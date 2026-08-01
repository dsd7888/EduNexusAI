/**
 * Shared plumbing for the CP-N5 PDF-export harnesses.
 *
 * Re-exports CP-N4's (and, transitively, CP-N2's/CP-N1's) helpers rather than
 * forking them — the same reasoning every prior notes checkpoint's shared.ts
 * gives: the `workAsyncStorage` shim in particular must EXECUTE `after()`
 * rather than discard it, and a second copy is a second copy to keep correct.
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

export { N4_FIXTURES as N5_FIXTURES } from "../_cp_n4_verify/shared";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudentSession } from "@/lib/testing/httpHarness";
import { ensureModuleNotes, type ResolvedSubject } from "../_cp_n2_verify/shared";
import { makeRunInScope } from "../_cp_n1_verify/shared";

/**
 * Guarantees a FRESH subject-scope study_notes row exists by driving the real
 * production path — ensure every module has fresh notes (reusing existing
 * rows; no AI spend unless one is actually missing), then call the real
 * GET /api/notes/subject/:id route as the student. That is the exact
 * precondition a real "Download PDF" click assumes ("the student has already
 * seen the notes"), and it is cheap: assembly is a deterministic join, not a
 * generation (subject-assembler.ts).
 */
export async function ensureFreshSubjectNotes(
  admin: SupabaseClient,
  subject: ResolvedSubject,
  student: StudentSession
): Promise<void> {
  const runInScope = await makeRunInScope();
  await ensureModuleNotes(admin, subject, runInScope);
  const res = await student.json(`/api/notes/subject/${subject.subjectId}`);
  if (res.status !== 200) {
    throw new Error(
      `[cp-n5] could not prime subject notes for ${subject.code}: ${res.status} ${JSON.stringify(
        res.body
      ).slice(0, 200)}`
    );
  }
}
