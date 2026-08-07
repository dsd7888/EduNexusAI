/**
 * Assessment Engine — batched fresh generation (CP-Q1).
 *
 * Everything the bank could not cover comes here. Three properties matter, and
 * each one is a direct fix for a defect in the current
 * /api/quiz/generate route:
 *
 *  1. BATCHED, NOT SINGLE-CALL. The current route asks Flash for the whole quiz
 *     in ONE 8k-token call, which hard-caps a "100-question" request at roughly
 *     20 questions before the JSON truncates. Here slots are grouped into
 *     batches of 5 (the proven Flash window — §11's Q Bank concurrency and §19's
 *     "content batches: 5 slides per request" are the same discovery) and run 4
 *     batches in parallel, so cost and latency scale with question count instead
 *     of falling off a cliff.
 *
 *  2. FULL SYLLABUS, NEVER TRUNCATED. The current route does
 *     `combinedSyllabus.slice(0, 2000)`, which silently deletes every subject
 *     after the first ~2000 characters — a multi-subject quiz is generated from
 *     the first subject's opening modules and nothing else. Each batch here is
 *     scoped to ONE subject and receives that subject's complete syllabus text.
 *     Batching is what makes this affordable: the prompt is per-subject, so no
 *     call ever needs to carry three syllabi at once.
 *
 *  3. STRICT responseSchema, NARROWED PER TYPE. §19: irrelevant optional fields
 *     in a schema remove the model's stopping pressure and cause runaway token
 *     cost. So `options` exists in the schema ONLY for MCQ/MSQ batches, and
 *     `numeric_answer`/`numeric_tolerance` ONLY for NAT batches — which is also
 *     why batches are grouped by question type, not just by subject.
 *
 * Write-through: every accepted question is inserted into faculty_question_bank
 * (source='ai_generated', is_verified=false) so a good AI question becomes
 * reusable bank material for the next student — the same
 * bank-first-with-write-through loop placement uses (§16).
 *
 * SERVER-ONLY (admin client + routeAI).
 */

import { routeAI } from "@/lib/ai/router";
import { estimateMaxOutputTokens } from "@/lib/ai/tokenBudget";
import { classifySubjectFamily } from "@/lib/qpaper/archetypes";
import {
  MATH_CHEM_NOTATION_GUIDE,
  hasLatex,
  repairGeminiJsonEscapes,
} from "@/lib/text/latexSegments";
import type { createAdminClient } from "@/lib/db/supabase-server";
import type { AILogContext } from "@/lib/ai/providers/types";
import {
  BANK_TYPE_FOR,
  typeHasOptions,
  type AssessmentQuestion,
  type AssessmentQuestionType,
  type QuestionSlot,
} from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Slots per AI call. The proven Flash structured-output window (§11, §19). */
const BATCH_SIZE = 5;
/** Batches in flight at once. */
const CONCURRENCY = 4;
/** PYQ hints are best-effort flavour, not context — a handful is plenty. */
const PYQ_PER_BATCH = 4;

const SYSTEM_PROMPT = `You are an expert university examiner writing practice questions for Indian engineering students. Every question must be:
- answerable from the syllabus text provided, and from nothing else
- unambiguous and self-contained (a student can answer it without seeing your prompt)
- factually correct — every formula, complexity claim, and numeric result verified
- accompanied by an explanation that teaches WHY the answer is right, not one that restates it

Output must obey the provided JSON schema exactly.`;

// ─── Subject context ───────────────────────────────────────────────────────

export interface AssessmentModule {
  id: string;
  module_number: number;
  name: string;
  description: string;
}

export interface AssessmentSubjectContext {
  subjectId: string;
  subjectName: string;
  subjectCode: string | null;
  /** The subject's FULL syllabus text. Never truncated — that truncation is
   *  the specific defect this engine replaces. */
  syllabus: string;
  modules: AssessmentModule[];
  courseOutcomes: { co_code: string; description: string }[];
  /** Past questions for style flavour, best-effort (pyq_questions has no
   *  module_id, so these are subject-level). */
  pyqs: string[];
  /** True when the subject's name/code or content carries math/chem notation —
   *  gates the MATH_CHEM_NOTATION_GUIDE block (§13). */
  mathChem: boolean;
  /** faculty_question_bank.faculty_id to attribute write-through rows to.
   *  Null when no faculty is assigned to the subject — write-through is then
   *  skipped (the questions are still served; see writeThroughToBank). */
  facultyId: string | null;
}

/**
 * Load the generation context for each subject. Separate from
 * generateFreshQuestions so a caller (or the CP-Q2 mode router) can load once
 * and reuse across retries.
 */
export async function loadSubjectContexts(
  subjectIds: string[],
  admin: AdminClient
): Promise<Map<string, AssessmentSubjectContext>> {
  const out = new Map<string, AssessmentSubjectContext>();
  const ids = Array.from(new Set(subjectIds)).filter(Boolean);
  if (ids.length === 0) return out;

  const [subjects, modules, contents, cos, pyqs, assignments] =
    await Promise.all([
      admin.from("subjects").select("id, name, code").in("id", ids),
      admin
        .from("modules")
        .select("id, subject_id, module_number, name, description")
        .in("subject_id", ids)
        .order("module_number"),
      admin
        .from("subject_content")
        .select("subject_id, content")
        .in("subject_id", ids),
      admin
        .from("course_outcomes")
        .select("subject_id, co_code, description")
        .in("subject_id", ids),
      admin
        .from("pyq_questions")
        .select("subject_id, question_text")
        .in("subject_id", ids)
        .limit(200),
      admin
        .from("faculty_assignments")
        .select("subject_id, faculty_id")
        .in("subject_id", ids),
    ]);

  for (const s of (subjects.data ?? []) as Array<{
    id: string;
    name: string;
    code: string | null;
  }>) {
    const subjectModules = (
      (modules.data ?? []) as Array<{
        id: string;
        subject_id: string;
        module_number: number;
        name: string;
        description: string | null;
      }>
    )
      .filter((m) => m.subject_id === s.id)
      .map((m) => ({
        id: m.id,
        module_number: m.module_number,
        name: m.name,
        description: m.description ?? "",
      }));

    const syllabus =
      ((contents.data ?? []) as Array<{ subject_id: string; content: string | null }>)
        .find((c) => c.subject_id === s.id)?.content ??
      // Fallback: reconstruct from module descriptions when subject_content has
      // no row. Still complete — just less prose than the seeded text.
      subjectModules
        .map(
          (m) => `Module ${m.module_number}: ${m.name}\n${m.description}`.trim()
        )
        .join("\n\n");

    out.set(s.id, {
      subjectId: s.id,
      subjectName: s.name,
      subjectCode: s.code,
      syllabus,
      modules: subjectModules,
      courseOutcomes: (
        (cos.data ?? []) as Array<{
          subject_id: string;
          co_code: string;
          description: string;
        }>
      )
        .filter((c) => c.subject_id === s.id)
        .map((c) => ({ co_code: c.co_code, description: c.description })),
      pyqs: (
        (pyqs.data ?? []) as Array<{ subject_id: string; question_text: string }>
      )
        .filter((p) => p.subject_id === s.id)
        .map((p) => p.question_text),
      mathChem:
        classifySubjectFamily(s.name, s.code ?? undefined) !== null ||
        hasLatex(syllabus),
      facultyId:
        (
          (assignments.data ?? []) as Array<{
            subject_id: string;
            faculty_id: string;
          }>
        ).find((a) => a.subject_id === s.id)?.faculty_id ?? null,
    });
  }

  return out;
}

// ─── responseSchema (narrowed per question type — §19) ─────────────────────

interface SchemaNode {
  type: string;
  [key: string]: unknown;
}

/**
 * The schema for ONE batch. Only the fields the batch's question type actually
 * uses are present:
 *   - `options`: MCQ / MSQ only.
 *   - `numeric_answer` + `numeric_tolerance`: NAT only, and both REQUIRED there
 *     (a NAT question without a tolerance is not gradeable).
 * Every string is maxLength-bounded and the array is maxItems-bounded to
 * BATCH_SIZE — §19's serving-ceiling rule: maxItems drives Gemini's constraint
 * state count, so it stays small and the prompt-side batch matches it exactly.
 */
export function buildResponseSchema(
  questionType: AssessmentQuestionType,
  batchSize: number
): object {
  const properties: Record<string, SchemaNode> = {
    id: { type: "string", maxLength: 12 },
    question_text: { type: "string", maxLength: 1200 },
    correct_answer: { type: "string", maxLength: 300 },
    explanation: { type: "string", maxLength: 700 },
    difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
    question_type: { type: "string", maxLength: 20 },
    module_id: { type: "string", maxLength: 40 },
    co_code: { type: "string", maxLength: 12 },
  };
  const required = [
    "id",
    "question_text",
    "correct_answer",
    "explanation",
    "difficulty",
    "question_type",
    "module_id",
  ];

  if (typeHasOptions(questionType)) {
    properties.options = {
      type: "array",
      items: { type: "string", maxLength: 300 },
      minItems: 2,
      maxItems: 5,
    };
    required.push("options");
  }
  if (questionType === "nat") {
    properties.numeric_answer = { type: "number" };
    properties.numeric_tolerance = { type: "number" };
    required.push("numeric_answer", "numeric_tolerance");
  }

  return {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: { type: "object", properties, required },
        minItems: 1,
        maxItems: batchSize,
      },
    },
    required: ["questions"],
  };
}

// ─── Prompt ────────────────────────────────────────────────────────────────

const TYPE_RULES: Record<string, string> = {
  mcq: `Exactly 4 options. EXACTLY ONE is correct. Distractors must be plausible — a common misconception, an off-by-one, or a near-miss formula, never filler.
"correct_answer" is the LETTER of the correct option: "A", "B", "C" or "D" (A = first element of options).`,
  msq: `Multiple-Select Question (GATE style). Provide 4 or 5 options of which EXACTLY 2 or 3 are correct — never 1, never all.
"correct_answer" is a PIPE-SEPARATED list of the correct option LETTERS in ascending order, e.g. "A|C" or "B|C|E". Letters map positionally: A = options[0], B = options[1], and so on.
Every correct option must be independently, defensibly correct; every incorrect option must be independently wrong. Do not write an option that is "partly right".`,
  multiple_correct: `Provide 4 or 5 options of which EXACTLY 2 or 3 are correct.
"correct_answer" is a PIPE-SEPARATED list of the correct option LETTERS, e.g. "A|C".`,
  nat: `Numerical Answer Type (GATE style). NO options — the student types a number.
The question must have ONE unambiguous numeric answer computable from the syllabus. State every value needed, and state the unit and the required precision in the question text.
"numeric_answer" is that number (a JSON number, not a string). "correct_answer" is the same number written as a string.
"numeric_tolerance" is the accepted error as a PERCENTAGE of the answer: use 0 for exact-integer answers (counts, indices), and 1 to 2 for answers that involve rounding or physical constants.
Keep the computation SHORT — a student must reach the number in at most three steps of arithmetic. Do not build a question that requires transforming a long string or table.
The explanation states those steps and stops. Do NOT enumerate cases, do NOT re-derive alternatives, do NOT work the problem twice.`,
  true_false: `No options. "correct_answer" is exactly "True" or "False".`,
  short: `No options. "correct_answer" is a concise 1–2 sentence model answer.`,
  match: `Provide exactly 4 combination options in the MCQ style; "correct_answer" is the letter of the fully-correct combination.`,
};

function buildBatchPrompt(
  batch: QuestionSlot[],
  ctx: AssessmentSubjectContext,
  questionType: AssessmentQuestionType
): string {
  const moduleIdsInBatch = Array.from(
    new Set(batch.map((s) => s.moduleId).filter((id): id is string => !!id))
  );
  const moduleBlock =
    moduleIdsInBatch.length > 0
      ? moduleIdsInBatch
          .map((id) => {
            const m = ctx.modules.find((mm) => mm.id === id);
            if (!m) return `- ${id}: (unknown module)`;
            return `- module_id ${m.id} → Module ${m.module_number}: ${m.name}\n  Topics: ${m.description || "(see syllabus)"}`;
          })
          .join("\n")
      : "- (no module scoping — draw from the whole syllabus)";

  const coBlock =
    ctx.courseOutcomes.length > 0
      ? ctx.courseOutcomes
          .map((c) => `${c.co_code}: ${c.description}`)
          .join("\n")
      : "(no course outcomes recorded)";

  const slotBlock = batch
    .map((s) => {
      const parts = [
        `id: ${s.slotId}`,
        `module_id: ${s.moduleId ?? "any"}`,
        `difficulty: ${s.difficulty}`,
      ];
      if (s.targetCo) parts.push(`target CO: ${s.targetCo}`);
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");

  // PYQ style hint — best-effort. pyq_questions carries no module_id, so these
  // are subject-level exemplars of HOW this university asks, never content to
  // copy (§12: same concept, different values/context/framing).
  const pyqBlock =
    ctx.pyqs.length > 0
      ? `\n<past_paper_style_reference>
These are real past questions from this subject. Match their PHRASING STYLE and
level of specificity. Do NOT reproduce them — different values, different framing.
${ctx.pyqs
  .slice(0, PYQ_PER_BATCH)
  .map((p, i) => `${i + 1}. ${p.replace(/\s+/g, " ").slice(0, 300)}`)
  .join("\n")}
</past_paper_style_reference>\n`
      : "";

  const mathBlock = ctx.mathChem
    ? `\n<notation>
${MATH_CHEM_NOTATION_GUIDE}
</notation>\n`
    : "";

  return `<subject>
${ctx.subjectName}${ctx.subjectCode ? ` (${ctx.subjectCode})` : ""}
</subject>

<syllabus>
${ctx.syllabus}
</syllabus>

<modules_in_scope>
${moduleBlock}
</modules_in_scope>

<course_outcomes>
${coBlock}
</course_outcomes>
${pyqBlock}${mathBlock}
<task>
Write exactly ${batch.length} ${questionType.toUpperCase()} question(s) — one for each slot below.
Return them in the SAME ORDER, echoing each slot's id and module_id verbatim in
the corresponding object, and honouring that slot's difficulty.

${slotBlock}
</task>

<rules>
${TYPE_RULES[questionType] ?? TYPE_RULES.mcq}
- "question_type" must be exactly "${questionType}" on every object.
- "difficulty" must be exactly the difficulty requested for that slot.
- "module_id" must be copied verbatim from the slot.
- "co_code" should be the course outcome the question serves, when one applies.
- Each question must test a DIFFERENT idea from the others in this batch.
- Never reveal the answer inside the question text.
- "explanation" is at most 60 words. This is a hard limit: an explanation that
  runs long is the single failure mode that truncates the whole batch, and a
  truncated batch loses every question in it, not just the long one.
- easy = recall or one-step application; medium = multi-step reasoning or an
  applied scenario; hard = analysis, comparison, or a multi-concept problem.
</rules>`;
}

// ─── Generation ────────────────────────────────────────────────────────────

export interface GenerationResult {
  generated: AssessmentQuestion[];
  /** Slots the AI did not produce a valid question for. Surfaced, never
   *  swallowed — a short quiz must be the caller's decision, not a silent one. */
  failed: QuestionSlot[];
  /** Per-batch failure reasons, for logging / the API response. */
  errors: string[];
  /** How many generated questions were persisted to faculty_question_bank. */
  writtenToBank: number;
}

interface RawQuestion {
  id?: string;
  question_text?: string;
  options?: unknown;
  correct_answer?: unknown;
  explanation?: string;
  difficulty?: string;
  question_type?: string;
  module_id?: string;
  co_code?: string;
  numeric_answer?: unknown;
  numeric_tolerance?: unknown;
}

/**
 * Generate questions for the slots the bank could not fill.
 *
 * Slots are grouped by (subject, question type) — the type grouping is what
 * lets each call carry a schema narrowed to exactly that type's fields — then
 * chunked into batches of {@link BATCH_SIZE} and run {@link CONCURRENCY} at a
 * time.
 */
export async function generateFreshQuestions(
  slots: QuestionSlot[],
  subjectContexts: Map<string, AssessmentSubjectContext>,
  admin: AdminClient,
  logContext: AILogContext
): Promise<GenerationResult> {
  if (slots.length === 0) {
    return { generated: [], failed: [], errors: [], writtenToBank: 0 };
  }

  // ── group → batch ─────────────────────────────────────────────────────────
  const groups = new Map<string, QuestionSlot[]>();
  const failed: QuestionSlot[] = [];
  const errors: string[] = [];

  for (const slot of slots) {
    if (!subjectContexts.has(slot.subjectId)) {
      failed.push(slot);
      continue;
    }
    const key = `${slot.subjectId}::${slot.questionType}`;
    const list = groups.get(key) ?? [];
    list.push(slot);
    groups.set(key, list);
  }
  if (failed.length > 0) {
    errors.push(
      `${failed.length} slot(s) had no subject context loaded and were not generated.`
    );
  }

  const batches: QuestionSlot[][] = [];
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      batches.push(list.slice(i, i + BATCH_SIZE));
    }
  }

  // ── run ───────────────────────────────────────────────────────────────────
  const generated: AssessmentQuestion[] = [];
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const window = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      window.map((batch, offset) =>
        runBatch(
          batch,
          subjectContexts.get(batch[0].subjectId)!,
          logContext,
          i + offset
        )
      )
    );
    for (const r of results) {
      generated.push(...r.questions);
      failed.push(...r.failed);
      if (r.error) errors.push(r.error);
    }
  }

  // ── write-through ─────────────────────────────────────────────────────────
  // NAT items are DELIBERATELY EXCLUDED here. Their write-through is gated on
  // gate 2 (natVerify.ts): a NAT question whose answer is wrong must never
  // reach the bank, because a bad bank row is then served free to every future
  // student, forever. The verification pipeline calls writeQuestionsToBank()
  // itself for the NAT items that pass. See CP_Q2_MODES_AND_VERIFIER.md.
  const writtenToBank = await writeQuestionsToBank(
    generated.filter((q) => q.type !== "nat"),
    subjectContexts,
    admin
  );

  failed.sort((a, b) => slotOrder(a) - slotOrder(b));
  return { generated, failed, errors, writtenToBank };
}

function slotOrder(s: QuestionSlot): number {
  const n = Number(s.slotId.replace(/^S/, ""));
  return Number.isFinite(n) ? n : 0;
}

async function runBatch(
  batch: QuestionSlot[],
  ctx: AssessmentSubjectContext,
  logContext: AILogContext,
  batchIndex: number
): Promise<{
  questions: AssessmentQuestion[];
  failed: QuestionSlot[];
  error?: string;
}> {
  const questionType = batch[0].questionType;
  const prompt = buildBatchPrompt(batch, ctx, questionType);

  try {
    const res = await routeAI("quiz_gen_v2", {
      model: "flash",
      messages: [{ role: "user", content: prompt }],
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0.6,
      responseSchema: buildResponseSchema(questionType, batch.length),
      // §19: structured task → thinking OFF. Flash thinking tokens are drawn
      // from maxOutputTokens and would truncate the JSON mid-array.
      thinkingBudget: 0,
      maxTokens: estimateMaxOutputTokens(
        [{ type: questionType, count: batch.length }],
        "assessment",
        { latexVerbose: ctx.mathChem }
      ),
      logContext: {
        ...logContext,
        subjectId: ctx.subjectId,
        subjectCode: ctx.subjectCode,
        metadata: {
          ...(logContext.metadata ?? {}),
          batchIndex,
          questionType,
          batchSize: batch.length,
        },
      },
    });

    const raw = parseBatch(String(res.content ?? ""));
    if (!raw) {
      // Log the tail, not the head: a schema-constrained response that fails to
      // parse is almost always TRUNCATED (the output-token budget ran out), and
      // the tail is what shows that. The head looks perfectly healthy.
      const text = String(res.content ?? "");
      console.warn(
        `[assessment generate] batch ${batchIndex} unparseable (${text.length} chars, ${res.tokensUsed.output} output tokens). Tail: …${text.slice(-200)}`
      );
      return {
        questions: [],
        failed: [...batch],
        error: `batch ${batchIndex} (${questionType} × ${batch.length}): response did not parse`,
      };
    }

    // Match by echoed slot id first; fall back to position for anything the
    // model failed to label. Never silently drop a slot.
    const byId = new Map<string, RawQuestion>();
    const unlabelled: RawQuestion[] = [];
    for (const r of raw) {
      const id = typeof r.id === "string" ? r.id.trim() : "";
      if (id && batch.some((s) => s.slotId === id) && !byId.has(id)) {
        byId.set(id, r);
      } else {
        unlabelled.push(r);
      }
    }

    const questions: AssessmentQuestion[] = [];
    const failedSlots: QuestionSlot[] = [];
    for (const slot of batch) {
      const item = byId.get(slot.slotId) ?? unlabelled.shift();
      const q = item ? normalise(item, slot, ctx) : null;
      if (q) questions.push(q);
      else failedSlots.push(slot);
    }

    const error =
      failedSlots.length > 0
        ? `batch ${batchIndex} (${questionType} × ${batch.length}): ${failedSlots.length} slot(s) returned no valid question`
        : undefined;
    return { questions, failed: failedSlots, error };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.warn(`[assessment generate] batch ${batchIndex} failed: ${message}`);
    return {
      questions: [],
      failed: [...batch],
      error: `batch ${batchIndex} (${questionType} × ${batch.length}): ${message}`,
    };
  }
}

/** responseSchema guarantees the shape, but a 429-retry or a future schema-less
 *  path could still hand us fenced text — so parse defensively. */
function parseBatch(rawText: string): RawQuestion[] | null {
  // §13: repair the Gemini escape collision before both parse attempts —
  // quiz stems and NAT explanations carry `$\frac{…}$` / `\theta` routinely.
  const cleaned = repairGeminiJsonEscapes(
    rawText
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/gi, "")
      .trim(),
  );
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (Array.isArray(parsed)) return parsed as RawQuestion[];
    if (parsed && typeof parsed === "object") {
      const qs = (parsed as { questions?: unknown }).questions;
      if (Array.isArray(qs)) return qs as RawQuestion[];
    }
  } catch {
    // fall through
  }
  const first = cleaned.indexOf("[");
  const last = cleaned.lastIndexOf("]");
  if (first !== -1 && last > first) {
    try {
      const arr = JSON.parse(cleaned.slice(first, last + 1)) as unknown;
      if (Array.isArray(arr)) return arr as RawQuestion[];
    } catch {
      // fall through
    }
  }
  return null;
}

const LETTERS = "ABCDEFGHIJ".split("");

/**
 * Validate one raw item against its slot. Returns null (→ the slot is reported
 * as failed) rather than repairing anything into a question that would grade
 * incorrectly — a silently-wrong MSQ key is worse than a missing question.
 */
export function normalise(
  raw: RawQuestion,
  slot: QuestionSlot,
  ctx: AssessmentSubjectContext
): AssessmentQuestion | null {
  const question = String(raw.question_text ?? "").trim();
  const explanation = String(raw.explanation ?? "").trim();
  if (!question || !explanation) return null;

  // The slot is authoritative for difficulty/type/module — the AI echoes them
  // so we can detect drift, it does not get to choose them (§12).
  const moduleId =
    typeof raw.module_id === "string" &&
    ctx.modules.some((m) => m.id === raw.module_id)
      ? raw.module_id
      : slot.moduleId;

  const base = {
    id: slot.slotId,
    question,
    type: slot.questionType,
    explanation,
    difficulty: slot.difficulty,
    slotId: slot.slotId,
    subjectId: slot.subjectId,
    moduleId,
    marks: slot.marks,
    coCode:
      typeof raw.co_code === "string" && raw.co_code.trim()
        ? raw.co_code.trim()
        : slot.targetCo,
    source: "ai_fresh" as const,
  };

  const answerRaw = String(raw.correct_answer ?? "").trim();

  if (typeHasOptions(slot.questionType)) {
    const options = Array.isArray(raw.options)
      ? (raw.options as unknown[]).map((o) => String(o).trim()).filter(Boolean)
      : [];
    if (options.length < 2) return null;

    const letters = parseAnswerLetters(answerRaw, options);
    if (letters.length === 0) return null;

    const isMulti =
      slot.questionType === "msq" || slot.questionType === "multiple_correct";
    // A single-select type with several keyed options, or a multi-select with
    // exactly one, means the model misunderstood the task — reject rather than
    // guess which reading was intended.
    if (!isMulti && letters.length !== 1) return null;
    if (isMulti && (letters.length < 2 || letters.length >= options.length)) {
      return null;
    }
    return { ...base, options, correctAnswer: letters.join("|") };
  }

  if (slot.questionType === "nat") {
    const n = Number(raw.numeric_answer);
    if (!Number.isFinite(n)) return null;
    const tolRaw = Number(raw.numeric_tolerance);
    // Absent/absurd tolerance → 0 (exact). Never a wide default: a generous
    // tolerance nobody asked for silently marks wrong answers correct.
    const tolerance = Number.isFinite(tolRaw) && tolRaw >= 0 && tolRaw <= 25 ? tolRaw : 0;
    return {
      ...base,
      correctAnswer: String(n),
      numericAnswer: n,
      numericTolerance: tolerance,
    };
  }

  if (!answerRaw) return null;
  if (slot.questionType === "true_false") {
    const tf = answerRaw.toLowerCase().startsWith("t") ? "True" : "False";
    return { ...base, correctAnswer: tf };
  }
  return { ...base, correctAnswer: answerRaw };
}

/**
 * Normalise an answer key to option LETTERS. Accepts what models actually
 * emit: "A", "a", "A|C", "A, C", "(A)", or the option TEXT itself.
 */
function parseAnswerLetters(answer: string, options: string[]): string[] {
  if (!answer) return [];
  const valid = new Set(options.map((_, i) => LETTERS[i]));
  const out: string[] = [];
  for (const piece of answer.split(/[|,;]+/)) {
    const p = piece.trim();
    if (!p) continue;
    const bare = p.replace(/[()\s.]/g, "").toUpperCase();
    if (bare.length === 1 && valid.has(bare)) {
      if (!out.includes(bare)) out.push(bare);
      continue;
    }
    const byText = options.findIndex(
      (o) => o.toLowerCase() === p.toLowerCase()
    );
    if (byText >= 0 && !out.includes(LETTERS[byText])) {
      out.push(LETTERS[byText]);
    }
  }
  return out.sort();
}

// ─── Write-through ─────────────────────────────────────────────────────────

/**
 * Persist accepted questions to faculty_question_bank as unverified
 * ai_generated rows, so the next student's fillFromBank can serve them for
 * free. Mutates each question's `bankQuestionId` on success.
 *
 * EXPORTED because NAT items take a different route to this function: they are
 * held back from the batch write above and only passed here once gate 2 has
 * verified them (natVerify.ts). Everything written here is still
 * `is_verified=false` — AI-verified is not faculty-verified.
 *
 * Skipped for subjects with no faculty assignment: faculty_question_bank
 * requires a NOT NULL faculty_id, and attributing a question to an arbitrary
 * profile would put it in someone's personal bank UI. The question is still
 * returned and still served — write-through is a cache-warm, never a gate.
 */
export async function writeQuestionsToBank(
  questions: AssessmentQuestion[],
  subjectContexts: Map<string, AssessmentSubjectContext>,
  admin: AdminClient
): Promise<number> {
  const rows: Array<Record<string, unknown>> = [];
  const backRefs: AssessmentQuestion[] = [];

  for (const q of questions) {
    const ctx = subjectContexts.get(q.subjectId);
    if (!ctx?.facultyId) continue;
    const bankType = BANK_TYPE_FOR[q.type];
    if (!bankType) continue;

    rows.push({
      subject_id: q.subjectId,
      faculty_id: ctx.facultyId,
      module_id: q.moduleId,
      question_text: q.question,
      question_type: bankType,
      marks: q.marks,
      model_answer: q.explanation,
      options: q.options
        ? q.options.map((text, i) => ({
            label: LETTERS[i],
            text,
            is_correct: q.correctAnswer.split("|").includes(LETTERS[i]),
          }))
        : null,
      co_code: q.coCode ?? null,
      difficulty: q.difficulty,
      source: "ai_generated",
      is_verified: false,
      usage_count: 0,
      numeric_answer: q.numericAnswer ?? null,
      numeric_tolerance: q.numericTolerance ?? null,
    });
    backRefs.push(q);
  }

  if (rows.length === 0) return 0;

  const { data, error } = await admin
    .from("faculty_question_bank")
    .insert(rows)
    .select("id");
  if (error) {
    console.warn(
      `[assessment generate] bank write-through failed (questions still served): ${error.message}`
    );
    return 0;
  }
  const inserted = (data ?? []) as Array<{ id: string }>;
  inserted.forEach((row, i) => {
    if (backRefs[i]) backRefs[i].bankQuestionId = row.id;
  });
  return inserted.length;
}
