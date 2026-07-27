/**
 * "How close is this module to promotion" — the mastery hub's per-module
 * indicator (CP-Q3 Part 5B).
 *
 * Promotion itself is placement's proven rule, mirrored exactly in
 * grading.ts's `nextDifficulty`: ≥70% accuracy AND ≥10 attempts AND ≥2
 * sessions. This function describes the state ONE STEP BEFORE that — the
 * same "ready to level up" window landingSignals.ts defines for the landing
 * card's counter — as a concrete, minimal ask: how many of the remaining
 * attempts (up to the 10-attempt evaluation point) need to be correct to
 * still clear 70% once they're in.
 *
 * Pure, client-safe: no Supabase, no React. Shared so the landing card's
 * count and the hub's per-module line can never describe two different
 * modules as "ready".
 */

import {
  LEVEL_UP_MIN_ACCURACY,
  LEVEL_UP_MIN_ATTEMPTS,
  PROMOTION_ATTEMPTS,
} from "./landingSignals";
import type { AssessmentDifficulty } from "./types";

const LADDER: AssessmentDifficulty[] = ["easy", "medium", "hard"];

export interface PromotionProgress {
  targetTier: AssessmentDifficulty;
  /** Minimum correct answers needed among the remaining attempts. */
  correctNeeded: number;
  /** Attempts left before the 10-attempt evaluation point. */
  attemptsAvailable: number;
}

/**
 * Returns null when the module is already at the top tier, has too few
 * attempts to be "close", or has already missed the window entirely (its
 * current accuracy can no longer reach 70% by attempt 10 — a module in that
 * state needs more PRACTICE, not a countdown that's already unreachable).
 */
export function computePromotionProgress(
  currentDifficulty: AssessmentDifficulty,
  attemptsCount: number,
  correctCount: number
): PromotionProgress | null {
  const tierIndex = LADDER.indexOf(currentDifficulty);
  if (tierIndex === LADDER.length - 1) return null; // already 'hard'
  if (attemptsCount < LEVEL_UP_MIN_ATTEMPTS || attemptsCount >= PROMOTION_ATTEMPTS) {
    return null;
  }
  const accuracy = attemptsCount > 0 ? correctCount / attemptsCount : 0;
  if (accuracy < LEVEL_UP_MIN_ACCURACY) return null;

  const attemptsAvailable = PROMOTION_ATTEMPTS - attemptsCount;
  const correctFloor = Math.ceil(LEVEL_UP_MIN_ACCURACY * PROMOTION_ATTEMPTS);
  const correctNeeded = Math.max(0, Math.min(attemptsAvailable, correctFloor - correctCount));

  return {
    targetTier: LADDER[tierIndex + 1],
    correctNeeded,
    attemptsAvailable,
  };
}
