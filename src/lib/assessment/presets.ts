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
 * GATE-AUTHENTIC, and every exemption below is a real GATE rule rather than a
 * simplification:
 *
 *  - MCQ (and its single-select cousins) → −1/3 of the question's marks.
 *  - MSQ → 0. This is the one that looks like an oversight and is not. Real
 *    GATE applies NO negative marking to multiple-select questions, because the
 *    all-or-nothing key IS the penalty: partial credit is denied, so a student
 *    who knows two of three correct options scores zero rather than most of the
 *    marks. Adding −1/3 on top would double-penalise the same partial knowledge.
 *  - NAT → 0. The student types a number; there is no option set to guess from.
 *
 * A product called "GATE Mock" that does not score like GATE is a credibility
 * bug the first time a student who has sat the real exam uses it.
 */
export function negativeMarksFor(
  rule: NegativeMarkingRule,
  questionType: AssessmentQuestionType,
  marks: number
): number {
  if (rule !== "gate_standard") return 0;
  if (
    questionType === "nat" ||
    questionType === "msq" ||
    questionType === "multiple_correct"
  ) {
    return 0;
  }
  if (
    questionType === "mcq" ||
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
