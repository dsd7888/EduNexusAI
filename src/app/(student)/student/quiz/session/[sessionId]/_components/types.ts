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

/**
 * One already-answered slot, returned by GET /api/assessment/session/[id] so a
 * resumed session can be rebuilt instead of restarting at question 1.
 *
 * `isCorrect` / `correctAnswer` / `explanation` are OPTIONAL because exam_sim
 * genuinely does not send them — a deferred-feedback exam that is still in
 * progress must not carry correctness, and the route omits the properties
 * rather than nulling them. Do not widen these to required; the optionality is
 * the client-side shadow of a server invariant.
 */
export interface AnsweredSlot {
  slotId: string;
  studentAnswer: string | null;
  timeTakenSeconds: number | null;
  isCorrect?: boolean;
  correctAnswer?: string;
  explanation?: string | null;
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
  /** Absent on a session that predates the resume-state migration. */
  answeredSlots?: AnsweredSlot[];
}

/**
 * Rebuild per-slot state for a resumed session.
 *
 * Shared by both runners so "what does a resumed answer look like" is defined
 * once. The runners differ in what they do with it, not in how they read it:
 * PracticeRunner restores the reveal, ExamRunner restores only the answer.
 *
 * `hydrateFeedback: false` is what keeps a resumed exam_sim silent. Even if a
 * future server change started sending correctness for exam_sim, this would not
 * surface it — two independent gates, which is the point.
 */
export function hydrateAnswers(
  questions: SessionQuestion[],
  answeredSlots: AnsweredSlot[] | undefined,
  hydrateFeedback: boolean
): Record<string, AnswerState> {
  const base: Record<string, AnswerState> = Object.fromEntries(
    questions.map((q) => [q.slotId, emptyAnswer()])
  );
  for (const a of answeredSlots ?? []) {
    if (!(a.slotId in base)) continue;
    base[a.slotId] = {
      ...emptyAnswer(),
      value: a.studentAnswer,
      timeSpent: a.timeTakenSeconds ?? 0,
      // Already persisted server-side by definition — that is where it came from.
      saved: true,
      feedback:
        hydrateFeedback && a.isCorrect !== undefined
          ? {
              slotId: a.slotId,
              isCorrect: a.isCorrect,
              correctAnswer: a.correctAnswer ?? "",
              explanation: a.explanation ?? null,
              // peerStat is deliberately not restored: it was never persisted,
              // and it is a live cohort statistic. Showing a stale one would be
              // worse than showing none.
            }
          : null,
    };
  }
  return base;
}

/**
 * Where a resumed session should open: the first slot with no answer.
 *
 * Returns the LAST index when every slot is answered — reachable in practice
 * (answer all 10, close the tab before pressing Finish), and landing there
 * shows the student their final question with the Finish action live, rather
 * than an index past the end of the array.
 */
export function firstUnansweredIndex(
  questions: SessionQuestion[],
  answers: Record<string, AnswerState>
): number {
  const i = questions.findIndex((q) => answers[q.slotId]?.value == null);
  return i === -1 ? Math.max(0, questions.length - 1) : i;
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
