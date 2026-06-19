import { requireRole, apiError } from "@/lib/api/helpers";
import {
  generateForSlots,
  type GenSubjectContext,
  type GeneratedBankQuestion,
  type PyqInspiration,
} from "@/lib/qbank/generator";
import { tagQuestions } from "@/lib/qbank/tagger";
import { rowToBankQuestion, type FqbRow } from "@/lib/qbank/row";
import type { GenerationSlot, ImportedQuestion } from "@/lib/qbank/types";
import type { NextRequest } from "next/server";

const MAX_TOTAL_QUESTIONS = 60;
const VALID_TYPES = new Set([
  "mcq",
  "short_answer",
  "long_answer",
  "numerical",
  "fill_blank",
]);

function isValidSlot(s: unknown): s is GenerationSlot {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o.question_type === "string" &&
    VALID_TYPES.has(o.question_type) &&
    typeof o.marks === "number" &&
    o.marks > 0 &&
    typeof o.count === "number" &&
    o.count > 0 &&
    (o.style === "fresh" || o.style === "pyq_inspired")
  );
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON body", 400);
    }

    const subjectId = String(body.subject_id ?? "").trim();
    if (!subjectId) return apiError("subject_id is required", 400);

    const rawSlots = Array.isArray(body.slots) ? body.slots : [];
    const slots = rawSlots.filter(isValidSlot);
    if (slots.length === 0) {
      return apiError("At least one valid slot is required", 400);
    }
    const includePyq = Boolean(body.include_pyq);

    const totalRequested = slots.reduce((acc, s) => acc + s.count, 0);
    if (totalRequested > MAX_TOTAL_QUESTIONS) {
      return apiError(
        `Too many questions requested: ${totalRequested} (max ${MAX_TOTAL_QUESTIONS})`,
        400
      );
    }

    // ── Subject context ──────────────────────────────────────────────────
    const { data: subject, error: subjectError } = await adminClient
      .from("subjects")
      .select("name")
      .eq("id", subjectId)
      .single();
    if (subjectError || !subject) return apiError("Subject not found", 404);

    const { data: moduleRows } = await adminClient
      .from("modules")
      .select("id, name, description")
      .eq("subject_id", subjectId)
      .order("module_number");

    const { data: coRows } = await adminClient
      .from("course_outcomes")
      .select("co_code, description")
      .eq("subject_id", subjectId);

    const ctx: GenSubjectContext = {
      subject_name: (subject as { name: string }).name,
      modules: (moduleRows ?? []) as GenSubjectContext["modules"],
      course_outcomes: (coRows ?? []) as GenSubjectContext["course_outcomes"],
    };

    // ── PYQ inspiration (only when requested and pyq_inspired slots exist) ─
    let pyqs: PyqInspiration[] = [];
    const needsPyq = includePyq && slots.some((s) => s.style === "pyq_inspired");
    if (needsPyq) {
      const { data: pyqRows } = await adminClient
        .from("pyq_questions")
        .select("question_text")
        .eq("subject_id", subjectId)
        .order("year", { ascending: false })
        .limit(40);
      pyqs = ((pyqRows ?? []) as { question_text: string }[]).map((p) => ({
        question_text: p.question_text,
      }));
    }

    // ── Generate ─────────────────────────────────────────────────────────
    const generated = await generateForSlots(slots, ctx, pyqs);
    if (generated.length === 0) {
      return apiError("Generation produced no questions", 502);
    }

    // ── Tag any questions missing CO or BTL ──────────────────────────────
    await tagMissing(generated, ctx);

    // ── Insert ───────────────────────────────────────────────────────────
    const rows = generated.map((q) => ({
      subject_id: subjectId,
      faculty_id: user.id,
      module_id: q.module_id,
      question_text: q.question_text,
      question_type: q.question_type,
      marks: q.marks,
      model_answer: q.model_answer,
      options: q.options,
      co_code: q.co_code,
      btl_level: q.btl_level,
      po_codes: null,
      difficulty: q.difficulty,
      source: "ai_generated",
      is_verified: false,
    }));

    const { data: inserted, error: insertError } = await adminClient
      .from("faculty_question_bank")
      .insert(rows)
      .select("*");
    if (insertError) {
      console.error("[qbank generate] insert failed:", insertError.message);
      return apiError("Failed to save generated questions", 500);
    }

    const questions = ((inserted ?? []) as FqbRow[]).map(rowToBankQuestion);
    return Response.json({ added: questions.length, questions });
  } catch (err) {
    console.error("[qbank generate] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate questions";
    return apiError(message, 500);
  }
}

/**
 * AI-infer CO/BTL/difficulty for generated questions that came back without a
 * CO or BTL. Mutates the questions in place with the inferred values.
 */
async function tagMissing(
  generated: GeneratedBankQuestion[],
  ctx: GenSubjectContext
): Promise<void> {
  const untaggedIdx: number[] = [];
  const toTag: ImportedQuestion[] = [];
  generated.forEach((q, i) => {
    if (!q.co_code || q.btl_level == null) {
      untaggedIdx.push(i);
      toTag.push({
        question_text: q.question_text,
        question_type: q.question_type,
        marks: q.marks,
      });
    }
  });
  if (toTag.length === 0) return;

  const tagged = await tagQuestions(toTag, {
    subject_name: ctx.subject_name,
    modules: ctx.modules.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description ?? "",
    })),
    course_outcomes: ctx.course_outcomes,
  });

  tagged.forEach((t, i) => {
    const q = generated[untaggedIdx[i]];
    if (!q.co_code && t.inferred_co_code) q.co_code = t.inferred_co_code;
    if (q.btl_level == null) q.btl_level = t.inferred_btl_level;
    if (!q.difficulty) q.difficulty = t.inferred_difficulty;
    if (!q.module_id && t.inferred_module_id) q.module_id = t.inferred_module_id;
  });
}
