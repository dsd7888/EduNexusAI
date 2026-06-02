/**
 * Semantic score system — single source of truth for how a student's numbers
 * are coloured and framed across the app.
 *
 * Why this exists: scores were painted RED for anything below ~60%. A learner
 * who just started and sits at 10% saw failure reflected back at them, which is
 * a retention killer. This module replaces "low = red" with a journey framing:
 *
 *   not-started  → slate/grey  ("you haven't tried this yet" — an invitation)
 *   in-progress  → amber/warm  ("you're on the way to your target")
 *   on-track     → emerald     ("you've reached the target")
 *
 * Red is intentionally NOT used for scores — it is reserved for destructive
 * actions and real errors. Pure functions only: no React, no deps. Keeps the
 * bundle light and the behaviour identical everywhere.
 */

export type ScoreState = "empty" | "progress" | "good";

/** Default readiness target used across placement + quizzes. */
export const DEFAULT_TARGET = 65;

export interface ScoreOptions {
  /**
   * Whether the student has actually attempted this. Defaults to "score is not
   * null". Pass `false` to force the not-started (slate) treatment even when a
   * stored score reads 0 — a 0% they never attempted is not a failure.
   */
  attempted?: boolean;
  /** Target the score is measured against. Defaults to {@link DEFAULT_TARGET}. */
  target?: number;
}

/** Classify a score into its semantic state. */
export function scoreState(
  score: number | null | undefined,
  opts: ScoreOptions = {}
): ScoreState {
  const { target = DEFAULT_TARGET } = opts;
  const attempted = opts.attempted ?? score != null;
  if (score == null || !attempted) return "empty";
  return score >= target ? "good" : "progress";
}

/** Short human label for the state — pairs with the colour. */
export function scoreLabel(state: ScoreState): string {
  switch (state) {
    case "good":
      return "On track";
    case "progress":
      return "In progress";
    default:
      return "Not started";
  }
}

/** Foreground text colour for the percentage number. */
export const scoreTextClass: Record<ScoreState, string> = {
  empty: "text-slate-400",
  progress: "text-amber-600",
  good: "text-emerald-600",
};

/** Soft pill/badge classes (bg + text + border). */
export const scoreBadgeClass: Record<ScoreState, string> = {
  empty: "bg-slate-100 text-slate-500 border border-slate-200",
  progress: "bg-amber-50 text-amber-700 border border-amber-200",
  good: "bg-emerald-50 text-emerald-700 border border-emerald-200",
};

/** Fill colour for a progress bar / meter track. */
export const scoreBarClass: Record<ScoreState, string> = {
  empty: "bg-slate-300",
  progress: "bg-amber-400",
  good: "bg-emerald-500",
};

/** Convenience: resolve all three class strings + label in one call. */
export function scoreStyles(
  score: number | null | undefined,
  opts: ScoreOptions = {}
) {
  const state = scoreState(score, opts);
  return {
    state,
    label: scoreLabel(state),
    text: scoreTextClass[state],
    badge: scoreBadgeClass[state],
    bar: scoreBarClass[state],
  };
}
