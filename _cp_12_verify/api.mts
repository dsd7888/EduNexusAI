/**
 * CP-12 verify: rebuilt POST /api/quiz/export against quiz_sessions.
 *
 * 1. Drives a real quick-quiz session (start → answer → submit) for
 *    teststudent@gmail.com — the fixture had zero *completed* sessions, so a
 *    real one is created rather than faked, matching CLAUDE.md's real-DB
 *    convention.
 * 2. Exports it, confirms a real PDF comes back.
 * 3. Unhappy paths: another student's session (403), a non-existent session
 *    (404), an in_progress session (404 — not submitted yet), and two
 *    concurrent export requests on the same completed session (both must
 *    succeed independently, no shared-state corruption).
 */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`;
const BASE = "http://localhost:3000";
const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function sessionFor(email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data) throw new Error(`generateLink failed: ${error?.message}`);
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr || !verified.session) throw new Error(`verifyOtp failed: ${verifyErr?.message}`);
  return verified.session;
}

function cookieValueFor(session: unknown): string {
  return "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
}

async function tokenFor(email: string): Promise<{ accessToken: string; userId: string }> {
  const session = await sessionFor(email);
  return { accessToken: cookieValueFor(session), userId: session.user.id };
}

function authHeaders(cookieValue: string) {
  return {
    "Content-Type": "application/json",
    Cookie: `${COOKIE_NAME}=${cookieValue}`,
  };
}

async function findStudent(email: string) {
  let page = 1;
  while (true) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (!data.users.length) throw new Error(`user not found: ${email}`);
    const u = data.users.find((x) => x.email === email);
    if (u) return u;
    page++;
  }
}

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log(`  ok  ${msg}`);
  } else {
    fail++;
    console.error(`FAIL  ${msg}`);
  }
}

async function driveRealQuickQuiz(accessToken: string, subjectId: string): Promise<string> {
  const startRes = await fetch(`${BASE}/api/assessment/quick`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ subjectIds: [subjectId], questionCount: 3 }),
  });
  const startJson = await startRes.json();
  if (!startRes.ok) throw new Error(`quick start failed: ${startRes.status} ${JSON.stringify(startJson)}`);
  const sessionId: string = startJson.sessionId ?? startJson.data?.sessionId;
  const questions: Array<{ slotId: string; options?: string[] | null }> =
    startJson.questions ?? startJson.data?.questions;
  if (!sessionId || !Array.isArray(questions)) {
    throw new Error(`unexpected quick-start shape: ${JSON.stringify(startJson).slice(0, 300)}`);
  }

  const submitRes = await fetch(`${BASE}/api/assessment/submit`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      sessionId,
      answers: questions.map((q, i) => ({
        questionIndex: i,
        slotId: q.slotId,
        studentAnswer: q.options?.[0] ?? "42",
        timeTakenSeconds: 10,
      })),
    }),
  });
  const submitJson = await submitRes.json();
  if (!submitRes.ok) throw new Error(`submit failed: ${submitRes.status} ${JSON.stringify(submitJson)}`);
  return sessionId;
}

async function main() {
  const student = await findStudent("teststudent@gmail.com");
  const { accessToken } = await tokenFor("teststudent@gmail.com");
  const { accessToken: accessToken2 } = await tokenFor("teststudent2@gmail.com");

  const { data: offerings } = await admin
    .from("subject_offerings")
    .select("subject_id")
    .limit(1);
  const subjectId = offerings?.[0]?.subject_id;
  if (!subjectId) throw new Error("no subject_offerings row found to run a quiz against");

  console.log("── happy path: real completed session ──");
  const sessionId = await driveRealQuickQuiz(accessToken, subjectId);

  const { data: sessionRow } = await admin
    .from("quiz_sessions")
    .select("status")
    .eq("id", sessionId)
    .single();
  assert(sessionRow?.status === "completed", "session status is completed after submit");

  const exportRes = await fetch(`${BASE}/api/quiz/export`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ sessionId }),
  });
  const exportBuf = Buffer.from(await exportRes.arrayBuffer());
  assert(exportRes.status === 200, `export returns 200 (got ${exportRes.status})`);
  assert(
    exportRes.headers.get("content-type") === "application/pdf",
    "export content-type is application/pdf"
  );
  assert(exportBuf.subarray(0, 4).toString("latin1") === "%PDF", "export body is a real PDF (starts with %PDF)");
  assert(exportBuf.length > 1000, `export PDF has real content (${exportBuf.length} bytes)`);

  console.log("── unhappy: wrong student (403) ──");
  const crossRes = await fetch(`${BASE}/api/quiz/export`, {
    method: "POST",
    headers: authHeaders(accessToken2),
    body: JSON.stringify({ sessionId }),
  });
  assert(crossRes.status === 403, `other student's export attempt is 403 (got ${crossRes.status})`);

  console.log("── unhappy: nonexistent session (404) ──");
  const missingRes = await fetch(`${BASE}/api/quiz/export`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ sessionId: "00000000-0000-0000-0000-000000000000" }),
  });
  assert(missingRes.status === 404, `nonexistent session is 404 (got ${missingRes.status})`);

  console.log("── unhappy: in_progress session (404, not submitted) ──");
  const { data: inProgressRows } = await admin
    .from("quiz_sessions")
    .select("id")
    .eq("student_id", student.id)
    .eq("status", "in_progress")
    .limit(1);
  if (inProgressRows && inProgressRows.length > 0) {
    const inProgressRes = await fetch(`${BASE}/api/quiz/export`, {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ sessionId: inProgressRows[0].id }),
    });
    assert(inProgressRes.status === 404, `in_progress session export is 404 (got ${inProgressRes.status})`);
  } else {
    console.log("  (skipped — no leftover in_progress session found)");
  }

  console.log("── unhappy: malformed body (400) ──");
  const malformedRes = await fetch(`${BASE}/api/quiz/export`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({}),
  });
  assert(malformedRes.status === 400, `missing sessionId is 400 (got ${malformedRes.status})`);

  console.log("── concurrent: two overlapping exports on the same session ──");
  const [c1, c2] = await Promise.all([
    fetch(`${BASE}/api/quiz/export`, {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ sessionId }),
    }),
    fetch(`${BASE}/api/quiz/export`, {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ sessionId }),
    }),
  ]);
  assert(c1.status === 200 && c2.status === 200, `both concurrent exports succeed (${c1.status}, ${c2.status})`);
  const b1 = Buffer.from(await c1.arrayBuffer());
  const b2 = Buffer.from(await c2.arrayBuffer());
  assert(b1.length > 1000 && b2.length > 1000, "both concurrent exports return real, independent PDFs");

  console.log("── analytics: totalQuizAttempts field (faculty dashboard dependency) ──");
  const { data: assignedFaculty } = await admin
    .from("faculty_assignments")
    .select("faculty_id")
    .eq("subject_id", subjectId)
    .limit(1);
  if (assignedFaculty && assignedFaculty.length > 0) {
    const { data: facultyProfile } = await admin
      .from("profiles")
      .select("id, email")
      .eq("id", assignedFaculty[0].faculty_id)
      .single();
    const { accessToken: facultyToken } = await tokenFor(facultyProfile!.email);
    const analyticsRes = await fetch(`${BASE}/api/analytics`, {
      headers: authHeaders(facultyToken),
    });
    const analyticsJson = await analyticsRes.json();
    assert(analyticsRes.status === 200, `analytics route returns 200 for faculty (got ${analyticsRes.status})`);
    assert(
      typeof analyticsJson.totalQuizAttempts === "number",
      `analytics response has numeric totalQuizAttempts (got ${JSON.stringify(analyticsJson.totalQuizAttempts)})`
    );
    // This faculty IS assigned to the subject the fixture just quizzed in —
    // confirms the count is real, not just present-but-always-zero (which is
    // exactly how the dead-table bug used to look, since quiz_attempts/quizzes
    // were never written to).
    assert(
      analyticsJson.totalQuizAttempts >= 1,
      `totalQuizAttempts reflects the real session just completed (got ${analyticsJson.totalQuizAttempts})`
    );
  } else {
    console.log("  (skipped — no faculty assigned to test subject)");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("VERIFY SCRIPT ERROR:", err);
  process.exit(1);
});
