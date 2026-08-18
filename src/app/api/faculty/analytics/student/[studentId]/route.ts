/**
 * GET /api/faculty/analytics/student/[studentId]?subjectId=<id>
 *
 * One student's assessment picture WITHIN ONE SUBJECT the caller teaches.
 *
 * ── 404, NEVER 403 ──────────────────────────────────────────────────────────
 * Every failure mode here returns 404 with the same body: no access to the
 * subject, subject doesn't exist, student doesn't exist, student exists but has
 * never taken a session on this subject. They are indistinguishable on purpose.
 * A faculty member who could tell "403 — exists but not yours" from "404 —
 * no such student" could enumerate the institution's student roster by walking
 * uuids and reading status codes. `analyticsAccessResponse(err, {
 * maskAsNotFound: true })` collapses the authorization outcomes; the explicit
 * 404s below cover the rest. 5xx is NOT masked — an infrastructure failure
 * reported as 404 sends everyone debugging the wrong thing.
 *
 * ── CROSS-FEATURE SCOPING IS THE POINT ──────────────────────────────────────
 * This route returns ASSESSMENT data only. No chat sessions, no chat messages,
 * no placement attempts, no faculty-generated content the student consumed.
 * That is a deliberate product boundary, not an unimplemented feature:
 *
 *   A student talking to the AI tutor is thinking out loud. They ask the
 *   things they would not ask in front of a class — that is most of the value
 *   of having it. If a faculty member can read that transcript, the student
 *   learns to perform for it instead, and the tutor becomes a worse tutor for
 *   the students who need it most.
 *
 * Assessment is different: a quiz is already a thing you submit to be marked.
 * Faculty seeing it changes nothing about how it is used.
 *
 * `_cp_q4_verify/cross_feature_scoping.ts` seeds a student with data in all
 * three surfaces and asserts none of it appears here. Enforced by test, not by
 * convention.
 */

import { apiSuccess, requireRole } from "@/lib/api/helpers";
import {
  analyticsAccessResponse,
  assertAnalyticsAccess,
} from "@/lib/analytics/access";
import { attemptWeightedAccuracy, tallyAttempts } from "@/lib/assessment/aggregation";
import { computeStreak } from "@/lib/assessment/streak";

/** Recent sessions shown on the per-student page. */
const RECENT_SESSION_WINDOW = 8;

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

export async function GET(
  request: Request,
  context: { params: Promise<{ studentId: string }> }
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

    const { studentId } = await context.params;
    const subjectId = new URL(request.url).searchParams.get("subjectId");
    if (!studentId || !subjectId) return notFound();

    // Gate 1: does the caller have analytics access to this subject?
    try {
      await assertAnalyticsAccess(
        adminClient,
        user.id,
        profile.role,
        subjectId
      );
    } catch (err) {
      const denied = analyticsAccessResponse(err, { maskAsNotFound: true });
      if (denied) return denied;
      throw err;
    }

    // Gate 2: has this student actually taken a session on this subject?
    // Both gates must pass, and failing either is the same 404. Without gate 2
    // a faculty member could read any student's name and profile by pairing an
    // arbitrary student id with a subject they legitimately teach.
    const { data: sessionData } = await adminClient
      .from("quiz_sessions")
      .select("id, mode, status, score, total_marks, started_at, completed_at, config")
      .eq("student_id", studentId)
      .contains("subject_ids", [subjectId])
      .order("started_at", { ascending: false });

    const sessions = (sessionData ?? []) as Array<{
      id: string;
      mode: string;
      status: string;
      score: number | null;
      total_marks: number | null;
      started_at: string;
      completed_at: string | null;
      config: { preset?: string | null } | null;
    }>;

    if (sessions.length === 0) return notFound();

    const { data: profileData } = await adminClient
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", studentId)
      .maybeSingle();
    const student = profileData as {
      id: string;
      full_name: string | null;
      email: string | null;
    } | null;
    if (!student) return notFound();

    const completed = sessions.filter((s) => s.status === "completed");

    const [attemptsRes, masteryRes, modulesRes] = await Promise.all([
      adminClient
        .from("student_question_attempts")
        .select("is_correct, module_id, time_taken_seconds")
        .eq("student_id", studentId)
        .eq("subject_id", subjectId)
        .order("created_at", { ascending: false }),
      adminClient
        .from("student_topic_mastery")
        .select("module_id, attempts_count, correct_count, accuracy, current_difficulty, last_practiced_at")
        .eq("student_id", studentId)
        .eq("subject_id", subjectId),
      adminClient
        .from("modules")
        .select("id, name, module_number")
        .eq("subject_id", subjectId),
    ]);

    const attempts = (attemptsRes.data ?? []) as Array<{
      is_correct: boolean | null;
      module_id: string | null;
      time_taken_seconds: number | null;
    }>;
    const mastery = (masteryRes.data ?? []) as Array<{
      module_id: string;
      attempts_count: number;
      correct_count: number;
      accuracy: number | null;
      current_difficulty: string;
      last_practiced_at: string | null;
    }>;
    const modules = (modulesRes.data ?? []) as Array<{
      id: string;
      name: string;
      module_number: number;
    }>;

    // Same shared arithmetic as the student's own mastery hub, so faculty and
    // student are never shown different numbers for the same work.
    const aggregateAccuracy = attemptWeightedAccuracy([tallyAttempts(attempts)]);

    // ── Per-module breakdown, derived from ATTEMPTS, not from mastery rows ───
    //
    // `student_topic_mastery` is written by the /submit write-back, so it is a
    // DERIVED cache, not the record of what happened. Deriving this panel from
    // it made the module breakdown vanish for any student whose attempts exist
    // but whose mastery rows do not — a submit that failed halfway, an attempt
    // written by /answer in a session never submitted, or seeded/imported data.
    // Faculty would see "0 modules practised" next to a non-zero attempt count
    // and have no way to tell that was a bookkeeping artefact rather than the
    // student's actual state.
    //
    // Attempts are the ground truth (they are what the cohort per-module panel
    // is built from too, so the two now agree by construction). Mastery is
    // consulted only for the two fields it alone knows: the adaptive ladder
    // position and the last-practised timestamp.
    //
    // Caught by _cp_q4_verify/cross_feature_scoping.ts.
    const masteryByModule = new Map(mastery.map((m) => [m.module_id, m]));
    const attemptsByModule = new Map<string, typeof attempts>();
    for (const a of attempts) {
      if (!a.module_id) continue;
      const list = attemptsByModule.get(a.module_id);
      if (list) list.push(a);
      else attemptsByModule.set(a.module_id, [a]);
    }

    const perModule = [...modules]
      .sort((a, b) => a.module_number - b.module_number)
      .map((mod) => {
        const rows = attemptsByModule.get(mod.id) ?? [];
        const stm = masteryByModule.get(mod.id);
        const tally = tallyAttempts(rows);
        return {
          module_id: mod.id,
          module_name: mod.name,
          module_number: mod.module_number,
          attempts: tally.attempts,
          correct: tally.correct,
          accuracy: attemptWeightedAccuracy([tally]),
          current_difficulty: stm?.current_difficulty ?? "easy",
          last_practiced_at: stm?.last_practiced_at ?? null,
        };
      })
      .filter((m) => m.attempts > 0);

    // Same streak rules as the student sees. Cohort scale does not change the
    // semantics — the current week is pending, not failing.
    const streak = computeStreak(
      completed.map((s) => s.completed_at ?? s.started_at)
    );

    const lastActive =
      completed.length > 0
        ? (completed[0].completed_at ?? completed[0].started_at)
        : null;

    return apiSuccess({
      student: {
        id: student.id,
        name: student.full_name,
        email: student.email,
      },
      subjectId,
      sessionCount: completed.length,
      aggregateAccuracy,
      attemptCount: attempts.length,
      lastActive,
      streak,
      perModule,
      recentSessions: completed.slice(0, RECENT_SESSION_WINDOW).map((s) => ({
        sessionId: s.id,
        mode: s.mode,
        preset: s.config?.preset ?? null,
        at: s.completed_at ?? s.started_at,
        score: s.score,
        totalMarks: s.total_marks,
        scorePct:
          s.score != null && s.total_marks != null && s.total_marks > 0
            ? Math.round((s.score / s.total_marks) * 100)
            : null,
      })),
    });
  } catch (err) {
    console.error("[faculty/analytics/student] error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
