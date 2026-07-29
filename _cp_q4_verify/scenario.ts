/**
 * THE controlled scenario, and its hand-computed expected values.
 *
 * `aggregate_correctness.ts` and `co_attainment.ts` both run this exact
 * scenario. It lives in one file so the two harnesses cannot drift into
 * verifying different worlds, and so the arithmetic below is written down ONCE
 * where it can be checked by eye.
 *
 * ── THE SCRIPT ──────────────────────────────────────────────────────────────
 * 3 students · 1 subject · 3 modules · 2 bank questions used per module ·
 * 10 completed sessions · 30 attempts.
 *
 *   Student A (2 sessions)
 *     S1: M1Q1 ✓  M1Q2 ✓  M2Q1 ✗   → 2/3
 *     S2: M2Q2 ✓  M3Q1 ✓  M3Q2 ✓   → 3/3
 *   Student B (4 sessions)
 *     S1: M1Q1 ✓  M1Q2 ✗  M2Q1 ✗   → 1/3
 *     S2: M2Q2 ✗  M3Q1 ✓  M3Q2 ✗   → 1/3
 *     S3: M1Q1 ✗  M2Q1 ✓  M3Q1 ✓   → 2/3
 *     S4: M1Q2 ✓  M2Q2 ✓  M3Q2 ✗   → 2/3
 *   Student C (4 sessions)
 *     S1: M1Q1 ✓  M1Q2 ✓  M2Q1 ✓   → 3/3
 *     S2: M2Q2 ✓  M3Q1 ✗  M3Q2 ✓   → 2/3
 *     S3: M1Q1 ✓  M2Q1 ✗  M3Q1 ✓   → 2/3
 *     S4: M1Q2 ✗  M2Q2 ✓  M3Q2 ✓   → 2/3
 *
 * ── PER QUESTION (each is served exactly 5 times — the discrimination floor) ─
 *   M1Q1  A-S1✓ B-S1✓ B-S3✗ C-S1✓ C-S3✓  → 5 served, 4 correct
 *   M1Q2  A-S1✓ B-S1✗ B-S4✓ C-S1✓ C-S4✗  → 5 served, 3 correct
 *   M2Q1  A-S1✗ B-S1✗ B-S3✓ C-S1✓ C-S3✗  → 5 served, 2 correct
 *   M2Q2  A-S2✓ B-S2✗ B-S4✓ C-S2✓ C-S4✓  → 5 served, 4 correct
 *   M3Q1  A-S2✓ B-S2✓ B-S3✓ C-S2✗ C-S3✓  → 5 served, 4 correct
 *   M3Q2  A-S2✓ B-S2✗ B-S4✗ C-S2✓ C-S4✓  → 5 served, 3 correct
 *
 * ── PER MODULE ──────────────────────────────────────────────────────────────
 *   M1 = 4+3 = 7 correct / 10 attempts → 0.7
 *   M2 = 2+4 = 6 correct / 10 attempts → 0.6
 *   M3 = 4+3 = 7 correct / 10 attempts → 0.7
 *   Every student touches every module → students_count = 3 each.
 *
 * ── AGGREGATE ───────────────────────────────────────────────────────────────
 *   20 correct / 30 attempts = 0.666666… → 0.6667
 *   Note this is NOT the mean of the module accuracies ((0.7+0.6+0.7)/3 = 0.6667
 *   coincidentally agrees here because every module has equal attempts — the
 *   uneven case is covered by aggregation.ts's own worked example).
 *
 * ── TWO HAND-COMPUTED DISCRIMINATIONS ───────────────────────────────────────
 * Session scores as fractions: A-S1 .6667, A-S2 1.0, B-S1 .3333, B-S2 .3333,
 * B-S3 .6667, B-S4 .6667, C-S1 1.0, C-S2 .6667, C-S3 .6667, C-S4 .6667
 *
 *   M1Q1 pairs: (✓,.6667) (✓,.3333) (✗,.6667) (✓,1.0) (✓,.6667)
 *     M1 = (.6667+.3333+1.0+.6667)/4 = .6667 ; M0 = .6667
 *     M1 − M0 = 0  →  r_pb = 0.0000  (a question that separates nobody)
 *
 *   M2Q1 pairs: (✗,.6667) (✗,.3333) (✓,.6667) (✓,1.0) (✗,.6667)
 *     right: .6667, 1.0        → M1 = .8333
 *     wrong: .6667,.3333,.6667 → M0 = .5556
 *     all scores mean = .6667 ; Σ(dev²) = .2222 ; var = .04444 ; σ = .21082
 *     p = 2/5 = .4, q = .6, √(pq) = .48990
 *     r_pb = ((.8333 − .5556)/.21082) × .48990 = 1.31762 × .48990 = 0.6455
 */

import type { ScriptedAnswer } from "./seed";

const a = (
  moduleIndex: number,
  questionIndex: number,
  correct: boolean,
  timeSeconds = 30
): ScriptedAnswer => ({ moduleIndex, questionIndex, correct, timeSeconds });

/** student → session → attempts. Module/question indices are 0-based. */
export const SCENARIO: ScriptedAnswer[][][] = [
  // Student A
  [
    [a(0, 0, true), a(0, 1, true), a(1, 0, false)],
    [a(1, 1, true), a(2, 0, true), a(2, 1, true)],
  ],
  // Student B
  [
    [a(0, 0, true), a(0, 1, false), a(1, 0, false)],
    [a(1, 1, false), a(2, 0, true), a(2, 1, false)],
    [a(0, 0, false), a(1, 0, true), a(2, 0, true)],
    [a(0, 1, true), a(1, 1, true), a(2, 1, false)],
  ],
  // Student C
  [
    [a(0, 0, true), a(0, 1, true), a(1, 0, true)],
    [a(1, 1, true), a(2, 0, false), a(2, 1, true)],
    [a(0, 0, true), a(1, 0, false), a(2, 0, true)],
    [a(0, 1, false), a(1, 1, true), a(2, 1, true)],
  ],
];

export const EXPECTED = {
  studentCount: 3,
  sessionCount: 10,
  attemptCount: 30,
  aggregateAccuracy: 20 / 30,
  perModuleAccuracy: [0.7, 0.6, 0.7],
  perModuleAttempts: [10, 10, 10],
  perModuleStudents: [3, 3, 3],
  /** [module][question] → [servedCount, correctCount] */
  perQuestion: [
    [
      [5, 4],
      [5, 3],
    ],
    [
      [5, 2],
      [5, 4],
    ],
    [
      [5, 4],
      [5, 3],
    ],
  ],
  discriminationM1Q1: 0.0,
  discriminationM2Q1: 0.6455,
};
