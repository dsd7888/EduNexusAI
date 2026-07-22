/**
 * Checkpoint-2 test harness — Syllabus Health Audit, Layer 2 (AI suggestions).
 *
 * Two halves, same shape as test-labmanual-path.ts:
 *
 *  (A) GATE TESTS — pure, free, NO AI. validateSuggestions is exported so every
 *      rejection path can be driven with forced-bad model output directly. This
 *      is where "a proposal can never write to a module that doesn't exist" is
 *      actually proven; waiting for the model to hallucinate one on demand is
 *      not a test strategy.
 *
 *  (B) LIVE RUN — one real Flash call against a subject with known CO gaps,
 *      printing every proposal as the diff the faculty will see.
 *
 *   npx tsx scripts/test-syllabus-audit-suggest.ts               # gate + live
 *   GATE_ONLY=1 npx tsx scripts/test-syllabus-audit-suggest.ts   # free
 *   SUBJECT=IDCH3051 npx tsx scripts/test-syllabus-audit-suggest.ts
 *
 * The live half costs one Flash call. Same fake-request-scope shim as
 * test-labmanual-path.ts: routeAI logs via next/server's after(), which needs a
 * request scope.
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

// TYPE-ONLY imports here — they erase at compile time. Every VALUE import of
// app code is deferred to an await import() inside the functions below, because
// suggestions.ts reaches routeAI → next/server, and loading that before the
// AsyncLocalStorage shim above is installed throws "AsyncLocalStorage accessed
// in runtime where it is not available". tsx transpiles to CJS, so a top-level
// `import` would be hoisted ABOVE the shim assignment. Same pattern as
// test-labmanual-path.ts.
import type { SubjectContext, SubjectModule } from "@/lib/subjectContext";
import type { AuditInput, Finding } from "@/lib/syllabus-audit/types";

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

// ─── Fixtures ────────────────────────────────────────────────────────────────

function mod(p: Partial<SubjectModule> & { module_number: number }): SubjectModule {
  return {
    id: `mod-${p.module_number}`,
    module_number: p.module_number,
    name: p.name ?? `Module ${p.module_number}`,
    description: p.description ?? "some topics taught in this module",
    hours: p.hours !== undefined ? p.hours : 10,
    weightage_percent: p.weightage_percent !== undefined ? p.weightage_percent : 25,
    btl_levels: p.btl_levels ?? [1, 2, 3],
    coCodes: p.coCodes ?? [],
  };
}

type RunAudit = typeof import("@/lib/syllabus-audit/checks")["runDeterministicAudit"];

/** A subject with a genuinely unmapped CO and a genuinely unmapped module. */
function gapFixture(runDeterministicAudit: RunAudit): { input: AuditInput; findings: Finding[] } {
  const ctx: SubjectContext = {
    subjectId: "fixture",
    subjectName: "Object Oriented Programming",
    subjectCode: "FIX101",
    modules: [
      mod({ module_number: 1, name: "Classes and Objects", coCodes: ["CO1"] }),
      mod({ module_number: 2, name: "Inheritance", coCodes: ["CO1"] }),
      mod({ module_number: 3, name: "Exception Handling", coCodes: [] }),
    ],
    courseOutcomes: [
      { co_code: "CO1", description: "Apply OOP principles to design class hierarchies" },
      { co_code: "CO2", description: "Learn and acquire exception handling" },
    ],
    practicals: [],
  };
  const input: AuditInput = { ctx, coPoMappings: [], referenceBooks: null };
  return { input, findings: runDeterministicAudit(input).findings };
}

// ─── (A) Gate tests ──────────────────────────────────────────────────────────

async function runGateTests(): Promise<void> {
  const { runDeterministicAudit } = await import("@/lib/syllabus-audit/checks");
  const { selectFindingsForAi, validateSuggestions } = await import(
    "@/lib/syllabus-audit/suggestions"
  );

  console.log("\n=== A. GATE TESTS (pure, no AI, no DB) ===\n");

  const { input, findings } = gapFixture(runDeterministicAudit);
  const coGap = findings.find((f) => f.entity === "CO2" && f.dimension === "co_coverage")!;
  const modGap = findings.find((f) => f.entity === "Module 3")!;
  const advisory = findings.find((f) => !f.fixable);

  console.log("fixture sanity");
  check("the fixture really does have a CO gap", !!coGap && coGap.fixable);
  check("the fixture really does have a module gap", !!modGap && modGap.fixable);
  check(
    "selectFindingsForAi keeps only fixable warnings/criticals",
    selectFindingsForAi(findings).every((f) => f.fixable && f.severity !== "info"),
  );

  // ── happy path ─────────────────────────────────────────────────────────────
  console.log("\naccepts a well-formed fix");
  {
    const r = validateSuggestions(
      [
        {
          findingId: coGap.id,
          entityType: "module_co_mapping",
          moduleNumber: 3,
          coCode: "CO2",
          rationale: "Module 3 teaches try/catch, which is exactly what CO2 covers.",
        },
      ],
      [],
      input,
      findings,
    );
    check("one proposal survives", r.proposals.length === 1, JSON.stringify(r.warnings));
    check("no warnings on a clean fix", r.warnings.length === 0);
    const p = r.proposals[0];
    check("oldValue is rendered from the DB, not the model", p.oldValue === "CO2 → (no modules)", p.oldValue);
    check(
      "newValue names the real module",
      p.newValue === "CO2 → Module 3 (Exception Handling)",
      p.newValue,
    );
    check("patch carries the real module UUID", p.patch.moduleId === "mod-3");
    check("patch carries the normalized CO code", p.patch.coCode === "CO2");
    check("status starts pending", p.status === "pending");
  }

  // ── rejection paths ────────────────────────────────────────────────────────
  console.log("\nrejects bad fixes");
  {
    const cases: Array<{ name: string; fix: Record<string, unknown>; kind: string }> = [
      {
        name: "orphan findingId",
        fix: { findingId: "deadbeefdeadbeef", entityType: "module_co_mapping", moduleNumber: 3, coCode: "CO2", rationale: "x" },
        kind: "orphan_proposal",
      },
      {
        name: "module number that doesn't exist",
        fix: { findingId: coGap.id, entityType: "module_co_mapping", moduleNumber: 99, coCode: "CO2", rationale: "x" },
        kind: "unknown_entity",
      },
      {
        name: "CO code that doesn't exist",
        fix: { findingId: coGap.id, entityType: "module_co_mapping", moduleNumber: 3, coCode: "CO9", rationale: "x" },
        kind: "unknown_entity",
      },
      {
        name: "empty rationale",
        fix: { findingId: coGap.id, entityType: "module_co_mapping", moduleNumber: 3, coCode: "CO2", rationale: "   " },
        kind: "empty_rationale",
      },
      {
        name: "entityType the dimension may not touch",
        fix: { findingId: coGap.id, entityType: "co_description", moduleNumber: 3, coCode: "CO2", rationale: "x" },
        kind: "bad_entity_type",
      },
      {
        name: "entityType outside the enum entirely",
        fix: { findingId: coGap.id, entityType: "DROP TABLE modules", moduleNumber: 3, coCode: "CO2", rationale: "x" },
        kind: "bad_entity_type",
      },
      {
        name: "redundant mapping (module already has that CO)",
        fix: { findingId: modGap.id, entityType: "module_co_mapping", moduleNumber: 1, coCode: "CO1", rationale: "x" },
        kind: "redundant_proposal",
      },
      {
        name: "BTL level out of the 1-6 range",
        fix: { findingId: coGap.id, entityType: "btl_levels", moduleNumber: 3, btlLevel: 9, rationale: "x" },
        kind: "bad_entity_type", // co_coverage may not propose btl_levels at all
      },
    ];

    for (const c of cases) {
      const r = validateSuggestions([c.fix], [], input, findings);
      check(
        `drops: ${c.name}`,
        r.proposals.length === 0 && r.warnings.some((w) => w.kind === c.kind),
        `proposals=${r.proposals.length} warnings=${JSON.stringify(r.warnings.map((w) => w.kind))}`,
      );
    }
  }

  console.log("\nrejects bad BTL fixes (against a real btl_profile finding)");
  {
    // A subject whose module 2 regresses, so a btl_profile finding exists.
    const ctx: SubjectContext = {
      subjectId: "f2",
      subjectName: "Test",
      subjectCode: null,
      modules: [
        mod({ module_number: 1, btl_levels: [1, 2, 4], coCodes: ["CO1"] }),
        mod({ module_number: 2, btl_levels: [1, 2], coCodes: ["CO1"] }),
      ],
      courseOutcomes: [{ co_code: "CO1", description: "Apply things" }],
      practicals: [],
    };
    const inp: AuditInput = { ctx, coPoMappings: [], referenceBooks: null };
    const fs = runDeterministicAudit(inp).findings;
    const btlFinding = fs.find((f) => f.dimension === "btl_profile" && f.entity === "Module 2")!;
    check("fixture raises a BTL regression finding", !!btlFinding);

    const ok = validateSuggestions(
      [{ findingId: btlFinding.id, entityType: "btl_levels", moduleNumber: 2, btlLevel: 4, rationale: "Module 2 already asks students to compare designs." }],
      [], inp, fs,
    );
    check("accepts a valid BTL addition", ok.proposals.length === 1, JSON.stringify(ok.warnings));
    check(
      "BTL diff shows the merged sorted array",
      ok.proposals[0]?.newValue === "Module 2 BTL: [1, 2, 4]",
      ok.proposals[0]?.newValue,
    );
    check(
      "BTL patch is the full new array, not a delta",
      JSON.stringify(ok.proposals[0]?.patch.btlLevels) === "[1,2,4]",
    );

    const bad = validateSuggestions(
      [{ findingId: btlFinding.id, entityType: "btl_levels", moduleNumber: 2, btlLevel: 7, rationale: "x" }],
      [], inp, fs,
    );
    check("drops BTL 7", bad.proposals.length === 0 && bad.warnings.some((w) => w.kind === "incomplete_patch"));

    const dupe = validateSuggestions(
      [{ findingId: btlFinding.id, entityType: "btl_levels", moduleNumber: 2, btlLevel: 2, rationale: "x" }],
      [], inp, fs,
    );
    check("drops a BTL the module already has", dupe.proposals.length === 0 && dupe.warnings.some((w) => w.kind === "redundant_proposal"));
  }

  console.log("\ndeduplication");
  {
    const two = validateSuggestions(
      [
        { findingId: coGap.id, entityType: "module_co_mapping", moduleNumber: 3, coCode: "CO2", rationale: "first" },
        { findingId: coGap.id, entityType: "module_co_mapping", moduleNumber: 1, coCode: "CO2", rationale: "second" },
      ],
      [], input, findings,
    );
    check("keeps only the first proposal per finding", two.proposals.length === 1 && two.proposals[0].rationale === "first");
    check("warns about the dropped duplicate", two.warnings.some((w) => w.kind === "duplicate_proposal"));
  }

  if (advisory) {
    console.log("\nadvisory findings are not proposable");
    const r = validateSuggestions(
      [{ findingId: advisory.id, entityType: "module_co_mapping", moduleNumber: 3, coCode: "CO2", rationale: "x" }],
      [], input, findings,
    );
    check(
      `drops a proposal aimed at a non-fixable ${advisory.dimension} finding`,
      r.proposals.length === 0 && r.warnings.some((w) => w.kind === "non_fixable_proposal"),
    );
  }

  // ── discoveries ────────────────────────────────────────────────────────────
  console.log("\ndiscoveries (the three AI-only dimensions)");
  {
    const r = validateSuggestions(
      [],
      [
        {
          dimension: "co_verb_quality",
          entity: "CO2",
          coCode: "CO2",
          diagnosis: "\"Learn and acquire\" is not measurable at any Bloom's level.",
          newDescription: "Apply exception handling to recover from runtime failures (BTL 3)",
          rationale: "Matches the BTL 3 ceiling of the modules CO2 will map to.",
        },
        {
          dimension: "modern_relevance",
          entity: "Module 1",
          diagnosis: "Applets are deprecated; JavaFX replaced them.",
        },
        {
          dimension: "missing_topics",
          entity: "Generics",
          diagnosis: "Generics are standard in an OOP course and absent here.",
        },
      ],
      input,
      findings,
    );
    check("all three discoveries become findings", r.aiFindings.length === 3, JSON.stringify(r.warnings));
    const verb = r.aiFindings.find((f) => f.dimension === "co_verb_quality")!;
    check("co_verb_quality is a warning by policy", verb.severity === "warning");
    check("modern_relevance is info by policy", r.aiFindings.find((f) => f.dimension === "modern_relevance")!.severity === "info");
    check("missing_topics is info by policy", r.aiFindings.find((f) => f.dimension === "missing_topics")!.severity === "info");
    check("a CO rewrite becomes a proposal", r.proposals.length === 1);
    check(
      "the rewrite's oldValue is the REAL description from the DB",
      r.proposals[0].oldValue === "Learn and acquire exception handling",
      r.proposals[0].oldValue,
    );
    check("the rewrite proposal links back to its finding", r.proposals[0].findingId === verb.id);
    check("only the co_verb_quality finding is fixable", verb.fixable && r.aiFindings.filter((f) => f.fixable).length === 1);
  }
  {
    const r = validateSuggestions(
      [],
      [
        { dimension: "co_verb_quality", entity: "CO9", coCode: "CO9", diagnosis: "x", newDescription: "Apply nonexistent things" },
        { dimension: "hallucinated_dimension", entity: "X", diagnosis: "y" },
        { dimension: "missing_topics", entity: "", diagnosis: "no entity" },
      ],
      input,
      findings,
    );
    check("drops a rewrite for a CO that doesn't exist", r.warnings.some((w) => w.kind === "unknown_entity"));
    check("drops an unknown dimension", r.warnings.some((w) => w.kind === "bad_discovery"));
    check("no proposals survive", r.proposals.length === 0);
  }
  {
    const r = validateSuggestions([], [], input, findings);
    check("empty output is valid, not an error", r.proposals.length === 0 && r.aiFindings.length === 0 && r.warnings.length === 0);
  }
}

// ─── (B) Live run ────────────────────────────────────────────────────────────

async function runLive(): Promise<void> {
  const { createAdminClient } = await import("@/lib/db/supabase-server");
  const { loadAuditInput } = await import("@/lib/syllabus-audit/load");
  const { runDeterministicAudit } = await import("@/lib/syllabus-audit/checks");
  const { generateSuggestions, selectFindingsForAi } = await import(
    "@/lib/syllabus-audit/suggestions"
  );
  const { workAsyncStorage } = await import(
    "next/dist/server/app-render/work-async-storage.external.js"
  );

  const admin = createAdminClient();
  const subjectArg = process.env.SUBJECT ?? "IDCH3051";

  const { data: byCode } = await admin
    .from("subjects")
    .select("id, name, code")
    .eq("code", subjectArg)
    .maybeSingle();
  const row = byCode as { id: string; name: string; code: string } | null;
  if (!row) {
    console.error(`\nCould not resolve subject "${subjectArg}". Skipping live run.`);
    return;
  }

  console.log(`\n=== B. LIVE RUN — ${row.code} — ${row.name} (1 Flash call) ===\n`);

  const input = await loadAuditInput(row.id);
  const audit = runDeterministicAudit(input);
  const selected = selectFindingsForAi(audit.findings);
  console.log(
    `  ${audit.findings.length} findings, ${selected.length} sent to the AI ` +
      `(health ${audit.overallHealth}/100)`,
  );
  for (const f of selected) {
    console.log(`    → [${f.severity}] ${f.dimension} · ${f.entity}`);
  }

  const logContext = {
    userId: null,
    userEmail: "harness@test",
    userRole: "faculty",
    subjectId: input.ctx.subjectId,
    subjectCode: input.ctx.subjectCode,
    jobId: crypto.randomUUID(),
    relatedContentId: null,
    feature: "syllabus_audit_test",
    metadata: {},
  };
  const store = { afterContext: { after: (fn: unknown) => { void fn; } } };

  await workAsyncStorage.run(store as never, async () => {
    const t0 = Date.now();
    const result = await generateSuggestions(input, audit.findings, logContext);
    console.log(`\n  Generated in ${Date.now() - t0}ms\n`);

    if (result.warnings.length > 0) {
      console.log(`  GATE WARNINGS (${result.warnings.length}):`);
      for (const w of result.warnings) console.log(`    [${w.kind}] ${w.message}`);
      console.log("");
    }

    console.log(`  ── PROPOSALS (${result.proposals.length}) ──`);
    for (const p of result.proposals) {
      const finding = [...audit.findings, ...result.aiFindings].find((f) => f.id === p.findingId);
      console.log(`\n  ${p.dimension} · ${p.entityType} · ref ${p.entityRef}`);
      console.log(`    problem : ${finding?.diagnosis ?? "(finding not found — GATE BUG)"}`);
      console.log(`    -  OLD  : ${p.oldValue}`);
      console.log(`    +  NEW  : ${p.newValue}`);
      console.log(`    why     : ${p.rationale}`);
      console.log(`    patch   : ${JSON.stringify(p.patch)}`);
    }

    console.log(`\n  ── AI FINDINGS (${result.aiFindings.length}) ──`);
    for (const f of result.aiFindings) {
      console.log(`\n  [${f.severity}] ${f.dimension} · ${f.entity}${f.fixable ? " (fixable)" : ""}`);
      console.log(`    ${f.diagnosis}`);
      if (f.suggestion) console.log(`    → ${f.suggestion}`);
    }

    // The invariant the whole gate exists for, re-asserted on real output.
    const allIds = new Set([...audit.findings, ...result.aiFindings].map((f) => f.id));
    console.log("");
    check(
      "LIVE: every proposal resolves to a real finding",
      result.proposals.every((p) => allIds.has(p.findingId)),
    );
    check(
      "LIVE: every proposal has a non-empty rationale",
      result.proposals.every((p) => p.rationale.trim().length > 0),
    );
    check(
      "LIVE: every module_co_mapping patch names a real module id",
      result.proposals
        .filter((p) => p.entityType === "module_co_mapping")
        .every((p) => input.ctx.modules.some((m) => m.id === p.patch.moduleId)),
    );
    check(
      "LIVE: every btl_levels patch is a sorted 1-6 array",
      result.proposals
        .filter((p) => p.entityType === "btl_levels")
        .every((p) => {
          const lv = p.patch.btlLevels as number[];
          return (
            Array.isArray(lv) &&
            lv.every((n) => n >= 1 && n <= 6) &&
            lv.every((n, i) => i === 0 || lv[i - 1] < n)
          );
        }),
    );
  });
}

async function main(): Promise<void> {
  await runGateTests();

  if (!process.env.GATE_ONLY) {
    await runLive();
  }

  console.log(`\n${"═".repeat(72)}`);
  console.log(`${passed} passed, ${failed} failed`);
  console.log("═".repeat(72));
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
