/**
 * GET /api/assessment/session/[id]
 *
 * Resume. A student who refreshed mid-quiz rejoins the SAME questions rather
 * than triggering a fresh generation — which would cost real money and, worse,
 * would pull from the bank again, burning questions the 30-day exclusion is
 * supposed to be protecting.
 *
 * There is no partial-submit path in CP-Q2: a session is either finished or
 * abandoned. This route therefore returns the served questions and the
 * session's clock, never a half-graded state.
 *
 * ⚠ INVARIANT (CP-Q3 Part 1): THIS ROUTE MUST NEVER RETURN ANSWER-KEY DATA in
 * any response shape, not even to the owning student, and not even for a
 * completed session. It does not read `quiz_session_keys` at all — grading
 * happens server-side in /api/assessment/submit and /api/assessment/answer, and
 * results come back from those. Two rules follow, and both are load-bearing:
 *   - never spread `session.config` into the response; enumerate fields, as
 *     below. A spread would ship whatever a future writer added to config.
 *   - if resume ever needs to show already-revealed answers (immediate-feedback
 *     modes), read them from student_question_attempts — the record of what the
 *     student was already told — never from the key.
 */

import { apiError, apiSuccess, requireRole } from "@/lib/api/helpers";
import { MODE_CONFIG } from "@/lib/assessment/presets";
import type { AssessmentMode } from "@/lib/assessment/types";

interface SessionRow {
  id: string;
  student_id: string;
  mode: AssessmentMode;
  subject_ids: string[];
  module_ids: string[] | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  score: number | null;
  total_marks: number | null;
  config: {
    questions?: unknown[];
    time_limit_minutes?: number | null;
    negative_marking?: boolean;
    preset?: string | null;
  } | null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const { id } = await context.params;
    if (!id) return apiError("session id is required", 400);

    const { data, error } = await adminClient
      .from("quiz_sessions")
      .select(
        "id, student_id, mode, subject_ids, module_ids, status, started_at, completed_at, score, total_marks, config"
      )
      .eq("id", id)
      .maybeSingle();
    if (error) return apiError(error.message, 500);
    const session = data as SessionRow | null;
    if (!session) return apiError("Session not found", 404);
    if (session.student_id !== user.id) return apiError("Forbidden", 403);

    const timeLimit = session.config?.time_limit_minutes ?? null;
    const elapsedSeconds = Math.max(
      0,
      Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000)
    );
    const remainingSeconds =
      timeLimit == null ? null : Math.max(0, timeLimit * 60 - elapsedSeconds);

    return apiSuccess({
      sessionId: session.id,
      mode: session.mode,
      status: session.status,
      preset: session.config?.preset ?? null,
      subjectIds: session.subject_ids,
      moduleIds: session.module_ids,
      startedAt: session.started_at,
      completedAt: session.completed_at,
      timeLimitMinutes: timeLimit,
      elapsedSeconds,
      remainingSeconds,
      immediateFeedback: MODE_CONFIG[session.mode].immediateFeedback,
      negativeMarking: session.config?.negative_marking ?? false,
      totalMarks: session.total_marks,
      score: session.score,
      // The stored payload is already the student-safe projection (no answers,
      // no explanations) — studentSafe() at write time, not filtered here.
      questions: session.config?.questions ?? [],
    });
  } catch (err) {
    console.error("[assessment/session]", err);
    return apiError("Internal server error", 500);
  }
}
