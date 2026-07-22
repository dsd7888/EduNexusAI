/**
 * Checkpoint-3 test harness — Syllabus Health Audit, /apply + the cache cascade.
 *
 * This one drives the LIVE database, so it is built around a strict rule:
 * it restores everything it touches. Cache rows are snapshotted in full before
 * deletion and written back afterwards, and any module_co_mapping row it
 * creates is removed again. A test that proves cache invalidation works by
 * permanently destroying a colleague's paid-for AI content is not a test worth
 * running on a pilot database.
 *
 * What it proves:
 *   1. applyProposalPatch writes a real module_co_mapping row (source
 *      'faculty_verified', not 'ai_classified').
 *   2. invalidateDownstreamCaches DELETES lesson_plan_cache and
 *      lab_manual_cache rows for that subject — the pass condition is
 *      count(*) = 0, not merely a fingerprint mismatch.
 *   3. The cascade is SUBJECT-SCOPED: another subject's cache row survives.
 *   4. The audit re-run no longer reports the CO that was just fixed.
 *   5. Every rejection path refuses to write, including a valid module id
 *      belonging to a DIFFERENT subject.
 *
 * No AI calls: the proposal is built through the real validateSuggestions gate
 * from a fixture "fix", so the full gate → proposal → apply path is exercised
 * for free.
 *
 *   npx tsx scripts/test-syllabus-audit-apply.ts
 *   SUBJECT=IDCH3051 npx tsx scripts/test-syllabus-audit-apply.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvLocal();

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type Row = Record<string, unknown>;

async function main(): Promise<void> {
  const { createAdminClient } = await import("@/lib/db/supabase-server");
  const { loadAuditInput } = await import("@/lib/syllabus-audit/load");
  const { runDeterministicAudit } = await import("@/lib/syllabus-audit/checks");
  const { validateSuggestions } = await import("@/lib/syllabus-audit/suggestions");
  const { applyProposalPatch, invalidateDownstreamCaches } = await import(
    "@/lib/syllabus-audit/apply"
  );

  const admin = createAdminClient();
  const code = process.env.SUBJECT ?? "IDCH3051";

  const { data: subjRow } = await admin
    .from("subjects")
    .select("id, code, name")
    .eq("code", code)
    .maybeSingle();
  const subject = subjRow as { id: string; code: string; name: string } | null;
  if (!subject) {
    console.error(`Could not resolve subject "${code}".`);
    process.exit(1);
  }
  const subjectId = subject.id;
  console.log(`\n=== ${subject.code} — ${subject.name} ===`);
  console.log(`    ${subjectId}\n`);

  // ── Snapshot everything we are about to disturb ───────────────────────────
  console.log("── SNAPSHOT (everything here is restored at the end) ──");
  const { data: lpBefore } = await admin
    .from("lesson_plan_cache")
    .select("*")
    .eq("subject_id", subjectId);
  const { data: lmBefore } = await admin
    .from("lab_manual_cache")
    .select("*")
    .eq("subject_id", subjectId);
  const { data: saBefore } = await admin
    .from("syllabus_audit_cache")
    .select("*")
    .eq("subject_id", subjectId);
  const lessonPlanRows = (lpBefore ?? []) as Row[];
  const labManualRows = (lmBefore ?? []) as Row[];
  const auditRows = (saBefore ?? []) as Row[];

  // Another subject's cache row — must NOT be touched by the cascade.
  const { data: otherLp } = await admin
    .from("lesson_plan_cache")
    .select("id, subject_id")
    .neq("subject_id", subjectId)
    .limit(1);
  const otherRow = ((otherLp ?? []) as { id: string; subject_id: string }[])[0] ?? null;

  console.log(`  lesson_plan_cache    : ${lessonPlanRows.length} row(s)`);
  console.log(`  lab_manual_cache     : ${labManualRows.length} row(s)`);
  console.log(`  syllabus_audit_cache : ${auditRows.length} row(s)`);
  console.log(
    `  control row (other subject): ${otherRow ? `${otherRow.subject_id.slice(0, 8)}…` : "none available"}`,
  );

  if (lessonPlanRows.length === 0 || labManualRows.length === 0) {
    console.error(
      "\n  ✗ PRECONDITION FAILED: this subject needs rows in BOTH lesson_plan_cache " +
        "and lab_manual_cache for the cascade test to mean anything.\n" +
        "    Generate a lesson plan and a lab-manual section for it first.",
    );
    process.exit(1);
  }

  // Seed a syllabus_audit_cache row too, so all three tables have something to
  // clear even if suggestions were never run for this subject.
  let seededAuditRow = false;
  if (auditRows.length === 0) {
    const { error } = await admin.from("syllabus_audit_cache").insert({
      subject_id: subjectId,
      payload: { proposals: [], aiFindings: [] },
      syllabus_fingerprint: "harness-seed",
      model_used: "harness",
    });
    if (!error) {
      seededAuditRow = true;
      console.log("  seeded 1 syllabus_audit_cache row for the cascade test");
    } else {
      console.log(`  could not seed syllabus_audit_cache: ${error.message}`);
    }
  }

  // ── Build a REAL proposal through the REAL gate (no AI call) ──────────────
  console.log("\n── BUILD PROPOSAL (through the real gate, no AI) ──");
  const input = await loadAuditInput(subjectId);
  const auditBefore = runDeterministicAudit(input);
  const coGap = auditBefore.findings.find(
    (f) => f.dimension === "co_coverage" && f.fixable && f.entity.toUpperCase().startsWith("CO"),
  );
  if (!coGap) {
    console.error("  ✗ This subject has no unmapped-CO finding to apply. Pick another.");
    process.exit(1);
  }
  const targetModule = input.ctx.modules[0];
  console.log(`  finding : ${coGap.entity} — ${coGap.diagnosis.slice(0, 80)}…`);
  console.log(`  target  : Module ${targetModule.module_number} (${targetModule.name})`);

  const gated = validateSuggestions(
    [
      {
        findingId: coGap.id,
        entityType: "module_co_mapping",
        moduleNumber: targetModule.module_number,
        coCode: coGap.entity,
        rationale: "Harness-built proposal exercising the real gate.",
      },
    ],
    [],
    input,
    auditBefore.findings,
  );
  check("gate produced exactly one proposal", gated.proposals.length === 1, JSON.stringify(gated.warnings));
  const proposal = gated.proposals[0];
  const appliedCoCode = String(proposal.patch.coCode);
  console.log(`  proposal: ${proposal.oldValue}  →  ${proposal.newValue}`);

  // ── REJECTION PATHS (must not write) ──────────────────────────────────────
  console.log("\n── REJECTION PATHS ──");
  const { data: foreignModuleRow } = await admin
    .from("modules")
    .select("id, subject_id")
    .neq("subject_id", subjectId)
    .limit(1);
  const foreignModule = ((foreignModuleRow ?? []) as { id: string }[])[0] ?? null;

  if (foreignModule) {
    const r = await applyProposalPatch(admin, subjectId, "module_co_mapping", {
      moduleId: foreignModule.id,
      coCode: appliedCoCode,
    });
    check(
      "refuses a real module id belonging to ANOTHER subject",
      !r.ok && r.status === 404,
      JSON.stringify(r),
    );
  }
  {
    const r = await applyProposalPatch(admin, subjectId, "module_weightage", {
      moduleId: targetModule.id,
      weightage: 99,
    });
    check("refuses an entityType with no apply path", !r.ok, JSON.stringify(r));
  }
  {
    const r = await applyProposalPatch(admin, subjectId, "module_co_mapping", {
      moduleId: targetModule.id,
      coCode: "CO99",
    });
    check("refuses a CO that isn't in this subject", !r.ok && r.status === 404);
  }
  {
    const r = await applyProposalPatch(admin, subjectId, "btl_levels", {
      moduleId: targetModule.id,
      btlLevels: [1, 2, 9],
    });
    check("refuses a BTL level outside 1-6", !r.ok, JSON.stringify(r));
  }
  {
    const r = await applyProposalPatch(admin, subjectId, "btl_levels", {
      moduleId: targetModule.id,
      btlLevels: [],
    });
    check("refuses an empty BTL array", !r.ok);
  }
  {
    const r = await applyProposalPatch(admin, subjectId, "co_description", {
      coCode: appliedCoCode,
      description: "   ",
    });
    check("refuses a blank CO description", !r.ok);
  }
  {
    const { count } = await admin
      .from("module_co_mapping")
      .select("*", { count: "exact", head: true })
      .eq("module_id", targetModule.id)
      .eq("co_code", appliedCoCode);
    check("no rejected patch wrote anything", (count ?? 0) === 0, `count=${count}`);
  }

  // ── THE WRITE ─────────────────────────────────────────────────────────────
  console.log("\n── APPLY ──");
  const outcome = await applyProposalPatch(
    admin,
    subjectId,
    proposal.entityType,
    proposal.patch,
  );
  check("apply succeeded", outcome.ok, JSON.stringify(outcome));
  console.log(`  summary : ${outcome.summary}`);

  const { data: writtenRow } = await admin
    .from("module_co_mapping")
    .select("id, module_id, co_code, source, confidence")
    .eq("module_id", targetModule.id)
    .eq("co_code", appliedCoCode)
    .maybeSingle();
  const written = writtenRow as
    | { id: string; co_code: string; source: string; confidence: string }
    | null;
  check("module_co_mapping row exists", !!written);
  check(
    "row is marked faculty_verified, not ai_classified",
    written?.source === "faculty_verified",
    written?.source,
  );

  {
    const r = await applyProposalPatch(admin, subjectId, "module_co_mapping", proposal.patch);
    check("re-applying the same proposal is refused as redundant", !r.ok && r.status === 409);
  }

  // ── THE CASCADE — the pass condition for this checkpoint ──────────────────
  console.log("\n── CASCADE ──");
  const invalidated = await invalidateDownstreamCaches(admin, subjectId);
  console.log(`  reported cleared: ${JSON.stringify(invalidated)}`);

  const { count: lpAfter } = await admin
    .from("lesson_plan_cache")
    .select("*", { count: "exact", head: true })
    .eq("subject_id", subjectId);
  const { count: lmAfter } = await admin
    .from("lab_manual_cache")
    .select("*", { count: "exact", head: true })
    .eq("subject_id", subjectId);
  const { count: saAfter } = await admin
    .from("syllabus_audit_cache")
    .select("*", { count: "exact", head: true })
    .eq("subject_id", subjectId);

  console.log(`  SELECT count(*) FROM lesson_plan_cache    WHERE subject_id = … → ${lpAfter}`);
  console.log(`  SELECT count(*) FROM lab_manual_cache     WHERE subject_id = … → ${lmAfter}`);
  console.log(`  SELECT count(*) FROM syllabus_audit_cache WHERE subject_id = … → ${saAfter}`);

  check("PASS CONDITION: lesson_plan_cache has ZERO rows for this subject", lpAfter === 0, `got ${lpAfter}`);
  check("PASS CONDITION: lab_manual_cache has ZERO rows for this subject", lmAfter === 0, `got ${lmAfter}`);
  check("syllabus_audit_cache also cleared", saAfter === 0, `got ${saAfter}`);
  check(
    "reported counts match what was actually deleted",
    invalidated.lessonPlanCache === lessonPlanRows.length &&
      invalidated.labManualCache === labManualRows.length,
    JSON.stringify(invalidated),
  );

  if (otherRow) {
    const { count: otherAfter } = await admin
      .from("lesson_plan_cache")
      .select("*", { count: "exact", head: true })
      .eq("id", otherRow.id);
    check(
      "cascade is subject-scoped — another subject's cache row SURVIVED",
      otherAfter === 1,
      `got ${otherAfter}`,
    );
  }

  // ── The audit reflects the fix ────────────────────────────────────────────
  console.log("\n── RE-AUDIT ──");
  const auditAfter = runDeterministicAudit(await loadAuditInput(subjectId));
  const stillUnmapped = auditAfter.findings.some((f) => f.id === coGap.id);
  check(`the "${coGap.entity} has no module" finding is gone`, !stillUnmapped);
  console.log(
    `  health ${auditBefore.overallHealth} → ${auditAfter.overallHealth}, ` +
      `findings ${auditBefore.findings.length} → ${auditAfter.findings.length}`,
  );

  // ── RESTORE ───────────────────────────────────────────────────────────────
  console.log("\n── RESTORE ──");
  if (written) {
    await admin.from("module_co_mapping").delete().eq("id", written.id);
    const { count } = await admin
      .from("module_co_mapping")
      .select("*", { count: "exact", head: true })
      .eq("id", written.id);
    check("mapping row removed", (count ?? 0) === 0);
  }
  if (lessonPlanRows.length > 0) {
    const { error } = await admin.from("lesson_plan_cache").insert(lessonPlanRows);
    check("lesson_plan_cache rows restored", !error, error?.message);
  }
  if (labManualRows.length > 0) {
    const { error } = await admin.from("lab_manual_cache").insert(labManualRows);
    check("lab_manual_cache rows restored", !error, error?.message);
  }
  if (auditRows.length > 0 && !seededAuditRow) {
    const { error } = await admin.from("syllabus_audit_cache").insert(auditRows);
    check("syllabus_audit_cache rows restored", !error, error?.message);
  }

  const { count: lpFinal } = await admin
    .from("lesson_plan_cache")
    .select("*", { count: "exact", head: true })
    .eq("subject_id", subjectId);
  const { count: lmFinal } = await admin
    .from("lab_manual_cache")
    .select("*", { count: "exact", head: true })
    .eq("subject_id", subjectId);
  check(
    "database left exactly as found",
    lpFinal === lessonPlanRows.length && lmFinal === labManualRows.length,
    `lesson_plan ${lpFinal}/${lessonPlanRows.length}, lab_manual ${lmFinal}/${labManualRows.length}`,
  );

  const finalAudit = runDeterministicAudit(await loadAuditInput(subjectId));
  check(
    "audit back to its original state",
    finalAudit.overallHealth === auditBefore.overallHealth &&
      finalAudit.findings.length === auditBefore.findings.length,
    `health ${finalAudit.overallHealth} vs ${auditBefore.overallHealth}`,
  );

  console.log(`\n${"═".repeat(72)}`);
  console.log(`${passed} passed, ${failed} failed`);
  console.log("═".repeat(72));
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
