/**
 * Practice streaks (CP-Q3 Part 6).
 *
 * Pure functions — no React, no Supabase, no Date.now() except through an
 * injectable `now`, so the calendar edge cases are unit-testable
 * (`_cp_q3_verify/streak_math.ts`).
 *
 * WHAT A STREAK IS HERE, AND WHAT IT DELIBERATELY IS NOT
 *
 * It is a signal to the student who wants one and invisible to the student who
 * does not. There are no points, no leaderboards, no push notifications, no
 * email nags, and no "don't break your streak!" copy anywhere. A streak that
 * punishes is a retention tactic aimed at the students least able to absorb it
 * — the ones already having a bad week. The grace clause below exists for
 * exactly that reason and is not a nice-to-have.
 *
 * THE RULES
 *   · A practice week runs Monday 00:00 → Sunday 23:59:59 (local).
 *   · A week QUALIFIES on ≥3 completed sessions of any mode.
 *   · A week is a HALF week on exactly 2 sessions.
 *   · A streak is N consecutive qualifying weeks ending at the current week.
 *   · GRACE: one half-week may be absorbed per rolling 4-week window without
 *     breaking the streak. A second half-week inside that window breaks it.
 *   · ≤1 session breaks the streak outright — grace does not stretch that far,
 *     or "a streak" stops meaning anything.
 *
 * THE CURRENT WEEK IS PENDING, NOT FAILING — a decision, not an oversight.
 *
 * The spec says a streak requires ≥3 sessions "in each of N consecutive weeks
 * including the current week". Read literally, every streak in the product
 * dies at 00:00 on Monday, when the current week necessarily has 0 sessions,
 * and revives on Wednesday. That is both absurd and precisely the guilt
 * mechanic this design rejects: it would make Monday the day the app tells you
 * you've lost something.
 *
 * So the current week can only ADD to the streak, never break it. The count is
 * the run of qualifying COMPLETED weeks, plus one if the current week already
 * qualifies. `currentWeekPending` tells the UI which of those it is looking at,
 * so it can invite ("2 more this week") without ever accusing. A week is only
 * judged once it is over.
 */

export interface StreakResult {
  /** Consecutive qualifying weeks, current week included only if it qualifies. */
  weeks: number;
  /** Completed sessions inside the current Mon–Sun week. */
  currentWeekSessions: number;
  /** True when the current week has not yet reached the threshold. */
  currentWeekPending: boolean;
  /** Sessions still needed this week to make it count. 0 once it qualifies. */
  sessionsToQualify: number;
  /**
   * How many weeks back the grace allowance was consumed (0 = current week),
   * or null if no half-week is currently being absorbed. Diagnostic — the UI
   * does not surface it, because "you used your grace week" is guilt framing.
   */
  graceUsedWeeksAgo: number | null;
}

/** Sessions needed for a week to count toward the streak. */
export const STREAK_THRESHOLD = 3;
/** Sessions that make a week a "half" — survivable once per window. */
export const STREAK_HALF_THRESHOLD = 2;
/** Rolling window, in weeks, within which only one half-week is forgiven. */
export const GRACE_WINDOW_WEEKS = 4;

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Monday 00:00:00.000 of the week containing `date`, in LOCAL time.
 *
 * Local, not UTC, on purpose: a student in IST practising at 11pm Sunday is
 * having a Sunday, and bucketing that into the next UTC week would silently
 * move ~7 hours of every week's activity for the entire pilot cohort.
 */
export function weekStart(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay(): 0=Sun … 6=Sat. Monday-based offset: Sun becomes 6.
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Whole weeks between two week-starts. Computed from calendar dates rather
 * than raw ms division so a DST transition (which makes a "week" 167 or 169
 * hours) cannot round a week index off by one.
 */
export function weeksBetween(earlier: Date, later: Date): number {
  const a = weekStart(earlier).getTime();
  const b = weekStart(later).getTime();
  return Math.round((b - a) / MS_PER_WEEK);
}

/**
 * Compute the streak from the timestamps of COMPLETED assessment sessions.
 *
 * @param sessionDates completion timestamps, any order, any mode. Callers pass
 *   `quiz_sessions.completed_at` for `status='completed'` rows only —
 *   abandoned sessions are not practice.
 * @param now injectable clock for tests.
 */
export function computeStreak(
  sessionDates: Array<Date | string>,
  now: Date = new Date()
): StreakResult {
  const currentWeek = weekStart(now);

  // Bucket by "weeks ago": 0 = current week, 1 = last week, …
  const byWeeksAgo = new Map<number, number>();
  for (const raw of sessionDates) {
    const d = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    const ago = weeksBetween(d, currentWeek);
    // Negative = a completed_at in the future (clock skew). Ignore rather than
    // let it inflate the current week.
    if (ago < 0) continue;
    byWeeksAgo.set(ago, (byWeeksAgo.get(ago) ?? 0) + 1);
  }

  const countAt = (ago: number) => byWeeksAgo.get(ago) ?? 0;

  const currentWeekSessions = countAt(0);
  const currentWeekQualifies = currentWeekSessions >= STREAK_THRESHOLD;

  // Walk backwards from LAST week. The current week is handled separately
  // because it is pending, not failing (see the header).
  let weeks = 0;
  let graceUsedWeeksAgo: number | null = null;

  // The current week, if it already qualifies, counts and cannot consume grace
  // (a pending week is never "half" — it just isn't finished).
  if (currentWeekQualifies) weeks += 1;

  for (let ago = 1; ; ago += 1) {
    const n = countAt(ago);
    if (n >= STREAK_THRESHOLD) {
      weeks += 1;
      continue;
    }
    if (n === STREAK_HALF_THRESHOLD) {
      // Grace is per rolling GRACE_WINDOW_WEEKS window: a second half-week
      // within that many weeks of the first one breaks the streak.
      const withinWindow =
        graceUsedWeeksAgo !== null &&
        ago - graceUsedWeeksAgo < GRACE_WINDOW_WEEKS;
      if (withinWindow) break;
      graceUsedWeeksAgo = ago;
      weeks += 1;
      continue;
    }
    break;
  }

  // A run made only of forgiven half-weeks is not a streak. Grace extends a
  // streak; it cannot manufacture one out of nothing.
  if (weeks === 1 && graceUsedWeeksAgo !== null) {
    weeks = 0;
    graceUsedWeeksAgo = null;
  }

  return {
    weeks,
    currentWeekSessions,
    currentWeekPending: !currentWeekQualifies,
    sessionsToQualify: Math.max(0, STREAK_THRESHOLD - currentWeekSessions),
    graceUsedWeeksAgo,
  };
}

/**
 * The one place streak copy is written, so the no-guilt rule is enforceable by
 * reading one function instead of auditing every surface.
 *
 * Banned framings, permanently: "Don't break your streak", "You're about to
 * lose…", "Last chance", any countdown to a loss. If a future revision wants
 * urgency, it does not get it here.
 */
export function streakCopy(streak: StreakResult): {
  headline: string;
  sub: string | null;
} {
  if (streak.weeks === 0) {
    return {
      headline: "Start a streak",
      sub: `${STREAK_THRESHOLD} quizzes this week.`,
    };
  }
  const headline = `${streak.weeks}-week streak`;
  if (!streak.currentWeekPending) return { headline, sub: null };
  return {
    headline,
    sub:
      streak.sessionsToQualify === 1
        ? "1 more this week counts it."
        : `${streak.sessionsToQualify} more this week counts it.`,
  };
}
