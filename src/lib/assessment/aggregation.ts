/**
 * Attempt-weighted accuracy — the single source of truth for "what percent did
 * they get right", shared by the student's own mastery aggregate (CP-Q3 Part 3,
 * `/api/assessment/landing`) and the faculty cohort aggregate (CP-Q4 Part 2,
 * `src/lib/analytics/aggregates.ts`).
 *
 * WHY IT IS SHARED RATHER THAN COMPUTED TWICE
 *
 * A student looking at "68%" on their mastery hub and a faculty member looking
 * at that same student's contribution to a cohort number must be looking at the
 * same arithmetic. Two implementations drift — not because anyone rewrites the
 * formula, but because one of them acquires a rounding change, a null guard, or
 * a filter that the other doesn't, and then the product quietly tells two people
 * different things about the same fact. There is no way to notice that from
 * either side.
 *
 * THE RULE: attempt-weighted, never a mean of per-bucket percentages.
 *
 * A module with 40 attempts must not carry the same weight as one with 3, or a
 * single lucky 3-question module inflates the headline. Concretely, for buckets
 * of (attempts=40, correct=20) and (attempts=3, correct=3):
 *   mean-of-percentages → (50% + 100%) / 2 = 75%   ← wrong, and flattering
 *   attempt-weighted     → 23 / 43            = 53%   ← what actually happened
 *
 * NULL, NOT ZERO, AT ZERO ATTEMPTS.
 *
 * Every function here returns `null` rather than 0 when there is nothing to
 * average. Zero is a real, terrible score; "no data yet" is not a score at all.
 * Collapsing the two shows a student who has never practised a 0%, and shows
 * faculty a fresh subject as a cohort in crisis — an intervention triggered by
 * data that does not exist. Callers must branch on null before formatting.
 */

/** One bucket of graded work: a module, a student, a question, a whole cohort. */
export interface AttemptTally {
  attempts: number;
  correct: number;
}

/** The minimum shape of an attempt row this module can tally. */
export interface GradedAttempt {
  is_correct: boolean | null;
}

/**
 * Tally raw attempt rows into a single bucket.
 *
 * `is_correct === true` is the numerator test, and EVERY row counts toward the
 * denominator — including `is_correct = null`. This matches
 * `peerStatCompute.ts`, deliberately: an attempt row exists only for a question
 * that was actually served, and `/submit` writes a final row for every served
 * question (unanswered ones land as `false`, not null). A null therefore means
 * a grading anomaly, not "not applicable", and silently dropping it from the
 * denominator would round the anomaly away instead of letting it show.
 */
export function tallyAttempts(rows: readonly GradedAttempt[]): AttemptTally {
  let correct = 0;
  for (const r of rows) if (r.is_correct === true) correct += 1;
  return { attempts: rows.length, correct };
}

/**
 * Attempt-weighted accuracy across buckets, as a ratio in [0, 1].
 * Returns null when the buckets carry no attempts at all.
 *
 * This is the storage-facing form — `faculty_analytics_snapshots.aggregate_accuracy`
 * is a numeric ratio, not a percent, so rounding happens once at render time
 * rather than being baked into the stored value.
 */
export function attemptWeightedAccuracy(
  tallies: readonly AttemptTally[]
): number | null {
  let attempts = 0;
  let correct = 0;
  for (const t of tallies) {
    attempts += t.attempts ?? 0;
    correct += t.correct ?? 0;
  }
  return attempts > 0 ? correct / attempts : null;
}

/**
 * Same value as a whole-number percent, 0..100. Returns null on no attempts.
 *
 * The display-facing form. Rounds ONCE, at the end — rounding per bucket and
 * then combining reintroduces exactly the weighting error this module exists
 * to prevent.
 */
export function attemptWeightedAccuracyPct(
  tallies: readonly AttemptTally[]
): number | null {
  const ratio = attemptWeightedAccuracy(tallies);
  return ratio == null ? null : Math.round(ratio * 100);
}
