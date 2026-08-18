/**
 * GET /api/faculty/analytics/question/[questionId]
 *
 * Deep view on one BANK question: how it has actually performed, per cohort.
 *
 * WHY THE ANSWER KEY IS IN THIS RESPONSE, deliberately:
 * CP-Q3 Part 1 moved answer keys off anything a student can read, and this
 * route hands the correct answer straight back. That is not a regression — it
 * is the same rule seen from the other side. A faculty member cannot judge
 * whether a question is miskeyed (the single most common cause of negative
 * discrimination) without seeing the key. The rule was never "keys are
 * secret"; it was "students must not read keys for questions they are being
 * assessed on". This route is gated to the faculty tier and scoped by
 * assertAnalyticsAccess.
 *
 * CROSS-SUBJECT: a bank question belongs to one subject but can be SERVED into
 * another subject's session (the same reason peerStatCompute scopes its stat
 * by subject). So attempts are grouped by the subject they were served in, and
 * each cohort is included ONLY if the caller has analytics access to that
 * subject. A dean over several subjects sees several rows; a faculty member
 * sees the one they teach. Cohorts the caller cannot access are dropped
 * silently — their existence is not reported, not even as a count.
 */

import { apiError, apiSuccess, requireRole } from "@/lib/api/helpers";
import {
  analyticsAccessResponse,
  assertAnalyticsAccess,
} from "@/lib/analytics/access";
import { pointBiserial, type AttemptRow } from "@/lib/analytics/aggregates";
import { discriminationReading } from "@/lib/analytics/privacy";

interface BankRow {
  id: string;
  subject_id: string;
  module_id: string | null;
  question_text: string;
  question_type: string;
  options: unknown;
  model_answer: string | null;
  numeric_answer: number | null;
  co_code: string | null;
  btl_level: string | null;
  difficulty: string | null;
  marks: number | null;
}

interface OptionShape {
  label?: string;
  text?: string;
  is_correct?: boolean;
}

/** MCQ/MSQ only — the distractor distribution is meaningless for NAT/short. */
const DISTRIBUTION_TYPES = new Set(["mcq", "msq"]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ questionId: string }> }
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

    const { questionId } = await context.params;
    if (!questionId) return apiError("questionId is required", 400);

    const { data: qData, error: qError } = await adminClient
      .from("faculty_question_bank")
      .select(
        "id, subject_id, module_id, question_text, question_type, options, model_answer, numeric_answer, co_code, btl_level, difficulty, marks"
      )
      .eq("id", questionId)
      .maybeSingle();
    if (qError) return apiError(qError.message, 500);
    const question = qData as BankRow | null;
    if (!question) return apiError("Question not found", 404);

    // Access is anchored on the question's OWNING subject first. A caller with
    // no access to that has no business reading the item at all, whatever
    // other cohorts it may have been served into.
    try {
      await assertAnalyticsAccess(
        adminClient,
        user.id,
        profile.role,
        question.subject_id
      );
    } catch (err) {
      const denied = analyticsAccessResponse(err);
      if (denied) return denied;
      throw err;
    }

    const { data: attemptData } = await adminClient
      .from("student_question_attempts")
      .select(
        "student_id, question_id, module_id, question_text, question_type, is_correct, time_taken_seconds, session_id, created_at, subject_id, student_answer"
      )
      .eq("question_id", questionId);

    const attempts = (attemptData ?? []) as Array<
      AttemptRow & { subject_id: string; student_answer: string | null }
    >;

    // Which of the served-into subjects may this caller see?
    const servedSubjectIds = [...new Set(attempts.map((a) => a.subject_id))];
    const accessible: string[] = [];
    for (const sid of servedSubjectIds) {
      try {
        await assertAnalyticsAccess(adminClient, user.id, profile.role, sid);
        accessible.push(sid);
      } catch {
        // Not accessible — this cohort is omitted entirely, including from
        // any total. Reporting "and 2 other cohorts" would leak scope.
      }
    }

    const visible = attempts.filter((a) => accessible.includes(a.subject_id));

    // Session scores for the point-biserial, over visible attempts only.
    const sessionIds = [
      ...new Set(visible.map((a) => a.session_id).filter((s): s is string => !!s)),
    ];
    const sessionScores = new Map<string, number>();
    if (sessionIds.length > 0) {
      const { data: sessions } = await adminClient
        .from("quiz_sessions")
        .select("id, score, total_marks")
        .in("id", sessionIds);
      for (const s of (sessions ?? []) as Array<{
        id: string;
        score: number | null;
        total_marks: number | null;
      }>) {
        if (s.score != null && s.total_marks != null && s.total_marks > 0) {
          sessionScores.set(s.id, s.score / s.total_marks);
        }
      }
    }

    const { data: subjectRows } = await adminClient
      .from("subjects")
      .select("id, name, code")
      .in("id", accessible.length > 0 ? accessible : [question.subject_id]);
    const subjectById = new Map(
      ((subjectRows ?? []) as Array<{ id: string; name: string; code: string }>).map(
        (s) => [s.id, s]
      )
    );

    const cohorts = accessible.map((sid) => {
      const rows = visible.filter((a) => a.subject_id === sid);
      const timesCorrect = rows.filter((r) => r.is_correct === true).length;
      const pairs = rows
        .map((r) => {
          const score = r.session_id ? sessionScores.get(r.session_id) : undefined;
          return score === undefined
            ? null
            : { correct: r.is_correct === true, overallScore: score };
        })
        .filter((p): p is { correct: boolean; overallScore: number } => p !== null);
      const timed = rows
        .map((r) => r.time_taken_seconds)
        .filter((t): t is number => typeof t === "number" && t >= 0);
      const discrimination = pointBiserial(pairs);

      return {
        subject_id: sid,
        subject_name: subjectById.get(sid)?.name ?? null,
        subject_code: subjectById.get(sid)?.code ?? null,
        times_served: rows.length,
        times_correct: timesCorrect,
        accuracy: rows.length > 0 ? timesCorrect / rows.length : null,
        avg_time_seconds:
          timed.length > 0 ? timed.reduce((s, t) => s + t, 0) / timed.length : null,
        discrimination,
        interpretation: discriminationReading(discrimination),
      };
    });

    // ── Wrong-answer distribution (MCQ/MSQ only) ─────────────────────────────
    // The point is misconception patterns: WHICH wrong answer is seducing
    // students. A distractor taking 40% of responses is telling you something
    // specific about what the cohort believes.
    const type = (question.question_type ?? "").toLowerCase();
    let wrongAnswerDistribution: Array<{
      label: string;
      text: string | null;
      is_correct: boolean;
      count: number;
      pct: number;
    }> | null = null;

    if (DISTRIBUTION_TYPES.has(type)) {
      const options = Array.isArray(question.options)
        ? (question.options as OptionShape[])
        : [];
      const answered = visible.filter(
        (a) => a.student_answer != null && a.student_answer !== ""
      );
      const total = answered.length;
      wrongAnswerDistribution = options.map((o, i) => {
        const label = String(o.label ?? String.fromCharCode(65 + i));
        // MSQ answers are stored pipe-joined ("A|C"); an option counts if it
        // appears anywhere in the student's selection.
        const count = answered.filter((a) =>
          (a.student_answer ?? "").split("|").map((s) => s.trim()).includes(label)
        ).length;
        return {
          label,
          text: o.text ?? null,
          is_correct: o.is_correct === true,
          count,
          pct: total > 0 ? Math.round((count / total) * 100) : 0,
        };
      });
    }

    return apiSuccess({
      question: {
        id: question.id,
        subject_id: question.subject_id,
        module_id: question.module_id,
        question_text: question.question_text,
        question_type: question.question_type,
        // Faculty-visible by design — see the header.
        model_answer: question.model_answer,
        numeric_answer: question.numeric_answer,
        options: question.options,
        co_code: question.co_code,
        btl_level: question.btl_level,
        difficulty: question.difficulty,
        marks: question.marks,
      },
      cohorts,
      wrongAnswerDistribution,
    });
  } catch (err) {
    console.error("[faculty/analytics/question] error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
