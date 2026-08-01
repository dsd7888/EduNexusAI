/**
 * Shared plumbing for the CP-N4 student-notes-UI harnesses.
 *
 * Re-exports CP-N2's helpers rather than forking them. CP-N4 adds no AI calls at
 * all, so the `workAsyncStorage` shim matters here only because `resolveSubject`
 * / `ensureModuleNotes` pull it in transitively — but a second copy would still
 * be a second copy to keep correct.
 *
 * ── WHAT THESE HARNESSES CAN AND CANNOT PROVE ────────────────────────────────
 * CP-N4 is a UI checkpoint, and an HTTP harness cannot click. Two things are
 * therefore verified structurally here and by browser drive in the checkpoint
 * report, and the split is stated rather than blurred:
 *
 *   - sessionStorage is browser-side. `handoff_token.ts` asserts the CONTRACT
 *     (serialisation shape, key format, payload fields) against the real pure
 *     functions the UI calls, and records the consume-once behaviour as a
 *     code-inspection note.
 *   - the PYQ chip cannot be exercised end-to-end at all: `pyq_questions` holds
 *     ZERO rows in dev, so CP-N3 enrichment correctly emits no signal anywhere.
 *     Chip rendering is code-verified and screenshot-verified against a
 *     synthetic signal. Logged in Future_plans.MD under CP-N4 deferrals.
 */
export {
  loadEnvLocal,
  adminClient,
  makeChecker,
  hr,
  sub,
  onSignals,
  makeRunInScope,
  type Checker,
} from "../_cp_n1_verify/shared";

export {
  resolveSubject,
  loadNotes,
  ensureModuleNotes,
  purgeSubjectNotes,
  type ResolvedSubject,
} from "../_cp_n2_verify/shared";

export const N4_FIXTURES = {
  /** Automobile Engineering — 4 modules, CSE/sem 1. Multi-module breakpoints. */
  MULTI_MODULE: "IDME3532",
  /** A branch no seeded subject is offered to, for the wrong-cohort case. */
  FOREIGN_BRANCH: "ECE",
} as const;
