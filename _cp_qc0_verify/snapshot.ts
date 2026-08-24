/**
 * CP-QC0 — proof that deleting the BTL-tier preset machinery is
 * behaviour-preserving on the production path.
 *
 * Run BEFORE the deletion to record a baseline, AFTER it to verify:
 *   npx tsx _cp_qc0_verify/snapshot.ts --write   > _cp_qc0_verify/run.log 2>&1
 *   npx tsx _cp_qc0_verify/snapshot.ts --check   > _cp_qc0_verify/run.log 2>&1
 *
 * Why two fixture classes?
 *   `apportionBtlTiers` only ever runs under `ctx.difficultyPreset && !ctx.btlRange`
 *   (moduleAssignment.ts). The Q-paper UI ALWAYS sends btlRange (page.tsx:108/566
 *   defaults it, shared.tsx:902 degrades legacy templates to it) and NEVER sends
 *   difficultyPreset — so that branch cannot fire in production.
 *
 *   Fixtures tagged `presetPath: false` are the reachable paths: their output MUST
 *   be byte-identical across the deletion, and any drift is a hard failure.
 *   Fixtures tagged `presetPath: true` exercise the dead branch deliberately; they
 *   are EXPECTED to change (falling back to TYPE_BTL_RANGE) and are reported as an
 *   explicit, reviewable diff rather than silently tolerated.
 *
 * No DB, no network, no AI spend.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  assignModulesToSlots,
  type ModuleData,
  type SlotAssignmentContext,
} from "../src/lib/qpaper/moduleAssignment";
import type { TemplateSection } from "../src/lib/qpaper/templates";

const BASELINE = join(import.meta.dirname, "baseline.json");

// ─── Fixture data ───────────────────────────────────────────────────────────

/** Deliberately varied: BTL spans differ per module so tier logic is exercised,
 *  and M3 is low-BTL (1–2) so BTL-incompatibility shows up in the output. */
const MODULES: ModuleData[] = [
  { id: "m1", module_number: 1, name: "Foundations",     description: "Basics",     weightage_percent: 30, btl_levels: [1, 2, 3] },
  { id: "m2", module_number: 2, name: "Structures",      description: "Lists",      weightage_percent: 25, btl_levels: [2, 3, 4] },
  { id: "m3", module_number: 3, name: "Trees & Graphs",  description: "Traversal",  weightage_percent: 20, btl_levels: [1, 2] },
  { id: "m4", module_number: 4, name: "Advanced",        description: "Hashing",    weightage_percent: 25, btl_levels: [3, 4, 5, 6] },
];

/** Every module missing a weightage — exercises computeEffectiveWeights' even split. */
const MODULES_NO_WEIGHT: ModuleData[] = MODULES.map((m) => ({
  ...m,
  weightage_percent: null,
}));

const SECTION_MCQ: TemplateSection = {
  section_name: "Section A",
  module_range: [1, 4],
  total_marks: 10,
  questions: [
    { q_number: 1, display_label: "Q - 1", type: "mcq", total_marks: 10, sub_parts: 10, marks_per_part: 1, attempt_logic: null },
  ],
};

const SECTION_FULL_PPSU: TemplateSection = {
  section_name: "Section I",
  module_range: [1, 4],
  total_marks: 30,
  questions: [
    { q_number: 1, display_label: "Q - 1", type: "mcq", total_marks: 6, sub_parts: 6, marks_per_part: 1, attempt_logic: null },
    { q_number: 2, display_label: "Q - 2", type: "descriptive", total_marks: 6, has_numerical: true, attempt_logic: null },
    { q_number: 3, display_label: "Q - 3", type: "descriptive_with_or", total_marks: 12, marks_per_part: 6, parts: ["a", "b"], attempt_logic: null },
    { q_number: 4, display_label: "Q - 4", type: "attempt_any_one", total_marks: 6, sub_parts: 2, attempt_logic: "any_one" },
  ],
};

const SECTION_POOL: TemplateSection = {
  section_name: "Section B",
  module_range: [1, 4],
  total_marks: 12,
  questions: [
    {
      q_number: 1, display_label: "Q - 1", type: "pool", total_marks: 12,
      attemptCount: 4, marksPerItem: 3,
      composition: [
        { itemType: "mcq", count: 2 },
        { itemType: "true_false", count: 1 },
        { itemType: "short", count: 2 },
        { itemType: "numerical", count: 1 },
      ],
    },
  ],
};

const SECTION_PINNED: TemplateSection = {
  section_name: "Section C",
  module_range: [1, 4],
  total_marks: 16,
  questions: [
    { q_number: 1, display_label: "Q - 1", type: "mcq", total_marks: 4, sub_parts: 4, marks_per_part: 1, attempt_logic: null, pinnedModuleId: "m3" },
    { q_number: 2, display_label: "Q - 2", type: "descriptive", total_marks: 12, attempt_logic: null, pinnedModuleId: "m4" },
  ],
};

const MODULE_COS: Record<number, string[]> = {
  1: ["CO1"],
  2: ["CO1", "CO2"],
  3: ["CO2", "CO3"],
  4: ["CO3", "CO4"],
};
const moduleCosFn = (n: number): string[] => MODULE_COS[n] ?? [];

const CO_PO = new Map([
  ["CO1", [{ po_code: "PO1", strength: 3 }]],
  ["CO2", [{ po_code: "PO2", strength: 2 }]],
  ["CO3", [{ po_code: "PO2", strength: 3 }, { po_code: "PO3", strength: 1 }]],
  ["CO4", [{ po_code: "PO4", strength: 2 }]],
]);

interface Fixture {
  name: string;
  /** true = exercises the dead `difficultyPreset && !btlRange` branch. */
  presetPath: boolean;
  modules: ModuleData[];
  section: TemplateSection;
  ctx: SlotAssignmentContext;
}

const BASE_CTX: SlotAssignmentContext = {
  coPoMap: CO_PO,
  moduleCosFn,
  allCoCodes: ["CO1", "CO2", "CO3", "CO4"],
};

const FIXTURES: Fixture[] = [
  // ── Reachable production paths — MUST NOT CHANGE ────────────────────────
  { name: "ppsu/btlRange[2,4]", presetPath: false, modules: MODULES, section: SECTION_FULL_PPSU,
    ctx: { ...BASE_CTX, btlRange: [2, 4] } },
  { name: "ppsu/btlRange[1,6]", presetPath: false, modules: MODULES, section: SECTION_FULL_PPSU,
    ctx: { ...BASE_CTX, btlRange: [1, 6] } },
  { name: "ppsu/btlRange[3,5]-narrow", presetPath: false, modules: MODULES, section: SECTION_FULL_PPSU,
    ctx: { ...BASE_CTX, btlRange: [3, 5] } },
  { name: "mcq/btlRange[1,2]", presetPath: false, modules: MODULES, section: SECTION_MCQ,
    ctx: { ...BASE_CTX, btlRange: [1, 2] } },
  { name: "pool/btlRange[2,4]", presetPath: false, modules: MODULES, section: SECTION_POOL,
    ctx: { ...BASE_CTX, btlRange: [2, 4] } },
  { name: "pinned/btlRange[2,4]", presetPath: false, modules: MODULES, section: SECTION_PINNED,
    ctx: { ...BASE_CTX, btlRange: [2, 4] } },
  { name: "ppsu/coTargets", presetPath: false, modules: MODULES, section: SECTION_FULL_PPSU,
    ctx: { ...BASE_CTX, btlRange: [2, 4], coTargets: new Map([["CO1", 12], ["CO3", 12]]) } },
  { name: "ppsu/difficultyTargets", presetPath: false, modules: MODULES, section: SECTION_FULL_PPSU,
    ctx: { ...BASE_CTX, btlRange: [2, 4],
      difficultyTargets: [
        { difficulty: "easy", pct: 30 },
        { difficulty: "medium", pct: 50 },
        { difficulty: "hard", pct: 20 },
      ] } },
  { name: "ppsu/all-secondary-directives", presetPath: false, modules: MODULES, section: SECTION_FULL_PPSU,
    ctx: { ...BASE_CTX, btlRange: [2, 5],
      coTargets: new Map([["CO2", 10], ["CO4", 8]]),
      difficultyTargets: [
        { difficulty: "easy", pct: 20 },
        { difficulty: "medium", pct: 40 },
        { difficulty: "hard", pct: 40 },
      ] } },
  { name: "ppsu/no-weightage", presetPath: false, modules: MODULES_NO_WEIGHT, section: SECTION_FULL_PPSU,
    ctx: { ...BASE_CTX, btlRange: [2, 4] } },
  { name: "ppsu/single-module", presetPath: false, modules: [MODULES[0]], section: SECTION_FULL_PPSU,
    ctx: { ...BASE_CTX, btlRange: [1, 3] } },
  { name: "ppsu/no-btl-no-preset", presetPath: false, modules: MODULES, section: SECTION_FULL_PPSU,
    ctx: { ...BASE_CTX } },

  // ── Dead branch — deletion is EXPECTED to change these ──────────────────
  { name: "DEAD/preset-balanced", presetPath: true, modules: MODULES, section: SECTION_FULL_PPSU,
    ctx: { ...BASE_CTX, difficultyPreset: "balanced" } },
  { name: "DEAD/preset-application_heavy", presetPath: true, modules: MODULES, section: SECTION_FULL_PPSU,
    ctx: { ...BASE_CTX, difficultyPreset: "application_heavy" } },
  { name: "DEAD/preset-custom", presetPath: true, modules: MODULES, section: SECTION_FULL_PPSU,
    ctx: { ...BASE_CTX, difficultyPreset: "custom", customBtlWeights: { tier1: 10, tier2: 20, tier3: 70 } } },
];

// ─── Deterministic serialisation ────────────────────────────────────────────

/** Stable key order so a snapshot diff reflects real change, not key ordering. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, stable((value as Record<string, unknown>)[k])])
    );
  }
  return value;
}

function run(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of FIXTURES) {
    // assignModulesToSlots mutates nothing external, but clone inputs anyway so
    // fixture order can never influence a later fixture's result.
    const slots = assignModulesToSlots(
      f.modules.map((m) => ({ ...m })),
      JSON.parse(JSON.stringify(f.section)) as TemplateSection,
      f.ctx
    );
    out[f.name] = JSON.stringify(stable(slots), null, 2);
  }
  return out;
}

// ─── Entry ──────────────────────────────────────────────────────────────────

const mode = process.argv.includes("--write") ? "write" : "check";
const current = run();

if (mode === "write") {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2));
  console.log(`baseline written: ${Object.keys(current).length} fixtures → ${BASELINE}`);
  for (const [k, v] of Object.entries(current)) {
    const slots = JSON.parse(v) as unknown[];
    console.log(`  ${k.padEnd(34)} ${slots.length} slots`);
  }
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error("FAIL: no baseline.json — run with --write BEFORE the deletion.");
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, string>;
const presetPathNames = new Set(FIXTURES.filter((f) => f.presetPath).map((f) => f.name));

let hardFail = 0;
let expectedDrift = 0;
let identical = 0;

for (const f of FIXTURES) {
  const before = baseline[f.name];
  const after = current[f.name];
  if (before === undefined) {
    console.error(`FAIL: fixture "${f.name}" absent from baseline — regenerate it.`);
    hardFail += 1;
    continue;
  }
  if (before === after) {
    identical += 1;
    continue;
  }
  if (presetPathNames.has(f.name)) {
    expectedDrift += 1;
    console.log(`~ EXPECTED DRIFT (dead branch removed): ${f.name}`);
    continue;
  }
  hardFail += 1;
  console.error(`\nFAIL: production-path fixture changed: ${f.name}`);
  const b = before.split("\n");
  const a = after.split("\n");
  for (let i = 0; i < Math.max(b.length, a.length); i++) {
    if (b[i] !== a[i]) {
      console.error(`  line ${i + 1}:\n    before: ${b[i] ?? "(none)"}\n    after:  ${a[i] ?? "(none)"}`);
    }
  }
}

// A baseline fixture that vanished from the suite is a silent coverage loss.
for (const name of Object.keys(baseline)) {
  if (!(name in current)) {
    console.error(`FAIL: baseline fixture "${name}" no longer present in the suite.`);
    hardFail += 1;
  }
}

console.log(
  `\n${identical} identical, ${expectedDrift} expected drift (dead branch), ${hardFail} failures`
);
if (hardFail > 0) {
  console.error("RESULT: FAIL — deletion changed a reachable code path.");
  process.exit(1);
}
console.log("RESULT: PASS — every production path is byte-identical.");
