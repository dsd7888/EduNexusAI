import {
  signInAsStudent,
  waitForServer,
  onSignals,
  makeChecker,
  hr,
  sub,
} from "../src/lib/testing/httpHarness";

const SUBJECT_ID = "b862c433-29d1-4e43-ac54-4a1369a7f195"; // SECE2250, CSE sem3, bank=37 mcq

async function main() {
  await waitForServer();
  const s1 = await signInAsStudent(undefined, undefined, { branch: "CSE", semester: 3 });
  const s2 = await signInAsStudent(undefined, undefined, { branch: "CSE", semester: 3 });
  onSignals(async () => {
    const a = await s1.cleanup();
    const b = await s2.cleanup();
    return `${a}; ${b}`;
  });
  const check = makeChecker();
  let sessionId: string | undefined;
  let questions: any[] = [];

  try {
    // ── A. HAPPY PATH ────────────────────────────────────────────────────
    hr("A. HAPPY PATH — quick mode, bank-sourced MCQ");
    const gen = await s1.json<any>("/api/assessment/quick", {
      method: "POST",
      body: JSON.stringify({ subjectIds: [SUBJECT_ID], questionCount: 5, questionTypes: ["mcq"] }),
    });
    check.check("quick generate 200", gen.status === 200, `status=${gen.status} body=${JSON.stringify(gen.body).slice(0,300)}`);
    sessionId = gen.body?.sessionId;
    questions = gen.body?.questions ?? [];
    check.check("questions.length === 5", questions.length === 5, `got ${questions.length}`);
    check.check("sourcing shows bank not ai_fresh (cost check)", (gen.body?.sourcing?.bank ?? 0) > 0, JSON.stringify(gen.body?.sourcing));
    check.check("questions are student-safe (no correctAnswer leaked)", questions.every((q: any) => q.correctAnswer === undefined), "checked all");

    if (sessionId) {
      // answer first 2 questions with immediate feedback
      for (let i = 0; i < 2; i++) {
        const q = questions[i];
        const ans = await s1.json<any>("/api/assessment/answer", {
          method: "POST",
          body: JSON.stringify({ sessionId, slotId: q.slotId, studentAnswer: "A", timeTakenSeconds: 5 }),
        });
        check.check(`answer q${i} 200 with feedback`, ans.status === 200 && typeof ans.body?.isCorrect === "boolean", JSON.stringify(ans.body).slice(0,200));
      }

      // ── B. RESUME ──────────────────────────────────────────────────────
      sub("B. RESUME — GET session mid-flight");
      const resume = await s1.json<any>(`/api/assessment/session/${sessionId}`);
      check.check("resume 200", resume.status === 200);
      check.check("answeredSlots length === 2", (resume.body?.answeredSlots?.length ?? -1) === 2, JSON.stringify(resume.body?.answeredSlots));

      // finish: submit all 5
      const payload = questions.map((q: any, i: number) => ({ questionIndex: i, slotId: q.slotId, studentAnswer: "A", timeTakenSeconds: 5 }));
      const before = await s1.admin.from("student_topic_mastery").select("*").eq("student_id", s1.userId);
      const submit = await s1.json<any>("/api/assessment/submit", {
        method: "POST",
        body: JSON.stringify({ sessionId, answers: payload }),
      });
      check.check("submit 200", submit.status === 200, JSON.stringify(submit.body).slice(0,300));
      check.check("quick mode returns masteryDeltas", Array.isArray(submit.body?.masteryDeltas), JSON.stringify(submit.body?.masteryDeltas));
      const after = await s1.admin.from("student_topic_mastery").select("*").eq("student_id", s1.userId);
      check.check("quick mode DID mutate student_topic_mastery", (after.data?.length ?? 0) > (before.data?.length ?? -1) || (after.data?.length ?? 0) > 0, `before=${before.data?.length} after=${after.data?.length}`);

      // double-submit
      const resubmit = await s1.json<any>("/api/assessment/submit", {
        method: "POST",
        body: JSON.stringify({ sessionId, answers: payload }),
      });
      check.check("re-submit completed session -> 409", resubmit.status === 409, `status=${resubmit.status}`);
    }

    // ── C. AUTHORIZATION ─────────────────────────────────────────────────
    sub("C. AUTHORIZATION — student2 hitting student1's session");
    if (sessionId) {
      const crossGet = await s2.json<any>(`/api/assessment/session/${sessionId}`);
      check.check("cross-student GET session -> 403", crossGet.status === 403, `status=${crossGet.status} body=${JSON.stringify(crossGet.body).slice(0,150)}`);
      const crossAnswer = await s2.json<any>("/api/assessment/answer", {
        method: "POST",
        body: JSON.stringify({ sessionId, slotId: questions[0]?.slotId, studentAnswer: "A" }),
      });
      check.check("cross-student POST answer -> 403", crossAnswer.status === 403, `status=${crossAnswer.status}`);
      const crossSubmit = await s2.json<any>("/api/assessment/submit", {
        method: "POST",
        body: JSON.stringify({ sessionId, answers: [{ questionIndex: 0, studentAnswer: "A" }] }),
      });
      check.check("cross-student POST submit -> 403", crossSubmit.status === 403, `status=${crossSubmit.status}`);
    }
    const randomSession = await s1.json<any>("/api/assessment/session/00000000-0000-0000-0000-000000000000");
    check.check("nonexistent session -> 404", randomSession.status === 404, `status=${randomSession.status}`);

    // ── D. MALFORMED / BOUNDARY ──────────────────────────────────────────
    hr("D. MALFORMED / BOUNDARY INPUT");
    const emptySubj = await s1.json<any>("/api/assessment/quick", { method: "POST", body: JSON.stringify({ subjectIds: [] }) });
    check.check("empty subjectIds -> 400", emptySubj.status === 400, `status=${emptySubj.status}`);

    const hugeCount = await s1.json<any>("/api/assessment/quick", { method: "POST", body: JSON.stringify({ subjectIds: [SUBJECT_ID], questionCount: 999999, questionTypes: ["mcq"] }) });
    check.check("huge questionCount clamped, not 500/hang", hugeCount.status === 200 || hugeCount.status === 502, `status=${hugeCount.status} count=${hugeCount.body?.questions?.length}`);
    if (hugeCount.status === 200) {
      check.check("huge questionCount clamped to mode max (20)", hugeCount.body?.questions?.length <= 20, `got ${hugeCount.body?.questions?.length}`);
    }

    const negCount = await s1.json<any>("/api/assessment/quick", { method: "POST", body: JSON.stringify({ subjectIds: [SUBJECT_ID], questionCount: -5, questionTypes: ["mcq"] }) });
    check.check("negative questionCount doesn't crash", negCount.status === 200 || negCount.status === 400 || negCount.status === 502, `status=${negCount.status}`);

    const sqlish = await s1.json<any>("/api/assessment/quick", { method: "POST", body: JSON.stringify({ subjectIds: ["'; DROP TABLE quiz_sessions; --"], questionCount: 5 }) });
    check.check("SQL-ish subjectId doesn't 500 / doesn't crash", sqlish.status !== 500, `status=${sqlish.status} body=${JSON.stringify(sqlish.body).slice(0,200)}`);

    const badJson = await s1.fetch("/api/assessment/quick", { method: "POST", body: "{not json", headers: { "content-type": "application/json" } });
    check.check("malformed JSON body doesn't 500", badJson.status !== 500, `status=${badJson.status}`);

    const missingSlot = await s1.json<any>("/api/assessment/answer", { method: "POST", body: JSON.stringify({ sessionId: sessionId ?? "x", slotId: "", studentAnswer: "A" }) });
    check.check("empty slotId -> 400", missingSlot.status === 400, `status=${missingSlot.status}`);

    console.log(`\nHAPPY-PATH/AUTH/BOUNDARY DONE. sessionId=${sessionId}`);
    console.log(`SUBJECT_ID=${SUBJECT_ID}`);
  } finally {
    const na = await s1.cleanup();
    const nb = await s2.cleanup();
    console.log(`\n[cleanup s1] ${na}`);
    console.log(`[cleanup s2] ${nb}`);
    const summary = check.summary();
    console.log(`\nSUMMARY: ${summary.passed} passed, ${summary.failed} failed`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
