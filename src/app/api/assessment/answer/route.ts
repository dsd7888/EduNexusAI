/**
 * POST /api/assessment/answer — grade ONE question, mid-session.
 *
 * WHY THIS IS ITS OWN ROUTE AND NOT A MODE ON /api/assessment/submit
 * Two different semantics deserve two routes. This one is per-question,
 * idempotent-ish, and returns feedback the student sees immediately; submit is
 * once-per-session, closes the session, computes negative marking across the
 * whole paper, and moves mastery. One route with an `if (perQuestion)` branch
 * would have both sets of invariants tangled in one handler, and the exam_sim
 * autosave path (which calls THIS route purely to persist, discarding the
 * response) would be running through session-closing code.
 *
 * Body: { sessionId, slotId, studentAnswer, timeTakenSeconds?, silent? }
 *   silent: true  → persist only, return nothing gradeable. This is what the
 *                   exam_sim 30-second autosave uses. A deferred-feedback mode
 *                   MUST NOT be able to obtain correctness mid-exam, so the
 *                   feedback fields are withheld by the MODE, not by the
 *                   client's honesty (see `immediateFeedback` below).
 *
 * Returns: { isCorrect, correctAnswer, explanation, peerStat? } for the
 * immediate-feedback modes; { recorded: true } otherwise.
 *
 * LATENCY BUDGET: < 200ms. Three costs: one PK lookup on quiz_session_keys
 * (session_id IS the primary key — the cheapest shape available, a deliberate
 * downstream of CP-Q3 Part 1), an in-process correctness compute, and a peer
 * stat that is served from an in-memory cache on all but the first request per
 * question per 5 minutes. Timing is logged per request (see `t0`) so this is
 * measured rather than asserted.
 */

import type { NextRequest } from "next/server";
import { apiError, apiSuccess, requireRole , logCappedError } from "@/lib/api/helpers";
import { isAnswerCorrect } from "@/lib/assessment/grading";
import { MODE_CONFIG } from "@/lib/assessment/presets";
import { loadSessionKey } from "@/lib/assessment/runner";
import type { AssessmentMode } from "@/lib/assessment/types";
import { computePeerStat } from "@/lib/assessment/peerStatCompute";

interface SessionRow {
  id: string;
  student_id: string;
  mode: AssessmentMode;
  status: string;
  config: {
    questions?: Array<{ slotId: string; options?: string[] | null }>;
    time_limit_minutes?: number | null;
  } | null;
  started_at: string;
}

export async function POST(request: NextRequest) {
  const t0 = Date.now();
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const body = (await request.json().catch(() => ({}))) as {
      sessionId?: string;
      slotId?: string;
      studentAnswer?: unknown;
      timeTakenSeconds?: unknown;
      silent?: unknown;
    };

    const sessionId = String(body.sessionId ?? "").trim();
    const slotId = String(body.slotId ?? "").trim();
    if (!sessionId || !slotId) {
      return apiError("sessionId and slotId are required", 400);
    }
    const studentAnswer =
      body.studentAnswer == null ? null : String(body.studentAnswer);
    const timeTakenSeconds =
      typeof body.timeTakenSeconds === "number"
        ? Math.max(0, Math.trunc(body.timeTakenSeconds))
        : null;
    const silent = body.silent === true;

    // ── the session row and the answer key, concurrently ───────────────────
    // Both are keyed by sessionId alone and neither reads the other's data, so
    // the sequential shape was costing a full round trip for nothing. On a
    // student's mobile connection every serialised trip is amplified, so the
    // independent ones are issued together.
    //
    // WHAT IS *NOT* PARALLELISABLE HERE, and why — do not "finish the job":
    //   - the peer stat needs `entry.bankQuestionId` / `entry.subjectId`, which
    //     come OUT of the key. It is data-dependent on this pair, not a third
    //     sibling, so it cannot join this Promise.all.
    //   - the peer stat must also stay BEFORE the attempt insert. That ordering
    //     is load-bearing (see the comment at its call site): parallelising the
    //     two would race the student's own answer into the statistic they are
    //     shown.
    // Fetching the key before ownership/status/timer checks have run only ever
    // costs one wasted read on a rejected request; the key is not returned, and
    // every guard below still fires in exactly the same order with exactly the
    // same status codes.
    const [sessionResult, key] = await Promise.all([
      adminClient
        .from("quiz_sessions")
        .select("id, student_id, mode, status, config, started_at")
        .eq("id", sessionId)
        .maybeSingle(),
      loadSessionKey(adminClient, sessionId),
    ]);

    const { data: sessionData, error: sessionErr } = sessionResult;
    if (sessionErr) return apiError(sessionErr.message, 500);
    const session = sessionData as SessionRow | null;
    if (!session) return apiError("Session not found", 404);
    // The admin client bypasses RLS, which is exactly why ownership is checked
    // explicitly here.
    if (session.student_id !== user.id) return apiError("Forbidden", 403);
    if (session.status !== "in_progress") {
      return apiError(
        session.status === "completed"
          ? "This session has already been submitted"
          : "This session is no longer active",
        409
      );
    }

    // ── timer enforcement (server-side, authoritative) ─────────────────────
    // A timed session's clock lives on the server. A client whose tab was
    // suspended, whose system clock is wrong, or which has been tampered with
    // does not get to answer after time is up.
    const limit = session.config?.time_limit_minutes ?? null;
    if (limit != null) {
      const elapsed = (Date.now() - new Date(session.started_at).getTime()) / 1000;
      if (elapsed > limit * 60 + 5) {
        // 5s grace absorbs request latency on an answer sent right at the
        // buzzer — a network hop should not cost a student a question.
        return apiError("Time is up for this session", 409);
      }
    }

    // `key` was fetched above, concurrently with the session row.
    const entry = key.find((k) => k.slotId === slotId);
    if (!entry) return apiError("Unknown slotId for this session", 400);

    const optionCount = session.config?.questions?.find((q) => q.slotId === slotId)
      ?.options?.length;

    const isCorrect = isAnswerCorrect(entry, studentAnswer, optionCount);

    // ── peer stat, BEFORE writing this attempt ─────────────────────────────
    // Order matters: computing after the insert would fold the student's own
    // answer into the stat they are shown, so a correct answer would nudge
    // "62% got this right" upward by their own doing.
    const peerStat =
      !silent && MODE_CONFIG[session.mode].immediateFeedback
        ? (await computePeerStat(adminClient, entry.bankQuestionId, entry.subjectId))
            .pct
        : null;

    // ── persist the attempt ────────────────────────────────────────────────
    // One row per answer submission. Re-answering a question in exam_sim
    // (autosave, or a student changing their mind) writes another row; the
    // final grade comes from /submit reading the session key against the last
    // submitted answers, so duplicates here are history, not double-counting.
    //
    // RESUME STATE (20260813000000). Three columns exist so that
    // GET /api/assessment/session/[id] can rebuild a half-finished session
    // WITHOUT reading quiz_session_keys — the invariant that route is built
    // around (CP-Q3 Part 1). This is the write side of its own doc comment's
    // prescription: "read them from student_question_attempts — the record of
    // what the student was already told — never from the key."
    //
    //   slot_id — every mode. It is not answer-key data (the client sends it in
    //     this very request body), and exam_sim needs it MOST: it is the only
    //     mode where a student can re-answer, so the only one producing several
    //     rows per slot, and resolving latest-per-slot is exactly its job.
    //   correct_answer / explanation — immediate-feedback modes ONLY. This is
    //     the same `entry` data the response below is about to hand this
    //     student, so persisting it is not new exposure. But exam_sim's
    //     30-second autosave calls this route (silent:true) purely to persist
    //     progress, and must never deposit correctness or explanations into
    //     this table for an in-progress exam, even latently — that would break
    //     the no-mid-exam-feedback invariant through a side door.
    //
    // Gated on the MODE, not on `silent`: `silent` controls what this response
    // returns, while the mode is what decides whether this student is entitled
    // to have been told at all.
    const immediateFeedback = MODE_CONFIG[session.mode].immediateFeedback;
    const { error: insertErr } = await adminClient
      .from("student_question_attempts")
      .insert({
        student_id: user.id,
        question_id: entry.bankQuestionId,
        subject_id: entry.subjectId,
        module_id: entry.moduleId,
        question_text: entry.questionText,
        question_type: entry.type,
        student_answer: studentAnswer,
        is_correct: isCorrect,
        time_taken_seconds: timeTakenSeconds,
        source: entry.source,
        session_id: sessionId,
        slot_id: slotId,
        correct_answer: immediateFeedback ? entry.correctAnswer : null,
        explanation: immediateFeedback ? entry.explanation : null,
      });
    if (insertErr) {
      // Non-fatal, same policy as /submit: losing a history row is bad, losing
      // the feedback the student is waiting on is worse.
      console.warn(`[assessment/answer] attempt insert failed: ${insertErr.message}`);
    }

    const ms = Date.now() - t0;
    if (ms > 400) {
      // Logged, not thrown. The budget is 200ms; 400 is the "look at this"
      // line so a regression shows up in logs before a student feels it.
      console.warn(`[assessment/answer] slow response: ${ms}ms (session ${sessionId})`);
    }

    // ── response ───────────────────────────────────────────────────────────
    // Feedback is gated on the MODE, never on the request. An exam_sim client
    // asking nicely for the answer key still gets nothing.
    if (silent || !MODE_CONFIG[session.mode].immediateFeedback) {
      return apiSuccess({ recorded: true, slotId, ms });
    }

    return apiSuccess({
      slotId,
      isCorrect,
      correctAnswer: entry.correctAnswer,
      explanation: entry.explanation,
      ...(peerStat != null ? { peerStat } : {}),
      ms,
    });
  } catch (err) {
    logCappedError("[assessment/answer]", err, { route: request.nextUrl?.pathname, httpMethod: "POST" });
    return apiError("Internal server error", 500);
  }
}
