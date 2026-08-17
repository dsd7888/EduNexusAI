import {
  signInAsStudent,
  waitForServer,
  onSignals,
  makeChecker,
  hr,
} from "../src/lib/testing/httpHarness";

// A subject the CSE-sem3 student is NOT enrolled in per subject_offerings
// (IDSH2020 sem1, seen earlier in find_subject.ts output — different offering).
const OUT_OF_SCOPE_SUBJECT_ID = "43003036-429f-43f7-b416-f300650a1eab"; // IDSH2020

async function main() {
  await waitForServer();
  const s1 = await signInAsStudent(undefined, undefined, { branch: "CSE", semester: 3 });
  onSignals(async () => s1.cleanup());
  const check = makeChecker();

  try {
    hr("J. SCOPE — student requests a subject outside their branch/semester offering");
    const res = await s1.json<any>("/api/assessment/quick", {
      method: "POST",
      body: JSON.stringify({ subjectIds: [OUT_OF_SCOPE_SUBJECT_ID], questionCount: 5, questionTypes: ["mcq"] }),
    });
    console.log("status:", res.status, "body:", JSON.stringify(res.body).slice(0, 400));
    check.check(
      "generating a quiz for a subject NOT in the student's branch/semester offering is blocked",
      res.status === 400 || res.status === 403 || (res.status === 200 && (res.body?.questions?.length ?? 0) === 0),
      `status=${res.status} questions=${res.body?.questions?.length}`
    );

    if (res.status === 200 && (res.body?.sessionId)) {
      await s1.admin.from("quiz_session_keys").delete().eq("session_id", res.body.sessionId);
      await s1.admin.from("quiz_sessions").delete().eq("id", res.body.sessionId);
    }
  } finally {
    const notes = await s1.cleanup();
    console.log(`\n[cleanup s1] ${notes}`);
    const summary = check.summary();
    console.log(`\nSUMMARY: ${summary.passed} passed, ${summary.failed} failed`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
