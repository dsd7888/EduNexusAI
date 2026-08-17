import {
  signInAsStudent,
  makeChecker,
  hr,
  sub,
  onSignals,
  waitForServer,
  loadEnvLocal,
} from "../src/lib/testing/httpHarness";
import { createClient } from "@supabase/supabase-js";

const SECE2250 = "b862c433-29d1-4e43-ac54-4a1369a7f195"; // Computer Org, 8 modules, 0 notes rows — fresh subject
const IDME3532 = "113969c6-5c0e-452b-8689-33c5cae95ae5"; // Automobile Eng, 4 modules, ALL have fresh module notes, no subject row yet
const SECE3260 = "74e25bc8-d2bc-4a11-8242-e0fefae8f3af"; // Cryptography, 6 modules, module 1 has notes

async function main() {
  loadEnvLocal();
  await waitForServer();
  const checker = makeChecker();

  const student = await signInAsStudent(undefined, undefined, {
    templateEmail: "teststudent@gmail.com",
  });
  onSignals(student.cleanup);
  console.log(`Signed in as ${student.email} (${student.userId})`);

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // ── get module ids ──────────────────────────────────────────────────────
  const { data: sece2250Modules } = await admin
    .from("modules")
    .select("id, module_number, name")
    .eq("subject_id", SECE2250)
    .order("module_number");
  const { data: idme3532Modules } = await admin
    .from("modules")
    .select("id, module_number, name")
    .eq("subject_id", IDME3532)
    .order("module_number");
  const { data: sece3260Modules } = await admin
    .from("modules")
    .select("id, module_number, name")
    .eq("subject_id", SECE3260)
    .order("module_number");

  try {
    // ═══════════════════════════════════════════════════════════════════════
    hr("1. HAPPY PATH — module generation (fresh, real AI call)");
    // ═══════════════════════════════════════════════════════════════════════
    const targetModule = sece2250Modules![0]; // M1, no notes exist yet
    console.log(`Generating notes for SECE2250 ${targetModule.name} (${targetModule.id})`);
    const t0 = Date.now();
    const genRes = await student.json<any>(`/api/notes/module/${targetModule.id}`);
    console.log(`  status=${genRes.status} ms=${Date.now() - t0}`);
    checker.check("generation succeeds", genRes.status === 200, `status=${genRes.status}`);
    if (genRes.status === 200) {
      const blocks = genRes.body.blocks;
      checker.check("blocks is array", Array.isArray(blocks));
      checker.check("blocks in [4,12]", blocks.length >= 4 && blocks.length <= 12, `got ${blocks?.length}`);
      checker.check("source=fresh", genRes.body.source === "fresh", genRes.body.source);
      checker.check("pyqEnriched flag present", genRes.body.pyqEnriched === true);
      const kinds = new Set(blocks.map((b: any) => b.kind));
      console.log(`  block kinds present: ${[...kinds].join(", ")}, count=${blocks.length}`);
      // formula block sanity
      const formulaBlock = blocks.find((b: any) => b.kind === "formula");
      if (formulaBlock) {
        checker.check("formula block has symbols[]", Array.isArray(formulaBlock.symbols) && formulaBlock.symbols.length > 0);
        console.log(`  sample formula: ${formulaBlock.name} = ${formulaBlock.formula}`);
      } else {
        console.log("  (no formula block generated for this module — architecture module, plausible)");
      }
      // id pattern check
      const badIds = blocks.filter((b: any) => !/^(concept|formula|comparison)-[a-z0-9]+(-[a-z0-9]+)*$/.test(b.id));
      checker.check("all block ids match pattern", badIds.length === 0, JSON.stringify(badIds.map((b: any) => b.id)));
      // no _moduleId leak on module-scope response
      checker.check("no _moduleId leak in module response", !blocks.some((b: any) => "_moduleId" in b));
    } else {
      console.log("  body:", JSON.stringify(genRes.body).slice(0, 500));
    }

    sub("Repeat GET — should now be a cache hit (hash match)");
    const genRes2 = await student.json<any>(`/api/notes/module/${targetModule.id}`);
    checker.check("second GET is cache hit", genRes2.body?.source === "cache", genRes2.body?.source);
    checker.eq("version unchanged", genRes2.body?.version, genRes.body?.version);

    // ═══════════════════════════════════════════════════════════════════════
    hr("2. SUBJECT ASSEMBLY — deterministic join, cached module rows (IDME3532, no AI call expected)");
    // ═══════════════════════════════════════════════════════════════════════
    const assembleRes = await student.json<any>(`/api/notes/subject/${IDME3532}`);
    checker.check("assembly succeeds", assembleRes.status === 200, `status=${assembleRes.status} body=${JSON.stringify(assembleRes.body).slice(0,300)}`);
    if (assembleRes.status === 200) {
      const blocks = assembleRes.body.blocks;
      checker.check("modulesCovered = 4", assembleRes.body.sourceMetadata?.modulesCovered?.length === 4, JSON.stringify(assembleRes.body.sourceMetadata));
      checker.check("moduleBreakpoints tile the array", (() => {
        const bps = assembleRes.body.sourceMetadata?.moduleBreakpoints ?? [];
        let sum = 0;
        for (const bp of bps) { if (bp.startIndex !== sum) return false; sum += bp.count; }
        return sum === blocks.length;
      })());
      checker.check("no _moduleId leak in subject response", !blocks.some((b: any) => "_moduleId" in b));
      console.log(`  ${blocks.length} total blocks across ${assembleRes.body.sourceMetadata?.moduleBreakpoints?.length} modules`);
    }

    sub("Repeat subject GET — cache hit expected, waives rate limit");
    const assembleRes2 = await student.json<any>(`/api/notes/subject/${IDME3532}`);
    checker.check("second subject GET is cache hit", assembleRes2.body?.source === "cache", assembleRes2.body?.source);

    // ═══════════════════════════════════════════════════════════════════════
    hr("3. EXPORT — full subject PDF + single-module PDF (IDME3532, cache-backed)");
    // ═══════════════════════════════════════════════════════════════════════
    const pdfRes = await student.fetch(`/api/notes/subject/${IDME3532}/export`);
    checker.check("full export 200", pdfRes.status === 200, `status=${pdfRes.status}`);
    checker.check("content-type is pdf", pdfRes.headers.get("content-type") === "application/pdf", pdfRes.headers.get("content-type") ?? "");
    let fullPdfBytes: Buffer | null = null;
    if (pdfRes.status === 200) {
      const ab = await pdfRes.arrayBuffer();
      fullPdfBytes = Buffer.from(ab);
      console.log(`  full PDF size: ${fullPdfBytes.length} bytes`);
      const fs = await import("node:fs");
      fs.writeFileSync("_audit_notes/out-full.pdf", fullPdfBytes);
    }

    const modBp = idme3532Modules![1]; // module 2
    const pdfModRes = await student.fetch(`/api/notes/subject/${IDME3532}/export?moduleId=${modBp.id}`);
    checker.check("module-scoped export 200", pdfModRes.status === 200, `status=${pdfModRes.status}`);
    if (pdfModRes.status === 200) {
      const ab = await pdfModRes.arrayBuffer();
      const bytes = Buffer.from(ab);
      const fs = await import("node:fs");
      fs.writeFileSync("_audit_notes/out-module2.pdf", bytes);
      console.log(`  module-scoped PDF size: ${bytes.length} bytes`);
      checker.check("module PDF smaller than full PDF", fullPdfBytes ? bytes.length < fullPdfBytes.length : true);
    }

    sub("Export with foreign/garbage moduleId param");
    const badModRes = await student.json<any>(`/api/notes/subject/${IDME3532}/export?moduleId=00000000-0000-0000-0000-000000000000`);
    checker.check("garbage moduleId -> 400 module_not_found", badModRes.status === 400 && badModRes.body?.error === "module_not_found", `status=${badModRes.status} body=${JSON.stringify(badModRes.body)}`);

    sub("Export a moduleId that belongs to a DIFFERENT subject (cross-subject param tamper)");
    const crossRes = await student.json<any>(`/api/notes/subject/${IDME3532}/export?moduleId=${sece2250Modules![0].id}`);
    checker.check("cross-subject moduleId rejected (not silently served)", crossRes.status === 400, `status=${crossRes.status} body=${JSON.stringify(crossRes.body).slice(0,200)}`);

    // ═══════════════════════════════════════════════════════════════════════
    hr("4. AUTHORIZATION — subject not offered to this branch/module ownership tamper");
    // ═══════════════════════════════════════════════════════════════════════
    // Find a subject NOT offered to CSE (or belonging to a different branch's offering)
    const { data: otherOffering } = await admin
      .from("subject_offerings")
      .select("subject_id, branch")
      .neq("branch", "CSE")
      .limit(1)
      .maybeSingle();
    if (otherOffering) {
      const { data: alsoOfferedToCse } = await admin
        .from("subject_offerings")
        .select("subject_id")
        .eq("subject_id", otherOffering.subject_id)
        .eq("branch", "CSE")
        .maybeSingle();
      if (!alsoOfferedToCse) {
        const foreignRes = await student.json<any>(`/api/notes/subject/${otherOffering.subject_id}`);
        checker.check(
          `cross-branch subject (${otherOffering.branch}) denied for CSE student`,
          foreignRes.status === 403,
          `status=${foreignRes.status} body=${JSON.stringify(foreignRes.body)}`
        );
      } else {
        console.log("  (skipped: candidate subject is also offered to CSE)");
      }
    } else {
      console.log("  (no other-branch-only subject found to test with)");
    }

    sub("Module GET with a moduleId belonging to an inaccessible subject");
    if (otherOffering) {
      const { data: foreignModule } = await admin
        .from("modules")
        .select("id")
        .eq("subject_id", otherOffering.subject_id)
        .limit(1)
        .maybeSingle();
      if (foreignModule) {
        const foreignModRes = await student.json<any>(`/api/notes/module/${foreignModule.id}`);
        checker.check(
          "foreign module GET denied (403), not silently generated",
          foreignModRes.status === 403,
          `status=${foreignModRes.status} body=${JSON.stringify(foreignModRes.body)}`
        );
      }
    }

    sub("Regenerate as a plain student — must be refused (faculty tier only)");
    const studentRegenRes = await student.json<any>(`/api/notes/module/${sece3260Modules![1].id}/regenerate`, { method: "POST" });
    checker.check(
      "student regenerate denied",
      studentRegenRes.status === 403,
      `status=${studentRegenRes.status} body=${JSON.stringify(studentRegenRes.body)}`
    );

    sub("Subject regenerate as a plain student — must be refused");
    const studentSubjRegenRes = await student.json<any>(`/api/notes/subject/${SECE3260}/regenerate`, { method: "POST" });
    checker.check(
      "student subject-regenerate denied",
      studentSubjRegenRes.status === 403,
      `status=${studentSubjRegenRes.status} body=${JSON.stringify(studentSubjRegenRes.body)}`
    );

    // ═══════════════════════════════════════════════════════════════════════
    hr("5. MALFORMED / BOUNDARY INPUT");
    // ═══════════════════════════════════════════════════════════════════════
    const garbageSubjRes = await student.json<any>(`/api/notes/subject/not-a-uuid`);
    checker.check("garbage subjectId handled cleanly (not 500)", garbageSubjRes.status === 404 || garbageSubjRes.status === 400, `status=${garbageSubjRes.status} body=${JSON.stringify(garbageSubjRes.body).slice(0,200)}`);

    const garbageModRes = await student.json<any>(`/api/notes/module/not-a-uuid`);
    checker.check("garbage moduleId handled cleanly (not 500)", garbageModRes.status === 404 || garbageModRes.status === 400, `status=${garbageModRes.status} body=${JSON.stringify(garbageModRes.body).slice(0,200)}`);

    const sqlInjectRes = await student.json<any>(`/api/notes/subject/${encodeURIComponent("'; DROP TABLE study_notes; --")}`);
    checker.check("SQL-ish subjectId handled cleanly (not 500)", sqlInjectRes.status < 500, `status=${sqlInjectRes.status}`);

    const veryLongId = "a".repeat(10000);
    const longIdRes = await student.json<any>(`/api/notes/subject/${veryLongId}`);
    checker.check("10k-char subjectId handled cleanly (not 500)", longIdRes.status < 500, `status=${longIdRes.status}`);

    const emptyExportRes = await student.json<any>(`/api/notes/subject/${SECE2250}/export`);
    // SECE2250 subject-scope row does not exist yet (only module 1 was generated above, no subject assembly triggered)
    checker.check(
      "export before subject notes exist -> clean 404 no_notes (not 500)",
      emptyExportRes.status === 404 && emptyExportRes.body?.error === "no_notes",
      `status=${emptyExportRes.status} body=${JSON.stringify(emptyExportRes.body)}`
    );

    // ═══════════════════════════════════════════════════════════════════════
    hr("6. CONCURRENCY — two parallel GETs on a module with NO existing notes row");
    // ═══════════════════════════════════════════════════════════════════════
    const raceModule = sece3260Modules!.find((m: any) => m.module_number === 3)!; // no notes yet
    console.log(`Racing two concurrent GETs on SECE3260 ${raceModule.name} (${raceModule.id})`);
    const raceT0 = Date.now();
    const [raceA, raceB] = await Promise.all([
      student.json<any>(`/api/notes/module/${raceModule.id}`),
      student.json<any>(`/api/notes/module/${raceModule.id}`),
    ]);
    console.log(`  race took ${Date.now() - raceT0}ms; A: status=${raceA.status} source=${raceA.body?.source}; B: status=${raceB.status} source=${raceB.body?.source}`);
    const { data: raceRows } = await admin
      .from("study_notes")
      .select("id, version, is_stale, created_at")
      .eq("subject_id", SECE3260)
      .eq("module_id", raceModule.id)
      .order("version");
    console.log(`  rows for this module after race: ${JSON.stringify(raceRows)}`);
    checker.check(
      "at most one non-stale row exists after concurrent generation",
      (raceRows ?? []).filter((r: any) => !r.is_stale).length <= 1,
      JSON.stringify(raceRows)
    );
    const bothOk = raceA.status === 200 && raceB.status === 200;
    const oneFailed = (raceA.status === 200) !== (raceB.status === 200);
    console.log(`  both succeeded: ${bothOk}; exactly one failed: ${oneFailed}`);
    if (oneFailed) {
      const failed = raceA.status !== 200 ? raceA : raceB;
      console.log(`  FAILED response body: ${JSON.stringify(failed.body)}`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    hr("7. RATE LIMIT — notes_export (5/day), boundary hammer");
    // ═══════════════════════════════════════════════════════════════════════
    // We've already used 2 export calls above (full + module-scoped) + 2 error-path
    // calls that ALSO reach the rate-limit check point... need to check which of
    // those counted. Re-derive current usage first.
    const today = new Date().toISOString().slice(0, 10);
    const { data: usageBefore } = await admin
      .from("usage_analytics")
      .select("event_count")
      .eq("date", today)
      .eq("user_id", student.userId)
      .eq("event_type", "notes_export")
      .eq("subject_id", IDME3532)
      .maybeSingle();
    console.log(`  notes_export usage so far for IDME3532: ${usageBefore?.event_count ?? 0}`);

    const exportCalls: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await student.json<any>(`/api/notes/subject/${IDME3532}/export`);
      exportCalls.push(r.status);
    }
    console.log(`  6 sequential export calls: ${exportCalls.join(", ")}`);
    checker.check("a 429 eventually appears within the hammer", exportCalls.includes(429), exportCalls.join(","));

    console.log("\nDone.");
  } finally {
    const note = await student.cleanup();
    console.log(`\nCleanup: ${note}`);
  }

  const { passed, failed } = checker.summary();
  console.log(`\n${passed} passed, ${failed} failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
