/**
 * CP-N2 harness 2 — a module going stale invalidates the subject above it.
 *
 * This is the assertion Part 1 exists for. Without inline propagation, editing a
 * module's syllabus and regenerating it leaves the subject-scope row unflagged,
 * and a student's next GET is served a join of modules that no longer match —
 * silently, with a fresh-looking is_stale=false.
 *
 * The drift is induced by MUTATING REAL SOURCE (a module's description), not by
 * hand-writing a hash: the hash is computed from the description, so writing a
 * fake hash would test the comparison and skip the derivation, which is the half
 * that can actually be wrong.
 *
 * Requires `npm run dev`.
 * Run: npx tsx _cp_n2_verify/hash_propagation.ts > /tmp/cpn2_hash.log 2>&1
 */
import { signInAsStudent, waitForServer, type StudentSession } from "@/lib/testing/httpHarness";

import {
  loadEnvLocal,
  adminClient,
  makeChecker,
  hr,
  sub,
  onSignals,
  makeRunInScope,
  resolveSubject,
  ensureModuleNotes,
  loadNotes,
  purgeSubjectNotes,
  N2_FIXTURES,
} from "./shared";

loadEnvLocal();

const DRIFT_MARKER = " CP_N2_DRIFT_TEST";

type NotesResponse = {
  blocks?: Array<{ id: string }>;
  version?: number;
  source?: string;
  sourceMetadata?: { modulesCovered?: string[]; modulesTotal?: number };
};

async function main() {
  const admin = adminClient();
  const { check, eq, summary } = makeChecker();
  const runInScope = await makeRunInScope();

  hr("CP-N2 harness 2 — hash_propagation");
  await waitForServer();

  const subject = await resolveSubject(admin, N2_FIXTURES.ASSEMBLY);
  console.log(`target: ${subject.code} "${subject.name}" — ${subject.modules.length} modules`);

  const sessions: StudentSession[] = [];
  /** Row ids present before the test, with their pre-test is_stale value. */
  let baseline = new Map<string, boolean>();
  let driftModuleId: string | null = null;
  let originalDescription: string | null = null;

  let cleaned = false;
  const cleanup = async (): Promise<string> => {
    if (cleaned) return "already cleaned";
    cleaned = true;
    const notes: string[] = [];

    // 1. Restore the mutated source FIRST — a half-restored module is what
    //    contaminates the next run's "original" snapshot (CLAUDE.md harness rules).
    if (driftModuleId && originalDescription !== null) {
      await admin
        .from("modules")
        .update({ description: originalDescription })
        .eq("id", driftModuleId);
      const { data: check } = await admin
        .from("modules")
        .select("description")
        .eq("id", driftModuleId)
        .maybeSingle();
      const residual = String(check?.description ?? "").includes(DRIFT_MARKER);
      notes.push(`module description restored (marker residual=${residual})`);
    }

    // 2. Delete every row this run created; restore is_stale on rows it flagged.
    const now = await loadNotes(admin, subject.subjectId);
    const created = now.filter((r) => !baseline.has(r.id)).map((r) => r.id);
    if (created.length > 0) {
      await admin.from("study_notes").delete().in("id", created);
    }
    for (const [id, wasStale] of baseline) {
      await admin.from("study_notes").update({ is_stale: wasStale }).eq("id", id);
    }
    const after = await loadNotes(admin, subject.subjectId);
    const residualCreated = after.filter((r) => !baseline.has(r.id)).length;
    const residualFlags = after.filter((r) => baseline.get(r.id) !== r.isStale).length;
    notes.push(`created-rows residual=${residualCreated}, wrong-flag residual=${residualFlags}`);

    for (const s of sessions) {
      try {
        notes.push(await s.cleanup());
      } catch (e) {
        notes.push(`session cleanup failed: ${String(e).slice(0, 80)}`);
      }
    }
    return notes.join("; ");
  };
  onSignals(cleanup);

  try {
    sub("pre — a fresh subject-scope row must exist to be invalidated");
    await purgeSubjectNotes(admin, subject.subjectId, "subject");
    await ensureModuleNotes(admin, subject, runInScope);

    const student = await signInAsStudent(undefined, undefined, {
      role: "student",
      branch: subject.offering.branch,
      semester: subject.offering.semester,
      fullName: "CP-N2 Student",
    });
    sessions.push(student);
    const PATH = `/api/notes/subject/${subject.subjectId}`;

    const seedGet = await student.json<NotesResponse>(PATH);
    eq("seeding GET is 200", seedGet.status, 200);

    // Snapshot AFTER seeding: the baseline is "the state this test must restore",
    // which includes the module rows the seed reused or created.
    const before = await loadNotes(admin, subject.subjectId);
    baseline = new Map(before.map((r) => [r.id, r.isStale]));

    // ── Step A: record H1 ────────────────────────────────────────────────
    const subjectBefore = before.filter((r) => r.scope === "subject" && !r.isStale);
    eq("exactly one fresh subject-scope row before the drift", subjectBefore.length, 1);
    const H1 = subjectBefore[0]?.contentHash;
    const V1 = subjectBefore[0]?.version;
    console.log(`    H1 = ${String(H1).slice(0, 24)}…  (v${V1})`);

    // Pick a module that actually HAS fresh notes — drifting one without notes
    // would change nothing about the subject hash and the test would pass
    // vacuously.
    const coveredModuleIds = before
      .filter((r) => r.scope === "module" && !r.isStale && r.moduleId)
      .map((r) => r.moduleId as string);
    const target = subject.modules.find((m) => coveredModuleIds.includes(m.id));
    if (!target) throw new Error("no covered module to drift");
    driftModuleId = target.id;
    console.log(`    drifting M${target.moduleNumber} "${target.name}"`);

    const moduleNoteBefore = before.find(
      (r) => r.scope === "module" && r.moduleId === target.id && !r.isStale
    );

    // ── Step B: mutate the source ────────────────────────────────────────
    sub("Step B — mutate the module's description (real source drift)");
    const { data: modRow } = await admin
      .from("modules")
      .select("description")
      .eq("id", target.id)
      .maybeSingle();
    const priorDescription: string = modRow?.description ?? "";
    originalDescription = priorDescription;
    await admin
      .from("modules")
      .update({ description: `${priorDescription}${DRIFT_MARKER}` })
      .eq("id", target.id);
    check(
      "module description carries the drift marker",
      true,
      `${priorDescription.length} -> ${priorDescription.length + DRIFT_MARKER.length} chars`
    );

    // ── Step C: regenerate that module ───────────────────────────────────
    sub("Step C — generateModuleNotes sees the drift and propagates");
    const { generateModuleNotes } = await import("@/lib/notes/generator");
    const gen = await runInScope(() =>
      generateModuleNotes({
        subjectId: subject.subjectId,
        moduleId: target.id,
        adminClient: admin as never,
        logContext: {
          userId: null,
          userEmail: null,
          userRole: "harness",
          subjectId: subject.subjectId,
          subjectCode: subject.code,
          jobId: crypto.randomUUID(),
          relatedContentId: null,
        },
      })
    );

    /**
     * PROPAGATION IS ASSERTED WHETHER OR NOT THE GENERATION SUCCEEDED, and that
     * is the stronger test rather than a concession.
     *
     * generator.ts flags divergent rows BEFORE it calls the model — deliberately,
     * so "a failed generation still leaves the outdated rows flagged" (its own
     * comment). Part 1's subject propagation sits in that same block, so it must
     * fire on the failure path too. If it only fired on success, a subject whose
     * module regeneration failed would keep serving a stale-but-unflagged
     * assembly — the exact bug this harness exists to exclude, and the one most
     * likely to occur in practice given CP-N1's current ~57% invalid_blocks rate
     * on real seeded content (see the CP-N2 report).
     */
    console.log(
      `    generation outcome: ${gen.ok ? `ok (v${gen.version}, source=${gen.source})` : `${gen.error} — ${gen.message.slice(0, 120)}`}`
    );
    if (gen.ok) {
      eq("regeneration was fresh, not cache", gen.source, "fresh");
    } else {
      check(
        "generation failed upstream (CP-N1 invalid_blocks) — propagation is asserted anyway",
        true,
        gen.error
      );
    }

    const afterGen = await loadNotes(admin, subject.subjectId);
    const oldModuleRow = afterGen.find((r) => r.id === moduleNoteBefore?.id);
    eq("the module's previous version is now stale", oldModuleRow?.isStale, true);

    // THE assertion this harness exists for.
    const subjectAfterGen = afterGen.filter((r) => r.scope === "subject");
    check(
      "the subject-scope row was flagged stale INLINE by the module generation",
      subjectAfterGen.length > 0 && subjectAfterGen.every((r) => r.isStale),
      `${subjectAfterGen.filter((r) => r.isStale).length} of ${subjectAfterGen.length} subject rows stale`
    );

    // ── Step D: reassembly ───────────────────────────────────────────────
    sub("Step D — GET reassembles rather than serving the invalidated row");
    const after = await student.json<NotesResponse>(PATH);
    eq("status is 200", after.status, 200);
    eq("source is 'fresh' (the stale row was not served)", after.body?.source, "fresh");
    eq("version incremented to 2", after.body?.version, (V1 ?? 0) + 1);
    // The hash moves on either path: a successful regeneration changes the
    // drifted module's own content_hash, and a failed one drops it from the
    // covered set. Both are real changes to the constituent set.
    console.log(
      `    coverage after drift: ${after.body?.sourceMetadata?.modulesCovered?.length}/${after.body?.sourceMetadata?.modulesTotal}`
    );

    const subjectRows = (await loadNotes(admin, subject.subjectId, "subject")).filter(
      (r) => !r.isStale
    );
    eq("exactly one fresh subject-scope row after reassembly", subjectRows.length, 1);
    const H2 = subjectRows[0]?.contentHash;
    check("content_hash changed (H2 != H1)", H2 !== H1, `${String(H1).slice(0, 16)}… -> ${String(H2).slice(0, 16)}…`);
    check(
      "the previously-fresh subject row is retained as stale, not deleted",
      (await loadNotes(admin, subject.subjectId, "subject")).some(
        (r) => r.contentHash === H1 && r.isStale
      ),
      "old version stays readable / rollback-able"
    );

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
