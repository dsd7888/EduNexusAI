/**
 * Mode defaults and exam presets (CP-Q2).
 *
 * The three modes are THIN CONFIG over one engine — they choose scope, count,
 * marks and feedback timing, and add no allocation logic of their own. If a
 * mode ever needs allocation behaviour that isn't expressible here, that is a
 * signal `planAssessment` is missing a parameter, not a licence for a
 * mode-specific code path (CP_Q1_ASSESSMENT_ENGINE.md).
 */

import type {
  AssessmentDifficulty,
  AssessmentMode,
  AssessmentQuestionType,
  RequestedDifficulty,
} from "./types";

export type NegativeMarkingRule = "gate_standard";
export type MarksRule = "gate_standard";

export interface ModeConfig {
  defaultQuestionCount: number;
  minQuestionCount: number;
  maxQuestionCount: number;
  defaultQuestionTypes: AssessmentQuestionType[];
  defaultDifficulty: RequestedDifficulty;
  /** true = grade each answer as it is given; false = only at submit. */
  immediateFeedback: boolean;
  /** Whether a submitted session moves student_topic_mastery. */
  updatesMastery: boolean;
  /** Multiple subjects in one session. */
  allowsMultiSubject: boolean;
  defaultTimeLimitMinutes: number | null;
}

/**
 * `updatesMastery` is the one field here carrying a real product decision:
 * exam_sim is a BENCHMARK INSTRUMENT, not a practice loop. It is capped at
 * 3/day, timed, and negatively marked — letting a bad afternoon on a 100-question
 * mock swing a student's per-module difficulty state would make the adaptive
 * signal noisier than the thing it is measuring. exam_sim still records every
 * attempt (that data is valuable and feeds the 30-day exclusion); it just does
 * not mutate difficulty.
 */
export const MODE_CONFIG: Record<AssessmentMode, ModeConfig> = {
  quick: {
    defaultQuestionCount: 10,
    minQuestionCount: 5,
    maxQuestionCount: 20,
    defaultQuestionTypes: ["mcq"],
    defaultDifficulty: "mixed",
    immediateFeedback: true,
    updatesMastery: true,
    allowsMultiSubject: false,
    defaultTimeLimitMinutes: null,
  },
  mastery: {
    defaultQuestionCount: 20,
    minQuestionCount: 10,
    maxQuestionCount: 30,
    defaultQuestionTypes: ["mcq", "short"],
    defaultDifficulty: "adaptive",
    immediateFeedback: true,
    updatesMastery: true,
    allowsMultiSubject: false,
    defaultTimeLimitMinutes: null,
  },
  exam_sim: {
    defaultQuestionCount: 50,
    minQuestionCount: 10,
    maxQuestionCount: 100,
    defaultQuestionTypes: ["mcq", "msq", "nat"],
    defaultDifficulty: "mixed",
    immediateFeedback: false,
    updatesMastery: false,
    allowsMultiSubject: true,
    defaultTimeLimitMinutes: 90,
  },
};

/** The counts an exam_sim caller may pick from the UI (CP-Q3). */
export const EXAM_SIM_PRESET_COUNTS = [30, 50, 100] as const;

export interface ExamPreset {
  label: string;
  questionCount: number;
  /** Minutes. */
  timeLimit: number;
  negativeMarking: boolean;
  negativeMarkingRule: NegativeMarkingRule;
  questionTypes: AssessmentQuestionType[];
  /** EXACT counts — see planAssessment's typeDistribution path. */
  typeDistribution: Partial<Record<AssessmentQuestionType, number>>;
  difficulty: RequestedDifficulty;
  marksRule: MarksRule;
  mode: AssessmentMode;
}

/**
 * GATE mock — 65 questions, 180 minutes, 100 marks (25×1 + 40×2).
 *
 * The type distribution is EXACT, not proportional: GATE's composition is a
 * mandated section structure, and "approximately 15 NAT" is not a GATE mock.
 */
export const GATE_PRESET: ExamPreset = {
  label: "GATE Mock",
  questionCount: 65,
  timeLimit: 180,
  negativeMarking: true,
  negativeMarkingRule: "gate_standard",
  questionTypes: ["mcq", "msq", "nat"],
  typeDistribution: { mcq: 35, msq: 15, nat: 15 },
  difficulty: "mixed",
  marksRule: "gate_standard",
  mode: "exam_sim",
};

export const PRESETS = { gate: GATE_PRESET } as const;

/**
 * Negative marks for ONE wrong answer. Returns a NEGATIVE number, or 0.
 *
 * ⚠ DEVIATION FROM REAL GATE, DELIBERATE AND SPEC'D: real GATE applies no
 * negative marking to MSQ (that is why MSQ exists as a type — partial-knowledge
 * guessing is penalised by the all-or-nothing key instead). The CP-Q2 spec
 * calls for −1/3 on MCQ *and* MSQ, so that is what ships. If the intent was
 * GATE-authentic scoring, this is the line to change — MSQ returns 0 — and
 * nothing else moves.
 */
export function negativeMarksFor(
  rule: NegativeMarkingRule,
  questionType: AssessmentQuestionType,
  marks: number
): number {
  if (rule !== "gate_standard") return 0;
  // NAT is never negatively marked — the student types a number, there is no
  // option set to guess from. This part IS GATE-authentic.
  if (questionType === "nat") return 0;
  if (
    questionType === "mcq" ||
    questionType === "msq" ||
    questionType === "multiple_correct" ||
    questionType === "true_false" ||
    questionType === "match"
  ) {
    return -(marks / 3);
  }
  return 0;
}

/** Clamp a requested count into the mode's allowed band. */
export function clampQuestionCount(
  mode: AssessmentMode,
  requested: number | undefined
): { count: number; warning?: string } {
  const cfg = MODE_CONFIG[mode];
  if (requested == null || !Number.isFinite(requested)) {
    return { count: cfg.defaultQuestionCount };
  }
  const n = Math.trunc(requested);
  if (n < cfg.minQuestionCount) {
    return {
      count: cfg.minQuestionCount,
      warning: `${mode} mode has a minimum of ${cfg.minQuestionCount} questions — raised from ${n}.`,
    };
  }
  if (n > cfg.maxQuestionCount) {
    return {
      count: cfg.maxQuestionCount,
      warning: `${mode} mode caps at ${cfg.maxQuestionCount} questions — lowered from ${n}.`,
    };
  }
  return { count: n };
}

/** Difficulty values a caller may pass through unchanged. */
export function isRequestedDifficulty(v: unknown): v is RequestedDifficulty {
  return (
    v === "easy" ||
    v === "medium" ||
    v === "hard" ||
    v === "mixed" ||
    v === "adaptive"
  );
}

export function isAssessmentDifficulty(v: unknown): v is AssessmentDifficulty {
  return v === "easy" || v === "medium" || v === "hard";
}
