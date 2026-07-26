/**
 * Shared types for the Assessment Engine (CP-Q1).
 *
 * The engine is the backend the three student quiz modes (quick / mastery /
 * exam_sim) will consume in CP-Q2. It is PURELY ADDITIVE in this checkpoint:
 * `src/app/api/quiz/generate/route.ts` and `src/lib/quiz/generator.ts` keep
 * serving the current UI untouched until CP-Q3 swaps the route.
 *
 * Question types extend — never replace — the existing `QuizQuestion` union in
 * `src/lib/quiz/generator.ts` with the two GATE-critical additions:
 *
 *   'msq' — multiple-select MCQ. 4–5 options, 2–3 correct. `correctAnswer` is a
 *           PIPE-SEPARATED list of option LETTERS ("A|C"). Letters, not option
 *           text, because a student's selection is a set of positions and
 *           grading must be an exact set comparison — matching on text breaks
 *           the moment an option is reworded.
 *   'nat' — numerical answer type. No options. `correctAnswer` is the answer as
 *           a string; `numericAnswer` carries the same value as a number and
 *           `numericTolerance` is a PERCENTAGE (GATE convention: an answer is
 *           correct when |given − expected| ≤ expected × tolerance/100).
 */

import type { QuizQuestion } from "@/lib/quiz/generator";
import type { QuestionType as BankQuestionType } from "@/lib/qbank/types";

// ─── Question types ────────────────────────────────────────────────────────

/**
 * The existing quiz types plus 'msq' and 'nat'. Derived from QuizQuestion so
 * the two unions can never silently drift — adding a type to quiz/generator.ts
 * automatically widens this one.
 */
export type AssessmentQuestionType = QuizQuestion["type"] | "msq" | "nat";

export type AssessmentDifficulty = "easy" | "medium" | "hard";

/** The difficulty a caller may REQUEST (per-slot values are always concrete). */
export type RequestedDifficulty =
  | AssessmentDifficulty
  | "mixed"
  | "adaptive";

export type AssessmentMode = "quick" | "mastery" | "exam_sim";

export type AssessmentPreset = "gate";

/**
 * A question produced by the engine — either pulled from the bank or generated
 * fresh. Field-compatible with `QuizQuestion` (same names, same meanings) so a
 * CP-Q3 route swap can hand these straight to the existing quiz UI, plus the
 * NAT-only numeric fields and the provenance the engine needs.
 */
export interface AssessmentQuestion {
  id: string;
  question: string;
  type: AssessmentQuestionType;
  /** MCQ/MSQ only. Option TEXT in order; letters are positional (A = [0]). */
  options?: string[];
  /** MCQ: "A". MSQ: "A|C". NAT: the number as a string. */
  correctAnswer: string;
  explanation: string;
  difficulty: AssessmentDifficulty;
  /** NAT only — the numeric value of `correctAnswer`. */
  numericAnswer?: number;
  /**
   * NAT only — tolerance as a PERCENTAGE of the expected value.
   *
   * ⚠ NOT the same thing as NAT_FP_TOLERANCE in natVerify.ts. This one is
   * PEDAGOGICAL: how much rounding a STUDENT may do and still be marked
   * correct. That one is NUMERICAL: whether the generator and the verifier
   * computed the same quantity at all. A question may legitimately allow a
   * student ±2% while a 2% generator/verifier gap means they solved different
   * problems. Do not merge them.
   */
  numericTolerance?: number;

  // ── provenance (engine-side; the quiz UI ignores these) ──
  /** The slot this question fills. */
  slotId: string;
  subjectId: string;
  moduleId: string | null;
  marks: number;
  coCode?: string;
  source: "bank" | "ai_fresh";
  /** faculty_question_bank.id — set for source='bank', and for an ai_fresh
   *  question that was successfully written through to the bank. */
  bankQuestionId?: string;
}

// ─── Slots ─────────────────────────────────────────────────────────────────

/**
 * One atomic question to be sourced. Mirrors qpaper's `QuestionSlot`
 * (src/lib/qpaper/moduleAssignment.ts) — a plan is a list of fully-determined
 * slots, and NO AI ever chooses a module, difficulty, or type. The AI only
 * WRITES what the plan has already decided (§12: "Module assignment computed in
 * code — AI never picks modules").
 */
export interface QuestionSlot {
  /** Stable, deterministic: `S{index}` in plan order. */
  slotId: string;
  subjectId: string;
  /** Null only when a subject has no modules seeded at all. */
  moduleId: string | null;
  questionType: AssessmentQuestionType;
  difficulty: AssessmentDifficulty;
  marks: number;
  /** Most under-served CO reachable from this slot's module, when known. */
  targetCo?: string;

  // ── denormalised for prompt building / logging; not part of the contract ──
  moduleNumber?: number;
  moduleName?: string;
}

export interface AssessmentPlanInput {
  studentId: string;
  subjectIds: string[];
  /** When omitted, all modules of the selected subjects participate. */
  moduleIds?: string[];
  questionCount: number;
  difficulty: RequestedDifficulty;
  questionTypes: AssessmentQuestionType[];
  mode: AssessmentMode;
  preset?: AssessmentPreset;
  /**
   * EXACT per-type counts, overriding the default index cycle. Used by presets
   * whose section counts are mandated rather than proportional (GATE:
   * 35 MCQ / 15 MSQ / 15 NAT). When the counts do not sum to questionCount they
   * are Hamilton-scaled and a warning is raised.
   */
  typeDistribution?: Partial<Record<AssessmentQuestionType, number>>;
  /**
   * 'gate_standard' prices by POSITION (Q1–25 = 1 mark, Q26–65 = 2), which is
   * how GATE actually works. Omit for mode-derived per-type marks.
   */
  marksRule?: "gate_standard";
}

/**
 * What the plan actually allocated. Named "sourcing" to match the qpaper
 * lineage, but at PLAN time nothing has been sourced yet — this is the
 * allocation summary (where the slots landed and why). Bank/AI provenance is
 * reported separately by fillFromBank() and generateFreshQuestions(), and the
 * three are combined by the mode router in CP-Q2.
 */
/**
 * NAT refusal/degradation report (CP-Q1.5, gate 1 — see CP_Q2_NAT_INTEGRITY.md).
 *
 * Present whenever a plan asked for at least one NAT slot, whether or not any
 * were refused, so a caller can always compare requested vs delivered without
 * a null check deciding meaning.
 *
 *  - `conceptual_module_refusal` — NAT was refused on a module classified
 *    'conceptual', but the count was preserved by moving those slots onto
 *    eligible modules. requested === delivered.
 *  - `insufficient_quantitative_modules` — there were not enough eligible
 *    modules to carry the NAT demand, so the excess became MCQ.
 *    delivered < requested.
 */
export interface NatDegradation {
  requested: number;
  delivered: number;
  reason:
    | "conceptual_module_refusal"
    | "insufficient_quantitative_modules"
    | null;
  /** Modules that refused NAT, i.e. quant_profile='conceptual'. */
  affectedModules: Array<{ moduleId: string; moduleName: string }>;
}

export interface SourcingSummary {
  totalSlots: number;
  /** subjectId → slot count. */
  bySubject: Record<string, number>;
  /** moduleId (or "__none__") → slot count. */
  byModule: Record<string, number>;
  byDifficulty: Record<AssessmentDifficulty, number>;
  byType: Record<string, number>;
  /** True when difficulty:'adaptive' resolved at least one module from
   *  student_topic_mastery rather than falling back to the 'easy' default. */
  adaptiveApplied: boolean;
  /** Set whenever the request asked for ≥1 NAT slot. */
  natDegraded?: NatDegradation;
  /** Non-fatal notes (missing weightages, preset coercions, empty subjects). */
  warnings: string[];
}

export interface AssessmentPlan {
  slots: QuestionSlot[];
  sourcing: SourcingSummary;
  /**
   * Caller-facing warnings. Same content as `sourcing.warnings`, promoted to
   * the top level so a mode router (CP-Q2) or a route handler can surface them
   * without reaching through the allocation summary. Includes the GATE-preset
   * NAT shortfall warning.
   */
  warnings: string[];
}

// ─── Bank type mapping ─────────────────────────────────────────────────────

/**
 * Assessment question type → `faculty_question_bank.question_type`.
 *
 * 'msq' and 'nat' are legal bank values from migration
 * 20260725000000_assessment_engine.sql onward. 'true_false' and 'match' map to
 * NOTHING on purpose: the bank has no equivalent shape, and coercing a
 * true/false slot onto an 'mcq' bank row would serve a 4-option question where
 * the UI renders two buttons. Those slots always go to the AI generator.
 */
export const BANK_TYPE_FOR: Record<
  AssessmentQuestionType,
  BankQuestionType | "msq" | "nat" | null
> = {
  mcq: "mcq",
  msq: "msq",
  nat: "nat",
  short: "short_answer",
  true_false: null,
  match: null,
  multiple_correct: "msq",
};

/** Types that carry an `options` array. */
export function typeHasOptions(t: AssessmentQuestionType): boolean {
  return t === "mcq" || t === "msq" || t === "multiple_correct" || t === "match";
}

/** Types that carry `numericAnswer` / `numericTolerance`. */
export function typeIsNumeric(t: AssessmentQuestionType): boolean {
  return t === "nat";
}

// ─── Mode / preset marks ───────────────────────────────────────────────────

const MODE_MARKS: Record<AssessmentMode, number> = {
  quick: 1,
  mastery: 1,
  exam_sim: 2,
};

/**
 * Marks for one slot. The GATE preset overrides the mode default with the real
 * GATE scheme — 1 mark for single-select MCQ, 2 for MSQ and NAT — because the
 * whole point of exam_sim + gate is that the mark arithmetic matches the paper
 * the student is actually sitting.
 */
export function marksForSlot(
  mode: AssessmentMode,
  questionType: AssessmentQuestionType,
  preset?: AssessmentPreset
): number {
  if (preset === "gate") {
    return questionType === "msq" || questionType === "nat" ? 2 : 1;
  }
  return MODE_MARKS[mode];
}
