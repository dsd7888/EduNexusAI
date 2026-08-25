/**
 * CP-QC4 — module coverage floor + carry-forward lock partitioning.
 *
 *   npx tsx _cp_qc4_verify/pure.ts > _cp_qc4_verify/run.log 2>&1
 *
 * No DB, no network, no AI spend.
 */
import {
  assignModulesToSlots,
  type ModuleData,
  type QuestionSlot,
} from "../src/lib/qpaper/moduleAssignment";
import {
  computeCoverage,
  GENERATION_ALLOCATION_DEFAULTS,
} from "../src/lib/qpaper/coverage";
import {
  partitionLockedQuestions,
  restoreLockedQuestions,
  lockedQuestionTexts,
} from "../src/lib/qpaper/carryForward";
import type { TemplateSection } from "../src/lib/qpaper/templates";
import type { AssembledPaper, GeneratedQuestion } from "../src/lib/qpaper/builder";

let pass = 0;
let fail = 0;
function assert(cond: boolean, label: string) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL: ${label}`);
  }
}

const M = (n: number, name: string, w: number, opts: Partial<ModuleData> = {}): ModuleData => ({
  id: `m${n}`, module_number: n, name, description: `${name} content`,
  weightage_percent: w, btl_levels: [1, 2, 3, 4], ...opts,
});

const descriptiveSection = (count: number, marks = 6): TemplateSection => ({
  section_name: "S",
  module_numbers: undefined,
  module_range: [1, 99],
  total_marks: count * marks,
  questions: Array.from({ length: count }, (_, i) => ({
    q_number: i + 1, display_label: `Q - ${i + 1}`, type: "descriptive" as const,
    total_marks: marks, attempt_logic: null,
  })),
});

const counts = (slots: QuestionSlot[]) => {
  const m = new Map<number, number>();
  for (const s of slots) m.set(s.moduleNumber, (m.get(s.moduleNumber) ?? 0) + 1);
  return m;
};

// ─── The floor ──────────────────────────────────────────────────────────────

{
  // A tiny-weightage module rounds to zero without the floor — the exact
  // "selected it, got nothing" case, minus the scoping bug fixed in CP-QC2.
  const mods = [M(1, "Big", 90), M(2, "Tiny", 5), M(3, "Small", 5)];
  const tpl = descriptiveSection(3);

  const without = assignModulesToSlots(mods, tpl, {});
  const cWithout = counts(without);
  const missingWithout = mods.filter((m) => !cWithout.get(m.module_number));
  assert(missingWithout.length > 0,
    `precondition: without the floor at least one unit gets nothing (${missingWithout.length} missing)`);

  const withFloor = assignModulesToSlots(mods, tpl, { ensureModuleFloor: true });
  const cWith = counts(withFloor);
  assert(mods.every((m) => (cWith.get(m.module_number) ?? 0) >= 1),
    "with the floor every unit gets at least one slot");
  assert(withFloor.length === without.length,
    "the floor reassigns slots, it never invents or drops any");
}

{
  // Opt-in: default behaviour must be untouched (this is what keeps the CP-QC0
  // snapshot honest).
  const mods = [M(1, "Big", 90), M(2, "Tiny", 10)];
  const tpl = descriptiveSection(3);
  const a = assignModulesToSlots(mods, tpl, {});
  const b = assignModulesToSlots(mods, tpl, {});
  assert(JSON.stringify(a) === JSON.stringify(b), "allocation is deterministic");
  const floored = assignModulesToSlots(mods, tpl, { ensureModuleFloor: true });
  assert(JSON.stringify(a) !== JSON.stringify(floored) || counts(a).size === mods.length,
    "the flag is what changes behaviour, nothing else");
}

{
  // Not enough slots to go round: forcing the floor would only move the hole,
  // so it must decline and let the ledger explain honestly.
  const mods = [M(1, "A", 25), M(2, "B", 25), M(3, "C", 25), M(4, "D", 25)];
  const tpl = descriptiveSection(2); // 2 slots, 4 modules
  const slots = assignModulesToSlots(mods, tpl, { ensureModuleFloor: true });
  assert(slots.length === 2, "slot count is unchanged when the floor cannot apply");
  const covered = counts(slots).size;
  assert(covered <= 2, "at most 2 units can be covered by 2 slots");

  // And the ledger still reports the uncovered ones with a real reason.
  const led = computeCoverage({
    selectedModules: mods,
    sections: [{ sectionName: "S", modules: mods, slots }],
  });
  const zero = led.filter((c) => c.slots === 0);
  assert(zero.length >= 2, "uncovered units are still reported");
  assert(zero.every((c) => c.reason.kind === "rounded_out"),
    "and attributed to weightage rounding, not silently dropped");
}

{
  // A pinned slot encodes an explicit faculty decision and must never be
  // reassigned to satisfy the floor.
  const mods = [M(1, "Pinned", 50), M(2, "Needy", 50)];
  const tpl: TemplateSection = {
    section_name: "S", module_range: [1, 2], total_marks: 12,
    questions: [
      { q_number: 1, display_label: "Q - 1", type: "descriptive", total_marks: 6, attempt_logic: null, pinnedModuleId: "m1" },
      { q_number: 2, display_label: "Q - 2", type: "descriptive", total_marks: 6, attempt_logic: null, pinnedModuleId: "m1" },
    ],
  };
  const slots = assignModulesToSlots(mods, tpl, { ensureModuleFloor: true });
  assert(slots.every((s) => s.moduleNumber === 1),
    "both pinned slots stay on the pinned unit — the floor does not steal one");
  assert(slots.every((s) => s.pinned === true), "pinned slots are flagged as such");
}

{
  // An OR-alternative must stay on its primary's module, or the two sides of an
  // OR would come from different units.
  const mods = [M(1, "A", 90), M(2, "B", 10)];
  const tpl: TemplateSection = {
    section_name: "S", module_range: [1, 2], total_marks: 12,
    questions: [
      { q_number: 1, display_label: "Q - 1", type: "descriptive_with_or", total_marks: 12, marks_per_part: 6, parts: ["a", "b"], attempt_logic: null },
    ],
  };
  const slots = assignModulesToSlots(mods, tpl, { ensureModuleFloor: true });
  for (const alt of slots.filter((s) => s.isOrAlternative)) {
    const primaryKey = alt.slotKey.replace(/_or$/, "");
    const primary = slots.find((s) => s.slotKey === primaryKey);
    assert(primary != null && primary.moduleNumber === alt.moduleNumber,
      `OR alternative ${alt.slotKey} stays on its primary's unit`);
  }
}

{
  // A reassigned slot must be REBUILT, not have its moduleNumber patched:
  // a slot also carries the module's BTL levels, COs and POs.
  const mods = [
    M(1, "Wide", 95, { btl_levels: [1, 2, 3, 4, 5, 6] }),
    M(2, "Narrow", 5, { btl_levels: [1, 2] }),
  ];
  const tpl = descriptiveSection(3);
  const slots = assignModulesToSlots(mods, tpl, {
    ensureModuleFloor: true,
    moduleCosFn: (n) => (n === 1 ? ["CO1"] : ["CO2"]),
    allCoCodes: ["CO1", "CO2"],
  });
  const needy = slots.find((s) => s.moduleNumber === 2);
  assert(needy != null, "the narrow unit received a slot");
  assert(needy!.moduleName === "Narrow", "slot carries the new unit's name");
  assert(JSON.stringify(needy!.allowedBtlLevels) === JSON.stringify([1, 2]),
    "slot carries the NEW unit's BTL levels, not the donor's");
  assert(needy!.cos.includes("CO2") && !needy!.cos.includes("CO1"),
    "slot carries the new unit's COs");
}

{
  // Per-slot directives belong to the SLOT, not to whichever unit fills it.
  const mods = [M(1, "Big", 95), M(2, "Tiny", 5)];
  const tpl = descriptiveSection(4);
  const slots = assignModulesToSlots(mods, tpl, {
    ensureModuleFloor: true,
    difficultyTargets: [
      { difficulty: "easy", pct: 50 },
      { difficulty: "hard", pct: 50 },
    ],
  });
  assert(slots.every((s) => s.targetDifficulty != null),
    "every slot still carries a difficulty directive after reassignment");
  assert(slots.some((s) => s.moduleNumber === 2), "the floor applied");
}

{
  // Degenerate inputs must not throw.
  assert(assignModulesToSlots([], descriptiveSection(3), { ensureModuleFloor: true }).length === 0,
    "no modules → no slots");
  const one = assignModulesToSlots([M(1, "Only", 100)], descriptiveSection(3), { ensureModuleFloor: true });
  assert(one.length === 3 && one.every((s) => s.moduleNumber === 1),
    "single module keeps every slot");
}

// ─── Preview/generation parity ──────────────────────────────────────────────

{
  // [REGRESSION] Found by browser testing, not by any unit test: the route set
  // ensureModuleFloor while the builder's pre-flight preview did not, so the
  // preview reported "3 of 8 units will get no questions" for a paper that
  // generation would have covered completely. A false warning is worse than no
  // warning — it teaches faculty the panel is noise.
  assert(
    GENERATION_ALLOCATION_DEFAULTS.ensureModuleFloor === true,
    "the shared allocation defaults enable the coverage floor"
  );

  // The property that matters: applying the shared defaults must cover every
  // in-scope unit when the section has room, which is precisely what the
  // preview promises and the route delivers.
  const mods = [M(1, "Big", 90), M(2, "Tiny", 5), M(3, "Small", 5)];
  const tpl = descriptiveSection(3);
  const withDefaults = assignModulesToSlots(mods, tpl, {
    ...GENERATION_ALLOCATION_DEFAULTS,
  });
  const ledger = computeCoverage({
    selectedModules: mods,
    sections: [{ sectionName: "S", modules: mods, slots: withDefaults }],
  });
  assert(
    ledger.every((c) => c.slots > 0),
    "under the shared defaults every in-scope unit is covered (preview and route agree)"
  );

  // And the negative control: WITHOUT the shared defaults the same fixture
  // leaves a unit uncovered. If this ever stops holding, the assertion above
  // is passing for the wrong reason.
  const withoutDefaults = assignModulesToSlots(mods, tpl, {});
  const bare = computeCoverage({
    selectedModules: mods,
    sections: [{ sectionName: "S", modules: mods, slots: withoutDefaults }],
  });
  assert(
    bare.some((c) => c.slots === 0),
    "without the defaults the same fixture DOES leave a unit uncovered (drift is detectable)"
  );
}

// ─── Carry-forward partitioning ─────────────────────────────────────────────

function paperWith(locks: Array<boolean | undefined>): AssembledPaper {
  return {
    universityName: "PPSU", courseCode: "CS101", courseName: "DS",
    duration: 150, totalMarks: 60, instructions: [],
    sections: [{
      section_name: "S", module_range: [1, 4],
      questions: locks.map((locked, i): GeneratedQuestion => ({
        q_number: i + 1, type: "descriptive", total_marks: 6,
        localId: `q-${i}`,
        ...(locked !== undefined ? { locked } : {}),
        parts: [{ label: "a", question: `Q${i}`, marks: 6 }],
      })),
    }],
  };
}

{
  const p = paperWith([true, false, undefined, true]);
  const r = partitionLockedQuestions(p);
  assert(r.locked.length === 2, `two locked questions found (got ${r.locked.length})`);
  assert(r.unlocked.length === 2, "two unlocked");
  assert(r.locked.every((q) => q.locked === true), "only genuinely locked questions are kept");
  assert(r.lockedIds.length === 2 && r.lockedIds.includes("q-0") && r.lockedIds.includes("q-3"),
    "locked ids are reported for the regeneration request");
  assert(!r.allLocked, "not all locked");
  assert(r.hasLocks, "hasLocks is true");
}

{
  const none = partitionLockedQuestions(paperWith([false, undefined]));
  assert(none.locked.length === 0 && !none.hasLocks,
    "no locks → nothing to carry forward (regeneration behaves exactly as before)");
  assert(!none.allLocked, "an unlocked paper is not 'all locked'");
}

{
  // Everything locked: regenerating is a no-op and must be reported as one
  // rather than burning a Pro call to reproduce the same paper.
  const all = partitionLockedQuestions(paperWith([true, true]));
  assert(all.allLocked, "every question locked → allLocked");
  assert(all.unlocked.length === 0, "nothing left to regenerate");
}

{
  const empty = partitionLockedQuestions({
    universityName: "P", courseCode: "C", courseName: "N",
    duration: 1, totalMarks: 0, instructions: [], sections: [],
  });
  assert(!empty.hasLocks && !empty.allLocked && empty.locked.length === 0,
    "an empty paper is safe and is not reported as fully locked");
}

{
  // A locked question with no localId cannot be carried forward reliably, and
  // must be surfaced rather than silently dropped.
  const p = paperWith([true]);
  delete p.sections[0].questions[0].localId;
  const r = partitionLockedQuestions(p);
  assert(r.locked.length === 1, "it is still counted as locked");
  assert(r.lockedIds.length === 0, "but contributes no id");
  assert(r.unidentifiedLocked === 1, "and is reported as unidentifiable");
}

// ─── restoreLockedQuestions ─────────────────────────────────────────────────

function paperWithText(texts: string[], locks: boolean[], marks = 6): AssembledPaper {
  return {
    universityName: "PPSU", courseCode: "CS101", courseName: "DS",
    duration: 150, totalMarks: 60, instructions: [],
    sections: [{
      section_name: "S", module_range: [1, 4],
      questions: texts.map((t, i): GeneratedQuestion => ({
        q_number: i + 1, type: "descriptive", total_marks: marks,
        localId: `q-${i}`,
        ...(locks[i] ? { locked: true } : {}),
        parts: [{ label: "a", question: t, marks }],
      })),
    }],
  };
}

{
  const previous = paperWithText(["KEEP-0", "old-1", "KEEP-2"], [true, false, true]);
  const fresh = paperWithText(["new-0", "new-1", "new-2"], [false, false, false]);

  const r = restoreLockedQuestions(fresh, previous);
  assert(r.restored === 2, `both locked questions carried forward (got ${r.restored})`);
  assert(r.paper.sections[0].questions[0].parts![0].question === "KEEP-0",
    "locked question 0 kept its original content");
  assert(r.paper.sections[0].questions[2].parts![0].question === "KEEP-2",
    "locked question 2 kept its original content");
  assert(r.paper.sections[0].questions[1].parts![0].question === "new-1",
    "the unlocked question WAS regenerated");
  assert(r.unplaceable.length === 0, "nothing unplaceable");
  assert(fresh.sections[0].questions[0].parts![0].question === "new-0",
    "the fresh paper is not mutated");
  assert(r.paper.sections[0].questions[0].locked === true, "locks survive the merge");
}

{
  // No locks → the fresh paper passes through untouched, so regeneration
  // behaves exactly as it did before this feature existed.
  const previous = paperWithText(["a", "b"], [false, false]);
  const fresh = paperWithText(["x", "y"], [false, false]);
  const r = restoreLockedQuestions(fresh, previous);
  assert(r.paper === fresh, "no locks → the fresh paper is returned by reference");
  assert(r.restored === 0, "nothing restored");
}

{
  // Structure changed between generations: a locked question with no
  // compatible slot must be REPORTED, never pasted into a mismatched slot.
  const previous = paperWithText(["KEEP"], [true], 12);
  const fresh = paperWithText(["new"], [false], 6); // different marks
  const r = restoreLockedQuestions(fresh, previous);
  assert(r.restored === 0, "incompatible slot is not overwritten");
  assert(r.unplaceable.length === 1, "the locked question is reported as unplaceable");
  assert(r.paper.sections[0].questions[0].parts![0].question === "new",
    "the fresh question stays in place");
}

{
  // A locked question in a section the new paper no longer has.
  const previous = paperWithText(["KEEP"], [true]);
  previous.sections.push({
    section_name: "S2", module_range: [5, 8],
    questions: [{
      q_number: 2, type: "descriptive", total_marks: 6, localId: "q-x", locked: true,
      parts: [{ label: "a", question: "ORPHAN", marks: 6 }],
    }],
  });
  const fresh = paperWithText(["new"], [false]);
  const r = restoreLockedQuestions(fresh, previous);
  assert(r.unplaceable.some((q) => q.parts?.[0].question === "ORPHAN"),
    "a locked question in a dropped section is reported, not silently lost");
}

{
  // The restored question adopts the NEW slot's identity so it stays
  // addressable (undo, regenerate, lock) in the new paper.
  const previous = paperWithText(["KEEP"], [true]);
  const fresh = paperWithText(["new"], [false]);
  fresh.sections[0].questions[0].localId = "fresh-id";
  const r = restoreLockedQuestions(fresh, previous);
  assert(r.paper.sections[0].questions[0].localId === "fresh-id",
    "restored question takes the new slot's localId");
  assert(r.paper.sections[0].questions[0].parts![0].question === "KEEP",
    "but keeps the preserved content");
}

{
  assert(restoreLockedQuestions(paperWithText(["a"], [false]), null).restored === 0,
    "null previous paper is safe");
}

// ─── lockedQuestionTexts ────────────────────────────────────────────────────

{
  const p = paperWithText(["KEEP-A", "drop", "KEEP-B"], [true, false, true]);
  const texts = lockedQuestionTexts(partitionLockedQuestions(p));
  assert(texts.includes("KEEP-A") && texts.includes("KEEP-B"),
    "locked question text is collected for the AI exclusion list");
  assert(!texts.includes("drop"), "unlocked question text is not excluded");
  assert(new Set(texts).size === texts.length, "the exclusion list is deduped");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("RESULT: FAIL");
  process.exit(1);
}
console.log("RESULT: PASS");
