/**
 * Shared constants + types for the student's own signal on the assessment
 * landing (CP-Q3 Part 3) and the mastery hub (Part 5).
 *
 * Client-safe: no Supabase, no server imports. Both the API route and the
 * components that render its response read the thresholds from here, so the
 * landing's "N modules ready to level up" counter and the hub's per-module
 * promotion indicator can never drift apart and tell a student two different
 * things about the same module.
 */

/** Quick-mode sparkline window — the last N completed quick sessions. */
export const QUICK_TREND_WINDOW = 8;

/**
 * "Ready to level up" thresholds.
 *
 * Promotion itself is placement's proven rule (§16, mirrored in CP-Q2's
 * grading): ≥70% accuracy AND ≥10 attempts AND ≥2 sessions. These two
 * constants describe the state ONE STEP BEFORE that — accuracy already met,
 * attempts within reach — so the counter means "another short session would
 * move this", not "this has moved".
 */
export const LEVEL_UP_MIN_ACCURACY = 0.7;
export const LEVEL_UP_MIN_ATTEMPTS = 8;
/** The attempt count at which promotion is actually evaluated (§16). */
export const PROMOTION_ATTEMPTS = 10;

export interface QuickTrendPoint {
  sessionId: string;
  at: string;
  score: number;
}

export interface LandingSignals {
  quick: { trend: QuickTrendPoint[]; window: number };
  mastery: {
    aggregatePct: number | null;
    modulesPractised: number;
    readyToLevelUp: number;
  };
  examSim: {
    sessionId: string;
    preset: string | null;
    at: string;
    scorePct: number | null;
    score: number | null;
    totalMarks: number | null;
  } | null;
  inProgress: Array<{
    sessionId: string;
    mode: "quick" | "mastery" | "exam_sim";
    preset: string | null;
    startedAt: string;
    questionCount: number | null;
    timeLimitMinutes: number | null;
    subjectIds: string[];
  }>;
  streak: {
    weeks: number;
    currentWeekSessions: number;
    currentWeekPending: boolean;
    sessionsToQualify: number;
    graceUsedWeeksAgo: number | null;
  };
}
