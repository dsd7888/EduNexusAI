/**
 * Shared types for the session UI (CP-Q3 Part 4).
 *
 * `SessionQuestion` mirrors the studentSafe() projection written at plan time
 * (src/lib/assessment/runner.ts) — no correctAnswer, no explanation. If a field
 * appears here that studentSafe() does not emit, that is a leak, not a feature.
 */

export type QuestionType =
  | "mcq"
  | "msq"
  | "nat"
  | "true_false"
  | "short"
  | "multiple_correct"
  | "match";

export interface SessionQuestion {
  slotId: string;
  question: string;
  type: QuestionType;
  options: string[] | null;
  marks: number;
  subjectId: string;
  moduleId: string | null;
  difficulty: string;
  numericTolerance?: number;
}

export interface SessionPayload {
  sessionId: string;
  mode: "quick" | "mastery" | "exam_sim";
  status: string;
  preset: string | null;
  subjectIds: string[];
  moduleIds: string[] | null;
  startedAt: string;
  completedAt: string | null;
  timeLimitMinutes: number | null;
  elapsedSeconds: number;
  remainingSeconds: number | null;
  immediateFeedback: boolean;
  negativeMarking: boolean;
  totalMarks: number | null;
  score: number | null;
  questions: SessionQuestion[];
}

/** What /api/assessment/answer returns for an immediate-feedback mode. */
export interface AnswerFeedback {
  slotId: string;
  isCorrect: boolean;
  correctAnswer: string;
  explanation: string | null;
  peerStat?: number;
}

/** Per-question client state. */
export interface AnswerState {
  /** What the student has entered. Null = untouched. */
  value: string | null;
  /** Feedback received (immediate-feedback modes only). */
  feedback: AnswerFeedback | null;
  /** exam_sim only. */
  markedForReview: boolean;
  /** Seconds spent, accumulated while the question was on screen. */
  timeSpent: number;
  /** True once persisted to the server (exam_sim autosave bookkeeping). */
  saved: boolean;
}

export function emptyAnswer(): AnswerState {
  return {
    value: null,
    feedback: null,
    markedForReview: false,
    timeSpent: 0,
    saved: false,
  };
}

/** MSQ answers travel as pipe-separated option LETTERS (CP-Q1 §"two new types"). */
export const LETTERS = "ABCDEFGHIJ".split("");

export function letterFor(index: number): string {
  return LETTERS[index] ?? String(index + 1);
}
