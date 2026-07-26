/**
 * CP-Q3 — quick-mode session flow, end to end over real HTTP.
 *
 * Everything here goes through the network and `proxy.ts`, as a real
 * authenticated student holding real @supabase/ssr cookies. That is the point:
 * the engine-level harnesses (CP-Q1/Q2) already prove planAssessment and
 * grading, and could not have caught a broken cookie parse, a wrong status
 * code, or a route that leaks the answer key in its response shape.
 *
 * WHAT IT PROVES
 *   - a quick session can be created, answered, and submitted by a student who
 *     holds nothing but browser cookies;
 *   - immediate feedback has the documented shape, and is CORRECT — one answer
 *     is deliberately right and one deliberately wrong, checked against the
 *     server-side key, so "isCorrect: true" can't pass by always returning true;
 *   - the served questions carry no answer key, and neither does resume;
 *   - submit closes the session, reveals answers, and moves mastery;
 *   - the DB agrees with all of it.
 *
 * ⚠ TWO DELIBERATE DEVIATIONS FROM THE BRIEF, both verified rather than assumed:
 *
 *   1. "3 questions" is NOT what the route serves. `MODE_CONFIG.quick`
 *      (presets.ts) sets `minQuestionCount: 5`, and `clampQuestionCount` raises
 *      any smaller request to 5 and emits a warning. So this harness REQUESTS 3
 *      and asserts the clamp — the real contract — instead of asserting a 3 the
 *      route will never produce.
 *
 *   2. The per-answer latency figure is a RESPONSE BODY field (`ms`), not a
 *      header. `/api/assessment/answer` computes `ms = Date.now() - t0` and
 *      returns it in the JSON; the only header-ish surface is a `console.warn`
 *      above 400ms. latency_measurement.ts reads the body field for the same
 *      reason.
 *
 * Real AI spend: the question bank is thin, so most slots are generated fresh
 * and land in `ai_call_logs` via routeAI's after(). That is intended (CLAUDE.md).
 *
 *   npx tsx _cp_q3_verify/session_flow.ts > out.txt 2>&1
 *
 * Do not pipe this through `head` — SIGPIPE cleanup is registered, but the
 * harness rules say redirect to a file.
 */

import {
  signInAsStudent,
  waitForServer,
  onSignals,
  makeChecker,
  hr,
  sub,
  type StudentSession,
} from "@/lib/testing/httpHarness";

/** Cryptography Fundamentals (CSE) — the subject with the most bank coverage. */
const SUBJECT_ID = process.env.HARNESS_SUBJECT_ID ?? "74e25bc8-d2bc-4a11-8242-e0fefae8f3af";
const REQUESTED_COUNT = 3;
const EXPECTED_COUNT = 5; // clamped up by MODE_CONFIG.quick.minQuestionCount

interface QuickResponse {
  sessionId: string;
  mode: string;
  immediateFeedback: boolean;
  timeLimitMinutes: number | null;
  totalMarks: number;
  questions: Array<{
    slotId: string;
    questionText?: string;
    type?: string;
    options?: string[] | null;
    marks?: number;
  }>;
  warnings: string[];
  sourcing: Record<string, unknown>;
  failed: unknown[];
}

interface AnswerResponse {
  slotId: string;
  isCorrect: boolean;
  correctAnswer: string;
  explanation: string;
  peerStat?: number;
  ms: number;
}

interface SubmitResponse {
  sessionId: string;
  mode: string;
  score: number;
  totalMarks: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  negativeMarksApplied: number;
  perQuestionResults: Array<{
    slotId: string;
    questionIndex: number;
    isCorrect: boolean;
    marksAwarded: number;
    studentAnswer: string | null;
    correctAnswer: string;
    explanation: string;
  }>;
  masteryDeltas?: unknown[];
}

interface KeyEntry {
  slotId: string;
  correctAnswer: string;
  bankQuestionId: string | null;
  subjectId: string;
  moduleId: string | null;
  type: string;
}

async function main() {
  const c = makeChecker();
  await waitForServer();

  const s: StudentSession = await signInAsStudent(undefined, undefined, {
    templateEmail: "teststudent@gmail.com",
  });
  onSignals(s.cleanup);

  try {
    hr("CP-Q3 — SESSION FLOW (quick mode, real HTTP, real student cookies)");
    console.log(`student ${s.email} (${s.userId})`);

    // ── 0. cookie format, empirically ──────────────────────────────────────
    sub("0. @supabase/ssr cookie format actually on the wire");
    const names = s.cookieNames();
    console.log(`  cookies: ${names.join(", ")}`);
    const authNames = names.filter((n) => n.includes("auth-token"));
    c.check(
      "an sb-<ref>-auth-token cookie exists",
      authNames.some((n) => /^sb-[a-z0-9]+-auth-token(\.\d+)?$/.test(n)),
      authNames.join(", ")
    );
    c.check(
      "chunking is consistent (either one bare cookie, or only .N chunks)",
      authNames.length === 1
        ? !authNames[0].match(/\.\d+$/)
        : authNames.every((n) => /\.\d+$/.test(n)),
      authNames.length === 1
        ? "single unchunked cookie — session is under the 3180-char chunk threshold"
        : `${authNames.length} chunks`
    );
    // Prove the route accepts them: an unauthenticated control must 401.
    const unauth = await fetch(`${process.env.HARNESS_BASE_URL ?? "http://localhost:3000"}/api/assessment/landing`, { redirect: "manual" });
    c.eq("unauthenticated control is rejected (401)", unauth.status, 401);

    // ── 1. create the session ──────────────────────────────────────────────
    sub("1. POST /api/assessment/quick");
    const created = await s.json<QuickResponse>("/api/assessment/quick", {
      method: "POST",
      body: JSON.stringify({
        subjectIds: [SUBJECT_ID],
        questionCount: REQUESTED_COUNT,
        questionTypes: ["mcq"],
      }),
    });
    c.eq("status 200", created.status, 200);
    if (created.status !== 200) {
      console.log("  body:", JSON.stringify(created.body).slice(0, 800));
      throw new Error("session creation failed — nothing downstream is meaningful");
    }
    const quiz = created.body;
    console.log(`  created in ${created.ms}ms, sessionId ${quiz.sessionId}`);
    console.log(`  sourcing: ${JSON.stringify(quiz.sourcing)}`);
    if (quiz.warnings.length) console.log(`  warnings: ${JSON.stringify(quiz.warnings)}`);

    c.eq("mode is quick", quiz.mode, "quick");
    c.eq("immediateFeedback is true", quiz.immediateFeedback, true);
    c.eq("no time limit on quick", quiz.timeLimitMinutes, null);
    c.eq(
      `requested ${REQUESTED_COUNT} → clamped to the mode minimum ${EXPECTED_COUNT}`,
      quiz.questions.length,
      EXPECTED_COUNT
    );
    c.check(
      "the clamp is announced in warnings, not silent",
      quiz.warnings.some((w) => w.includes("minimum")),
      quiz.warnings.find((w) => w.includes("minimum")) ?? "(no minimum warning)"
    );
    c.check(
      "every question has a slotId",
      quiz.questions.every((q) => typeof q.slotId === "string" && q.slotId.length > 0)
    );

    // ── 2. the served payload carries no answer key ────────────────────────
    sub("2. student-safe projection");
    const servedBlob = JSON.stringify(quiz);
    c.check(
      "no `correctAnswer` anywhere in the create response",
      !servedBlob.includes("correctAnswer")
    );
    c.check(
      "no `explanation` anywhere in the create response",
      !servedBlob.includes("explanation")
    );

    // Positive control (CLAUDE.md four-assertion template, #2): the key DOES
    // exist server-side. Without this, "no correctAnswer in the response" would
    // pass identically against a session that has no key at all.
    const { data: keyRow, error: keyErr } = await s.admin
      .from("quiz_session_keys")
      .select("key")
      .eq("session_id", quiz.sessionId)
      .maybeSingle();
    const key = ((keyRow as { key?: KeyEntry[] } | null)?.key ?? []) as KeyEntry[];
    c.check("positive control: service role CAN read the session key", !keyErr && key.length > 0, `${key.length} entries`);
    c.eq("key covers every served question", key.length, quiz.questions.length);

    // And the student holding real cookies still cannot (RLS).
    const asStudent = await s.client
      .from("quiz_session_keys")
      .select("key")
      .eq("session_id", quiz.sessionId);
    c.check(
      "student client reads [] from quiz_session_keys, with NO error",
      (asStudent.data?.length ?? 0) === 0 && !asStudent.error,
      `rows=${asStudent.data?.length ?? 0} error=${asStudent.error?.message ?? "none"}`
    );

    // ── 3. resume shape ────────────────────────────────────────────────────
    sub("3. GET /api/assessment/session/[id] (resume)");
    const resume = await s.json<Record<string, unknown>>(
      `/api/assessment/session/${quiz.sessionId}`
    );
    c.eq("status 200", resume.status, 200);
    c.eq("status is in_progress", (resume.body as { status?: string }).status, "in_progress");
    c.eq("resume returns the same question count", ((resume.body as { questions?: unknown[] }).questions ?? []).length, EXPECTED_COUNT);
    const resumeBlob = JSON.stringify(resume.body);
    c.check("resume leaks no correctAnswer", !resumeBlob.includes("correctAnswer"));
    c.check("resume leaks no explanation", !resumeBlob.includes("explanation"));

    // ── 4. immediate feedback, deliberately right AND deliberately wrong ───
    sub("4. POST /api/assessment/answer — immediate feedback");
    const bySlot = new Map(key.map((k) => [k.slotId, k]));

    const q0 = quiz.questions[0];
    const k0 = bySlot.get(q0.slotId)!;
    const right = await s.json<AnswerResponse>("/api/assessment/answer", {
      method: "POST",
      body: JSON.stringify({
        sessionId: quiz.sessionId,
        slotId: q0.slotId,
        studentAnswer: k0.correctAnswer,
        timeTakenSeconds: 12,
      }),
    });
    c.eq("status 200", right.status, 200);
    c.eq("a known-correct answer grades correct", right.body.isCorrect, true);
    c.check("correctAnswer is revealed", typeof right.body.correctAnswer === "string" && right.body.correctAnswer.length > 0);
    c.check("explanation is revealed", typeof right.body.explanation === "string" && right.body.explanation.length > 0);
    c.eq("slotId echoes back", right.body.slotId, q0.slotId);
    c.check("`ms` timing field is present in the BODY (not a header)", typeof right.body.ms === "number", `${right.body.ms}ms`);
    c.check(
      "peerStat is a percentage or absent",
      right.body.peerStat === undefined ||
        (typeof right.body.peerStat === "number" && right.body.peerStat >= 0 && right.body.peerStat <= 100),
      String(right.body.peerStat)
    );

    const q1 = quiz.questions[1];
    const k1 = bySlot.get(q1.slotId)!;
    const wrongAnswer =
      (q1.options ?? []).find((o) => o !== k1.correctAnswer) ??
      `${k1.correctAnswer}__definitely_not`;
    const wrong = await s.json<AnswerResponse>("/api/assessment/answer", {
      method: "POST",
      body: JSON.stringify({
        sessionId: quiz.sessionId,
        slotId: q1.slotId,
        studentAnswer: wrongAnswer,
        timeTakenSeconds: 8,
      }),
    });
    c.eq("status 200", wrong.status, 200);
    c.eq("a known-wrong answer grades incorrect", wrong.body.isCorrect, false);
    c.check(
      "the wrong answer still gets the correct answer revealed (quick = immediate feedback)",
      wrong.body.correctAnswer === k1.correctAnswer,
      wrong.body.correctAnswer
    );

    // Attempts landed.
    const { data: midAttempts } = await s.admin
      .from("student_question_attempts")
      .select("id, is_correct, slot:session_id")
      .eq("session_id", quiz.sessionId);
    c.eq("2 attempt rows after 2 per-question answers", (midAttempts ?? []).length, 2);

    // ── 5. submit ──────────────────────────────────────────────────────────
    sub("5. POST /api/assessment/submit");
    const answers = quiz.questions.map((q, i) => {
      const k = bySlot.get(q.slotId)!;
      // First two mirror what was already answered above; the rest are correct,
      // so the expected score is arithmetic rather than whatever the AI produced.
      const studentAnswer =
        i === 1 ? wrongAnswer : k.correctAnswer;
      return { questionIndex: i, slotId: q.slotId, studentAnswer, timeTakenSeconds: 10 };
    });
    const submitted = await s.json<SubmitResponse>("/api/assessment/submit", {
      method: "POST",
      body: JSON.stringify({ sessionId: quiz.sessionId, answers }),
    });
    c.eq("status 200", submitted.status, 200);
    const r = submitted.body;
    console.log(`  score ${r.score}/${r.totalMarks} — ${r.correctCount} right, ${r.wrongCount} wrong, ${r.unansweredCount} unanswered`);

    c.eq("correctCount = 4 of 5 (one deliberate miss)", r.correctCount, EXPECTED_COUNT - 1);
    c.eq("wrongCount = 1", r.wrongCount, 1);
    c.eq("unansweredCount = 0", r.unansweredCount, 0);
    c.eq("no negative marking in quick mode", r.negativeMarksApplied, 0);
    c.eq("perQuestionResults covers every question", r.perQuestionResults.length, EXPECTED_COUNT);
    c.check(
      "submit reveals correctAnswer for every question",
      r.perQuestionResults.every((p) => typeof p.correctAnswer === "string" && p.correctAnswer.length > 0)
    );
    c.check(
      "submit reveals explanation for every question",
      r.perQuestionResults.every((p) => typeof p.explanation === "string")
    );
    c.check(
      "masteryDeltas present — quick mode updates mastery",
      Array.isArray(r.masteryDeltas),
      `${(r.masteryDeltas ?? []).length} delta(s)`
    );
    c.check(
      "score is consistent with the per-question marks",
      Math.abs(r.score - r.perQuestionResults.reduce((a, p) => a + p.marksAwarded, 0)) < 1e-6,
      `${r.score} vs ${r.perQuestionResults.reduce((a, p) => a + p.marksAwarded, 0)}`
    );

    // ── 6. DB state ────────────────────────────────────────────────────────
    sub("6. DB state after submit");
    const { data: sessRow } = await s.admin
      .from("quiz_sessions")
      .select("status, completed_at, score, total_marks, student_id, mode, config")
      .eq("id", quiz.sessionId)
      .maybeSingle();
    const sess = sessRow as {
      status: string;
      completed_at: string | null;
      score: number | null;
      total_marks: number | null;
      student_id: string;
      mode: string;
      config: Record<string, unknown>;
    } | null;
    c.eq("session status is completed", sess?.status, "completed");
    c.check("completed_at is set", !!sess?.completed_at, sess?.completed_at ?? "null");
    c.eq("persisted score matches the response", sess?.score, r.score);
    c.eq("session belongs to this student", sess?.student_id, s.userId);
    c.check(
      "config carries no `key` (CP-Q3 Part 1: the key moved to quiz_session_keys)",
      !JSON.stringify(sess?.config ?? {}).includes('"key"')
    );

    const { data: allAttempts } = await s.admin
      .from("student_question_attempts")
      .select("id, is_correct, question_id, session_id")
      .eq("session_id", quiz.sessionId);
    c.eq(
      "attempts = 2 (per-question) + 5 (submit) = 7 — duplicates are history, by design",
      (allAttempts ?? []).length,
      2 + EXPECTED_COUNT
    );

    const { data: mastery } = await s.admin
      .from("student_topic_mastery")
      .select("id, subject_id, module_id")
      .eq("student_id", s.userId);
    c.check("student_topic_mastery rows were written", (mastery ?? []).length > 0, `${(mastery ?? []).length} row(s)`);

    // ── 7. post-submit invariants ──────────────────────────────────────────
    sub("7. post-submit invariants");
    const resubmit = await s.json("/api/assessment/submit", {
      method: "POST",
      body: JSON.stringify({ sessionId: quiz.sessionId, answers }),
    });
    c.eq("double submit is rejected (409)", resubmit.status, 409);

    const lateAnswer = await s.json("/api/assessment/answer", {
      method: "POST",
      body: JSON.stringify({
        sessionId: quiz.sessionId,
        slotId: q0.slotId,
        studentAnswer: k0.correctAnswer,
      }),
    });
    c.eq("answering a completed session is rejected (409)", lateAnswer.status, 409);

    const otherSession = await s.json("/api/assessment/answer", {
      method: "POST",
      body: JSON.stringify({
        sessionId: "00000000-0000-0000-0000-000000000000",
        slotId: q0.slotId,
        studentAnswer: "x",
      }),
    });
    c.eq("unknown session is 404", otherSession.status, 404);

    // ── summary ────────────────────────────────────────────────────────────
    const { passed, failed } = c.summary();
    hr(`SESSION FLOW: ${passed} passed, ${failed} failed`);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    const notes = await s.cleanup();
    console.log(`\ncleanup: ${notes}`);

    // Verify the cleanup rather than assume it (CLAUDE.md harness rules).
    const residue: string[] = [];
    for (const [table, col] of [
      ["quiz_sessions", "student_id"],
      ["student_question_attempts", "student_id"],
      ["student_topic_mastery", "student_id"],
    ] as const) {
      const { data } = await s.admin.from(table).select("id").eq(col, s.userId);
      if ((data ?? []).length > 0) residue.push(`${table}=${(data ?? []).length}`);
    }
    const { data: prof } = await s.admin.from("profiles").select("id").eq("id", s.userId);
    if ((prof ?? []).length > 0) residue.push("profiles=1");
    console.log(
      residue.length === 0
        ? "residue check: clean — no rows remain for this student"
        : `residue check: LEFTOVER ${residue.join(", ")}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
