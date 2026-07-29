/**
 * CP-Q4 Part 5d — point-biserial correlation, pure unit test.
 *
 * No database, no server, no seeding. `pointBiserial` is a pure function of an
 * array of (correct, overallScore) pairs, so it is verified against synthetic
 * datasets whose correct answers are computed BY HAND in the comments below
 * rather than by re-running the implementation and asserting it equals itself.
 *
 *   npx tsx _cp_q4_verify/discrimination_stat.ts > out.txt 2>&1
 */

import { pointBiserial } from "@/lib/analytics/aggregates";
import { MIN_ATTEMPTS_FOR_DISCRIMINATION } from "@/lib/analytics/privacy";
import { makeChecker, hr, sub } from "@/lib/testing/httpHarness";

const TOL = 0.01;

function near(actual: number | null, expected: number): boolean {
  return actual != null && Math.abs(actual - expected) <= TOL;
}

async function main() {
  const c = makeChecker();
  hr("CP-Q4 Part 5d — POINT-BISERIAL DISCRIMINATION (pure)");

  // ── 1. An EXCELLENT discriminator ────────────────────────────────────────
  // Everyone who got the item right scored high overall; everyone who got it
  // wrong scored low. Perfect separation.
  //
  //   right: scores 0.9, 0.9, 0.9   → M1 = 0.9
  //   wrong: scores 0.3, 0.3, 0.3   → M0 = 0.3
  //   all:   [.9,.9,.9,.3,.3,.3]    → mean 0.6
  //          variance = ((0.3)^2 * 6) / 6 = 0.09 → σ = 0.3
  //   p = q = 0.5 → √(pq) = 0.5
  //   r_pb = ((0.9 − 0.3) / 0.3) × 0.5 = 2.0 × 0.5 = 1.0
  sub("1. Perfect discriminator — expect r_pb = 1.00");
  const excellent = [
    { correct: true, overallScore: 0.9 },
    { correct: true, overallScore: 0.9 },
    { correct: true, overallScore: 0.9 },
    { correct: false, overallScore: 0.3 },
    { correct: false, overallScore: 0.3 },
    { correct: false, overallScore: 0.3 },
  ];
  const rExcellent = pointBiserial(excellent);
  c.check(
    "perfect separation → 1.00",
    near(rExcellent, 1.0),
    `got ${rExcellent?.toFixed(4)}`
  );
  c.check("is above the 0.3 'good discriminator' bar", (rExcellent ?? 0) > 0.3);

  // ── 2. A BROKEN item — the inverted pattern ──────────────────────────────
  // Same numbers, roles swapped: the students who scored WELL overall got this
  // one wrong. This is the miskeyed-answer signature, and the reason negative
  // discrimination is the single most useful number on the whole panel.
  //   r_pb = ((0.3 − 0.9) / 0.3) × 0.5 = −1.0
  sub("2. Broken/miskeyed item — expect r_pb = −1.00");
  const broken = [
    { correct: true, overallScore: 0.3 },
    { correct: true, overallScore: 0.3 },
    { correct: true, overallScore: 0.3 },
    { correct: false, overallScore: 0.9 },
    { correct: false, overallScore: 0.9 },
    { correct: false, overallScore: 0.9 },
  ];
  const rBroken = pointBiserial(broken);
  c.check(
    "inverted separation → −1.00",
    near(rBroken, -1.0),
    `got ${rBroken?.toFixed(4)}`
  );
  c.check("is negative (flags for review)", (rBroken ?? 0) < 0);

  // ── 3. A hand-computed asymmetric case ───────────────────────────────────
  // Not symmetric, so a sign error or a swapped mean cannot pass by accident.
  //   right: 0.8, 0.6        → M1 = 0.7   (n=2)
  //   wrong: 0.5, 0.4, 0.1   → M0 = 1.0/3 = 0.333333   (n=3)
  //   all:   [.8,.6,.5,.4,.1] mean = 2.4/5 = 0.48
  //   deviations: .32, .12, .02, −.08, −.38
  //   squares:    .1024, .0144, .0004, .0064, .1444  → Σ = .268
  //   variance = .268/5 = .0536 → σ = 0.2315167…
  //   p = 2/5 = 0.4, q = 0.6 → √(pq) = √0.24 = 0.4898979…
  //   r_pb = ((0.7 − 0.333333) / 0.2315167) × 0.4898979
  //        = (0.366667 / 0.2315167) × 0.4898979
  //        = 1.583763 × 0.4898979 = 0.775883…
  sub("3. Asymmetric hand-computed case — expect r_pb ≈ 0.7759");
  const asymmetric = [
    { correct: true, overallScore: 0.8 },
    { correct: true, overallScore: 0.6 },
    { correct: false, overallScore: 0.5 },
    { correct: false, overallScore: 0.4 },
    { correct: false, overallScore: 0.1 },
  ];
  const rAsym = pointBiserial(asymmetric);
  c.check(
    "matches hand calculation within 0.01",
    near(rAsym, 0.7759),
    `got ${rAsym?.toFixed(4)}, expected ≈0.7759`
  );

  // ── 4. THE FLOOR ─────────────────────────────────────────────────────────
  // Exactly at the floor computes; one below returns null. Both halves matter:
  // testing only the null case would pass against a function that always
  // returns null.
  sub(`4. The ${MIN_ATTEMPTS_FOR_DISCRIMINATION}-attempt floor`);
  const atFloor = asymmetric; // exactly 5 pairs
  c.check(
    `exactly ${MIN_ATTEMPTS_FOR_DISCRIMINATION} attempts → computes (not null)`,
    pointBiserial(atFloor) != null,
    `n=${atFloor.length}`
  );
  const belowFloor = asymmetric.slice(0, MIN_ATTEMPTS_FOR_DISCRIMINATION - 1);
  c.check(
    `${MIN_ATTEMPTS_FOR_DISCRIMINATION - 1} attempts → null`,
    pointBiserial(belowFloor) === null,
    `n=${belowFloor.length}, got ${String(pointBiserial(belowFloor))}`
  );
  c.check(
    "below-floor result is null, NOT 0 (0 would sort as a broken question)",
    pointBiserial(belowFloor) !== 0
  );

  // ── 5. Degenerate inputs return null, not NaN ────────────────────────────
  sub("5. Degenerate inputs");
  const allCorrect = Array.from({ length: 6 }, (_, i) => ({
    correct: true,
    overallScore: 0.5 + i * 0.05,
  }));
  c.check(
    "every attempt correct → null (no item variance)",
    pointBiserial(allCorrect) === null
  );

  const allWrong = allCorrect.map((p) => ({ ...p, correct: false }));
  c.check(
    "every attempt wrong → null (no item variance)",
    pointBiserial(allWrong) === null
  );

  const flatScores = Array.from({ length: 6 }, (_, i) => ({
    correct: i % 2 === 0,
    overallScore: 0.5,
  }));
  c.check(
    "zero variance in overall scores → null, not NaN",
    pointBiserial(flatScores) === null,
    `got ${String(pointBiserial(flatScores))}`
  );

  c.check("no result is ever NaN", [rExcellent, rBroken, rAsym].every(
    (v) => v == null || Number.isFinite(v)
  ));

  const { passed, failed } = c.summary();
  hr(`RESULT — ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
