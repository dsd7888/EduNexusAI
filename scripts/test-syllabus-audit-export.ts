/**
 * Checkpoint-5 test harness — the syllabus compliance report PDF.
 *
 * Renders the report for a real subject straight to disk so it can be OPENED
 * and looked at. That is the point: §17 records that visual/rendered inspection
 * is the only authoritative check for a document output, and that a fix once
 * nearly shipped for a bug that didn't exist because extracted text was trusted
 * over an actual render. So this harness asserts what it can (the PDF parses,
 * has pages, embeds the expected structure) and then puts a file in front of a
 * human for the rest.
 *
 *   npx tsx scripts/test-syllabus-audit-export.ts             # IDCH3051
 *   SUBJECT=SECE2291 npx tsx scripts/test-syllabus-audit-export.ts
 *   SUBJECT=all npx tsx scripts/test-syllabus-audit-export.ts # every subject
 *   OUT=/tmp/reports npx tsx scripts/test-syllabus-audit-export.ts
 *
 * No AI calls, no writes to the database, no Storage upload — this exercises
 * the BUILDER. The route's upload/sign path is thin and covered separately.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

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

async function main(): Promise<void> {
  const { createAdminClient } = await import("@/lib/db/supabase-server");
  const { loadAuditInput } = await import("@/lib/syllabus-audit/load");
  const { runDeterministicAudit } = await import("@/lib/syllabus-audit/checks");
  const { buildComplianceReportPdf } = await import("@/lib/syllabus-audit/pdfBuilder");
  const { loadExportHeader } = await import("@/lib/lessonplan/exportShared");
  const { PDFDocument } = await import("pdf-lib");

  const admin = createAdminClient();
  const outDir = process.env.OUT ?? resolve(process.cwd(), ".reports");
  mkdirSync(outDir, { recursive: true });

  // Any faculty id works — it only fills the header's "Faculty:" line.
  const { data: fac } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("role", "faculty")
    .limit(1);
  const facultyId = ((fac ?? []) as { id: string }[])[0]?.id ?? null;
  if (!facultyId) {
    console.error("No faculty profile found to attribute the report to.");
    process.exit(1);
  }

  const wanted = process.env.SUBJECT ?? "IDCH3051";
  const { data: subjRows } = await admin.from("subjects").select("id, code, name");
  const all = (subjRows ?? []) as { id: string; code: string; name: string }[];
  const targets =
    wanted === "all" ? all : all.filter((s) => s.code === wanted || s.id === wanted);

  if (targets.length === 0) {
    console.error(`Could not resolve subject "${wanted}".`);
    process.exit(1);
  }

  console.log(`\nRendering ${targets.length} compliance report(s) → ${outDir}\n`);

  for (const subject of targets) {
    const input = await loadAuditInput(subject.id);
    const audit = runDeterministicAudit(input);
    const { header } = await loadExportHeader(subject.id, facultyId);

    const t0 = Date.now();
    const bytes = await buildComplianceReportPdf({ ctx: input.ctx, audit, header });
    const ms = Date.now() - t0;

    const file = resolve(outDir, `compliance-${subject.code}.pdf`);
    writeFileSync(file, bytes);

    // Re-open what was written — proving the bytes on disk are a valid PDF,
    // not just that the builder returned without throwing.
    const reopened = await PDFDocument.load(bytes);
    const pages = reopened.getPages();

    console.log(`${subject.code} — ${subject.name}`);
    console.log(
      `  health ${audit.overallHealth}/100 · ${audit.findings.length} finding(s) · ` +
        `${input.ctx.modules.length} modules · ${input.ctx.courseOutcomes.length} COs`,
    );
    console.log(`  ${pages.length} page(s) · ${(bytes.length / 1024).toFixed(1)} KB · ${ms}ms`);
    console.log(`  → ${file}`);

    if (targets.length === 1) {
      check("PDF re-opens as a valid document", pages.length > 0);
      check("page size is A4 portrait", Math.round(pages[0].getWidth()) === 595 && Math.round(pages[0].getHeight()) === 842);
      check("fits the one-page target for a typical subject", pages.length <= 2, `${pages.length} pages`);
      check("non-trivial file size (content actually drawn)", bytes.length > 3000, `${bytes.length} bytes`);
      // The three sections the checkpoint explicitly calls out.
      check("subject has CO/module data for the matrix", input.ctx.courseOutcomes.length > 0 && input.ctx.modules.length > 0);
      check("subject has BTL data for the distribution", input.ctx.modules.some((m) => m.btl_levels.length > 0));
      check("findings table has rows to render", audit.findings.length > 0);
    }
    console.log("");
  }

  if (targets.length === 1) {
    console.log("═".repeat(72));
    console.log(`${passed} passed, ${failed} failed`);
    console.log("═".repeat(72));
    console.log("\nNOW OPEN THE PDF. Structural checks cannot tell you whether the");
    console.log("CO/module matrix, BTL grid and findings table actually LOOK right.");
  }
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
