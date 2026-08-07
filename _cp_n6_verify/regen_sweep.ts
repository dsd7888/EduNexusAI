/**
 * CP-N6 Part 5.2 — LIVE regression. Makes REAL Gemini calls and costs money.
 *
 * Generates notes N times (default 5) for a deliberately formula-heavy module
 * and scans every returned block set with the shared corruption detector. The
 * bar is ZERO corruption across ALL runs: this failure mode is intermittent, so
 * a single clean run proves nothing.
 *
 *   npx tsx _cp_n6_verify/regen_sweep.ts > /tmp/cpn6.log 2>&1
 *   RUNS=3 SUBJECT=SOEEC1010 MODULE=1 npx tsx _cp_n6_verify/regen_sweep.ts
 *
 * HARNESS RULES (CLAUDE.md):
 *  - the workAsyncStorage shim EXECUTES after(), so routeAI's ai_call_logs
 *    writes actually land and the spend is visible rather than swallowed;
 *  - cleanup runs on SIGINT/SIGTERM/SIGPIPE/SIGHUP as well as in finally — a
 *    signalled run must not leave its generated versions behind;
 *  - cleanup is VERIFIED by re-querying study_notes afterwards, not assumed.
 *    REDIRECT OUTPUT TO A FILE — piping through `head` SIGPIPE-kills the run.
 */
import { loadEnvLocal, adminClient, makeRunInScope, resolveModule } from "../_cp_n1_verify/shared";

loadEnvLocal();

const RUNS = Number(process.env.RUNS ?? 5);
const SUBJECT = process.env.SUBJECT ?? "SOEEC1010";
const MODULE = Number(process.env.MODULE ?? 1);

async function main() {
  const admin = adminClient();
  const runInScope = await makeRunInScope();
  const { generateModuleNotes } = await import("../src/lib/notes/generator");
  const { findEscapeCorruption, hasResidualControlChars } = await import(
    "../src/lib/text/latexSegments"
  );

  const target = await resolveModule(admin, SUBJECT, MODULE);
  console.log(
    `CP-N6 regen sweep — ${target.subjectCode} M${target.moduleNumber} "${target.moduleName}" × ${RUNS} runs\n`,
  );

  // Every study_notes row this harness creates, so cleanup can be exact.
  const createdIds: string[] = [];
  let cleanedUp = false;

  const cleanup = async (): Promise<void> => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (createdIds.length === 0) {
      console.log("\ncleanup: nothing to remove.");
      return;
    }
    const { error } = await admin.from("study_notes").delete().in("id", createdIds);
    console.log(
      `\ncleanup: deleting ${createdIds.length} generated row(s)${error ? ` — FAILED: ${error.message}` : ""}`,
    );
    // VERIFY the cleanup rather than assuming it (CLAUDE.md).
    const { data: residue } = await admin
      .from("study_notes")
      .select("id")
      .in("id", createdIds);
    console.log(
      residue && residue.length > 0
        ? `cleanup VERIFY: FAILED — ${residue.length} row(s) still present`
        : "cleanup VERIFY: clean, 0 rows remain",
    );
  };

  for (const sig of ["SIGINT", "SIGTERM", "SIGPIPE", "SIGHUP"] as const) {
    process.on(sig, () => {
      void cleanup().then(() => process.exit(1));
    });
  }

  let corruptRuns = 0;
  let failedRuns = 0;

  try {
    for (let run = 1; run <= RUNS; run++) {
      const before = await admin
        .from("study_notes")
        .select("id")
        .eq("module_id", target.moduleId);
      const beforeIds = new Set((before.data ?? []).map((r) => r.id as string));

      // A real jobId, exactly as the notes routes mint one. Without it the
      // ai_call_logs insert fails its NOT NULL constraint and the run's spend
      // is silently unlogged — and the per-attempt rows this harness reads back
      // below would not exist.
      const jobId = crypto.randomUUID();

      const result = await runInScope(() =>
        generateModuleNotes({
          subjectId: target.subjectId,
          moduleId: target.moduleId,
          adminClient: admin as never,
          // Bypass the cache — a cache hit would re-scan the SAME bytes every
          // run and report five clean passes over one generation.
          forceRegenerate: true,
          logContext: { feature: "notes", jobId, userId: null } as never,
        }),
      );

      // How many attempts did this run actually consume? Two means the first
      // attempt failed its gate and the CP-N6 retry rescued it.
      const { data: calls } = await admin
        .from("ai_call_logs")
        .select("attempt_number, status")
        .eq("job_id", jobId)
        .order("attempt_number", { ascending: true });
      const attempts = calls?.length ?? 0;

      const after = await admin
        .from("study_notes")
        .select("id")
        .eq("module_id", target.moduleId);
      for (const r of after.data ?? []) {
        if (!beforeIds.has(r.id as string)) createdIds.push(r.id as string);
      }

      if (!result.ok) {
        failedRuns++;
        console.log(`run ${run}: GENERATION FAILED after ${attempts} attempt(s) — ${result.error}: ${result.message}`);
        continue;
      }

      const hits = result.blocks.flatMap((b, i) =>
        findEscapeCorruption(JSON.stringify(b)).map((h) => ({ ...h, block: i })),
      );
      const residual = result.blocks.some(hasResidualControlChars);
      const mathBlocks = result.blocks.filter((b) => JSON.stringify(b).includes("$")).length;

      if (hits.length === 0 && !residual) {
        console.log(
          `run ${run}: CLEAN — ${result.blocks.length} blocks (${mathBlocks} math-bearing), attempts=${attempts}${attempts > 1 ? " (retry rescued this run)" : ""}, ₹${result.costInr.toFixed(4)}`,
        );
      } else {
        corruptRuns++;
        console.log(
          `run ${run}: CORRUPTION — ${hits.length} hit(s), residualCtrl=${residual}, ${result.blocks.length} blocks, attempts=${attempts}`,
        );
        for (const h of hits.slice(0, 6)) {
          console.log(`    block ${h.block} [${h.severity}] ${JSON.stringify(h.command)}`);
        }
      }
    }
  } finally {
    await cleanup();
  }

  console.log(
    `\n${RUNS - corruptRuns - failedRuns}/${RUNS} clean, ${corruptRuns} corrupted, ${failedRuns} generation failures`,
  );
  console.log(corruptRuns === 0 ? "RESULT: PASS" : "RESULT: FAIL");
  process.exit(corruptRuns === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
