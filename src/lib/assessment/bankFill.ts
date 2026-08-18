/**
 * Assessment Engine — bank-first sourcing (CP-Q1).
 *
 * Before a single token is spent, every slot is offered to
 * `faculty_question_bank`. This is the union of two proven patterns:
 *
 *   * Q PAPER (src/lib/qpaper/bankFill.ts) — per-slot matching against the
 *     bank with the ordering `is_verified DESC, usage_count ASC, RANDOM()`, a
 *     shared `used` set so no question appears twice in one paper, and unfilled
 *     slots handed to the AI.
 *   * PLACEMENT (§16) — a per-student recency exclusion so the bank never
 *     serves a student a question they have just seen. Placement uses a 7-day
 *     window over student_question_history; the spec for the syllabus quiz is
 *     30 days over student_question_attempts.
 *
 * The difference from qpaper's version is what a slot is matched ON. A paper
 * slot matches type + MARKS (a 10-mark slot cannot take a 2-mark question). A
 * quiz slot's marks come from the MODE, not the question, so marks are not a
 * matching criterion at all — the criteria are (subject, module, type,
 * difficulty). That is why this is a sibling file and not a shared function:
 * same pattern, genuinely different matching key.
 *
 * SERVER-ONLY (admin client; bypasses RLS — faculty_question_bank RLS is
 * faculty-owned and a student can never read it directly).
 */

import type { createAdminClient } from "@/lib/db/supabase-server";
import type { MCQOption } from "@/lib/qbank/types";
import {
  BANK_TYPE_FOR,
  typeHasOptions,
  type AssessmentQuestion,
  type QuestionSlot,
} from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Per-student recency window. Placement uses 7 days for drill questions; a
 *  syllabus quiz pool is smaller and re-tests are more meaningful, but the spec
 *  window is 30 days — a question seen inside it is never re-served. */
const RECENCY_DAYS = 30;

/** Upper bound on candidate rows pulled per request. Well above any realistic
 *  per-subject bank (the largest today is ~10 rows); it exists so a future bank
 *  of tens of thousands cannot turn one quiz into a full-table read. */
const CANDIDATE_LIMIT = 2000;

const LETTERS = "ABCDEFGHIJ".split("");

interface BankRow {
  id: string;
  subject_id: string;
  module_id: string | null;
  question_text: string;
  question_type: string;
  model_answer: string | null;
  options: MCQOption[] | null;
  co_code: string | null;
  difficulty: string | null;
  is_verified: boolean;
  usage_count: number;
  numeric_answer: number | null;
  numeric_tolerance: number | null;
}

export interface BankFillResult {
  filled: AssessmentQuestion[];
  unfilled: QuestionSlot[];
  /** Bank ids actually served — the caller bumps usage_count / last_used_at and
   *  records attempts against these. */
  usedBankIds: string[];
  /** How many candidate rows the recency window removed from play. */
  excludedByRecency: number;
}

/**
 * Fill as many slots as possible from the bank.
 *
 * One query fetches the candidate pool for the whole request (filtered to the
 * subjects and bank-eligible question types in play) and matching happens in
 * memory. That is a deliberate departure from "one query per slot": a
 * 100-question plan would otherwise issue 100 round trips to score at most a
 * few hundred rows. The ORDERING is unchanged — `is_verified DESC,
 * usage_count ASC` comes from Postgres, and the RANDOM() tiebreak is applied
 * in memory (exactly as qpaper's `pickBest` does).
 */
export async function fillFromBank(
  slots: QuestionSlot[],
  studentId: string,
  admin: AdminClient
): Promise<BankFillResult> {
  if (slots.length === 0) {
    return { filled: [], unfilled: [], usedBankIds: [], excludedByRecency: 0 };
  }

  // Slots whose type has no bank equivalent (true_false, match) never touch the
  // bank — see BANK_TYPE_FOR for why coercing them would be wrong.
  const eligible = slots.filter((s) => BANK_TYPE_FOR[s.questionType] != null);
  const ineligible = slots.filter((s) => BANK_TYPE_FOR[s.questionType] == null);
  if (eligible.length === 0) {
    return {
      filled: [],
      unfilled: [...slots],
      usedBankIds: [],
      excludedByRecency: 0,
    };
  }

  const subjectIds = Array.from(new Set(eligible.map((s) => s.subjectId)));
  const bankTypes = Array.from(
    new Set(eligible.map((s) => BANK_TYPE_FOR[s.questionType] as string))
  );

  // ── Per-student recency exclusion (the placement pattern, generalised) ────
  const cutoff = new Date(
    Date.now() - RECENCY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data: seenRows } = await admin
    .from("student_question_attempts")
    .select("question_id")
    .eq("student_id", studentId)
    .gt("created_at", cutoff)
    .not("question_id", "is", null);
  const seenIds = new Set(
    ((seenRows ?? []) as Array<{ question_id: string | null }>)
      .map((r) => r.question_id)
      .filter((id): id is string => !!id)
  );

  // ── Candidate pool ────────────────────────────────────────────────────────
  const { data: bankRows, error } = await admin
    .from("faculty_question_bank")
    .select(
      "id, subject_id, module_id, question_text, question_type, model_answer, options, co_code, difficulty, is_verified, usage_count, numeric_answer, numeric_tolerance"
    )
    .in("subject_id", subjectIds)
    .in("question_type", bankTypes)
    .order("is_verified", { ascending: false })
    .order("usage_count", { ascending: true })
    .limit(CANDIDATE_LIMIT);
  if (error) {
    // A bank read failure must not fail the quiz — every slot simply becomes an
    // AI slot. Bank-first is an optimisation, never a dependency.
    console.warn(`[assessment bankFill] bank query failed: ${error.message}`);
    return {
      filled: [],
      unfilled: [...slots],
      usedBankIds: [],
      excludedByRecency: 0,
    };
  }

  const allRows = (bankRows ?? []) as BankRow[];
  const pool = allRows.filter((r) => !seenIds.has(r.id));
  const excludedByRecency = allRows.length - pool.length;

  // ── Per-slot matching ─────────────────────────────────────────────────────
  const used = new Set<string>();
  const filled: AssessmentQuestion[] = [];
  const unfilled: QuestionSlot[] = [...ineligible];

  for (const slot of eligible) {
    const bankType = BANK_TYPE_FOR[slot.questionType] as string;
    const candidates = pool.filter(
      (r) =>
        !used.has(r.id) &&
        r.subject_id === slot.subjectId &&
        r.question_type === bankType &&
        // A module-less slot accepts any module; a module-scoped slot does not
        // accept a module-less bank row — an untagged question has no proven
        // relationship to the module the plan is trying to cover.
        (slot.moduleId == null || r.module_id === slot.moduleId) &&
        r.difficulty === slot.difficulty
    );

    const picked = pickBest(candidates);
    if (!picked) {
      unfilled.push(slot);
      continue;
    }
    const question = bankRowToQuestion(picked, slot);
    if (!question) {
      // Structurally unusable (e.g. an MCQ row with no correct option marked).
      // Burn the id so it is not retried on the next slot, and fall through.
      used.add(picked.id);
      unfilled.push(slot);
      continue;
    }
    used.add(picked.id);
    filled.push(question);
  }

  // Restore plan order for the caller's convenience.
  unfilled.sort((a, b) => slotOrder(a) - slotOrder(b));

  return {
    filled,
    unfilled,
    usedBankIds: filled
      .map((q) => q.bankQuestionId)
      .filter((id): id is string => !!id),
    excludedByRecency,
  };
}

function slotOrder(s: QuestionSlot): number {
  const n = Number(s.slotId.replace(/^S/, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * is_verified DESC, usage_count ASC, RANDOM().
 *
 * REUSE: same selection rule as `pickBest` in src/lib/qpaper/bankFill.ts
 * (private there) and §11's documented bank ordering. The random tiebreak is
 * what stops the same "best" question being served to every student in a class
 * on the same day.
 */
function pickBest(candidates: BankRow[]): BankRow | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (a.is_verified !== b.is_verified) return a.is_verified ? -1 : 1;
    if (a.usage_count !== b.usage_count) return a.usage_count - b.usage_count;
    return Math.random() - 0.5;
  });
  return sorted[0];
}

/**
 * Project a bank row onto the slot it fills. Returns null when the row cannot
 * produce a gradeable question — better to fall through to the AI than to serve
 * an MCQ whose correct option nobody marked.
 */
export function bankRowToQuestion(
  row: BankRow,
  slot: QuestionSlot
): AssessmentQuestion | null {
  const base = {
    id: slot.slotId,
    question: row.question_text,
    type: slot.questionType,
    explanation: row.model_answer ?? "",
    difficulty: slot.difficulty,
    slotId: slot.slotId,
    subjectId: slot.subjectId,
    moduleId: row.module_id ?? slot.moduleId,
    marks: slot.marks,
    coCode: row.co_code ?? slot.targetCo,
    source: "bank" as const,
    bankQuestionId: row.id,
  };

  if (typeHasOptions(slot.questionType)) {
    const opts = Array.isArray(row.options) ? row.options : [];
    if (opts.length < 2) return null;
    const options = opts.map((o) => o.text);
    const correctLetters = opts
      .map((o, i) => (o.is_correct ? String(o.label ?? LETTERS[i]) : ""))
      .filter((l) => l.length > 0)
      .map((l) => l.toUpperCase());
    if (correctLetters.length === 0) return null;
    // MSQ grading is an exact SET comparison, so the stored answer must be the
    // full pipe-separated set; a single-select type takes the first letter.
    const correctAnswer =
      slot.questionType === "msq" || slot.questionType === "multiple_correct"
        ? correctLetters.join("|")
        : correctLetters[0];
    return { ...base, options, correctAnswer };
  }

  if (slot.questionType === "nat") {
    if (row.numeric_answer == null) return null;
    return {
      ...base,
      correctAnswer: String(row.numeric_answer),
      numericAnswer: Number(row.numeric_answer),
      numericTolerance:
        row.numeric_tolerance == null ? 0 : Number(row.numeric_tolerance),
    };
  }

  // short / descriptive-ish: the model answer IS the answer.
  if (!row.model_answer) return null;
  return { ...base, correctAnswer: row.model_answer };
}
