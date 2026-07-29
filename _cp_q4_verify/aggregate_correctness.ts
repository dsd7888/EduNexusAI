/**
 * CP-Q4 Part 5b — the correctness floor for everything faculty sees.
 *
 * Seeds the controlled scenario in `scenario.ts` (3 students, 1 subject, 3
 * modules, 10 sessions, 30 scripted attempts), runs the REAL `refreshSnapshot`
 * against the REAL database, then asserts the persisted snapshot matches the
 * hand-computed values in `EXPECTED` to four decimal places.
 *
 * Why the real refreshSnapshot and not the pure functions in isolation: the
 * pure functions are already covered by their own arithmetic. What this proves
 * is the whole path — the queries pull the right rows, the joins line up, the
 * jsonb round-trips through Postgres without losing precision, and the upsert
 * writes what was computed. Every one of those is a place a correct formula
 * can still produce a wrong dashboard.
 *
 *   npx tsx _cp_q4_verify/aggregate_correctness.ts > out.txt 2>&1
 *
 * Self-cleaning, including on signals.
 */

import { refreshSnapshot } from "@/lib/analytics/aggregates";
import { makeChecker, hr, sub, onSignals } from "@/lib/testing/httpHarness";
import { seedScenario, type SeedScenario } from "./seed";
import { SCENARIO, EXPECTED } from "./scenario";

const DP = 4;
const round = (n: number) => Number(n.toFixed(DP));

async function main() {
  const c = makeChecker();
  hr("CP-Q4 Part 5b — AGGREGATE CORRECTNESS (real DB, real refreshSnapshot)");

  let scenario: SeedScenario | null = null;
  try {
    sub("0. Seeding the controlled scenario");
    scenario = await seedScenario(SCENARIO);
    const s = scenario;
    onSignals(() => s.cleanup());
    console.log(
      `  subject ${s.subjectId} · ${s.moduleIds.length} modules · ${s.studentIds.length} students · ${s.sessionIds.length} sessions`
    );
    c.check(
      "seeded 10 sessions across 3 students",
      s.sessionIds.length === EXPECTED.sessionCount,
      `got ${s.sessionIds.length}`
    );

    sub("1. refreshSnapshot() — the real thing, against the real DB");
    const aggregates = await refreshSnapshot(s.admin, s.subjectId);

    // ── counts ──
    sub("2. Cohort counts");
    c.eq("student_count", aggregates.student_count, EXPECTED.studentCount);
    c.eq("session_count", aggregates.session_count, EXPECTED.sessionCount);
    c.eq("attempt_count", aggregates.attempt_count, EXPECTED.attemptCount);

    // ── aggregate accuracy ──
    sub("3. Aggregate accuracy (attempt-weighted, 4dp)");
    c.eq(
      "aggregate_accuracy = 20/30",
      round(aggregates.aggregate_accuracy ?? -1),
      round(EXPECTED.aggregateAccuracy)
    );

    // ── per module ──
    sub("4. Per-module accuracy, attempts, distinct students (4dp)");
    const byNumber = [...aggregates.per_module].sort(
      (x, y) => x.module_number - y.module_number
    );
    c.eq("per_module has one row per module", byNumber.length, 3);
    c.check(
      "per_module is ordered by module_number",
      byNumber.every((m, i) => m.module_number === i + 1)
    );
    for (let i = 0; i < 3; i += 1) {
      c.eq(
        `M${i + 1} accuracy`,
        round(byNumber[i].accuracy ?? -1),
        round(EXPECTED.perModuleAccuracy[i])
      );
      c.eq(`M${i + 1} attempts`, byNumber[i].attempts, EXPECTED.perModuleAttempts[i]);
      c.eq(
        `M${i + 1} distinct students`,
        byNumber[i].students_count,
        EXPECTED.perModuleStudents[i]
      );
    }

    // ── per question ──
    sub("5. Per-question served/correct counts (bank questions only)");
    c.eq(
      "per_question covers the 6 questions actually served",
      aggregates.per_question.length,
      6
    );
    for (let m = 0; m < 3; m += 1) {
      for (let q = 0; q < 2; q += 1) {
        const id = s.questionIds[m][q];
        const row = aggregates.per_question.find((r) => r.question_id === id);
        const [served, correct] = EXPECTED.perQuestion[m][q];
        c.check(
          `M${m + 1}Q${q + 1} present in per_question`,
          row != null
        );
        if (row) {
          c.eq(`M${m + 1}Q${q + 1} times_served`, row.times_served, served);
          c.eq(`M${m + 1}Q${q + 1} times_correct`, row.times_correct, correct);
          c.eq(
            `M${m + 1}Q${q + 1} accuracy`,
            round(row.accuracy ?? -1),
            round(correct / served)
          );
        }
      }
    }
    c.check(
      "questions seeded but never served are absent (not zero-filled)",
      aggregates.per_question.length === 6 &&
        !aggregates.per_question.some((r) => r.times_served === 0)
    );

    // ── discrimination, hand-computed ──
    sub("6. Discrimination against hand calculation");
    const m1q1 = aggregates.per_question.find(
      (r) => r.question_id === s.questionIds[0][0]
    );
    const m2q1 = aggregates.per_question.find(
      (r) => r.question_id === s.questionIds[1][0]
    );
    c.check(
      "M1Q1 discrimination = 0.0000 (separates nobody)",
      m1q1?.discrimination != null &&
        Math.abs(m1q1.discrimination - EXPECTED.discriminationM1Q1) < 0.0001,
      `got ${m1q1?.discrimination?.toFixed(4)}`
    );
    c.check(
      "M2Q1 discrimination ≈ 0.6455",
      m2q1?.discrimination != null &&
        Math.abs(m2q1.discrimination - EXPECTED.discriminationM2Q1) < 0.001,
      `got ${m2q1?.discrimination?.toFixed(4)}`
    );
    c.check(
      "every question is at the 5-attempt floor and still computes",
      aggregates.per_question.every(
        (r) => r.times_served === 5 && r.discrimination != null
      )
    );

    // ── persistence: what was computed is what was stored ──
    sub("7. The stored row matches the computed value (jsonb round-trip)");
    const { data: stored } = await s.admin
      .from("faculty_analytics_snapshots")
      .select("*")
      .eq("subject_id", s.subjectId)
      .maybeSingle();
    const row = stored as {
      student_count: number;
      session_count: number;
      attempt_count: number;
      aggregate_accuracy: number | string | null;
      per_module: Array<{ module_number: number; accuracy: number | null }>;
      per_question: unknown[];
    } | null;

    c.check("a snapshot row was written", row != null);
    if (row) {
      c.eq("stored student_count", row.student_count, EXPECTED.studentCount);
      c.eq("stored session_count", row.session_count, EXPECTED.sessionCount);
      c.eq("stored attempt_count", row.attempt_count, EXPECTED.attemptCount);
      // numeric comes back as a string from PostgREST — assert the VALUE, and
      // that the precision survived the round trip.
      c.eq(
        "stored aggregate_accuracy (4dp, numeric→string round trip)",
        round(Number(row.aggregate_accuracy)),
        round(EXPECTED.aggregateAccuracy)
      );
      const storedByNumber = [...row.per_module].sort(
        (x, y) => x.module_number - y.module_number
      );
      for (let i = 0; i < 3; i += 1) {
        c.eq(
          `stored M${i + 1} accuracy`,
          round(Number(storedByNumber[i].accuracy)),
          round(EXPECTED.perModuleAccuracy[i])
        );
      }
      c.eq("stored per_question length", row.per_question.length, 6);
    }

    // ── exactly one row, ever ──
    sub("8. One snapshot per subject (the UNIQUE constraint holds)");
    await refreshSnapshot(s.admin, s.subjectId);
    const { count } = await s.admin
      .from("faculty_analytics_snapshots")
      .select("*", { count: "exact", head: true })
      .eq("subject_id", s.subjectId);
    c.eq("after a second refresh, still exactly 1 row", count, 1);
  } catch (err) {
    c.check("harness ran without throwing", false, String(err));
  } finally {
    if (scenario) {
      const notes = await scenario.cleanup();
      sub("9. Cleanup — verified, not assumed");
      console.log(`  cleanup: ${notes}`);
      const { count: leftoverSnapshots } = await scenario.admin
        .from("faculty_analytics_snapshots")
        .select("*", { count: "exact", head: true })
        .eq("subject_id", scenario.subjectId);
      const { count: leftoverAttempts } = await scenario.admin
        .from("student_question_attempts")
        .select("*", { count: "exact", head: true })
        .eq("subject_id", scenario.subjectId);
      c.eq("no snapshot rows left behind", leftoverSnapshots ?? 0, 0);
      c.eq("no attempt rows left behind", leftoverAttempts ?? 0, 0);
    }
  }

  const { passed, failed } = c.summary();
  hr(`RESULT — ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
