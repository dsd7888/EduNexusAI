/**
 * Assessment engine — subject-scope check (CP-10).
 *
 * handleAssessmentRequest calls this via an adminClient (service role, bypasses
 * RLS), and until now nothing stood between a student's requested subjectIds
 * and the question bank: /api/assessment/{quick,mastery,exam-sim} would happily
 * generate a real, scored quiz for a subject never offered to the student's
 * branch. Mirrors the student branch-scoping rule in
 * src/lib/notes/access.ts (assertNotesSubjectAccess) — same subject_offerings
 * check, since assessment routes are student-only (no faculty/dean/hod path
 * to port).
 */

import { apiError } from "@/lib/api/helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = { from: (table: string) => any };

/**
 * Verifies every subjectId in the request is offered to the student's branch.
 * Returns null when allowed, or the Response to return when not.
 */
export async function assertAssessmentSubjectAccess(
  adminClient: AdminClient,
  userId: string,
  subjectIds: string[]
): Promise<Response | null> {
  const { data: profile } = await adminClient
    .from("profiles")
    .select("branch")
    .eq("id", userId)
    .maybeSingle();
  const branch = profile?.branch ?? null;
  if (!branch) {
    return apiError("Forbidden: no branch on profile", 403);
  }

  const { data: offerings } = await adminClient
    .from("subject_offerings")
    .select("subject_id")
    .eq("branch", branch)
    .in("subject_id", subjectIds);

  const offered = new Set((offerings ?? []).map((o: { subject_id: string }) => o.subject_id));
  const notOffered = subjectIds.filter((id) => !offered.has(id));
  if (notOffered.length > 0) {
    return apiError("Forbidden: subject is not offered to your branch", 403);
  }
  return null;
}
