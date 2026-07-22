/**
 * Checkpoint-1 test harness — Syllabus Health Audit, Layer 1 (deterministic).
 *
 * Two halves:
 *
 *  (A) FIXTURE TESTS — pure, free, NO AI and NO DB. Every check is exported, so
 *      each rule is driven with a hand-built SubjectContext that forces the
 *      exact condition. This is where the rules are actually proven: a live
 *      subject can't be relied on to contain a BTL regression on demand.
 *
 *  (B) LIVE RUN — loads a real seeded subject and prints the full audit
 *      (per-dimension scores + every finding) for manual inspection.
 *
 *   npx tsx scripts/test-syllabus-audit-checks.ts               # fixtures + live
 *   FIXTURES_ONLY=1 npx tsx scripts/test-syllabus-audit-checks.ts
 *   SUBJECT=SEIT3032 npx tsx scripts/test-syllabus-audit-checks.ts
 *   SUBJECT=all npx tsx scripts/test-syllabus-audit-checks.ts    # every subject, summary
 *
 * The live half makes NO AI calls — Layer 1 is free — so it costs nothing but a
 * few Supabase reads.
 */
import { readFileSync } from "node:fs";
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

import type { SubjectContext, SubjectModule } from "../src/lib/subjectContext";
import {
  checkAssessmentCoverage,
  checkBtlProfile,
  checkCoCoverage,
  checkCoPoMapping,
  checkHoursBalance,
  checkPracticalAlignment,
  checkTopicDensity,
  practicalModuleScore,
  runDeterministicAudit,
  splitTopics,
} from "../src/lib/syllabus-audit/checks";
import {
  DIMENSION_LABELS,
  type AuditInput,
  type Finding,
} from "../src/lib/syllabus-audit/types";

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

// ─── Fixture builders ────────────────────────────────────────────────────────

function mod(partial: Partial<SubjectModule> & { module_number: number }): SubjectModule {
  return {
    id: `m${partial.module_number}`,
    module_number: partial.module_number,
    name: partial.name ?? `Module ${partial.module_number}`,
    description: partial.description ?? "",
    // `?? 10` would silently rewrite an explicit `hours: null` — the exact case
    // the "no hours data" test exists to exercise. Only `undefined` defaults.
    hours: partial.hours !== undefined ? partial.hours : 10,
    weightage_percent:
      partial.weightage_percent !== undefined ? partial.weightage_percent : 20,
    btl_levels: partial.btl_levels ?? [1, 2, 3],
    coCodes: partial.coCodes ?? [],
  };
}

/** A description dense enough to land inside the healthy 1–4 topics/hour band. */
function topicsFor(count: number): string {
  return Array.from({ length: count }, (_, i) => `topic ${i} explained in detail`).join(", ");
}

function ctxOf(partial: Partial<SubjectContext>): SubjectContext {
  return {
    subjectId: "fixture",
    subjectName: "Fixture Subject",
    subjectCode: "FIX101",
    modules: partial.modules ?? [],
    courseOutcomes: partial.courseOutcomes ?? [],
    practicals: partial.practicals ?? [],
  };
}

function inputOf(
  ctx: SubjectContext,
  coPo: AuditInput["coPoMappings"] = [],
): AuditInput {
  // referenceBooks is read only by the AI layer (missing_topics); no
  // deterministic check touches it, so these fixtures always pass null.
  return { ctx, coPoMappings: coPo, referenceBooks: null };
}

const kinds = (fs: Finding[]) => fs.map((f) => `${f.severity}:${f.entity}`).sort();

// ─── (A) Fixture tests ───────────────────────────────────────────────────────

function runFixtureTests(): void {
  console.log("\n=== A. FIXTURE TESTS (pure, no AI, no DB) ===\n");

  // ── splitTopics ────────────────────────────────────────────────────────────
  console.log("splitTopics — parenthesis-aware fragmenting");
  {
    const topics = splitTopics(
      "Introduction to trees and their uses, Binary search trees (insert, delete, search), Balanced trees such as AVL and red-black.",
    );
    check(
      "does not split inside parentheses",
      topics.length === 3,
      `got ${topics.length}: ${JSON.stringify(topics)}`,
    );
    check(
      "drops sub-4-word punctuation noise",
      splitTopics("Trees, AVL, B-tree, and a genuinely long topic fragment here").length === 1,
    );
  }

  // ── co_coverage ────────────────────────────────────────────────────────────
  console.log("\nco_coverage");
  {
    const ctx = ctxOf({
      modules: [
        mod({ module_number: 1, coCodes: ["CO1"] }),
        mod({ module_number: 2, coCodes: [] }), // module with no CO
      ],
      courseOutcomes: [
        { co_code: "CO1", description: "Explain fundamentals" },
        { co_code: "CO2", description: "Apply techniques" }, // CO with no module
      ],
    });
    const fs = checkCoCoverage(inputOf(ctx));
    check("flags the unmapped CO as critical", fs.some((f) => f.entity === "CO2" && f.severity === "critical"));
    check("flags the unmapped module as warning", fs.some((f) => f.entity === "Module 2" && f.severity === "warning"));
    check("leaves the mapped CO/module alone", fs.length === 2, kinds(fs).join(", "));
    check("both are fixable", fs.every((f) => f.fixable));
    check(
      "ids are deterministic across runs",
      checkCoCoverage(inputOf(ctx))[0].id === fs[0].id,
    );
  }

  // ── btl_profile ────────────────────────────────────────────────────────────
  console.log("\nbtl_profile");
  {
    const noHigher = ctxOf({
      modules: [
        mod({ module_number: 1, btl_levels: [1, 2] }),
        mod({ module_number: 2, btl_levels: [2, 3] }),
      ],
    });
    const fs = checkBtlProfile(inputOf(noHigher));
    check("flags absent BTL 4+ as warning", fs.some((f) => f.entity === "Subject" && f.severity === "warning"));
    check("does not flag BTL 1 absence (BTL 1 present)", !fs.some((f) => f.diagnosis.includes("BTL 1")));
    check("no false regression on ascending BTL", !fs.some((f) => f.diagnosis.includes("regresses")));
  }
  {
    const regress = ctxOf({
      modules: [
        mod({ module_number: 1, btl_levels: [1, 2] }),
        mod({ module_number: 2, btl_levels: [3, 4] }),
        mod({ module_number: 3, btl_levels: [2] }), // regression 4 → 2
      ],
    });
    const fs = checkBtlProfile(inputOf(regress));
    const reg = fs.find((f) => f.entity === "Module 3");
    check("flags the regression", !!reg, kinds(fs).join(", "));
    check(
      "regression names both modules and both levels",
      !!reg && reg.diagnosis.includes("BTL 2") && reg.diagnosis.includes("Module 2") && reg.diagnosis.includes("BTL 4"),
      reg?.diagnosis,
    );
    check("regression is fixable", !!reg && reg.fixable);
  }
  {
    const noBtl1 = ctxOf({ modules: [mod({ module_number: 1, btl_levels: [2, 3, 4] })] });
    const fs = checkBtlProfile(inputOf(noBtl1));
    const info = fs.find((f) => f.severity === "info");
    check("absent BTL 1 is info, not warning", !!info && info.diagnosis.includes("BTL 1"));
    check("info finding is not fixable and has no suggestion", !!info && !info.fixable && info.suggestion === null);
  }

  // ── hours_balance ──────────────────────────────────────────────────────────
  console.log("\nhours_balance");
  {
    // M1: 5/50 hrs = 10% hours, 40% weightage → ratio 4.0 (too little time)
    // M2: 35/50 hrs = 70% hours, 20% weightage → ratio 0.29 (too much time)
    // M3: 10/50 hrs = 20% hours, 40% weightage → ratio 2.0 (exactly at bound, OK)
    const ctx = ctxOf({
      modules: [
        mod({ module_number: 1, hours: 5, weightage_percent: 40 }),
        mod({ module_number: 2, hours: 35, weightage_percent: 20 }),
        mod({ module_number: 3, hours: 10, weightage_percent: 40 }),
      ],
    });
    const fs = checkHoursBalance(inputOf(ctx));
    check("flags the under-taught module", fs.some((f) => f.entity === "Module 1" && f.diagnosis.includes("little")));
    check("flags the over-taught module", fs.some((f) => f.entity === "Module 2" && f.diagnosis.includes("much")));
    check("ratio exactly at the 2.0 bound is not flagged", !fs.some((f) => f.entity === "Module 3"), kinds(fs).join(", "));
    check("hours findings are never fixable", fs.every((f) => !f.fixable));
  }
  {
    const noHours = ctxOf({ modules: [mod({ module_number: 1, hours: null })] });
    check("no hours data → silent, not a false finding", checkHoursBalance(inputOf(noHours)).length === 0);
  }

  // ── topic_density ──────────────────────────────────────────────────────────
  console.log("\ntopic_density");
  {
    const dense = Array.from({ length: 10 }, (_, i) => `topic number ${i} of this module`).join(", ");
    const ctx = ctxOf({
      modules: [
        mod({ module_number: 1, hours: 2, description: dense }), // 10 topics / 2h = 5.0
        mod({ module_number: 2, hours: 12, description: "one single broad topic taught slowly" }), // 1/12
        mod({ module_number: 3, hours: 4, description: dense }), // 10/4 = 2.5 — fine
      ],
    });
    const fs = checkTopicDensity(inputOf(ctx));
    check("flags the over-packed module as warning", fs.some((f) => f.entity === "Module 1" && f.severity === "warning"));
    check("flags the sparse module as info", fs.some((f) => f.entity === "Module 2" && f.severity === "info"));
    check("leaves the balanced module alone", !fs.some((f) => f.entity === "Module 3"), kinds(fs).join(", "));
  }

  // ── practical_alignment ────────────────────────────────────────────────────
  console.log("\npractical_alignment");
  {
    check(
      "boilerplate-only title scores ~0 against an unrelated module",
      practicalModuleScore("Write a program to implement", "Network layer routing protocols") < 0.34,
    );
    check(
      "shared concepts score above threshold",
      practicalModuleScore(
        "Write a program to implement bubble sort and insertion sort",
        "Sorting: bubble sort, insertion sort, selection sort, merge sort",
      ) >= 0.34,
    );
  }
  {
    const ctx = ctxOf({
      modules: [
        mod({ module_number: 1, name: "Sorting", description: "bubble sort, insertion sort, merge sort" }),
        mod({ module_number: 2, name: "Graphs", description: "adjacency matrix, breadth first traversal" }),
      ],
      practicals: [
        { sr_no: 1, name: "Write a program to implement bubble sort", hours: 2 },
        { sr_no: 2, name: "Study of quantum entanglement in cryogenic media", hours: 2 },
      ],
    });
    const fs = checkPracticalAlignment(inputOf(ctx));
    check("flags the orphan practical", fs.some((f) => f.entity === "Practical 2" && f.severity === "warning"));
    check("does not flag the matched practical", !fs.some((f) => f.entity === "Practical 1"));
    check("flags the module with no practical as info", fs.some((f) => f.entity === "Module 2" && f.severity === "info"));
    check("no practicals → dimension is silent", checkPracticalAlignment(inputOf(ctxOf({ modules: ctx.modules }))).length === 0);
  }

  // ── co_po_mapping ──────────────────────────────────────────────────────────
  console.log("\nco_po_mapping");
  {
    const ctx = ctxOf({ courseOutcomes: [{ co_code: "CO1", description: "x" }] });
    const fs = checkCoPoMapping(
      inputOf(ctx, [
        { co_code: "CO1", po_code: "PO1", strength: 3 },
        { co_code: "CO1", po_code: "PO 2", strength: 1 }, // spaced variant
        { co_code: "CO1", po_code: "PO3", strength: 0 }, // strength 0 = not addressed
      ]),
    );
    const uncovered = fs.map((f) => f.entity);
    check("PO1 covered", !uncovered.includes("PO1"));
    check("normalizes 'PO 2' to PO2", !uncovered.includes("PO2"), uncovered.join(","));
    check("strength 0 does not count as coverage", uncovered.includes("PO3"));
    check("reports the remaining 10 POs", fs.length === 10, `got ${fs.length}`);
    check("all are info and non-fixable", fs.every((f) => f.severity === "info" && !f.fixable));
    check("no CO-PO data → dimension is silent", checkCoPoMapping(inputOf(ctx, [])).length === 0);
  }

  // ── assessment_coverage ────────────────────────────────────────────────────
  console.log("\nassessment_coverage");
  {
    const ctx = ctxOf({
      modules: [
        mod({ module_number: 1, weightage_percent: 30, coCodes: ["CO1"] }),
        mod({ module_number: 2, weightage_percent: 30, coCodes: ["CO1"] }),
        mod({ module_number: 3, weightage_percent: 5, coCodes: ["CO2", "CO3"] }),
        mod({ module_number: 4, weightage_percent: 35, coCodes: ["CO3"] }),
      ],
      courseOutcomes: [
        { co_code: "CO1", description: "Section I only" },
        { co_code: "CO2", description: "Section II, low weightage only" },
        { co_code: "CO3", description: "Section II, mixed weightage" },
        { co_code: "CO4", description: "Unmapped entirely" },
      ],
    });
    const fs = checkAssessmentCoverage(inputOf(ctx));
    check("flags the Section-II-only CO", fs.some((f) => f.entity === "CO2" && f.diagnosis.includes("Section II")));
    check("flags the low-weightage-only CO as warning", fs.some((f) => f.entity === "CO2" && f.severity === "warning"));
    check("CO3 spans a high-weightage module → no low-weightage flag", !fs.some((f) => f.entity === "CO3" && f.severity === "warning"));
    check("CO1 (Section I) is not flagged", !fs.some((f) => f.entity === "CO1"));
    check("unmapped CO4 is left to co_coverage, not double-reported", !fs.some((f) => f.entity === "CO4"));
  }

  // ── scoring + orchestration ────────────────────────────────────────────────
  console.log("\nscoring");
  {
    // Every rule satisfied at once: 20 topics/10h (2.0/hr, inside the band),
    // 25% hours vs 25% weightage on each module (ratio 1.0), BTL ascending 2→4
    // with BTL 1 present, and both COs reaching a Section I module.
    const clean = ctxOf({
      modules: [
        mod({ module_number: 1, hours: 10, weightage_percent: 25, btl_levels: [1, 2], coCodes: ["CO1"], description: topicsFor(20) }),
        mod({ module_number: 2, hours: 10, weightage_percent: 25, btl_levels: [2, 3], coCodes: ["CO2"], description: topicsFor(20) }),
        mod({ module_number: 3, hours: 10, weightage_percent: 25, btl_levels: [3, 4], coCodes: ["CO1"], description: topicsFor(20) }),
        mod({ module_number: 4, hours: 10, weightage_percent: 25, btl_levels: [4], coCodes: ["CO2"], description: topicsFor(20) }),
      ],
      courseOutcomes: [
        { co_code: "CO1", description: "a" },
        { co_code: "CO2", description: "b" },
      ],
    });
    const result = runDeterministicAudit(inputOf(clean));
    check("clean syllabus produces no findings", result.findings.length === 0, JSON.stringify(result.findings.map((f) => f.diagnosis)));
    check("clean syllabus scores 100", result.overallHealth === 100, String(result.overallHealth));
    check(
      "dimensions with no data are marked unassessed, not clean",
      result.scores.practical_alignment.assessed === false &&
        result.scores.co_po_mapping.assessed === false,
    );
    check(
      "AI dimensions start unassessed",
      result.scores.co_verb_quality.assessed === false &&
        !!result.scores.co_verb_quality.note,
    );
    check("no deterministic proposals", result.proposals.length === 0);
  }
  {
    const critical = ctxOf({
      modules: [mod({ module_number: 1, coCodes: [] })],
      courseOutcomes: [{ co_code: "CO1", description: "orphan" }],
    });
    const result = runDeterministicAudit(inputOf(critical));
    check("a critical drops co_coverage to 30", result.scores.co_coverage.score === 30);
    check("critical findings sort first", result.findings[0].severity === "critical");
    check("overall health falls below 100", result.overallHealth < 100, String(result.overallHealth));
  }
}

// ─── (B) Live run ────────────────────────────────────────────────────────────

function printAudit(label: string, input: AuditInput): number {
  const t0 = Date.now();
  const result = runDeterministicAudit(input);
  const ms = Date.now() - t0;

  console.log(`\n${"─".repeat(72)}`);
  console.log(`${label}`);
  console.log(
    `  ${input.ctx.modules.length} modules · ${input.ctx.courseOutcomes.length} COs · ` +
      `${input.ctx.practicals.length} practicals · ${input.coPoMappings.length} CO-PO rows`,
  );
  console.log(`  HEALTH: ${result.overallHealth}/100   (audit ran in ${ms}ms)`);
  console.log("  Dimensions:");
  for (const [dim, s] of Object.entries(result.scores)) {
    const label = DIMENSION_LABELS[dim as keyof typeof DIMENSION_LABELS];
    const state = s.assessed ? `${s.score}/100 · ${s.total} finding(s)` : `— ${s.note}`;
    console.log(`    ${label.padEnd(22)} ${state}`);
  }

  if (result.findings.length === 0) {
    console.log("  No findings.");
    return result.overallHealth;
  }
  console.log(`  Findings (${result.findings.length}):`);
  for (const f of result.findings) {
    const sev = f.severity.toUpperCase().padEnd(8);
    console.log(`    [${sev}] ${f.dimension} · ${f.entity}${f.fixable ? " (fixable)" : ""}`);
    console.log(`             ${f.diagnosis}`);
    if (f.suggestion) console.log(`             → ${f.suggestion}`);
  }
  return result.overallHealth;
}

async function runLive(): Promise<void> {
  const { createAdminClient } = await import("../src/lib/db/supabase-server");
  const { loadAuditInput } = await import("../src/lib/syllabus-audit/load");
  const admin = createAdminClient();

  const subjectArg = process.env.SUBJECT ?? "SEIT3032";

  if (subjectArg === "all") {
    console.log("\n=== B. LIVE RUN — every subject (summary) ===\n");
    const { data } = await admin.from("subjects").select("id, code, name").order("code");
    const rows = (data ?? []) as { id: string; code: string; name: string }[];
    const scored: { code: string; health: number; findings: number }[] = [];
    for (const row of rows) {
      const input = await loadAuditInput(row.id);
      const result = runDeterministicAudit(input);
      scored.push({ code: row.code, health: result.overallHealth, findings: result.findings.length });
    }
    scored.sort((a, b) => a.health - b.health);
    console.log("  Worst-first:");
    for (const s of scored) {
      console.log(`    ${String(s.health).padStart(3)}/100  ${s.code.padEnd(12)} ${s.findings} finding(s)`);
    }
    const avg = scored.reduce((sum, s) => sum + s.health, 0) / (scored.length || 1);
    console.log(`\n  ${scored.length} subjects · mean health ${avg.toFixed(1)}/100`);
    return;
  }

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
  let subjectId: string | null = null;
  let subjectLabel = subjectArg;

  if (uuidRe.test(subjectArg)) {
    subjectId = subjectArg;
  } else {
    const { data: byCode } = await admin
      .from("subjects")
      .select("id, name, code")
      .eq("code", subjectArg)
      .maybeSingle();
    const row = byCode as { id: string; name: string; code: string } | null;
    if (row) {
      subjectId = row.id;
      subjectLabel = `${row.code} — ${row.name}`;
    }
  }

  if (!subjectId) {
    console.error(`\nCould not resolve a subject for "${subjectArg}". Skipping live run.`);
    return;
  }

  console.log("\n=== B. LIVE RUN (real syllabus, still no AI) ===");
  const input = await loadAuditInput(subjectId);
  printAudit(`${subjectLabel} (${subjectId})`, input);
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  runFixtureTests();

  console.log(`\n${"═".repeat(72)}`);
  console.log(`Fixture tests: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(72));

  if (!process.env.FIXTURES_ONLY) {
    await runLive();
  }

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
