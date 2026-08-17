import {
  signInAsStudent,
  waitForServer,
  onSignals,
  makeChecker,
  hr,
  sub,
  sleep,
} from "../src/lib/testing/httpHarness";

const SUBJECT_ID = "b862c433-29d1-4e43-ac54-4a1369a7f195"; // SECE2250, CSE sem3

async function main() {
  await waitForServer();
  const s1 = await signInAsStudent(undefined, undefined, { branch: "CSE", semester: 3 });
  onSignals(async () => s1.cleanup());
  const check = makeChecker();

  try {
    // ── E. NAT dual-gate grading ─────────────────────────────────────────
    hr("E. NAT GRADING — right and wrong numeric input");
    const natGen = await s1.json<any>("/api/assessment/quick", {
      method: "POST",
      body: JSON.stringify({ subjectIds: [SUBJECT_ID], questionCount: 5, questionTypes: ["nat"] }),
    });
    check.check("NAT generate 200", natGen.status === 200, `status=${natGen.status} sourcing=${JSON.stringify(natGen.body?.sourcing)}`);
    const natQuestions = natGen.body?.questions ?? [];
    check.check("NAT questions produced (verifier didn't discard all)", natQuestions.length > 0, `got ${natQuestions.length}, warnings=${JSON.stringify(natGen.body?.warnings)}`);

    if (natQuestions.length > 0) {
      const natSessionId = natGen.body.sessionId;
      const q = natQuestions[0];
      // We don't know the correct answer (student-safe payload) — probe via a
      // clearly-wrong value first (should be marked wrong), then use /submit's
      // response (which reveals correctAnswer) to build a provably-right probe
      // for a second NAT question in the same session, tested via /answer.
      const wrongAns = await s1.json<any>("/api/assessment/answer", {
        method: "POST",
        body: JSON.stringify({ sessionId: natSessionId, slotId: q.slotId, studentAnswer: "-999999.123456", timeTakenSeconds: 3 }),
      });
      check.check("NAT wrong numeric -> isCorrect:false", wrongAns.status === 200 && wrongAns.body?.isCorrect === false, JSON.stringify(wrongAns.body));
      const revealedCorrect = wrongAns.body?.correctAnswer;

      const rightAns = await s1.json<any>("/api/assessment/answer", {
        method: "POST",
        body: JSON.stringify({ sessionId: natSessionId, slotId: q.slotId, studentAnswer: String(revealedCorrect), timeTakenSeconds: 3 }),
      });
      check.check("NAT exact correct numeric (re-answer) -> isCorrect:true", rightAns.status === 200 && rightAns.body?.isCorrect === true, JSON.stringify(rightAns.body));

      // cleanup this session's slots by submitting minimal
      const payload = natQuestions.map((qq: any, i: number) => ({ questionIndex: i, slotId: qq.slotId, studentAnswer: i === 0 ? String(revealedCorrect) : null }));
      await s1.json<any>("/api/assessment/submit", { method: "POST", body: JSON.stringify({ sessionId: natSessionId, answers: payload }) });
    }

    // ── F. TRUE/FALSE round trip (isAnswerCorrect bug, live) ────────────
    sub("F. TRUE/FALSE — live round trip through the real routes");
    const tfGen = await s1.json<any>("/api/assessment/quick", {
      method: "POST",
      body: JSON.stringify({ subjectIds: [SUBJECT_ID], questionCount: 5, questionTypes: ["true_false"] }),
    });
    check.check("true_false generate 200", tfGen.status === 200, `status=${tfGen.status}`);
    const tfQuestions = tfGen.body?.questions ?? [];
    check.check("true_false questions produced", tfQuestions.length > 0, `got ${tfQuestions.length} warnings=${JSON.stringify(tfGen.body?.warnings)}`);
    if (tfQuestions.length > 0) {
      const q = tfQuestions[0];
      console.log("  true_false question shape:", JSON.stringify(q));
      check.check("true_false question ships with NO options array (UI has nothing to render)", q.options === undefined || q.options === null || (Array.isArray(q.options) && q.options.length === 0), `options=${JSON.stringify(q.options)}`);

      // Probe both "True" and "False" as freeform text (what a UI WOULD send if
      // it had options to click — but confirmed above it has none to render).
      const tfSessionId = tfGen.body.sessionId;
      const probeTrue = await s1.json<any>("/api/assessment/answer", {
        method: "POST",
        body: JSON.stringify({ sessionId: tfSessionId, slotId: q.slotId, studentAnswer: "True", timeTakenSeconds: 2 }),
      });
      console.log("  answer 'True' ->", JSON.stringify(probeTrue.body));
      const actualCorrect = probeTrue.body?.correctAnswer;
      check.check(`answering the LITERAL correct text ("${actualCorrect}") grades correct`, probeTrue.body?.isCorrect === (String(actualCorrect).toLowerCase() === "true"), `answered True, correctAnswer=${actualCorrect}, isCorrect=${probeTrue.body?.isCorrect}`);

      const payload = tfQuestions.map((qq: any, i: number) => ({ questionIndex: i, slotId: qq.slotId, studentAnswer: i === 0 ? "True" : null }));
      await s1.json<any>("/api/assessment/submit", { method: "POST", body: JSON.stringify({ sessionId: tfSessionId, answers: payload }) });
    }

    // ── G. EXAM-SIM: mastery non-mutation + timer/submit bypass ─────────
    hr("G. EXAM-SIM — mastery non-mutation & server-side timer enforcement at /submit");
    const examGen = await s1.json<any>("/api/assessment/exam-sim", {
      method: "POST",
      body: JSON.stringify({ subjectIds: [SUBJECT_ID], questionCount: 10, questionTypes: ["mcq"], timeLimit: 1 }), // 1 MINUTE
    });
    check.check("exam-sim generate 200", examGen.status === 200, `status=${examGen.status} body=${JSON.stringify(examGen.body).slice(0,200)}`);
    const examSessionId = examGen.body?.sessionId;
    const examQuestions = examGen.body?.questions ?? [];
    check.check("exam-sim immediateFeedback=false", examGen.body?.immediateFeedback === false, `${examGen.body?.immediateFeedback}`);

    if (examSessionId) {
      const before = await s1.admin.from("student_topic_mastery").select("*").eq("student_id", s1.userId);

      console.log("  waiting 70s for the 1-minute timer to expire (server-side)...");
      await sleep(70_000);

      // First: confirm /answer correctly REJECTS a late write (server-side timer works there).
      const lateAnswer = await s1.json<any>("/api/assessment/answer", {
        method: "POST",
        body: JSON.stringify({ sessionId: examSessionId, slotId: examQuestions[0].slotId, studentAnswer: "A", silent: true, timeTakenSeconds: 3 }),
      });
      check.check("/answer rejects a write after expiry (409)", lateAnswer.status === 409, `status=${lateAnswer.status} body=${JSON.stringify(lateAnswer.body)}`);

      // Now the key test: does /submit ALSO enforce the timer, or does it accept
      // a full late submission carrying answers straight from "client state"
      // (which the answer route never got to see because it 409'd)?
      const latePayload = examQuestions.map((q: any, i: number) => ({ questionIndex: i, slotId: q.slotId, studentAnswer: "A", timeTakenSeconds: 3 }));
      const lateSubmit = await s1.json<any>("/api/assessment/submit", {
        method: "POST",
        body: JSON.stringify({ sessionId: examSessionId, answers: latePayload }),
      });
      check.check(
        "*** /submit should reject a submission after the timer expired, same as /answer ***",
        lateSubmit.status === 409,
        `status=${lateSubmit.status} body=${JSON.stringify(lateSubmit.body).slice(0,300)} — if 200, a student can think past the visible countdown indefinitely as long as they never call /answer again`
      );

      const after = await s1.admin.from("student_topic_mastery").select("*").eq("student_id", s1.userId);
      check.check("exam-sim does NOT mutate student_topic_mastery", (after.data?.length ?? 0) === (before.data?.length ?? 0), `before=${before.data?.length} after=${after.data?.length}`);
      check.check("exam-sim submit response carries no masteryDeltas key", lateSubmit.body?.masteryDeltas === undefined, JSON.stringify(Object.keys(lateSubmit.body ?? {})));
    }

    console.log(`\nSTAGE2 DONE`);
  } finally {
    const notes = await s1.cleanup();
    console.log(`\n[cleanup s1] ${notes}`);
    const summary = check.summary();
    console.log(`\nSUMMARY: ${summary.passed} passed, ${summary.failed} failed`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
