/**
 * GET /api/faculty/analytics/subject/[subjectId]/students
 *
 * The roster behind panel 6 of the subject dashboard: name, session count,
 * accuracy, streak, last active — one row per student with data on this
 * subject.
 *
 * ── WHY THIS IS A SEPARATE ROUTE AND NOT PART OF THE SNAPSHOT ───────────────
 * The CP-Q4 spec lists four routes. This is a fifth, and the reason is a
 * privacy boundary rather than a convenience:
 *
 *   `faculty_analytics_snapshots` is a CACHED AGGREGATE. Putting names into it
 *   would mean the institution's student roster, with per-student accuracy,
 *   sits denormalised in a cache row that is refreshed by a cron, read by
 *   every faculty member on the subject, and never expired. An aggregate table
 *   that contains identities is no longer an aggregate table — and the CP-Q4
 *   rule is that names appear ONLY in the students table, which is exactly
 *   this surface.
 *
 * So the roster is computed live, per request, from data the caller is already
 * entitled to read. It is also the correct freshness behaviour: the snapshot
 * may legitimately be two hours old, but "who is in my class and when were
 * they last active" should not be.
 *
 * ACCESS: assertAnalyticsAccess, same as every other analytics route.
 */

import { apiSuccess, requireRole } from "@/lib/api/helpers";
import {
  analyticsAccessResponse,
  assertAnalyticsAccess,
} from "@/lib/analytics/access";
import { attemptWeightedAccuracy, tallyAttempts } from "@/lib/assessment/aggregation";
import { computeStreak } from "@/lib/assessment/streak";
import { MIN_COHORT_FOR_AGGREGATE } from "@/lib/analytics/privacy";

export async function GET(
  _request: Request,
  context: { params: Promise<{ subjectId: string }> }
) {
  try {
    const authResult = await requireRole([
      "faculty",
      "dean",
      "hod",
      "superadmin",
    ]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const { subjectId } = await context.params;

    try {
      await assertAnalyticsAccess(adminClient, user.id, profile.role, subjectId);
    } catch (err) {
      const denied = analyticsAccessResponse(err);
      if (denied) return denied;
      throw err;
    }

    const [sessionsRes, attemptsRes] = await Promise.all([
      adminClient
        .from("quiz_sessions")
        .select("id, student_id, status, started_at, completed_at")
        .contains("subject_ids", [subjectId]),
      adminClient
        .from("student_question_attempts")
        .select("student_id, is_correct")
        .eq("subject_id", subjectId),
    ]);

    const sessions = (
      (sessionsRes.data ?? []) as Array<{
        student_id: string;
        status: string;
        started_at: string;
        completed_at: string | null;
      }>
    ).filter((s) => s.status === "completed");

    const attempts = (attemptsRes.data ?? []) as Array<{
      student_id: string;
      is_correct: boolean | null;
    }>;

    const studentIds = [...new Set(sessions.map((s) => s.student_id))];

    // The roster is names. It is subject to the same cohort floor as the
    // aggregates: below it, "the students table" is a list of two people and
    // their scores, which is the thing the floor exists to prevent being
    // casually browsable.
    if (studentIds.length < MIN_COHORT_FOR_AGGREGATE) {
      return apiSuccess({ students: [], cohortBelowFloor: true });
    }

    const { data: profileRows } = await adminClient
      .from("profiles")
      .select("id, full_name")
      .in("id", studentIds);
    const nameById = new Map(
      ((profileRows ?? []) as Array<{ id: string; full_name: string | null }>).map(
        (p) => [p.id, p.full_name]
      )
    );

    const students = studentIds.map((id) => {
      const theirSessions = sessions.filter((s) => s.student_id === id);
      const theirAttempts = attempts.filter((a) => a.student_id === id);
      const dates = theirSessions.map((s) => s.completed_at ?? s.started_at);
      const lastActive = dates
        .slice()
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

      return {
        id,
        name: nameById.get(id) ?? null,
        sessionCount: theirSessions.length,
        // Same shared arithmetic as everywhere else.
        accuracy: attemptWeightedAccuracy([tallyAttempts(theirAttempts)]),
        // Same streak rules the student sees on their own landing page.
        streakWeeks: computeStreak(dates).weeks,
        lastActive: lastActive ?? null,
      };
    });

    return apiSuccess({ students, cohortBelowFloor: false });
  } catch (err) {
    console.error("[faculty/analytics/subject/students] error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
