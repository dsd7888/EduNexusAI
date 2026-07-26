/**
 * CP-Q1.5 verification harness — module quant classification + the NAT gate.
 *
 * Sibling of _cp_q1_verify/verify.ts, kept separate so the CP-Q1 harness stays
 * a clean regression check for the engine's core allocation. Four checks:
 *
 *   (a) classifyModulesForSubjectQuant() end to end on a real subject — prints
 *       every module's resulting profile + confidence + whether it was written.
 *   (b) a NAT-heavy plan on that subject — natDegraded populated, showing which
 *       conceptual modules refused NAT and whether the count survived.
 *   (c) faculty override — one module is flipped to
 *       quant_source='faculty_verified', quant_profile='quantitative', and a
 *       plan scoped to just that module shows NAT passing through untouched.
 *   (d) re-run the classifier — the faculty_verified row is skipped entirely,
 *       and ai_classified rows are only rewritten when the verdict changed
 *       (quant_classified_at is left alone otherwise).
 *
 * Cleanup restores every module's ORIGINAL quant_* values, so a subject that
 * was unclassified before the run is unclassified after it.
 *
 *   npx tsx _cp_q1_5_verify/verify.ts
 *   SUBJECT=SOEEC1010 npx tsx _cp_q1_5_verify/verify.ts
 *
 * Makes 4 real Flash calls (2 per classification pass × 2 runs).
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

const SUBJECT_CODE = process.env.SUBJECT ?? "SECE3260";
const STUDENT_EMAIL = process.env.STUDENT ?? "teststudent@gmail.com";

interface QuantCols {
  id: string;
  module_number: number;
  name: string;
  quant_profile: string | null;
  quant_confidence: string | null;
  quant_source: string | null;
  quant_classified_at: string | null;
}

function hr(title: string): void {
  console.log(`\n${"─".repeat(78)}\n${title}\n${"─".repeat(78)}`);
}

function row(m: QuantCols): string {
  return `  M${String(m.module_number).padEnd(2)} ${(m.quant_profile ?? "—").padEnd(13)} ${(m.quant_confidence ?? "—").padEnd(7)} ${(m.quant_source ?? "—").padEnd(17)} ${m.quant_classified_at ? m.quant_classified_at.slice(11, 23) : "—".padEnd(12)}  ${m.name.slice(0, 34)}`;
}

const HEADER = `  mod profile       conf    source            classified_at  name`;

async function main() {
  const { workAsyncStorage } = await import(
    "next/dist/server/app-render/work-async-storage.external"
  );
  const { createAdminClient } = await import("@/lib/db/supabase-server");
  const { classifyModulesForSubjectQuant } = await import(
    "@/lib/assessment/quantClassifier"
  );
  const { planAssessment } = await import("@/lib/assessment/engine");

  const admin = createAdminClient();
  const store = { afterContext: { after: (_fn: unknown) => { void _fn; } } };

  const QUANT_COLS =
    "id, module_number, name, quant_profile, quant_confidence, quant_source, quant_classified_at";

  // Original state, restored in the finally block.
  let original: QuantCols[] = [];

  try {
    hr("PREFLIGHT");
    const { error: colErr } = await admin
      .from("modules")
      .select("id, quant_profile, quant_confidence, quant_source, quant_classified_at")
      .limit(1);
    console.log(
      `  modules.quant_* columns: ${colErr ? `MISSING (${colErr.message})` : "present"}`
    );
    if (colErr) {
      console.log(
        "\n  Apply supabase/migrations/20260726000000_module_quant_profile.sql, then re-run."
      );
      process.exit(1);
    }

    const { data: subjRow } = await admin
      .from("subjects")
      .select("id, name, code")
      .eq("code", SUBJECT_CODE)
      .maybeSingle();
    if (!subjRow) throw new Error(`subject ${SUBJECT_CODE} not found`);
    const subject = subjRow as { id: string; name: string; code: string };

    const { data: studentRow } = await admin
      .from("profiles")
      .select("id")
      .eq("email", STUDENT_EMAIL)
      .maybeSingle();
    if (!studentRow) throw new Error(`student ${STUDENT_EMAIL} not found`);
    const studentId = (studentRow as { id: string }).id;

    const readModules = async (): Promise<QuantCols[]> => {
      const { data } = await admin
        .from("modules")
        .select(QUANT_COLS)
        .eq("subject_id", subject.id)
        .order("module_number");
      return (data ?? []) as QuantCols[];
    };

    original = await readModules();
    console.log(`\n  Subject: ${subject.code} — ${subject.name}`);
    console.log(`  Modules: ${original.length}`);
    console.log("\n  BEFORE:");
    console.log(HEADER);
    for (const m of original) console.log(row(m));

    // ── (a) classify ──────────────────────────────────────────────────────
    hr("(a) classifyModulesForSubjectQuant — dual-pass Flash, real subject");
    const runA = await workAsyncStorage.run(store as never, async () =>
      classifyModulesForSubjectQuant(subject.id, admin, {
        userEmail: "harness@cp-q1.5",
        userRole: "superadmin",
        feature: "assessment_cp_q1_5_verify",
      })
    );
    console.log(
      `\n  classified=${runA.classified.length} written=${runA.classified.filter((r) => r.written).length} skippedFacultyVerified=${runA.skippedFacultyVerified.length}`
    );
    for (const w of runA.warnings) console.log(`  warning: ${w}`);
    const afterA = await readModules();
    console.log("\n  AFTER PASS 1:");
    console.log(HEADER);
    for (const m of afterA) console.log(row(m));

    const conceptual = afterA.filter((m) => m.quant_profile === "conceptual");
    const quantitative = afterA.filter((m) => m.quant_profile === "quantitative");
    console.log(
      `\n  → ${quantitative.length} quantitative, ${conceptual.length} conceptual`
    );

    // ── (b) NAT-heavy plan ────────────────────────────────────────────────
    hr("(b) planAssessment — NAT-heavy, GATE preset, whole subject");
    const planB = await planAssessment(
      {
        studentId,
        subjectIds: [subject.id],
        questionCount: 12,
        difficulty: "medium",
        questionTypes: ["nat"], // every slot wants NAT — maximum pressure
        mode: "exam_sim",
        preset: "gate",
      },
      admin
    );
    console.log(
      `\n  natDegraded: ${JSON.stringify(planB.sourcing.natDegraded, null, 2)?.replace(/\n/g, "\n  ")}`
    );
    console.log(`\n  byType: ${JSON.stringify(planB.sourcing.byType)}`);
    console.log("\n  warnings:");
    for (const w of planB.warnings) console.log(`    - ${w}`);
    console.log("\n  slots:");
    for (const s of planB.slots) {
      const prof =
        afterA.find((m) => m.id === s.moduleId)?.quant_profile ?? "—";
      console.log(
        `    ${s.slotId.padEnd(4)} M${String(s.moduleNumber ?? "-").padEnd(2)} ${s.questionType.padEnd(4)} ${String(s.marks)}M  module=${prof}`
      );
    }
    const natOnConceptual = planB.slots.filter(
      (s) =>
        s.questionType === "nat" &&
        conceptual.some((m) => m.id === s.moduleId)
    );
    console.log(
      `\n  NAT slots left on conceptual modules: ${natOnConceptual.length} → refusal ${natOnConceptual.length === 0 ? "HOLDS" : "VIOLATED"}`
    );

    // ── (c) faculty override ──────────────────────────────────────────────
    hr("(c) faculty_verified quantitative module — NAT passes through");
    // Flip whichever module the AI called conceptual (or module 1 if none) to a
    // faculty-verified quantitative judgement: the human overrules the model.
    const target = conceptual[0] ?? afterA[0];
    await admin
      .from("modules")
      .update({
        quant_profile: "quantitative",
        quant_confidence: "high",
        quant_source: "faculty_verified",
        quant_classified_at: new Date().toISOString(),
      })
      .eq("id", target.id);
    console.log(
      `  M${target.module_number} ("${target.name.slice(0, 40)}") set to quantitative / faculty_verified` +
        (conceptual[0] ? " — overruling the AI's 'conceptual' verdict" : "")
    );

    const planC = await planAssessment(
      {
        studentId,
        subjectIds: [subject.id],
        moduleIds: [target.id],
        questionCount: 4,
        difficulty: "medium",
        questionTypes: ["nat"],
        mode: "exam_sim",
        preset: "gate",
      },
      admin
    );
    console.log(
      `\n  natDegraded: requested=${planC.sourcing.natDegraded?.requested} delivered=${planC.sourcing.natDegraded?.delivered} reason=${planC.sourcing.natDegraded?.reason}`
    );
    console.log(`  byType: ${JSON.stringify(planC.sourcing.byType)}`);
    console.log(
      `  warnings: ${planC.warnings.length === 0 ? "(none)" : planC.warnings.join(" | ")}`
    );
    console.log(
      `  → NAT allowed through unchanged: ${
        planC.sourcing.byType.nat === 4 && planC.warnings.length === 0
          ? "YES"
          : "NO"
      }`
    );

    // ── (d) re-run ────────────────────────────────────────────────────────
    hr("(d) re-run classification — faculty row untouched, stable rows not rewritten");
    const beforeRerun = await readModules();
    const runB = await workAsyncStorage.run(store as never, async () =>
      classifyModulesForSubjectQuant(subject.id, admin, {
        userEmail: "harness@cp-q1.5",
        userRole: "superadmin",
        feature: "assessment_cp_q1_5_verify",
      })
    );
    console.log(
      `\n  classified=${runB.classified.length} written=${runB.classified.filter((r) => r.written).length} skippedFacultyVerified=${runB.skippedFacultyVerified.length}`
    );
    for (const w of runB.warnings) console.log(`  warning: ${w}`);
    const afterRerun = await readModules();
    console.log("\n  AFTER PASS 2:");
    console.log(HEADER);
    for (const m of afterRerun) console.log(row(m));

    const facultyRowBefore = beforeRerun.find((m) => m.id === target.id)!;
    const facultyRowAfter = afterRerun.find((m) => m.id === target.id)!;
    const facultyUntouched =
      facultyRowBefore.quant_profile === facultyRowAfter.quant_profile &&
      facultyRowBefore.quant_source === facultyRowAfter.quant_source &&
      facultyRowBefore.quant_classified_at === facultyRowAfter.quant_classified_at;
    console.log(
      `\n  faculty_verified row (M${target.module_number}) untouched: ${facultyUntouched ? "YES" : "NO"}`
    );

    let stable = 0;
    let changed = 0;
    for (const after of afterRerun) {
      if (after.id === target.id) continue;
      const before = beforeRerun.find((m) => m.id === after.id);
      if (!before) continue;
      if (before.quant_classified_at === after.quant_classified_at) stable++;
      else changed++;
    }
    console.log(
      `  ai_classified rows: ${stable} unchanged (timestamp preserved), ${changed} refreshed (verdict changed)`
    );
  } finally {
    hr("CLEANUP — restoring original quant_* values");
    let restored = 0;
    for (const m of original) {
      const { error } = await admin
        .from("modules")
        .update({
          quant_profile: m.quant_profile,
          quant_confidence: m.quant_confidence,
          quant_source: m.quant_source,
          quant_classified_at: m.quant_classified_at,
        })
        .eq("id", m.id);
      if (!error) restored++;
    }
    console.log(`  restored ${restored}/${original.length} module row(s)`);
  }

  console.log("\n=== done ===\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("Harness failed:", e);
  process.exit(1);
});
