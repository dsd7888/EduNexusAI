/**
 * CP-10 verify — assessment engine subject-scope check
 * (src/lib/assessment/access.ts, wired into handleAssessmentRequest).
 *
 * Before this fix, /api/assessment/{quick,mastery,exam-sim} never checked
 * that the requested subjectIds are offered to the student's branch — a CSE
 * student could request a subject offered only to DS/IT/CEIT and get a real,
 * scored quiz back (200 + N questions). Expect 403 now.
 *
 * Real auth cookie via magiclink -> verifyOtp (same pattern as
 * _cp_09_verify/api.mts).
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

const STUDENT_EMAIL = "teststudent@gmail.com";

let failures = 0;

async function main() {
  const { data: student } = await admin
    .from("profiles")
    .select("id, branch")
    .eq("email", STUDENT_EMAIL)
    .single();
  const userId = student!.id as string;
  const branch = student!.branch as string;
  console.log(`[setup] student ${userId} branch=${branch}`);

  const { data: offeringsAll } = await admin
    .from("subject_offerings")
    .select("subject_id, branch");
  const bySubject = new Map<string, Set<string>>();
  for (const row of offeringsAll ?? []) {
    const set = bySubject.get(row.subject_id) ?? new Set<string>();
    set.add(row.branch);
    bySubject.set(row.subject_id, set);
  }
  const inScopeSubject = [...bySubject.entries()].find(([, branches]) =>
    branches.has(branch)
  )?.[0];
  const outOfScopeSubject = [...bySubject.entries()].find(
    ([, branches]) => !branches.has(branch)
  )?.[0];
  if (!inScopeSubject || !outOfScopeSubject) {
    throw new Error("could not find both an in-scope and out-of-scope subject in DB");
  }
  console.log(`[setup] inScope=${inScopeSubject} outOfScope=${outOfScopeSubject}`);

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: STUDENT_EMAIL,
  });
  if (error || !data) throw new Error(`generateLink failed: ${error?.message}`);
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr || !verified.session) throw new Error(`verifyOtp failed: ${verifyErr?.message}`);
  const cookie =
    `${COOKIE_NAME}=` +
    "base64-" + Buffer.from(JSON.stringify(verified.session), "utf8").toString("base64url");

  async function post(path: string, body: unknown) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }

  function check(label: string, cond: boolean, detail: unknown) {
    if (cond) {
      console.log(`[PASS] ${label}`);
    } else {
      console.error(`[FAIL] ${label}`, detail);
      failures++;
    }
  }

  // 1. Negative: single out-of-scope subject on quick mode -> 403, no questions.
  {
    const { status, json } = await post("/api/assessment/quick", {
      subjectIds: [outOfScopeSubject],
      questionCount: 5,
    });
    check(
      "out-of-scope subject rejected with 403",
      status === 403,
      { status, json }
    );
    check(
      "403 response carries no questions array",
      !(json && Array.isArray((json as { questions?: unknown }).questions)),
      json
    );
  }

  // 2. Positive control: in-scope subject still works (200, real questions).
  {
    const { status, json } = await post("/api/assessment/quick", {
      subjectIds: [inScopeSubject],
      questionCount: 3,
    });
    const questions = (json as { questions?: unknown[] })?.questions;
    check(
      "in-scope subject still succeeds (200)",
      status === 200,
      { status, json }
    );
    check(
      "in-scope subject returns questions",
      Array.isArray(questions) && questions.length > 0,
      json
    );
  }

  // 3. Mixed scope (exam-sim allows multi-subject): one in-scope + one
  //    out-of-scope subjectId in the same request -> whole request rejected,
  //    not silently narrowed to the allowed subject.
  {
    const { status, json } = await post("/api/assessment/exam-sim", {
      subjectIds: [inScopeSubject, outOfScopeSubject],
      questionCount: 10,
    });
    check(
      "mixed in-scope/out-of-scope exam-sim request rejected with 403",
      status === 403,
      { status, json }
    );
  }

  // 4. Concurrent: two simultaneous out-of-scope requests both rejected
  //    (no race lets one slip through before rate-limit/scope state settles).
  {
    const [a, b] = await Promise.all([
      post("/api/assessment/quick", {
        subjectIds: [outOfScopeSubject],
        questionCount: 5,
      }),
      post("/api/assessment/mastery", {
        subjectIds: [outOfScopeSubject],
        questionCount: 5,
      }),
    ]);
    check("concurrent out-of-scope request A rejected", a.status === 403, a);
    check("concurrent out-of-scope request B rejected", b.status === 403, b);
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
