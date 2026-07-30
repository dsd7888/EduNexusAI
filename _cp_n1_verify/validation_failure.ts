/**
 * CP-N1 harness 5 — invalid model output fails loudly and writes nothing.
 *
 * Part 3 makes two claims about failure that are unfalsifiable from outside:
 * the generator does NOT silently retry, and it inserts NOTHING when
 * validation fails. Waiting for a real model to spontaneously emit an invalid
 * block is not a test, so this feeds a known-bad payload through the
 * `aiOverride` seam and COUNTS the invocations — "exactly one call" is then a
 * measurement, not a promise.
 *
 * Run: npx tsx _cp_n1_verify/validation_failure.ts > /tmp/cpn1_valfail.log 2>&1
 */
import { randomUUID } from "node:crypto";

import {
  loadEnvLocal,
  adminClient,
  makeChecker,
  hr,
  sub,
  onSignals,
  resolveModule,
  purgeNotes,
  FIXTURES,
} from "./shared";

loadEnvLocal();

import { generateModuleNotes } from "@/lib/notes/generator";

/** Valid except that the concept block has no `whyItMatters` (a required field). */
const MISSING_REQUIRED_FIELD = JSON.stringify({
  blocks: [
    {
      kind: "concept",
      id: "concept-set",
      title: "Set",
      plainExplanation: "A well-defined collection of distinct objects.",
      // whyItMatters deliberately absent
    },
    {
      kind: "concept",
      id: "concept-power-set",
      title: "Power Set",
      plainExplanation: "The set of all subsets of a set.",
      whyItMatters: "Cardinality questions rely on it.",
    },
    {
      kind: "concept",
      id: "concept-subset",
      title: "Subset",
      plainExplanation: "Every element of A is also in B.",
      whyItMatters: "Underpins set inclusion proofs.",
    },
    {
      kind: "concept",
      id: "concept-union",
      title: "Union",
      plainExplanation: "All elements in either set.",
      whyItMatters: "Basic set operation.",
    },
  ],
});

/** A second failure mode: an id that is not <kind>-<slug>. */
const BAD_ID = JSON.stringify({
  blocks: JSON.parse(MISSING_REQUIRED_FIELD).blocks.map(
    (b: Record<string, unknown>, i: number) =>
      i === 0 ? { ...b, whyItMatters: "Filled in.", id: "a7f3c9" } : b
  ),
});

async function main() {
  const admin = adminClient();
  const { check, eq, summary } = makeChecker();

  hr("CP-N1 harness 5 — validation_failure");

  const target = await resolveModule(
    admin,
    FIXTURES.IDSH2020.code,
    FIXTURES.IDSH2020.moduleOne
  );
  console.log(`target: ${target.subjectCode} M${target.moduleNumber} "${target.moduleName}"`);

  let cleaned = false;
  const cleanup = async (): Promise<string> => {
    if (cleaned) return "already cleaned";
    cleaned = true;
    const residual = await purgeNotes(admin, [target.moduleId]);
    return `study_notes residual rows for this module: ${residual}`;
  };
  onSignals(cleanup);

  try {
    await purgeNotes(admin, [target.moduleId]);

    const countRows = async () => {
      const { count } = await admin
        .from("study_notes")
        .select("*", { count: "exact", head: true })
        .eq("module_id", target.moduleId);
      return count ?? 0;
    };

    for (const [label, payload, expectField] of [
      ["missing required field", MISSING_REQUIRED_FIELD, "whyItMatters"],
      ["malformed block id", BAD_ID, "id"],
    ] as const) {
      sub(label);
      const before = await countRows();
      let calls = 0;

      const res = await generateModuleNotes({
        subjectId: target.subjectId,
        moduleId: target.moduleId,
        adminClient: admin,
        logContext: {
          userId: null,
          userEmail: null,
          userRole: "superadmin",
          subjectId: target.subjectId,
          subjectCode: target.subjectCode,
          jobId: randomUUID(),
          relatedContentId: null,
        },
        aiOverride: async () => {
          calls += 1;
          return {
            content: payload,
            tokensUsed: { input: 100, output: 100, thinking: 0 },
            costInr: 0,
            modelUsed: "test-stub",
          };
        },
      });

      const after = await countRows();

      check("generation reported failure", !res.ok);
      if (!res.ok) {
        eq("error is 'invalid_blocks'", res.error, "invalid_blocks");
        check(
          "issues array is populated",
          Array.isArray(res.issues) && res.issues.length > 0,
          `${res.issues?.length ?? 0} issue(s)`
        );
        check(
          `an issue names the offending field (${expectField})`,
          (res.issues ?? []).some((i) => i.field.includes(expectField)),
          (res.issues ?? []).map((i) => i.field).join(", ")
        );
        check(
          "raw blocks returned for debugging",
          Array.isArray(res.rawBlocks) && res.rawBlocks.length === 4,
          `${res.rawBlocks?.length ?? 0} raw block(s)`
        );
      }
      // The two load-bearing assertions.
      eq("the AI was called EXACTLY once (no silent retry)", calls, 1);
      eq("no study_notes row was inserted", after, before);
    }

    sub("a valid payload through the same seam still stores");
    const goodBlocks = JSON.parse(MISSING_REQUIRED_FIELD).blocks;
    goodBlocks[0].whyItMatters = "Sets are the foundation of every later module.";
    const okRes = await generateModuleNotes({
      subjectId: target.subjectId,
      moduleId: target.moduleId,
      adminClient: admin,
      logContext: {
        userId: null,
        userEmail: null,
        userRole: "superadmin",
        subjectId: target.subjectId,
        subjectCode: target.subjectCode,
        jobId: randomUUID(),
        relatedContentId: null,
      },
      aiOverride: async () => ({
        content: JSON.stringify({ blocks: goodBlocks }),
        tokensUsed: { input: 100, output: 100, thinking: 0 },
        costInr: 0,
        modelUsed: "test-stub",
      }),
    });
    // Without this, the harness would pass just as well against a generator
    // that rejects everything.
    check("valid payload succeeds", okRes.ok, okRes.ok ? "" : okRes.message);
    eq("stored row count is now 1", await countRows(), 1);

    const { passed, failed } = summary();
    console.log(`\n${passed} passed, ${failed} failed`);
    console.log(await cleanup());
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error("harness error:", err);
    console.log(await cleanup());
    process.exit(1);
  }
}

main();
