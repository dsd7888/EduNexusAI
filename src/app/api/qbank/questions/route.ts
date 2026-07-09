import { requireRole, apiError } from "@/lib/api/helpers";
import { rowToBankQuestion, type FqbRow } from "@/lib/qbank/row";
import type { MCQOption, QuestionType } from "@/lib/qbank/types";
import type { NextRequest } from "next/server";

const BANK_TYPES = new Set<QuestionType>([
  "mcq",
  "short_answer",
  "long_answer",
  "numerical",
  "fill_blank",
]);

/**
 * Normalise a question type coming from the paper builder (which uses paper
 * shapes like "descriptive" / "attempt_any_one") to a bank QuestionType.
 */
function normaliseType(raw: unknown, marks: number): QuestionType {
  const s = String(raw ?? "").toLowerCase().trim();
  if (BANK_TYPES.has(s as QuestionType)) return s as QuestionType;
  if (s === "mcq" || s === "truefalse") return "mcq";
  if (s === "numerical") return "numerical";
  // descriptive / descriptive_with_or / attempt_any_one / short / long
  if (s === "short") return "short_answer";
  if (s === "long") return "long_answer";
  return marks >= 5 ? "long_answer" : "short_answer";
}

function normaliseOptions(raw: unknown): MCQOption[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: MCQOption[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    const obj = o as Record<string, unknown>;
    const label = String(obj.label ?? "").toUpperCase().trim();
    const text = String(obj.text ?? "").trim();
    if (!["A", "B", "C", "D"].includes(label) || !text) continue;
    out.push({
      label: label as MCQOption["label"],
      text,
      is_correct: Boolean(obj.is_correct),
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * POST /api/qbank/questions — save a single (typically faculty-edited)
 * question into the bank as a trusted, verified import.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON body", 400);
    }

    const subjectId = String(body.subject_id ?? "").trim();
    if (!subjectId) return apiError("subject_id is required", 400);

    // ── Ownership check ────────────────────────────────────────────────────
    // Faculty can only save bank questions for subjects they are assigned to.
    // Superadmin bypasses this check.
    if (profile.role === "faculty") {
      const { data: assignment } = await adminClient
        .from("faculty_assignments")
        .select("subject_id")
        .eq("faculty_id", user.id)
        .eq("subject_id", subjectId)
        .maybeSingle();
      if (!assignment) {
        return apiError(
          "Forbidden: subject is not assigned to this faculty",
          403
        );
      }
    }

    const questionText = String(body.question_text ?? "").trim();
    if (!questionText) return apiError("question_text is required", 400);

    const marks = Number(body.marks);
    if (!Number.isFinite(marks) || marks <= 0) {
      return apiError("marks must be a positive number", 400);
    }

    const questionType = normaliseType(body.question_type, marks);

    const btlRaw = body.btl_level;
    const btlNum = Number(btlRaw);
    const btlLevel =
      btlRaw != null && Number.isInteger(btlNum) && btlNum >= 1 && btlNum <= 6
        ? btlNum
        : null;

    const difficulty =
      body.difficulty === "easy" ||
      body.difficulty === "medium" ||
      body.difficulty === "hard"
        ? body.difficulty
        : null;

    const row = {
      subject_id: subjectId,
      faculty_id: user.id,
      module_id:
        typeof body.module_id === "string" && body.module_id ? body.module_id : null,
      question_text: questionText,
      question_type: questionType,
      marks,
      model_answer:
        typeof body.model_answer === "string" && body.model_answer.trim()
          ? body.model_answer.trim()
          : null,
      options: questionType === "mcq" ? normaliseOptions(body.options) : null,
      co_code:
        typeof body.co_code === "string" && body.co_code.trim()
          ? body.co_code.trim()
          : null,
      btl_level: btlLevel,
      po_codes: null,
      difficulty,
      source: "faculty_imported",
      is_verified: true, // faculty reviewed it before saving
    };

    const { data: inserted, error: insertError } = await adminClient
      .from("faculty_question_bank")
      .insert(row)
      .select("*")
      .single();
    if (insertError || !inserted) {
      console.error("[qbank/questions] insert failed:", insertError?.message);
      return apiError("Failed to save question to bank", 500);
    }

    return Response.json({ question: rowToBankQuestion(inserted as FqbRow) });
  } catch (err) {
    console.error("[qbank/questions] Error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to save question",
      500
    );
  }
}
