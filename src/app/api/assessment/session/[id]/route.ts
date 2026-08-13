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
 *
 * `answeredSlots` (below) is that second rule, now actually implemented rather
 * than only prescribed. It exists because resume was silently discarding a
 * student's progress: answer 3 of 10, navigate away, come back via the landing
 * page's Continue strip, and you landed on question 1 with 0 answered — the
 * rows were in student_question_attempts the whole time, nothing read them.
 * The key remains untouched by this route; the revealed text is persisted at
 * reveal time by /api/assessment/answer (migration 20260813000000).
 *
 * ⚠ THE GATE ON `answeredSlots` IS A MODE GATE, AND IT COVERS `isCorrect` TOO.
 * `student_question_attempts.is_correct` is written for EVERY mode — exam_sim's
 * silent autosave included, since grading and mastery need it. So correctness
 * for an exam_sim session is sitting in a column this route can read, and
 * returning it on resume would hand a student per-question correctness in the
 * middle of a deferred-feedback exam. That is the same integrity hole CP-Q3
 * Part 1 closed, re-opened from a different table. For exam_sim the payload
 * carries `studentAnswer` and nothing else — see `AnsweredSlot`.
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

interface AttemptRow {
  slot_id: string | null;
  student_answer: string | null;
  is_correct: boolean | null;
  time_taken_seconds: number | null;
  correct_answer: string | null;
  explanation: string | null;
  created_at: string;
}

/**
 * One already-answered slot, as resume needs it.
 *
 * Immediate-feedback modes get the full reveal back (this student has already
 * seen all of it). exam_sim gets `studentAnswer` ONLY — no correctness, no key
 * — because the exam is still in progress. Fields are optional rather than
 * nullable so exam_sim's payload does not merely carry `isCorrect: null`: the
 * property is absent from the JSON entirely, which is the shape that cannot be
 * misread by a future client as "answered but not yet graded".
 */
interface AnsweredSlot {
  slotId: string;
  studentAnswer: string | null;
  timeTakenSeconds: number | null;
  isCorrect?: boolean;
  correctAnswer?: string;
  explanation?: string | null;
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

    // ── already-answered slots ─────────────────────────────────────────────
    // Ownership is filtered explicitly as well as by session id: the admin
    // client bypasses RLS, so `session_id` alone would be trusting the id in
    // the URL to be the only thing scoping this read. Ascending by created_at
    // so the reduce below leaves the LATEST row per slot in the map.
    const immediateFeedback = MODE_CONFIG[session.mode].immediateFeedback;
    const { data: attemptData, error: attemptErr } = await adminClient
      .from("student_question_attempts")
      .select(
        "slot_id, student_answer, is_correct, time_taken_seconds, correct_answer, explanation, created_at"
      )
      .eq("session_id", session.id)
      .eq("student_id", user.id)
      .order("created_at", { ascending: true });
    if (attemptErr) return apiError(attemptErr.message, 500);

    // Latest-per-slot. A student can re-answer in exam_sim (and the 30s
    // autosave re-persists), so several rows per slot is the normal case there,
    // not an anomaly. Rows with no slot_id predate migration 20260813000000 and
    // are skipped — such a session resumes exactly as it did before that
    // migration (at question 1), which is the old behaviour, not a new failure.
    const bySlot = new Map<string, AttemptRow>();
    for (const row of (attemptData ?? []) as AttemptRow[]) {
      if (!row.slot_id) continue;
      bySlot.set(row.slot_id, row);
    }

    const answeredSlots: AnsweredSlot[] = Array.from(bySlot.values()).map((row) => {
      const base: AnsweredSlot = {
        slotId: row.slot_id as string,
        studentAnswer: row.student_answer,
        timeTakenSeconds: row.time_taken_seconds,
      };
      // The mode gate. Not a convenience — see the isCorrect warning in the
      // file header. exam_sim falls through with answers only.
      if (!immediateFeedback) return base;
      return {
        ...base,
        isCorrect: row.is_correct ?? false,
        correctAnswer: row.correct_answer ?? "",
        explanation: row.explanation,
      };
    });

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
      immediateFeedback,
      negativeMarking: session.config?.negative_marking ?? false,
      totalMarks: session.total_marks,
      score: session.score,
      // The stored payload is already the student-safe projection (no answers,
      // no explanations) — studentSafe() at write time, not filtered here.
      questions: session.config?.questions ?? [],
      // Only slots this student has actually answered appear here. A slot with
      // no attempt row is OMITTED, never included with null fields — an empty
      // placeholder is indistinguishable from "revealed, but blank" once it
      // reaches the client.
      answeredSlots,
    });
  } catch (err) {
    console.error("[assessment/session]", err);
    return apiError("Internal server error", 500);
  }
}
