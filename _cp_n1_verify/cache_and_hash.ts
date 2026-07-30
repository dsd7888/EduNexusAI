/**
 * CP-N1 harness 3 — cache hits are contingent on the HASH, not on the flag.
 *
 * Three-phase, using REAL generation (the caching semantics are the thing under
 * test, but serving a stale row is a correctness bug worth paying two Flash
 * calls to disprove):
 *
 *   1. generate            -> version 1, source 'fresh'
 *   2. request again       -> source 'cache', same version, no new row
 *   3. edit the module     -> previous row flagged stale, version 2 generated,
 *      description via SQL    content_hash differs
 *
 * Phase 3 is the one that matters. A cache that keyed only on "is_stale =
 * false" would happily serve version 1 describing a syllabus that no longer
 * exists.
 *
 * The module description is restored in cleanup, and the restore is VERIFIED
 * rather than assumed (CLAUDE.md harness rules) — a half-restored fixture would
 * silently corrupt every later run.
 *
 * Run: npx tsx _cp_n1_verify/cache_and_hash.ts > /tmp/cpn1_cache.log 2>&1
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

import { generateModuleNotes } from "@/lib/notes/generator";

/**
 * Key-order-insensitive canonical form.
 *
 * Postgres `jsonb` does NOT preserve object key order — it stores a parsed
 * representation and re-serialises keys in its own order (shortest-first). So a
 * block round-tripped through study_notes comes back semantically identical but
 * byte-wise different from what was inserted, and a plain JSON.stringify
 * comparison of the two always fails. Anything downstream that wants to compare
 * or checksum stored blocks (CP-N4 diffing, delta-regeneration) has to
 * canonicalise first for the same reason.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)])
    );
  }
  return value;
}

async function main() {
  const admin = adminClient();
  const runInScope = await makeRunInScope();
  const { check, eq, summary } = makeChecker();

  hr("CP-N1 harness 3 — cache_and_hash");

  const target = await resolveModule(
    admin,
    FIXTURES.IDSH2020.code,
    FIXTURES.IDSH2020.moduleOne
  );
  console.log(`target: ${target.subjectCode} M${target.moduleNumber} "${target.moduleName}"`);

  // Snapshot the fixture BEFORE mutating it.
  const { data: original } = await admin
    .from("modules")
    .select("description")
    .eq("id", target.moduleId)
    .single();
  const originalDescription: string | null = original?.description ?? null;
  console.log(`original description: ${(originalDescription ?? "").length} chars`);

  let cleaned = false;
  const cleanup = async (): Promise<string> => {
    if (cleaned) return "already cleaned";
    cleaned = true;
    await admin
      .from("modules")
      .update({ description: originalDescription })
      .eq("id", target.moduleId);
    const residual = await purgeNotes(admin, [target.moduleId]);
    // Verify the restore rather than assuming it.
    const { data: check2 } = await admin
      .from("modules")
      .select("description")
      .eq("id", target.moduleId)
      .single();
    const restored = (check2?.description ?? null) === originalDescription;
    return `notes residual=${residual}; description restored=${restored}`;
  };
  onSignals(cleanup);

  const logCtx = (jobId: string) => ({
    userId: null,
    userEmail: null,
    userRole: "superadmin",
    subjectId: target.subjectId,
    subjectCode: target.subjectCode,
    jobId,
    relatedContentId: null,
  });

  try {
    await purgeNotes(admin, [target.moduleId]);

    // ── Phase 1 ──────────────────────────────────────────────────────────────
    sub("phase 1 — first generation");
    const r1 = await runInScope(() =>
      generateModuleNotes({
        subjectId: target.subjectId,
        moduleId: target.moduleId,
        adminClient: admin,
        logContext: logCtx(randomUUID()),
      })
    );
    check("generated", r1.ok, r1.ok ? "" : r1.message);
    if (!r1.ok) throw new Error(r1.message);
    eq("source 'fresh'", r1.source, "fresh");
    eq("version 1", r1.version, 1);
    const hash1 = r1.contentHash;
    console.log(`    hash1 = ${hash1.slice(0, 24)}…  blocks=${r1.blocks.length}`);

    // ── Phase 2 ──────────────────────────────────────────────────────────────
    sub("phase 2 — immediate re-request");
    const r2 = await runInScope(() =>
      generateModuleNotes({
        subjectId: target.subjectId,
        moduleId: target.moduleId,
        adminClient: admin,
        logContext: logCtx(randomUUID()),
      })
    );
    check("returned", r2.ok, r2.ok ? "" : r2.message);
    if (!r2.ok) throw new Error(r2.message);
    eq("source 'cache'", r2.source, "cache");
    eq("same version", r2.version, 1);
    eq("same hash", r2.contentHash, hash1);
    eq("cached read spends nothing", r2.tokensUsed, 0);
    check(
      "cached blocks identical (canonicalised — jsonb reorders keys)",
      JSON.stringify(canonical(r2.blocks)) === JSON.stringify(canonical(r1.blocks)),
      `${r1.blocks.length} blocks`
    );
    eq(
      "cached block ids identical and in order",
      r2.blocks.map((b) => b.id),
      r1.blocks.map((b) => b.id)
    );
    const { count: afterCache } = await admin
      .from("study_notes")
      .select("*", { count: "exact", head: true })
      .eq("module_id", target.moduleId);
    eq("still exactly one stored row", afterCache, 1);

    // ── Phase 3 ──────────────────────────────────────────────────────────────
    sub("phase 3 — source changes underneath");
    await admin
      .from("modules")
      .update({
        description: `${originalDescription ?? ""} Additionally: Venn diagrams, De Morgan's laws for sets, and the inclusion-exclusion principle.`,
      })
      .eq("id", target.moduleId);

    const r3 = await runInScope(() =>
      generateModuleNotes({
        subjectId: target.subjectId,
        moduleId: target.moduleId,
        adminClient: admin,
        logContext: logCtx(randomUUID()),
      })
    );
    check("regenerated", r3.ok, r3.ok ? "" : r3.message);
    if (!r3.ok) throw new Error(r3.message);

    eq("source 'fresh' (NOT served from cache)", r3.source, "fresh");
    eq("version 2", r3.version, 2);
    check("hash differs from v1", r3.contentHash !== hash1,
      `${hash1.slice(0, 12)}… -> ${r3.contentHash.slice(0, 12)}…`);

    const { data: rows } = await admin
      .from("study_notes")
      .select("version, is_stale, content_hash")
      .eq("module_id", target.moduleId)
      .order("version");
    eq("two rows stored", rows?.length ?? 0, 2);
    const v1row = rows?.find((r) => r.version === 1);
    const v2row = rows?.find((r) => r.version === 2);
    eq("v1 is now marked stale", v1row?.is_stale, true);
    eq("v2 is not stale", v2row?.is_stale, false);
    eq("v1 kept its original hash", v1row?.content_hash, hash1);
    eq("v2 carries the new hash", v2row?.content_hash, r3.contentHash);

    sub("phase 4 — the new version is what now serves");
    const r4 = await runInScope(() =>
      generateModuleNotes({
        subjectId: target.subjectId,
        moduleId: target.moduleId,
        adminClient: admin,
        logContext: logCtx(randomUUID()),
      })
    );
    if (!r4.ok) throw new Error(r4.message);
    eq("source 'cache'", r4.source, "cache");
    eq("serves version 2, not the stale version 1", r4.version, 2);

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
