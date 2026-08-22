import {
  createAdminClient,
  createServerClientForRequestResponse,
} from "@/lib/db/supabase-server";
import { apiError, requireRole } from "@/lib/api/helpers";
import { extractAndSavePyqQuestions } from "@/lib/pyq/extract";
import { isExamType } from "@/lib/pyq/coverage";
import { isMissingColumnError } from "@/lib/pyq/co";
import { type NextRequest, NextResponse } from "next/server";

const ALLOWED_TYPE = ["syllabus", "notes", "pyq"] as const;

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
    const examTypeRaw = String(formData.get("examType") ?? "").trim();
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
    // Optional on this route too — see the exam_type note in
    // 20260822000000_pyq_faculty_upload.sql for why it is worth capturing.
    const examType = type === "pyq" && isExamType(examTypeRaw) ? examTypeRaw : null;

    // exam_type ships in migration 20260822000000, which is applied by hand.
    // Retry without it if the column is not there yet, so a deploy that lands
    // before the migration cannot break this pre-existing upload path.
    const baseRow = {
      type,
      subject_id: subjectId,
      module_id: moduleId || null,
      year: yearValue,
      title: file.name,
      file_path: filePath,
      uploaded_by: user.id,
      status: "processing",
    };

    let { data: document, error: dbError } = await adminClient
      .from("documents")
      .insert({ ...baseRow, exam_type: examType })
      .select()
      .single();

    if (dbError && isMissingColumnError(dbError)) {
      console.warn(
        "[upload] documents.exam_type missing — retrying without it " +
          "(apply migration 20260822000000)"
      );
      ({ data: document, error: dbError } = await adminClient
        .from("documents")
        .insert(baseRow)
        .select()
        .single());
    }

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
