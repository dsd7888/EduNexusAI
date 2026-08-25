/**
 * CP-QC7 — draft "meaningfulness", the rule behind the "Resume your draft?"
 * prompt.
 *
 *   npx tsx _cp_qc7_verify/pure.ts > _cp_qc7_verify/run.log 2>&1
 *
 * The logic under test lives in useQpaperDraft.ts, which is a "use client"
 * React hook and cannot be imported under tsx. The two pure functions are
 * mirrored here EXACTLY; the fixtures are what matter, and they encode the
 * reported bug ("it comes many times") as assertions.
 *
 * No DB, no network, no AI spend.
 */
import {
  defaultBtlRange,
  defaultDifficultyTargets,
  defaultMetadata,
  defaultSourcingMix,
  eseStandardSections,
  quizSection,
  type SourcingMixState,
} from "../src/app/(faculty)/faculty/qpaper/_components/shared";

let pass = 0;
let fail = 0;
function assert(cond: boolean, label: string) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL: ${label}`);
  }
}

// ── Mirrors of useQpaperDraft's internals ──────────────────────────────────
type Snap = {
  selectedSubjectId: string;
  selectedModuleIds: string[];
  meta: ReturnType<typeof defaultMetadata>;
  sections: ReturnType<typeof eseStandardSections>;
  flatLayout: boolean;
  targetMarks: number;
  sourcingMix: SourcingMixState;
  btlRange: [number, number];
  coTargetsPct: Record<string, number>;
  difficultyTargets: { easy: number; medium: number; hard: number };
  preferredBankQuestionIds: string[];
  paper: unknown | null;
};

function stripIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIds);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => k !== "id")
        .map(([k, v]) => [k, stripIds(v)])
    );
  }
  return value;
}

function meaningfulFingerprint(s: Snap): string {
  return JSON.stringify({
    sections: s.sections.map((sec) => ({
      name: sec.name,
      questions: stripIds(sec.questions),
    })),
    meta: { ...s.meta, instructions: s.meta.instructions.map((i) => i.text) },
    flatLayout: s.flatLayout,
    targetMarks: s.targetMarks,
    sourcingMix: s.sourcingMix,
    btlRange: s.btlRange,
    coTargetsPct: s.coTargetsPct,
    difficultyTargets: s.difficultyTargets,
    preferredBankQuestionIds: s.preferredBankQuestionIds,
  });
}

function pristine(sourcingMix: SourcingMixState): Snap {
  return {
    selectedSubjectId: "",
    selectedModuleIds: [],
    meta: defaultMetadata(),
    sections: eseStandardSections(),
    flatLayout: false,
    targetMarks: 60,
    sourcingMix,
    btlRange: defaultBtlRange(),
    coTargetsPct: {},
    difficultyTargets: defaultDifficultyTargets(),
    preferredBankQuestionIds: [],
    paper: null,
  };
}

const PRISTINE_FINGERPRINTS = new Set([
  meaningfulFingerprint(pristine(defaultSourcingMix(false))),
  meaningfulFingerprint(pristine(defaultSourcingMix(true))),
]);

function isMeaningful(s: Snap): boolean {
  if (s.paper !== null) return true;
  return !PRISTINE_FINGERPRINTS.has(meaningfulFingerprint(s));
}

// ─── The reported bug ───────────────────────────────────────────────────────

{
  // [REGRESSION] "Resume your draft? … it comes many times."
  //
  // page.tsx reconciles the sourcing mix against PYQ availability the moment a
  // subject is chosen (100% fresh → 80/20 when the subject HAS past papers).
  // That is the app's doing, not the faculty's. Against a single pristine
  // fingerprint it read as a real edit, so simply selecting a subject created a
  // draft — and every later visit prompted to resume work nobody had done.
  const justPickedSubject = pristine(defaultSourcingMix(false));
  justPickedSubject.selectedSubjectId = "subject-uuid";
  justPickedSubject.selectedModuleIds = ["m1", "m2", "m3"];
  assert(
    !isMeaningful(justPickedSubject),
    "[REGRESSION] selecting a subject alone is NOT a draft worth resuming"
  );

  const afterPyqReconcile = { ...justPickedSubject, sourcingMix: defaultSourcingMix(true) };
  assert(
    !isMeaningful(afterPyqReconcile),
    "[REGRESSION] the app's own PYQ sourcing-mix reconciliation is NOT a draft"
  );

  // Prove the fixture is real: under the OLD single-fingerprint rule this same
  // state WAS treated as meaningful. Without this the assertion above could be
  // passing for the wrong reason.
  const oldRule = new Set([meaningfulFingerprint(pristine(defaultSourcingMix(false)))]);
  assert(
    !oldRule.has(meaningfulFingerprint(afterPyqReconcile)),
    "[REGRESSION] the old single-pristine rule DID mis-classify it (bug reproduced)"
  );
}

// ─── Genuine authoring must still count ────────────────────────────────────

{
  const edited = pristine(defaultSourcingMix(false));
  edited.targetMarks = 75;
  assert(isMeaningful(edited), "changing target marks IS meaningful");
}

{
  const edited = pristine(defaultSourcingMix(false));
  edited.btlRange = [3, 6];
  assert(isMeaningful(edited), "changing the BTL range IS meaningful");
}

{
  const edited = pristine(defaultSourcingMix(false));
  edited.sections = quizSection();
  assert(isMeaningful(edited), "switching to the Quiz structure IS meaningful");
}

{
  const edited = pristine(defaultSourcingMix(false));
  edited.sections[0].questions[0].marks = 99;
  assert(isMeaningful(edited), "editing a question IS meaningful");
}

{
  const edited = pristine(defaultSourcingMix(false));
  edited.coTargetsPct = { CO1: 50, CO2: 50 };
  assert(isMeaningful(edited), "setting CO targets IS meaningful");
}

{
  const edited = pristine(defaultSourcingMix(false));
  edited.difficultyTargets = { easy: 10, medium: 10, hard: 80 };
  assert(isMeaningful(edited), "changing the difficulty split IS meaningful");
}

{
  // A DELIBERATE sourcing change is still caught — the fix must not blanket-
  // exempt the field, only the two app-generated defaults.
  const edited = pristine(defaultSourcingMix(false));
  edited.sourcingMix = { fresh: 50, pyq_style: 25, bank: 25 };
  assert(isMeaningful(edited), "a hand-set sourcing mix IS meaningful");
}

{
  // A generated paper always warrants the prompt, whatever the config looks like.
  const withPaper = pristine(defaultSourcingMix(false));
  withPaper.paper = { sections: [] };
  assert(isMeaningful(withPaper), "a draft holding a generated paper IS meaningful");
}

{
  // Volatile ids must not leak into the fingerprint, or every fresh mount would
  // look like an edit and prompt forever.
  const a = pristine(defaultSourcingMix(false));
  const b = pristine(defaultSourcingMix(false));
  assert(
    meaningfulFingerprint(a) === meaningfulFingerprint(b),
    "two fresh builders fingerprint identically (section/question ids excluded)"
  );
  assert(!isMeaningful(a) && !isMeaningful(b), "and neither is a draft");
}

// ─── Discard suppression ────────────────────────────────────────────────────

{
  // Discard used to only delete the row and null the id, so the next autosave
  // tick re-INSERTED a draft from the same unchanged state and the prompt
  // returned on the next visit — discarding recreated the thing discarded.
  // The hook now records the discarded fingerprint and stays quiet until the
  // state genuinely differs. Modelled here as the same predicate the effect uses.
  const state = pristine(defaultSourcingMix(false));
  state.targetMarks = 75; // meaningful, so it would otherwise be saved
  const discarded = meaningfulFingerprint(state);

  const shouldPersist = (s: Snap, discardedFp: string | null) =>
    isMeaningful(s) &&
    !(discardedFp !== null && meaningfulFingerprint(s) === discardedFp && s.paper === null);

  assert(!shouldPersist(state, discarded), "after discard the same state is NOT re-saved");
  assert(shouldPersist(state, null), "with no discard on record it WOULD be saved");

  const edited = { ...state, targetMarks: 80 };
  assert(shouldPersist(edited, discarded), "a real edit after discard resumes autosaving");

  const generated = { ...state, paper: { sections: [] } };
  assert(
    shouldPersist(generated, discarded),
    "generating a paper always saves, even on discarded config (never lose real output)"
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("RESULT: FAIL");
  process.exit(1);
}
console.log("RESULT: PASS");
