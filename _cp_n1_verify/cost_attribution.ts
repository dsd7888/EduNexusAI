/**
 * CP-N1 harness 6 — notes spend is attributed to notes, not to chat.
 *
 * This is the explicit check for the v1 bug CP-N1 fixes. The retired quick-notes
 * route called routeAI with task 'chat' and feature 'chat', so every rupee spent
 * generating study material landed in the chat bucket on the analytics page and
 * was indistinguishable from real tutoring spend.
 *
 * The harness depends on the shared `after()` shim EXECUTING the callback —
 * routeAI logs through after(), and a shim that swallowed it would make every
 * assertion here pass over an empty table, vacuously. That is the CLAUDE.md
 * harness rule this file exists to honour, so it also asserts the row is
 * genuinely there before asserting anything about its contents.
 *
 * Run: npx tsx _cp_n1_verify/cost_attribution.ts > /tmp/cpn1_cost.log 2>&1
 */
import { randomUUID } from "node:crypto";

import {
  loadEnvLocal,
  adminClient,
  makeRunInScope,
  makeChecker,
  hr,
  sub,
  onSignals,
  resolveModule,
  purgeNotes,
  FIXTURES,
} from "./shared";

loadEnvLocal();

import { generateModuleNotes, NOTES_FEATURE, NOTES_MODULE_TASK } from "@/lib/notes/generator";

async function main() {
  const admin = adminClient();
  const runInScope = await makeRunInScope();
  const { check, eq, summary } = makeChecker();

  hr("CP-N1 harness 6 — cost_attribution");

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
    return `study_notes residual rows: ${residual}`;
  };
  onSignals(cleanup);

  try {
    await purgeNotes(admin, [target.moduleId]);

    const jobId = randomUUID();
    const res = await runInScope(() =>
      generateModuleNotes({
        subjectId: target.subjectId,
        moduleId: target.moduleId,
        adminClient: admin,
        logContext: {
          userId: null,
          userEmail: null,
          userRole: "superadmin",
          subjectId: target.subjectId,
          subjectCode: target.subjectCode,
          jobId,
          relatedContentId: null,
        },
      })
    );
    check("generation succeeded", res.ok, res.ok ? "" : res.message);
    if (!res.ok) throw new Error(res.message);

    // after() is fired via void; give the log write a moment to land.
    await new Promise((r) => setTimeout(r, 1500));

    sub("ai_call_logs");
    const { data: logs, error: logsError } = await admin
      .from("ai_call_logs")
      .select(
        "task, feature, status, input_tokens, output_tokens, thinking_tokens, cost_inr, subject_id, attempt_number"
      )
      .eq("job_id", jobId);

    // Assert the QUERY worked before interpreting its emptiness. An error and a
    // genuinely empty result both surface as "no rows", and scoring a typo'd
    // column name as "after() never fired" would send the next reader hunting
    // the wrong bug — which is exactly what happened while writing this.
    check("the ai_call_logs query itself succeeded", !logsError, logsError?.message ?? "");

    // Positive control: without this, every assertion below would pass
    // identically against a shim that discarded after().
    check(
      "a log row was actually written (after() executed)",
      (logs?.length ?? 0) >= 1,
      `${logs?.length ?? 0} row(s)`
    );
    if (!logs || logs.length === 0) throw new Error("no ai_call_logs row for this job");

    for (const row of logs) {
      eq("task is notes_gen_module", row.task, NOTES_MODULE_TASK);
      eq("feature is 'notes'", row.feature, NOTES_FEATURE);
      check("feature is NOT 'chat' (the v1 bug)", row.feature !== "chat", String(row.feature));
      eq("subject_id recorded", row.subject_id, target.subjectId);
      const total =
        (row.input_tokens ?? 0) + (row.output_tokens ?? 0) + (row.thinking_tokens ?? 0);
      check("tokens recorded", total > 0, String(total));
      check("cost recorded", Number(row.cost_inr ?? 0) > 0, String(row.cost_inr));
    }

    sub("no leakage into the chat bucket");
    // Scoped to this job id, so a genuinely concurrent chat elsewhere cannot
    // make this fail.
    const chatRows = (logs ?? []).filter((r) => r.feature === "chat");
    eq("zero rows in the chat bucket for this job", chatRows.length, 0);

    sub("cached reads cost nothing");
    const cachedJob = randomUUID();
    const cached = await runInScope(() =>
      generateModuleNotes({
        subjectId: target.subjectId,
        moduleId: target.moduleId,
        adminClient: admin,
        logContext: {
          userId: null,
          userEmail: null,
          userRole: "superadmin",
          subjectId: target.subjectId,
          subjectCode: target.subjectCode,
          jobId: cachedJob,
          relatedContentId: null,
        },
      })
    );
    check("second call served from cache", cached.ok && cached.source === "cache");
    await new Promise((r) => setTimeout(r, 1000));
    const { data: cachedLogs } = await admin
      .from("ai_call_logs")
      .select("id")
      .eq("job_id", cachedJob);
    eq("a cache hit writes no ai_call_logs row", cachedLogs?.length ?? 0, 0);

    const { passed, failed } = summary();
    console.log(`\n${passed} passed, ${failed} failed`);
    console.log(`cleanup: ${await cleanup()}`);
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error("harness error:", err);
    console.log(`cleanup: ${await cleanup()}`);
    process.exit(1);
  }
}

main();
