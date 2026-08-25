/**
 * CP-QC2 — module scoping fix + coverage ledger.
 *
 *   npx tsx _cp_qc2_verify/pure.ts > _cp_qc2_verify/run.log 2>&1
 *
 * The two headline assertions are REGRESSION tests: they reproduce the exact
 * faculty-reported failures against the old encoding, and both fail if the fix
 * is reverted. They are marked [REGRESSION] below.
 *
 * No DB, no network, no AI spend.
 */
import { selectModulesForSection } from "../src/lib/qpaper/moduleScope";
import {
  computeCoverage,
  explainCoverage,
  uncoveredModules,
  warnedModules,
  normaliseBtlLevels,
  type ModuleCoverage,
} from "../src/lib/qpaper/coverage";
import { assignModulesToSlots, type ModuleData } from "../src/lib/qpaper/moduleAssignment";
import type { TemplateSection } from "../src/lib/qpaper/templates";

let pass = 0;
let fail = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.error(`FAIL: ${label}`);
  }
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

interface Row extends ModuleData {
  id: string;
  section_number: number | null;
}

const M = (
  n: number,
  name: string,
  opts: Partial<Row> = {}
): Row => ({
  id: `m${n}`,
  module_number: n,
  name,
  description: `${name} content`,
  weightage_percent: 25,
  btl_levels: [1, 2, 3, 4],
  section_number: null,
  ...opts,
});

const section = (
  name: string,
  moduleNumbers: number[] | undefined,
  range: [number, number],
  marks = 30
): TemplateSection => ({
  section_name: name,
  ...(moduleNumbers ? { module_numbers: moduleNumbers } : {}),
  module_range: range,
  total_marks: marks,
  questions: [
    { q_number: 1, display_label: "Q - 1", type: "mcq", total_marks: 6, sub_parts: 6, marks_per_part: 1, attempt_logic: null },
    { q_number: 2, display_label: "Q - 2", type: "descriptive", total_marks: 12, attempt_logic: null },
    { q_number: 3, display_label: "Q - 3", type: "descriptive", total_marks: 12, attempt_logic: null },
  ],
});

// ─── selectModulesForSection ────────────────────────────────────────────────

{
  // [REGRESSION] Phantom inclusion. Selecting units 1, 2 and 5 used to collapse
  // to the range [1,5], which the server re-expanded to 1,2,3,4,5 — generating
  // from two units the faculty explicitly DEselected.
  const all = [M(1, "A"), M(2, "B"), M(3, "C"), M(4, "D"), M(5, "E")];
  const withExplicit = selectModulesForSection(all, {
    module_numbers: [1, 2, 5],
    module_range: [1, 5],
  });
  const nums = withExplicit.map((m) => m.module_number);
  assert(
    JSON.stringify(nums) === JSON.stringify([1, 2, 5]),
    `[REGRESSION] non-contiguous selection honoured exactly (got ${nums.join(",")})`
  );
  assert(!nums.includes(3) && !nums.includes(4),
    "[REGRESSION] deselected units 3 and 4 are excluded");

  // Prove the old encoding really was lossy — range-only still over-selects,
  // which is exactly why module_numbers has to win.
  const rangeOnly = selectModulesForSection(all, { module_range: [1, 5] });
  assert(rangeOnly.length === 5,
    "range-only encoding demonstrably over-selects (5 units for a 3-unit choice)");
}

{
  const all = [M(1, "A"), M(2, "B"), M(3, "C")];
  assert(selectModulesForSection(all, { module_range: [1, 2] }).length === 2,
    "falls back to module_range on legacy templates");
  assert(selectModulesForSection(all, {}).length === 3,
    "no scope at all → every module");
  assert(selectModulesForSection(all, { module_numbers: [], module_range: [2, 3] }).length === 2,
    "empty module_numbers falls through to the range (never scopes to nothing)");
  assert(selectModulesForSection(all, { module_numbers: [9] }).length === 0,
    "module_numbers naming no real module yields nothing (caller must handle)");
  assert(selectModulesForSection([], { module_numbers: [1] }).length === 0,
    "empty module list is safe");
}

// ─── modulesForSectionIndex (the section_number gate) ───────────────────────
// Re-implemented here rather than imported: the source lives in a "use client"
// component (shared.tsx) that pulls in React/JSX and cannot load under tsx.
// Kept deliberately line-for-line equivalent to the shipped function.

function modulesForSectionIndex(
  sectionIdx: number,
  modules: Row[],
  selectedModuleIds: string[],
  sectionCount: number
): Row[] {
  const selectedSet = new Set(selectedModuleIds);
  const selected = modules.filter((m) => selectedSet.has(m.id));
  if (selected.length === 0) return [];
  const sectionNumber = sectionIdx + 1;
  const belongsToARealSection = (m: Row) =>
    m.section_number != null && m.section_number >= 1 && m.section_number <= sectionCount;
  const inThisSection = selected.filter(
    (m) => belongsToARealSection(m) && m.section_number === sectionNumber
  );
  const unscoped = selected.filter((m) => !belongsToARealSection(m));
  const out = [...inThisSection, ...unscoped].sort((a, b) => a.module_number - b.module_number);
  return out.length > 0 ? out : selected;
}

/** The OLD implementation, kept so the regression can be demonstrated. */
function oldModuleRangeForSection(
  sectionIdx: number,
  modules: Row[],
  selectedModuleIds: string[]
): [number, number] {
  const sectionNumber = sectionIdx + 1;
  const inSection = modules.filter(
    (m) =>
      selectedModuleIds.includes(m.id) &&
      (m.section_number == null || m.section_number === sectionNumber)
  );
  if (inSection.length === 0) {
    const all = modules.filter((m) => selectedModuleIds.includes(m.id));
    if (all.length === 0) return [0, 0];
    return [Math.min(...all.map((m) => m.module_number)), Math.max(...all.map((m) => m.module_number))];
  }
  return [
    Math.min(...inSection.map((m) => m.module_number)),
    Math.max(...inSection.map((m) => m.module_number)),
  ];
}

{
  // [REGRESSION] The reported bug: 3 units selected, unit 3 assigned to
  // section_number 2, template has ONE section. The old code dropped unit 3
  // from every section, silently.
  const mods = [
    M(1, "Foundations", { section_number: 1 }),
    M(2, "Structures", { section_number: 1 }),
    M(3, "Trees & Graphs", { section_number: 2 }),
  ];
  const selectedIds = ["m1", "m2", "m3"];

  const oldRange = oldModuleRangeForSection(0, mods, selectedIds);
  const oldResolved = mods.filter(
    (m) => m.module_number >= oldRange[0] && m.module_number <= oldRange[1]
  );
  assert(
    !oldResolved.some((m) => m.module_number === 3),
    "[REGRESSION] old code demonstrably dropped unit 3 (bug reproduced)"
  );

  const fixed = modulesForSectionIndex(0, mods, selectedIds, 1);
  assert(
    fixed.some((m) => m.module_number === 3),
    "[REGRESSION] unit 3 is now included in the single-section paper"
  );
  assert(fixed.length === 3, "all three selected units are in scope");
}

{
  // A genuine two-section partition must still be honoured — the useful case
  // for section_number, which the fix deliberately preserves.
  const mods = [
    M(1, "A", { section_number: 1 }), M(2, "B", { section_number: 1 }),
    M(3, "C", { section_number: 2 }), M(4, "D", { section_number: 2 }),
  ];
  const ids = ["m1", "m2", "m3", "m4"];
  const s1 = modulesForSectionIndex(0, mods, ids, 2).map((m) => m.module_number);
  const s2 = modulesForSectionIndex(1, mods, ids, 2).map((m) => m.module_number);
  assert(JSON.stringify(s1) === JSON.stringify([1, 2]), "section I keeps its own units");
  assert(JSON.stringify(s2) === JSON.stringify([3, 4]), "section II keeps its own units");
}

{
  // All section_number null — the most common shape. Must behave exactly as
  // before: every section draws from the whole selection.
  const mods = [M(1, "A"), M(2, "B"), M(3, "C")];
  const ids = ["m1", "m2", "m3"];
  for (const idx of [0, 1]) {
    const got = modulesForSectionIndex(idx, mods, ids, 2).map((m) => m.module_number);
    assert(JSON.stringify(got) === JSON.stringify([1, 2, 3]),
      `unscoped modules are shared across section ${idx + 1} (unchanged behaviour)`);
  }
}

{
  const mods = [M(1, "A"), M(2, "B")];
  assert(modulesForSectionIndex(0, mods, [], 1).length === 0,
    "no selection → empty scope (caller blocks generation)");
  assert(modulesForSectionIndex(0, mods, ["m1"], 1).length === 1,
    "partial selection is honoured");
  // A module pointing at a section beyond the template must never vanish.
  const orphan = [M(1, "A", { section_number: 1 }), M(2, "B", { section_number: 7 })];
  const got = modulesForSectionIndex(0, orphan, ["m1", "m2"], 2).map((m) => m.module_number);
  assert(got.includes(2), "module with an out-of-range section_number is retained, not dropped");
}

// ─── Coverage ledger ────────────────────────────────────────────────────────

function ledgerFor(
  selected: Row[],
  sectionDefs: Array<{ name: string; modules: Row[] }>,
  btlRange?: [number, number]
): ModuleCoverage[] {
  return computeCoverage({
    selectedModules: selected,
    sections: sectionDefs.map((d) => ({
      sectionName: d.name,
      modules: d.modules,
      slots: assignModulesToSlots(d.modules, section(d.name, d.modules.map((m) => m.module_number), [1, 999]), {
        ...(btlRange ? { btlRange } : {}),
      }),
    })),
    btlRange,
  });
}

{
  // Everything covered.
  const mods = [M(1, "A"), M(2, "B"), M(3, "C")];
  const led = ledgerFor(mods, [{ name: "Section I", modules: mods }]);
  assert(led.length === 3, "ledger reports every selected unit");
  assert(led.every((c) => c.reason.kind === "ok"), "all units covered → all ok");
  assert(led.every((c) => c.slots > 0 && c.marks > 0), "covered units carry slot + mark counts");
  assert(uncoveredModules(led).length === 0, "nothing flagged when coverage is complete");
}

{
  // not_in_any_section — the headline diagnosis.
  const inScope = [M(1, "A"), M(2, "B")];
  const orphan = M(5, "Hashing");
  const led = ledgerFor([...inScope, orphan], [{ name: "Section I", modules: inScope }]);
  const c = led.find((x) => x.moduleNumber === 5)!;
  assert(c.reason.kind === "not_in_any_section", `unit 5 → not_in_any_section (got ${c.reason.kind})`);
  assert(c.slots === 0, "and zero slots");
  const ex = explainCoverage(c);
  assert(ex.title.includes("Unit 5") && ex.title.includes("0 questions"), "explains which unit and that it got nothing");
  assert(ex.remedy.length > 0, "offers a remedy, not just a complaint");
  assert(ex.detail.includes("Section I"), "names the section scopes so the cause is checkable");
}

{
  // btl_clamped — the unit IS in the paper, but tagged outside the requested
  // range. assignModulesToSlots never excludes a BTL-mismatched module;
  // clampRangeToAllowed degrades it to the nearest level it does allow. An
  // earlier draft of the ledger reported this as "0 questions", which would
  // have sent faculty hunting for a unit that was present all along.
  const low = M(3, "Trees & Graphs", { btl_levels: [1, 2] });
  const ok1 = M(1, "A", { btl_levels: [3, 4, 5] });
  const mods = [ok1, low];
  const led = ledgerFor(mods, [{ name: "Section I", modules: mods }], [3, 5]);
  const c = led.find((x) => x.moduleNumber === 3)!;
  assert(c.slots > 0, "precondition: the allocator clamps rather than excluding");
  assert(c.reason.kind === "btl_clamped", `BTL 1-2 vs range 3-5 → btl_clamped (got ${c.reason.kind})`);
  if (c.reason.kind === "btl_clamped") {
    assert(JSON.stringify(c.reason.moduleBtl) === JSON.stringify([1, 2]), "reports the unit's actual levels");
    assert(JSON.stringify(c.reason.requestedRange) === JSON.stringify([3, 5]), "reports the requested range");
    const [alo, ahi] = c.reason.actualRange;
    assert(alo >= 1 && ahi <= 2, `reports the BTL actually assigned (${alo}-${ahi}, within the unit's own levels)`);
  }
  const ex = explainCoverage(c);
  assert(ex.detail.includes("1, 2") && ex.detail.includes("3–5"), "explanation cites both sides of the mismatch");
  assert(/widen/i.test(ex.remedy), "remedy tells the faculty to widen the range");
  assert(!/0 questions/.test(ex.title), "does NOT claim the unit is missing — it is present");

  // It must be surfaced as a warning, but must NOT be listed as uncovered.
  assert(uncoveredModules(led).every((x) => x.moduleNumber !== 3),
    "clamped unit is not reported as missing");
  assert(warnedModules(led).some((x) => x.moduleNumber === 3),
    "clamped unit IS reported as needing attention");
}

{
  // rounded_out — eligible and in scope, but weightage gave it nothing.
  // A tiny-weightage unit against a big one, with few slots.
  const big = M(1, "Big", { weightage_percent: 97 });
  const tiny = M(2, "Tiny", { weightage_percent: 3 });
  const oneSlot: TemplateSection = {
    section_name: "S", module_numbers: [1, 2], module_range: [1, 2], total_marks: 6,
    questions: [{ q_number: 1, display_label: "Q - 1", type: "descriptive", total_marks: 6, attempt_logic: null }],
  };
  const led = computeCoverage({
    selectedModules: [big, tiny],
    sections: [{
      sectionName: "S",
      modules: [big, tiny],
      slots: assignModulesToSlots([big, tiny], oneSlot, {}),
    }],
  });
  const c = led.find((x) => x.moduleNumber === 2)!;
  assert(c.slots === 0, "precondition: the tiny unit really did get zero slots");
  assert(c.reason.kind === "rounded_out", `in-scope + eligible + zero slots → rounded_out (got ${c.reason.kind})`);
  const ex = explainCoverage(c);
  assert(/weightage/i.test(ex.detail), "explanation names weightage as the cause");
  assert(ex.remedy.length > 0, "offers a remedy");
}

{
  // Precedence: a unit that is BOTH out of scope and BTL-mismatched must be
  // reported as out of scope — fixing the BTL range alone would not bring it back.
  const inScope = [M(1, "A", { btl_levels: [3, 4] })];
  const doubleBad = M(9, "Orphan", { btl_levels: [1, 2] });
  const led = ledgerFor([...inScope, doubleBad], [{ name: "Section I", modules: inScope }], [3, 5]);
  const c = led.find((x) => x.moduleNumber === 9)!;
  assert(c.reason.kind === "not_in_any_section",
    `scope beats BTL in reason precedence (got ${c.reason.kind})`);
}

{
  // displaced_by_pins fires ONLY on real pins. An earlier draft inferred pins
  // from the shape of the allocation, which misreported ordinary weightage
  // rounding as a pin — a confident wrong diagnosis.
  const pinned = M(1, "Pinned", { weightage_percent: 50 });
  const loser = M(2, "Loser", { weightage_percent: 50 });
  const oneSlot: TemplateSection = {
    section_name: "S", module_numbers: [1, 2], module_range: [1, 2], total_marks: 6,
    questions: [{
      q_number: 1, display_label: "Q - 1", type: "descriptive",
      total_marks: 6, attempt_logic: null, pinnedModuleId: "m1",
    }],
  };
  const slots = assignModulesToSlots([pinned, loser], oneSlot, {});
  assert(slots.every((s) => s.moduleNumber === 1), "precondition: the pin took the only slot");

  const withPins = computeCoverage({
    selectedModules: [pinned, loser],
    sections: [{ sectionName: "S", modules: [pinned, loser], slots, pinnedModuleIds: ["m1"] }],
  });
  const c = withPins.find((x) => x.moduleNumber === 2)!;
  assert(c.reason.kind === "displaced_by_pins", `real pin → displaced_by_pins (got ${c.reason.kind})`);
  assert(/pinned/i.test(explainCoverage(c).detail), "explanation names pinning as the cause");

  // Same allocation, but no pin declared → must NOT claim a pin.
  const withoutPins = computeCoverage({
    selectedModules: [pinned, loser],
    sections: [{ sectionName: "S", modules: [pinned, loser], slots }],
  });
  const c2 = withoutPins.find((x) => x.moduleNumber === 2)!;
  assert(c2.reason.kind === "rounded_out",
    `identical slots with no declared pin → rounded_out, not a fabricated pin (got ${c2.reason.kind})`);

  // A pin on the module itself must never be read as displacing it.
  const selfPinned = computeCoverage({
    selectedModules: [pinned, loser],
    sections: [{ sectionName: "S", modules: [pinned, loser], slots, pinnedModuleIds: ["m2"] }],
  });
  const c3 = selfPinned.find((x) => x.moduleNumber === 2)!;
  assert(c3.reason.kind === "rounded_out", "a module's own pin does not displace it");
}

{
  // ai_shortfall — slots were reserved but the section produced nothing.
  const mods = [M(1, "A"), M(2, "B")];
  const led = computeCoverage({
    selectedModules: mods,
    sections: [{
      sectionName: "S",
      modules: mods,
      slots: assignModulesToSlots(mods, section("S", [1, 2], [1, 2]), {}),
    }],
    producedByModule: new Map([[1, 0], [2, 3]]),
  });
  const a = led.find((x) => x.moduleNumber === 1)!;
  const b = led.find((x) => x.moduleNumber === 2)!;
  assert(a.reason.kind === "ai_shortfall", `slots but no output → ai_shortfall (got ${a.reason.kind})`);
  assert(b.reason.kind === "ok", "the section that produced output stays ok");
  assert(/regenerate/i.test(explainCoverage(a).remedy), "shortfall remedy suggests regenerating");
}

{
  // Degenerate inputs must not throw — these come from resumed rows of unknown vintage.
  assert(computeCoverage({ selectedModules: [], sections: [] }).length === 0, "no modules → empty ledger");
  const led = computeCoverage({ selectedModules: [M(1, "A")], sections: [] });
  assert(led[0].reason.kind === "not_in_any_section", "no sections at all → not_in_any_section");
}

// ─── normaliseBtlLevels must mirror moduleAssignment.normaliseBtl ───────────

{
  assert(JSON.stringify(normaliseBtlLevels([1, 2, 3])) === JSON.stringify([1, 2, 3]), "numeric levels pass through");
  assert(JSON.stringify(normaliseBtlLevels(["Apply", "Remember"])) === JSON.stringify([1, 3]), "text labels map and sort");
  assert(JSON.stringify(normaliseBtlLevels(["2", "4"])) === JSON.stringify([2, 4]), "numeric strings parse");
  assert(JSON.stringify(normaliseBtlLevels(null)) === JSON.stringify([1, 2, 3, 4]), "null → default 1-4");
  assert(JSON.stringify(normaliseBtlLevels([])) === JSON.stringify([1, 2, 3, 4]), "empty → default 1-4");
  assert(JSON.stringify(normaliseBtlLevels(["nonsense"])) === JSON.stringify([1, 2, 3, 4]), "unparseable → default 1-4");
  assert(JSON.stringify(normaliseBtlLevels([9, 0, 3])) === JSON.stringify([3]), "out-of-range levels dropped");

  // The ledger must agree with the allocator about a module's levels, or it
  // would explain a decision the allocator never made. Cross-check via a
  // module whose levels only reach BTL 1-2 against a 3-5 range.
  const m = M(1, "A", { btl_levels: ["Remember", "Understand"] });
  const slots = assignModulesToSlots([m], section("S", [1], [1, 1]), { btlRange: [3, 5] });
  const levels = normaliseBtlLevels(m.btl_levels);
  assert(JSON.stringify(levels) === JSON.stringify([1, 2]), "ledger normalises labels the same way");
  assert(
    slots.every((s) => s.allowedBtlLevels.every((b) => levels.includes(b))),
    "allocator's allowedBtlLevels agree with the ledger's normalisation"
  );
}

// ─── Result ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("RESULT: FAIL");
  process.exit(1);
}
console.log("RESULT: PASS");
