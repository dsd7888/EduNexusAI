/**
 * Shared types for the results view (CP-Q3 Part 5A).
 *
 * Mirrors GET /api/assessment/results/[sessionId]'s response exactly — if a
 * field appears here that route does not emit, that is drift, not a feature.
 */

export type AssessmentMode = "quick" | "mastery" | "exam_sim";
export type AssessmentDifficulty = "easy" | "medium" | "hard";

export interface PerQuestionResult {
  questionIndex: number;
  subjectId: string;
  moduleId: string | null;
  stem: string;
  questionType: string;
  options: string[] | null;
  studentAnswer: string | null;
  correctAnswer: string;
  explanation: string;
  isCorrect: boolean;
  marks: number;
  peerStat?: number;
}

export interface MasteryDelta {
  subjectId: string;
  moduleId: string;
  moduleName?: string;
  attemptsBefore: number;
  attemptsAfter: number;
  accuracyBefore: number | null;
  accuracyAfter: number;
  difficultyBefore: AssessmentDifficulty;
  difficultyAfter: AssessmentDifficulty;
  promoted: boolean;
  demoted: boolean;
}

export interface SectionalBreakdownEntry {
  subjectId: string;
  subjectName: string;
  correctCount: number;
  questionCount: number;
  marksAwarded: number;
  totalMarks: number;
  timeActualSeconds: number;
  timeTargetSeconds: number;
}

export interface NegativeMarkingImpact {
  rawScore: number;
  actualScore: number;
  delta: number;
  perTypeBreakdown: Record<
    "mcq" | "msq" | "nat",
    { wrong: number; penaltyPer: number; totalPenalty: number }
  >;
}

export interface ResultsPayload {
  sessionId: string;
  mode: AssessmentMode;
  preset: string | null;
  subjectIds: string[];
  subjectNames: Record<string, string>;
  startedAt: string;
  completedAt: string | null;
  timeLimitMinutes: number | null;
  score: number;
  totalMarks: number;
  perQuestionResults: PerQuestionResult[];
  masteryDeltas?: MasteryDelta[];
  sectionalBreakdown?: SectionalBreakdownEntry[];
  negativeMarkingImpact?: NegativeMarkingImpact;
  warnings?: string[];
}
