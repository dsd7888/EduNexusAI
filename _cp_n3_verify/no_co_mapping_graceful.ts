/**
 * CP-N3 Part 4.3 — no_co_mapping_graceful: a module with no module_co_mapping
 * rows (CO not yet classified) must still serve notes normally.
 *
 * Every seeded CSE module already has a module_co_mapping row (backfilled per
 * CLAUDE_CONTEXT.md §17), so this harness manufactures the precondition: it
 * snapshots IDME3532 M1's real mapping row(s), deletes them, drives the real
 * route, then restores the exact rows (same ids) in a `finally` AND on every
 * termination signal. Deleting module_co_mapping does not change the
 * module's content_hash, so the already-cached module notes remain servable
 * — this GET is a cache hit, no AI spend.
 *
 *   npx tsx _cp_n3_verify/no_co_mapping_graceful.ts > /tmp/cp_n3_no_co_mapping.out 2>&1
 */
import {
  loadEnvLocal,
  signInAsStudent,
  waitForServer,
  onSignals,
  makeChecker,
  hr,
  type StudentSession,
} from "./shared";
import {
  N3_FIXTURES,
  stripCoMapping,
  restoreCoMapping,
  type SnapshotRow,
} from "./shared";

type ModuleResponse = {
  blocks: Array<{ id: string; kind: string; pyqSignal?: unknown }>;
  version: number;
  source: string;
  pyqEnriched?: boolean;
};

async function main() {
  loadEnvLocal();
  await waitForServer();

  const checker = makeChecker();

  hr("CP-N3 Part 4.3 — no_co_mapping_graceful");

  const session: StudentSession = await signInAsStudent(undefined, undefined, {
    branch: N3_FIXTURES.MODULE_SCOPE.branch,
    semester: N3_FIXTURES.MODULE_SCOPE.semester,
  });

  let snapshot: SnapshotRow[] = [];
  let restored = false;
  const cleanup = async () => {
    const notes: string[] = [];
    if (!restored && snapshot.length > 0) {
      await restoreCoMapping(session.admin, snapshot);
      restored = true;
      notes.push(`restored ${snapshot.length} module_co_mapping row(s)`);
    }
    notes.push(await session.cleanup());
    return notes.join("; ");
  };
  onSignals(cleanup);
  const m1 = N3_FIXTURES.MODULE_SCOPE.m1;

  try {
    snapshot = await stripCoMapping(session.admin, m1.id);
    checker.check(
      "precondition: module had >=1 mapping row to strip",
      snapshot.length > 0,
      `stripped=${snapshot.length}`,
    );

    const { count: afterStrip } = await session.admin
      .from("module_co_mapping")
      .select("*", { count: "exact", head: true })
      .eq("module_id", m1.id);
    checker.eq("module now has 0 module_co_mapping rows", afterStrip ?? -1, 0);

    const res = await session.json<ModuleResponse>(
      `/api/notes/module/${m1.id}`,
    );
    checker.check("200 returned", res.status === 200, `status=${res.status}`);
    checker.check(
      "blocks served",
      Array.isArray(res.body?.blocks) && res.body.blocks.length > 0,
      `count=${res.body?.blocks?.length}`,
    );
    checker.check(
      "no block has pyqSignal",
      (res.body?.blocks ?? []).every((b) => !("pyqSignal" in b)),
    );
    checker.check("pyqEnriched: true", res.body?.pyqEnriched === true);

    await restoreCoMapping(session.admin, snapshot);
    restored = true;
    const { count: afterRestore } = await session.admin
      .from("module_co_mapping")
      .select("*", { count: "exact", head: true })
      .eq("module_id", m1.id);
    checker.eq(
      "restore brought mapping count back to original",
      afterRestore ?? -1,
      snapshot.length,
    );
  } finally {
    console.log(`\nCleanup: ${await cleanup()}`);
  }

  const { passed, failed } = checker.summary();
  console.log(`\nno_co_mapping_graceful: ${passed}/${passed + failed} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[no_co_mapping_graceful] fatal:", err);
  process.exit(1);
});
