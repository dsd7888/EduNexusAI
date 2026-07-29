/**
 * CP-Q4 Part 5c — CO attainment weights correctly by dual-pass confidence,
 * and a VERIFIED mapping weighs 1.0 regardless of its original AI confidence.
 *
 * Same controlled scenario as `aggregate_correctness.ts` (imported from
 * scenario.ts, not re-declared), plus a CO mapping layer chosen so that every
 * weighting rule changes the answer measurably. If the weights were ignored —
 * or if verification were discounted by its stale band — the numbers below
 * would come out different, and the harness says by how much.
 *
 * ── THE MAPPING LAYER ───────────────────────────────────────────────────────
 *   M1 → CO 1   confidence 'high'   source ai_inferred          → w 1.0
 *   M2 → CO 1   confidence 'low'    source ai_inferred          → w 0.4
 *   M2 → CO 2   confidence 'medium' source ai_inferred          → w 0.7
 *   M3 → CO 2   confidence 'low'    source superadmin_verified  → w 1.0  ★
 *
 * ★ is the assertion that matters: a LOW-confidence mapping that has been
 *   verified must weigh 1.0, not 0.4. Verification supersedes the classifier.
 *
 * ── HAND-COMPUTED EXPECTATIONS ──────────────────────────────────────────────
 * Per-module totals from scenario.ts: M1 7/10, M2 6/10, M3 7/10.
 *
 *   CO 1 = (7×1.0 + 6×0.4) / (10×1.0 + 10×0.4)
 *        = (7 + 2.4) / 14  =  9.4 / 14  = 0.671428…  → 0.6714
 *        attempts 20, contributing modules {M1, M2}
 *
 *   CO 2 = (6×0.7 + 7×1.0) / (10×0.7 + 10×1.0)
 *        = (4.2 + 7) / 17  =  11.2 / 17 = 0.658823…  → 0.6588
 *        attempts 20, contributing modules {M2, M3}
 *
 *   COUNTERFACTUAL, asserted explicitly: had the verified M3 mapping been
 *   weighted by its 'low' band (0.4) instead of 1.0, CO 2 would be
 *   (4.2 + 2.8) / (7 + 4) = 7.0 / 11 = 0.636363… → 0.6364. The harness asserts
 *   the result is NOT that, so "weights applied at all" and "verification
 *   respected" are two separate passes rather than one that could mask the
 *   other.
 *
 *   npx tsx _cp_q4_verify/co_attainment.ts > out.txt 2>&1
 */

import { computeCOAttainment, type AttemptRow, type ModuleCoRow } from "@/lib/analytics/aggregates";
import { CONFIDENCE_WEIGHTS, mappingWeight } from "@/lib/analytics/coWeighting";
import { makeChecker, hr, sub, onSignals } from "@/lib/testing/httpHarness";
import { seedScenario, type SeedScenario } from "./seed";
import { SCENARIO } from "./scenario";

const round4 = (n: number) => Number(n.toFixed(4));

const EXPECTED_CO1 = round4(9.4 / 14);
const EXPECTED_CO2 = round4(11.2 / 17);
const COUNTERFACTUAL_CO2_IF_UNVERIFIED = round4(7.0 / 11);

async function main() {
  const c = makeChecker();
  hr("CP-Q4 Part 5c — CO ATTAINMENT LINEAGE (confidence + verification weights)");

  let scenario: SeedScenario | null = null;
  try {
    sub("0. Seed scenario + CO mapping layer");
    scenario = await seedScenario(SCENARIO);
    const s = scenario;
    onSignals(() => s.cleanup());

    const mappings: Array<{
      module_id: string;
      co_code: string;
      confidence: string;
      source: string;
    }> = [
      { module_id: s.moduleIds[0], co_code: "CO 1", confidence: "high", source: "ai_inferred" },
      { module_id: s.moduleIds[1], co_code: "CO 1", confidence: "low", source: "ai_inferred" },
      { module_id: s.moduleIds[1], co_code: "CO 2", confidence: "medium", source: "ai_inferred" },
      { module_id: s.moduleIds[2], co_code: "CO 2", confidence: "low", source: "superadmin_verified" },
    ];
    const { error: mapErr } = await s.admin.from("module_co_mapping").insert(mappings);
    c.check("CO mapping layer inserted", !mapErr, mapErr?.message ?? "4 rows");

    // ── weight function, in isolation ──
    sub("1. mappingWeight() — the rule, before it touches any data");
    c.eq("high + ai_inferred → 1.0", mappingWeight(mappings[0]), CONFIDENCE_WEIGHTS.high);
    c.eq("low + ai_inferred → 0.4", mappingWeight(mappings[1]), CONFIDENCE_WEIGHTS.low);
    c.eq("medium + ai_inferred → 0.7", mappingWeight(mappings[2]), CONFIDENCE_WEIGHTS.medium);
    c.eq(
      "low + superadmin_verified → 1.0 (verification supersedes the band)",
      mappingWeight(mappings[3]),
      1.0
    );
    c.check(
      "…and that is NOT the low weight it would otherwise get",
      mappingWeight(mappings[3]) !== CONFIDENCE_WEIGHTS.low
    );

    // ── computeCOAttainment over the real seeded attempts ──
    sub("2. computeCOAttainment over the seeded attempts");
    const { data: attemptData } = await s.admin
      .from("student_question_attempts")
      .select(
        "student_id, question_id, module_id, question_text, question_type, is_correct, time_taken_seconds, session_id, created_at"
      )
      .eq("subject_id", s.subjectId);
    const attempts = (attemptData ?? []) as AttemptRow[];
    c.eq("30 attempts loaded", attempts.length, 30);

    const result = computeCOAttainment(attempts, mappings as ModuleCoRow[]);
    c.eq("two COs produced", result.length, 2);

    const co1 = result.find((r) => r.co_code === "CO 1");
    const co2 = result.find((r) => r.co_code === "CO 2");

    sub("3. CO 1 — high(1.0) over M1 + low(0.4) over M2");
    c.check("CO 1 present", co1 != null);
    if (co1) {
      c.eq(
        "weighted_accuracy = 9.4/14",
        round4(co1.weighted_accuracy ?? -1),
        EXPECTED_CO1
      );
      c.eq("attempts is the RAW count, not the weighted sum", co1.attempts, 20);
      c.eq("contributing modules", co1.contributing_modules.length, 2);
      c.check(
        "contributing modules are M1 and M2",
        co1.contributing_modules.includes(s.moduleIds[0]) &&
          co1.contributing_modules.includes(s.moduleIds[1])
      );
    }

    sub("4. CO 2 — medium(0.7) over M2 + VERIFIED low(1.0) over M3");
    c.check("CO 2 present", co2 != null);
    if (co2) {
      c.eq(
        "weighted_accuracy = 11.2/17",
        round4(co2.weighted_accuracy ?? -1),
        EXPECTED_CO2
      );
      c.check(
        "is NOT the value it would have if verification were ignored (7.0/11)",
        round4(co2.weighted_accuracy ?? -1) !== COUNTERFACTUAL_CO2_IF_UNVERIFIED,
        `got ${round4(co2.weighted_accuracy ?? -1)}, counterfactual ${COUNTERFACTUAL_CO2_IF_UNVERIFIED}`
      );
      c.eq("attempts is the RAW count", co2.attempts, 20);
    }

    // ── the weights are actually doing something ──
    sub("5. Weighting is load-bearing (unweighted would differ)");
    const unweighted = computeCOAttainment(
      attempts,
      mappings.map((m) => ({ ...m, confidence: "high", source: "ai_inferred" })) as ModuleCoRow[]
    );
    const unweightedCO1 = unweighted.find((r) => r.co_code === "CO 1");
    c.check(
      "flattening every weight to 1.0 changes CO 1",
      round4(unweightedCO1?.weighted_accuracy ?? -1) !== EXPECTED_CO1,
      `weighted ${EXPECTED_CO1} vs flat ${round4(unweightedCO1?.weighted_accuracy ?? -1)}`
    );

    // ── an attempt in a module mapped to two COs counts toward both ──
    sub("6. A module mapping to two COs contributes to both");
    const m2InBoth =
      (co1?.contributing_modules.includes(s.moduleIds[1]) ?? false) &&
      (co2?.contributing_modules.includes(s.moduleIds[1]) ?? false);
    c.check("M2 contributes to CO 1 AND CO 2", m2InBoth);
    c.eq(
      "total contributing attempts across COs = 40 (20 attempts double-counted by design)",
      (co1?.attempts ?? 0) + (co2?.attempts ?? 0),
      40
    );

    // ── unmapped modules do not silently vanish into a CO ──
    sub("7. Attempts with no CO mapping contribute to no CO");
    const noMappings = computeCOAttainment(attempts, []);
    c.eq("no mappings → no CO rows", noMappings.length, 0);
  } catch (err) {
    c.check("harness ran without throwing", false, String(err));
  } finally {
    if (scenario) {
      const notes = await scenario.cleanup();
      sub("8. Cleanup — verified, not assumed");
      console.log(`  cleanup: ${notes}`);
      const { count } = await scenario.admin
        .from("module_co_mapping")
        .select("*", { count: "exact", head: true })
        .in("module_id", scenario.moduleIds);
      c.eq("no module_co_mapping rows left behind", count ?? 0, 0);
    }
  }

  const { passed, failed } = c.summary();
  hr(`RESULT — ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
