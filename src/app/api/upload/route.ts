import {
  createAdminClient,
  createServerClientForRequestResponse,
} from "@/lib/db/supabase-server";
import { requireAuth, requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { routeAI } from "@/lib/ai/router";
import type { AILogContext } from "@/lib/ai/providers/types";
import { type NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

const ALLOWED_TYPE = ["syllabus", "notes", "pyq"] as const;

const PYQ_EXTRACT_SYSTEM_PROMPT = `You are a precise exam question extractor for Indian engineering university papers. Extract every question exactly as written.
Output ONLY valid JSON array. First char [, last char ]. No markdown.`;

interface ExtractedPyq {
  section_name: string | null;
  q_number: string | null;
  question_text: string;
  question_type: string | null;
  marks: number | null;
  co: string | null;
  btl: number | null;
  po: string | null;
  options: Record<string, string> | null;
  is_or_alternative: boolean;
}

const PYQ_EXTRACT_USER_PROMPT = `Extract every question from the attached exam paper PDF.
For each question / sub-question output one object:
{
  "section_name": string,    // "Section I" | "Section II" | "Section A"
  "q_number": string,        // "Q-1", "Q-2", "Q-3(a)", "Q-3(b)"
  "question_text": string,   // exactly as written
  "question_type": "mcq"|"numerical"|"descriptive"|"short"|"fill_blank",
  "marks": number,
  "co": string | null,       // as printed, e.g. "03" or "CO3"
  "btl": number | null,      // 1-6, as printed
  "po": string | null,       // as printed, e.g. "04" or "PO4"
  "options": { "a": string, "b": string, "c": string, "d": string } | null,
  "is_or_alternative": boolean
}

Output a single JSON array. First char [, last char ]. No prose.`;

function parsePyqArray(raw: string): ExtractedPyq[] {
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();
  const first = cleaned.indexOf("[");
  const last = cleaned.lastIndexOf("]");
  const slice =
    first !== -1 && last > first ? cleaned.slice(first, last + 1) : cleaned;
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const toStr = (v: unknown): string | null => {
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s : null;
  };
  const toInt = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  };
  const out: ExtractedPyq[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const text = toStr(r.question_text);
    if (!text) continue;
    out.push({
      section_name: toStr(r.section_name),
      q_number: toStr(r.q_number),
      question_text: text,
      question_type: toStr(r.question_type),
      marks: toInt(r.marks),
      co: toStr(r.co),
      btl: toInt(r.btl),
      po: toStr(r.po),
      options:
        r.options && typeof r.options === "object"
          ? (r.options as Record<string, string>)
          : null,
      is_or_alternative: Boolean(r.is_or_alternative),
    });
  }
  return out;
}

/**
 * Extract per-question PYQ rows and write them to pyq_questions.
 * Sends the PDF directly to Gemini Flash (no LlamaParse step) — Flash
 * parses tables / column layouts well enough for exam papers and saves a
 * round-trip plus the LlamaParse cost.
 * Wrapped end-to-end in try/catch — never blocks the upload flow.
 */
async function extractAndSavePyqQuestions(
  adminClient: SupabaseClient,
  params: {
    documentId: string;
    subjectId: string;
    year: number | null;
    pdfBase64: string;
    logContext: AILogContext;
  }
): Promise<{ count: number; error: string | null }> {
  const { documentId, subjectId, year, pdfBase64, logContext } = params;
  try {
    if (!pdfBase64) {
      return { count: 0, error: "missing pdf data" };
    }

    const ai = await routeAI("pyq_extract", {
      systemPrompt: PYQ_EXTRACT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: PYQ_EXTRACT_USER_PROMPT }],
      attachments: [{ mediaType: "application/pdf", data: pdfBase64 }],
      logContext,
    });

    const questions = parsePyqArray(String(ai.content ?? ""));
    console.log(
      `[upload/pyq] Extracted ${questions.length} questions ` +
        `from document ${documentId.slice(0, 8)}`
    );
    if (questions.length === 0) {
      return { count: 0, error: "0 questions parsed" };
    }

    // Idempotent re-upload: clear prior rows for this document first.
    await adminClient
      .from("pyq_questions")
      .delete()
      .eq("document_id", documentId);

    const rows = questions.map((q) => ({
      document_id: documentId,
      subject_id: subjectId,
      section_name: q.section_name,
      q_number: q.q_number,
      question_text: q.question_text,
      question_type: q.question_type,
      marks: q.marks,
      co: q.co,
      btl: q.btl,
      po: q.po,
      options: q.options,
      year,
      is_or_alternative: q.is_or_alternative,
    }));

    const { error: insertError } = await adminClient
      .from("pyq_questions")
      .insert(rows);
    if (insertError) {
      return { count: 0, error: insertError.message };
    }
    return { count: rows.length, error: null };
  } catch (err) {
    return {
      count: 0,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

async function extractTextWithLlamaParse(
  fileBuffer: Buffer,
  fileName: string
): Promise<string> {
  const apiKey = process.env.LLAMA_CLOUD_API_KEY;
  if (!apiKey) {
    throw new Error("LLAMA_CLOUD_API_KEY not set");
  }

  const formData = new FormData();
  const arrayBuffer = Uint8Array.from(fileBuffer).buffer as ArrayBuffer;
  formData.append(
    "file",
    new Blob([arrayBuffer], { type: "application/pdf" }),
    fileName
  );

  // Step 1: Upload file
  const uploadRes = await fetch(
    "https://api.cloud.llamaindex.ai/api/parsing/upload",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`LlamaParse upload failed: ${err}`);
  }

  const { id } = await uploadRes.json();
  console.log(`[LlamaParse] Job started: ${id}`);

  // Step 2: Poll for result (max 90s, check every 5s)
  for (let attempt = 0; attempt < 18; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));

    const resultRes = await fetch(
      `https://api.cloud.llamaindex.ai/api/parsing/job/${id}/result/markdown`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );

    if (resultRes.ok) {
      const { markdown } = await resultRes.json();
      console.log(
        `[LlamaParse] Done. Characters extracted: ${markdown.length}`
      );
      return markdown;
    }

    // 404 means still processing — keep polling
    if (resultRes.status !== 404) {
      const err = await resultRes.text();
      throw new Error(`LlamaParse result error: ${err}`);
    }
  }

  throw new Error("LlamaParse timeout after 90s");
}

async function getSubjectCode(subjectId: string): Promise<string> {
  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("subjects")
    .select("code")
    .eq("id", subjectId)
    .single();
  return data?.code ?? "unknown";
}

export async function GET() {
  return NextResponse.json({ message: "upload" });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const type = formData.get("type") as string | null;
    const subjectId = formData.get("subjectId") as string | null;
    const moduleId = formData.get("moduleId") as string | null;
    const yearStr = formData.get("year") as string | null;
    const file = formData.get("file") as File | null;

    if (!type || !ALLOWED_TYPE.includes(type as (typeof ALLOWED_TYPE)[number])) {
      return NextResponse.json(
        { error: "Invalid or missing type (syllabus, notes, pyq)" },
        { status: 400 }
      );
    }
    if (!subjectId) {
      return NextResponse.json(
        { error: "Subject is required" },
        { status: 400 }
      );
    }
    if (!file || !(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "A valid PDF file is required" },
        { status: 400 }
      );
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Only PDF files are allowed" },
        { status: 400 }
      );
    }

    if (type === "notes" && !moduleId) {
      return NextResponse.json(
        { error: "Module is required for notes" },
        { status: 400 }
      );
    }
    if (type === "pyq") {
      const year = yearStr ? Number(yearStr) : NaN;
      if (!yearStr || isNaN(year) || year < 2020 || year > 2026) {
        return NextResponse.json(
          { error: "Valid year (2020–2026) is required for PYQs" },
          { status: 400 }
        );
      }
    }

    const response = NextResponse.next();
    const supabase = createServerClientForRequestResponse(request, response);
    const authResult = await requireRole(["superadmin"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    console.log("[upload] User ID:", user.id);

    const { data: subject } = await supabase
      .from("subjects")
      .select("id")
      .eq("id", subjectId)
      .single();

    if (!subject) {
      return NextResponse.json(
        { error: "Subject not found" },
        { status: 400 }
      );
    }

    if (type === "notes" && moduleId) {
      const { data: module } = await supabase
        .from("modules")
        .select("id")
        .eq("id", moduleId)
        .eq("subject_id", subjectId)
        .single();
      if (!module) {
        return NextResponse.json(
          { error: "Module not found or does not belong to subject" },
          { status: 400 }
        );
      }
    }

    const timestamp = Date.now();
    const subjectCode = await getSubjectCode(subjectId);
    const fileName = `${type}_${subjectCode}_${timestamp}.pdf`;
    const filePath = `${type}/${subjectId}/${fileName}`;

    const fileBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(fileBuffer);

    // LlamaParse is only needed for syllabus / notes (chunking + embedding
    // pipeline). PYQs go directly to Gemini Flash as a PDF attachment, so we
    // skip the LlamaParse round-trip entirely for that path.
    if (type !== "pyq") {
      const extractedText = await extractTextWithLlamaParse(buffer, file.name);
      console.log(`[upload] Extracted text length: ${extractedText.length}`);
    }

    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(filePath, fileBuffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const yearValue =
      type === "pyq" && yearStr ? Number(yearStr) : null;

    const { data: document, error: dbError } = await adminClient
      .from("documents")
      .insert({
        type,
        subject_id: subjectId,
        module_id: moduleId || null,
        year: yearValue,
        title: file.name,
        file_path: filePath,
        uploaded_by: user.id,
        status: "processing",
      })
      .select()
      .single();

    if (dbError) {
      console.error("[upload] Database error:", dbError);
      await supabase.storage.from("documents").remove([filePath]);
      return NextResponse.json(
        { error: `Database error: ${dbError.message}` },
        { status: 500 }
      );
    }

    // PYQ-specific: extract per-question structured data via Gemini Flash.
    // Sends the PDF directly (no LlamaParse, no chunks, no embeddings).
    // Wrapped in try/catch in the helper — any failure leaves the upload
    // intact and the qpaper generator falls back to chunk-based context.
    let pyqExtractedCount = 0;
    if (type === "pyq") {
      const pdfBase64 = buffer.toString("base64");
      const jobId = crypto.randomUUID();
      const result = await extractAndSavePyqQuestions(adminClient, {
        documentId: document.id,
        subjectId,
        year: yearValue,
        pdfBase64,
        logContext: {
          userId: user.id,
          userEmail: user.email ?? null,
          userRole: profile.role,
          subjectId,
          subjectCode,
          jobId,
          relatedContentId: null,
          feature: "pyq_extraction",
        },
      });
      pyqExtractedCount = result.count;
      if (result.error) {
        console.warn(
          `[upload/pyq] Extraction skipped/failed for ${document.id.slice(0, 8)}: ${result.error}`
        );
      } else {
        console.log(
          `[upload/pyq] Saved ${result.count} structured questions for ${document.id.slice(0, 8)}`
        );
      }
      // Mark PYQ docs as ready so downstream chunk fallback (and any future
      // listing UI) treats them as queryable. Non-fatal if it fails.
      await adminClient
        .from("documents")
        .update({ status: "ready" })
        .eq("id", document.id);
    }

    return NextResponse.json({
      success: true,
      message: "File uploaded successfully",
      documentId: document.id,
      pyqExtractedCount: type === "pyq" ? pyqExtractedCount : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return apiError(message, 500);
  }
}
