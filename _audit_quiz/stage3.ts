import {
  signInAsStudent,
  waitForServer,
  onSignals,
  makeChecker,
  hr,
  sub,
} from "../src/lib/testing/httpHarness";

const SUBJECT_ID = "b862c433-29d1-4e43-ac54-4a1369a7f195";

async function main() {
  await waitForServer();
  const s1 = await signInAsStudent(undefined, undefined, { branch: "CSE", semester: 3 });
  onSignals(async () => s1.cleanup());
  const check = makeChecker();

  try {
    // ── H. CONCURRENT DOUBLE-SUBMIT ──────────────────────────────────────
    hr("H. CONCURRENCY — two simultaneous /submit calls for the same session");
    const gen = await s1.json<any>("/api/assessment/quick", {
      method: "POST",
      body: JSON.stringify({ subjectIds: [SUBJECT_ID], questionCount: 5, questionTypes: ["mcq"] }),
    });
    const sessionId = gen.body?.sessionId;
    const questions = gen.body?.questions ?? [];
    if (sessionId) {
      const payload = questions.map((q: any, i: number) => ({ questionIndex: i, slotId: q.slotId, studentAnswer: "A" }));
      const before = await s1.admin.from("student_topic_mastery").select("*").eq("student_id", s1.userId);
      const [r1, r2] = await Promise.all([
        s1.json<any>("/api/assessment/submit", { method: "POST", body: JSON.stringify({ sessionId, answers: payload }) }),
        s1.json<any>("/api/assessment/submit", { method: "POST", body: JSON.stringify({ sessionId, answers: payload }) }),
      ]);
      console.log(`  r1: status=${r1.status}`, JSON.stringify(r1.body).slice(0, 150));
      console.log(`  r2: status=${r2.status}`, JSON.stringify(r2.body).slice(0, 150));
      check.check("at most one of the two concurrent submits succeeded with 200", [r1.status, r2.status].filter((s) => s === 200).length <= 1, `statuses=${r1.status},${r2.status}`);

      const { data: attempts } = await s1.admin.from("student_question_attempts").select("id").eq("session_id", sessionId);
      check.check("no duplicate attempt rows from the race (expect exactly 5, one per question)", (attempts?.length ?? -1) === 5, `got ${attempts?.length}`);

      const after = await s1.admin.from("student_topic_mastery").select("*").eq("student_id", s1.userId);
      // mastery deltas are upserts keyed by (student,subject,module) so double-application
      // would show as inflated attempts_count on the mastery rows, not extra rows.
      const beforeMap = new Map((before.data ?? []).map((r: any) => [`${r.subject_id}:${r.module_id}`, r.attempts_count]));
      let doubleApplied = false;
      for (const row of after.data ?? []) {
        const key = `${(row as any).subject_id}:${(row as any).module_id}`;
        const prevCount = beforeMap.has(key) ? beforeMap.get(key) : 0;
        const delta = (row as any).attempts_count - (prevCount ?? 0);
        if (delta > 1) doubleApplied = true;
      }
      check.check("mastery attempts_count incremented by exactly 1 per module, not 2 (race didn't double-write mastery)", !doubleApplied, `after=${JSON.stringify(after.data?.map((r:any)=>({m:r.module_id,a:r.attempts_count})))}`);
    }

    // ── I. LEGACY /api/quiz/export — is it reachable / functional at all? ──
    sub("I. LEGACY /api/quiz/export — orphaned v1 route sanity check");
    const exportTry = await s1.json<any>("/api/quiz/export", {
      method: "POST",
      body: JSON.stringify({ attemptId: "00000000-0000-0000-0000-000000000000" }),
    });
    console.log(`  /api/quiz/export with a random id -> status=${exportTry.status} body=${JSON.stringify(exportTry.body)}`);
    check.check("legacy export route reachable at all (auth doesn't block it outright)", exportTry.status === 404 || exportTry.status === 500, `status=${exportTry.status}`);

    // Does ANY real completed quiz_sessions row have a matching quiz_attempts
    // counterpart the legacy route could actually serve? (already know table is
    // empty from check_dashboard_disconnect.ts, this just confirms end-to-end)
    const { count } = await s1.admin.from("quiz_attempts").select("id", { count: "exact", head: true });
    check.check("quiz_attempts table has ZERO rows platform-wide (legacy export can NEVER succeed for any real session)", (count ?? -1) === 0, `count=${count}`);

    console.log(`\nSTAGE3 DONE`);
  } finally {
    const notes = await s1.cleanup();
    console.log(`\n[cleanup s1] ${notes}`);
    const summary = check.summary();
    console.log(`\nSUMMARY: ${summary.passed} passed, ${summary.failed} failed`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
