/**
 * PYQ structured extraction — the shared path behind BOTH upload routes.
 *
 * Lifted verbatim (prompts, parser, idempotent-delete, error contract) out of
 * src/app/api/upload/route.ts when the faculty-facing upload route was added,
 * so superadmin and faculty uploads can never drift into producing differently
 * shaped `pyq_questions` rows. The superadmin route now calls this too.
 *
 * Sends the PDF directly to Gemini Flash (no LlamaParse step) — Flash parses
 * exam-paper tables / column layouts well enough, and it saves a round-trip
 * plus the LlamaParse cost.
 *
 * NEVER THROWS. Extraction is best-effort enrichment on top of a file that is
 * already stored: a failure here must leave the upload intact (the generator
 * falls back to chunk-based context), so every path returns
 * `{ count, error }` rather than raising.
 */
import { routeAI } from "@/lib/ai/router";
import type { AILogContext } from "@/lib/ai/providers/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCoCode } from "./co";

const PYQ_EXTRACT_SYSTEM_PROMPT = `You are a precise exam question extractor for Indian engineering university papers. Extract every question exactly as written.
Output ONLY valid JSON array. First char [, last char ]. No markdown.`;

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

export interface PyqExtractionResult {
  count: number;
  error: string | null;
}

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
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const text = toStr(r.question_text);
    if (!text) continue;
    out.push({
      section_name: toStr(r.section_name),
      q_number: toStr(r.q_number),
      question_text: text,
      question_type: toStr(r.question_type),
      marks: toInt(r.marks),
      // Canonicalized on write — see src/lib/pyq/co.ts for why this cannot be
      // left "as printed".
      co: normalizeCoCode(toStr(r.co)),
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
 * Extract per-question PYQ rows from a PDF and write them to `pyq_questions`.
 * Idempotent per document: prior rows for the same `documentId` are cleared
 * first, so a re-process never doubles a paper's questions.
 */
export async function extractAndSavePyqQuestions(
  adminClient: SupabaseClient,
  params: {
    documentId: string;
    subjectId: string;
    year: number | null;
    pdfBase64: string;
    logContext: AILogContext;
  }
): Promise<PyqExtractionResult> {
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
      `[pyq/extract] Extracted ${questions.length} questions ` +
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
