/**
 * The access spine for faculty analytics (CP-Q4 Part 1).
 *
 * THE ONE INVARIANT, stated once, enforced in one function:
 *
 *   A faculty user sees analytics ONLY for subjects in their
 *   faculty_assignments. Dean/HOD see analytics only for subjects within
 *   their role_scope. Superadmin sees everything. No exceptions.
 *
 * Every faculty analytics route calls assertAnalyticsAccess() before its first
 * read. That is grep-verifiable, and deliberately so:
 *
 *   grep -rn "assertAnalyticsAccess" src/app/api/faculty/analytics
 *
 * must return a hit for every route file under that directory. A route that
 * reads first and checks later would still pass a functional test — the check
 * would just be decorative — so the enforcement is positional, not incidental.
 *
 * WHY THIS EXISTS SEPARATELY FROM assertSubjectAccess()
 *
 * `src/lib/api/subjectAccess.ts` short-circuits on `role !== "faculty"` —
 * dean, hod and superadmin all bypass it entirely. That is correct for the
 * surfaces it guards (lesson plans, syllabus, audits): those are FACULTY
 * CONTENT, and oversight roles are meant to see all of it (§4).
 *
 * Analytics is not faculty content. It is per-student performance data
 * aggregated at cohort scale, and an unscoped dean read means one person can
 * pull the mastery profile of every student in the institution from one
 * endpoint. So this helper scopes dean/hod through role_scope and FAILS CLOSED
 * when they have no scope rows.
 *
 * Keeping it a separate module (rather than a flag on the shared one) means a
 * future faculty feature that has nothing to do with analytics cannot pick up
 * analytics-specific rules by importing the same function, and equally cannot
 * loosen them for everyone by "fixing" the shared helper for its own case.
 *
 * KNOWN STATE OF role_scope AT PILOT TIME — read this before debugging a 403:
 * the live `role_scope` table exists but is EMPTY, and there are currently no
 * dean/hod profiles (roles present: student, faculty, superadmin). So today
 * this code path is exercised only by faculty and superadmin; the dean/hod
 * branch is verified by seeding both a profile and a role_scope row
 * (_cp_q4_verify/access_invariants.ts). When the first real dean is created,
 * they MUST get a role_scope row or analytics will correctly show them
 * nothing.
 */

import type { createAdminClient } from "@/lib/db/supabase-server";

type AdminClient = ReturnType<typeof createAdminClient>;

/** The subject columns every analytics surface needs for framing/breadcrumbs. */
export interface SubjectRow {
  id: string;
  name: string;
  code: string;
  school: string | null;
  department: string;
  branch: string;
  semester: number;
}

/** Roles permitted to reach any faculty analytics surface at all (§4). */
export const ANALYTICS_TIER_ROLES = [
  "faculty",
  "dean",
  "hod",
  "superadmin",
] as const;

/**
 * Thrown by assertAnalyticsAccess. Carries the HTTP status the route should
 * return, so the mapping from "why access failed" to "what the client sees"
 * lives here rather than being re-decided per route.
 *
 * `status` is 403 for a genuine scope miss and 404 for a subject that does not
 * exist. Routes that must not leak existence (the per-student route, Part 3)
 * catch this and collapse BOTH to 404 — see `analyticsAccessResponse`.
 */
export class AnalyticsAccessError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AnalyticsAccessError";
    this.status = status;
  }
}

/**
 * Assert that `userId` (holding `role`) may read analytics for `subjectId`.
 *
 * Throws AnalyticsAccessError on denial; returns the SubjectRow on success so
 * the caller does not need a second round trip for the subject's name/code.
 *
 * The subject is loaded FIRST because the dean/hod check needs its school and
 * department. Note the ordering consequence: a non-existent subject throws 404
 * before any scope check runs, which is why the "does not leak existence"
 * requirement is handled by the caller collapsing statuses, not by reordering
 * these reads.
 */
export async function assertAnalyticsAccess(
  adminClient: AdminClient,
  userId: string,
  role: string,
  subjectId: string
): Promise<SubjectRow> {
  if (!subjectId) {
    throw new AnalyticsAccessError("Missing subjectId", 400);
  }

  if (!(ANALYTICS_TIER_ROLES as readonly string[]).includes(role)) {
    throw new AnalyticsAccessError(
      "Forbidden: faculty analytics is not available to this role",
      403
    );
  }

  const { data: subject, error } = await adminClient
    .from("subjects")
    .select("id, name, code, school, department, branch, semester")
    .eq("id", subjectId)
    .maybeSingle();

  if (error) {
    // A query failure is not an access denial. Surfacing it as 403 would send
    // a faculty user hunting for a permissions problem that doesn't exist.
    throw new AnalyticsAccessError(
      `Failed to load subject: ${error.message}`,
      500
    );
  }
  if (!subject) {
    throw new AnalyticsAccessError("Subject not found", 404);
  }

  const row = subject as SubjectRow;

  // Superadmin: platform-wide, no scope table consulted.
  if (role === "superadmin") return row;

  // Faculty: faculty_assignments ONLY. Not school, not branch, not department
  // (§4 — faculty can be assigned to subjects in any school/branch, so any
  // hierarchy-based shortcut here would be both wrong and wider).
  if (role === "faculty") {
    const { data: assignment } = await adminClient
      .from("faculty_assignments")
      .select("subject_id")
      .eq("faculty_id", userId)
      .eq("subject_id", subjectId)
      .maybeSingle();

    if (!assignment) {
      throw new AnalyticsAccessError(
        "Forbidden: subject is not assigned to this faculty",
        403
      );
    }
    return row;
  }

  // Dean/HOD: role_scope. department IS NULL means the entire school.
  // No matching scope row → denied. An oversight role with no recorded scope
  // has no implicit institution-wide scope here.
  const { data: scopes } = await adminClient
    .from("role_scope")
    .select("school, department")
    .eq("user_id", userId);

  const inScope = (scopes ?? []).some(
    (s: { school: string | null; department: string | null }) =>
      s.school === row.school &&
      (s.department === null || s.department === row.department)
  );

  if (!inScope) {
    throw new AnalyticsAccessError(
      "Forbidden: subject is outside this user's scope",
      403
    );
  }

  return row;
}

/**
 * Convert a thrown AnalyticsAccessError into the Response a route returns.
 *
 * `maskAsNotFound` collapses 403 → 404 for surfaces where the mere DISTINCTION
 * between "exists but you can't see it" and "doesn't exist" is itself a leak.
 * The per-student route (Part 3) uses it: a faculty probing student ids must
 * not be able to enumerate which students exist by reading status codes.
 * 5xx is never masked — an infrastructure failure reported as 404 would send
 * everyone debugging the wrong thing.
 */
export function analyticsAccessResponse(
  err: unknown,
  opts: { maskAsNotFound?: boolean } = {}
): Response | null {
  if (!(err instanceof AnalyticsAccessError)) return null;

  const status =
    opts.maskAsNotFound && err.status < 500 ? 404 : err.status;
  const message = opts.maskAsNotFound && status === 404 ? "Not found" : err.message;

  return Response.json({ error: message }, { status });
}
