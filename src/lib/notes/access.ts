/**
 * Notes v2 — subject access, mirroring the study_notes RLS policies.
 *
 * WHY THIS EXISTS AT ALL. Both notes routes read and write through an
 * adminClient (service role), which BYPASSES RLS. The policies in
 * 20260730000000_notes_v2.sql therefore protect a student's own browser
 * queries but do nothing for a route handler. Without an explicit check here,
 * `GET /api/notes/module/<any module id>` would serve any module's notes to any
 * authenticated user.
 *
 * WHY IT IS STRICTER THAN /api/chat. The chat route performs no subject-access
 * check — it loads the profile and proceeds. That is a pre-existing gap, not a
 * pattern worth copying into a new surface; notes are per-module study material
 * whose module id is guessable from any subject page.
 *
 * The rules below are deliberately the SAME rules as the RLS policies, so a
 * student who can read a row through PostgREST can read it through the route
 * and vice versa. If one side changes, change both.
 */

import { apiError } from "@/lib/api/helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = { from: (table: string) => any };

export const FACULTY_TIER_ROLES = ["faculty", "dean", "hod"] as const;

/**
 * Read access to a subject's notes.
 *
 *   superadmin  — everything.
 *   student     — subjects OFFERED TO THEIR BRANCH (subject_offerings, branch
 *                 only; semester is a readiness gate in useStudentSubjects, not
 *                 a filter, and the subjects grid shows every semester of the
 *                 branch).
 *   faculty     — faculty_assignments only (§4), never school/branch hierarchy.
 *   dean/hod    — role_scope → subjects.school/department; NULL department
 *                 means the whole school. No role_scope row → no access.
 *
 * Returns null when allowed, or the Response to return when not.
 */
export async function assertNotesSubjectAccess(
  adminClient: AdminClient,
  role: string,
  userId: string,
  subjectId: string
): Promise<Response | null> {
  if (role === "superadmin") return null;

  if (role === "student") {
    const { data: profile } = await adminClient
      .from("profiles")
      .select("branch")
      .eq("id", userId)
      .maybeSingle();
    const branch = profile?.branch ?? null;
    if (!branch) {
      return apiError("Forbidden: no branch on profile", 403);
    }
    const { data: offering } = await adminClient
      .from("subject_offerings")
      .select("subject_id")
      .eq("subject_id", subjectId)
      .eq("branch", branch)
      .limit(1)
      .maybeSingle();
    if (!offering) {
      return apiError("Forbidden: subject is not offered to your branch", 403);
    }
    return null;
  }

  if (role === "faculty") {
    const { data: assignment } = await adminClient
      .from("faculty_assignments")
      .select("subject_id")
      .eq("faculty_id", userId)
      .eq("subject_id", subjectId)
      .maybeSingle();
    if (!assignment) {
      return apiError("Forbidden: subject is not assigned to this faculty", 403);
    }
    return null;
  }

  if (role === "dean" || role === "hod") {
    const { data: subject } = await adminClient
      .from("subjects")
      .select("school, department")
      .eq("id", subjectId)
      .maybeSingle();
    if (!subject) return apiError("Subject not found", 404);

    const { data: scopes } = await adminClient
      .from("role_scope")
      .select("school, department")
      .eq("user_id", userId);

    const permitted = (scopes ?? []).some(
      (s: { school: string | null; department: string | null }) =>
        s.school === subject.school &&
        (s.department === null || s.department === subject.department)
    );
    // Fail closed: a dean with no role_scope row reads nothing, by design —
    // same rule as CP-Q4's analytics access.
    if (!permitted) {
      return apiError("Forbidden: subject is outside your scope", 403);
    }
    return null;
  }

  return apiError("Forbidden", 403);
}

/**
 * Write (regenerate) access. Faculty tier only — students consume notes, they
 * do not decide when the institution pays to rebuild them. Reuses the read
 * rules for the scoping half, so an unassigned faculty is refused exactly as
 * they are for reads.
 */
export async function assertNotesRegenerateAccess(
  adminClient: AdminClient,
  role: string,
  userId: string,
  subjectId: string
): Promise<Response | null> {
  if (role === "superadmin") return null;
  if (!(FACULTY_TIER_ROLES as readonly string[]).includes(role)) {
    return apiError("Forbidden: Faculty only", 403);
  }
  return assertNotesSubjectAccess(adminClient, role, userId, subjectId);
}
