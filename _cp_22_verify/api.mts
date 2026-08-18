/**
 * CP-22 verify — `setup_complete` without CGPA.
 *
 * Bug: POST /api/placement/profile accepted `setup_complete: true` with no
 * validation that `cgpa` (existing or in the same request) was ever set. A
 * profile could end up `setup_complete: true, cgpa: null` forever — every
 * downstream `isDriveEligible`/`computeCompanyFit` call then silently
 * coalesces `cgpa ?? 0`, so the student fails every CGPA-gated drive without
 * ever being told their CGPA is missing (indistinguishable from an actual
 * 0.0 CGPA).
 *
 * Fix: reject `setup_complete: true` with 400 unless the effective CGPA
 * (request body value, falling back to the existing row) is a real number
 * in [0, 10].
 *
 * This harness snapshots the test student's existing profile row, drives it
 * to a null-cgpa state, then asserts the route rejects `setup_complete:true`
 * without a CGPA, accepts it once a valid CGPA is supplied, and exercises a
 * concurrent + an interrupted flow. Original row state is restored on exit,
 * including on SIGINT/SIGTERM/SIGPIPE/SIGHUP.
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
const STUDENT_EMAIL = "teststudent@gmail.com";

const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

let studentId: string | undefined;
let originalRow: Record<string, unknown> | null = null;
let hadRow = false;

async function restore() {
  if (!studentId) return;
  if (hadRow && originalRow) {
    await admin
      .from("student_placement_profiles")
      .update(originalRow)
      .eq("student_id", studentId);
    console.log("[cleanup] restored original profile row");
  } else {
    await admin.from("student_placement_profiles").delete().eq("student_id", studentId);
    console.log("[cleanup] deleted row created by this harness (none existed before)");
  }
}

for (const sig of ["SIGINT", "SIGTERM", "SIGPIPE", "SIGHUP"] as const) {
  process.on(sig, () => {
    restore().finally(() => process.exit(1));
  });
}

async function main() {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: STUDENT_EMAIL,
  });
  if (error || !data) throw new Error(`generateLink failed: ${error?.message}`);
  studentId = data.user.id;

  const { data: existing } = await admin
    .from("student_placement_profiles")
    .select("*")
    .eq("student_id", studentId)
    .maybeSingle();
  hadRow = !!existing;
  originalRow = existing ?? null;

  // Drive to a clean null-cgpa, setup_complete:false starting state.
  await admin
    .from("student_placement_profiles")
    .upsert(
      { student_id: studentId, cgpa: null, setup_complete: false, primary_target: "service_it" },
      { onConflict: "student_id" }
    );

  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr || !verified.session)
    throw new Error(`verifyOtp failed: ${verifyErr?.message}`);
  const cookie =
    `${COOKIE_NAME}=` +
    "base64-" +
    Buffer.from(JSON.stringify(verified.session), "utf8").toString("base64url");

  async function post(body: Record<string, unknown>, signal?: AbortSignal) {
    const res = await fetch(`${BASE}/api/placement/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
      signal,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  let pass = true;

  // 1. setup_complete:true with no cgpa anywhere (row is null from the reset above) -> 400
  const r1 = await post({ setup_complete: true, primary_target: "product" });
  console.log("[no-cgpa] status:", r1.status, JSON.stringify(r1.json));
  if (r1.status !== 400) {
    console.error("FAIL: setup_complete accepted with no CGPA set (expected 400)");
    pass = false;
  } else {
    console.log("PASS: setup_complete rejected with no CGPA set");
  }

  // Confirm the row was NOT flipped to setup_complete:true by the rejected call.
  const { data: afterReject } = await admin
    .from("student_placement_profiles")
    .select("setup_complete, cgpa")
    .eq("student_id", studentId)
    .maybeSingle();
  if (afterReject?.setup_complete === true) {
    console.error("FAIL: row shows setup_complete:true despite the 400 rejection");
    pass = false;
  } else {
    console.log("PASS: row still setup_complete:false/null after rejection —", afterReject);
  }

  // 2. Out-of-range cgpa (e.g. 15) alongside setup_complete:true -> 400
  const r2 = await post({ setup_complete: true, cgpa: 15 });
  console.log("[out-of-range] status:", r2.status, JSON.stringify(r2.json));
  if (r2.status !== 400) {
    console.error("FAIL: setup_complete accepted with out-of-range CGPA (expected 400)");
    pass = false;
  } else {
    console.log("PASS: setup_complete rejected with out-of-range CGPA");
  }

  // 3. Valid cgpa in the same request -> 200, and setup_complete actually true
  const r3 = await post({ setup_complete: true, cgpa: 8.2, primary_target: "product" });
  console.log("[valid] status:", r3.status, JSON.stringify(r3.json));
  if (r3.status !== 200 || r3.json?.profile?.setup_complete !== true || r3.json?.profile?.cgpa !== 8.2) {
    console.error("FAIL: valid setup_complete request did not succeed as expected");
    pass = false;
  } else {
    console.log("PASS: setup_complete succeeded once a valid CGPA was supplied");
  }

  // Reset to null-cgpa state again for the remaining checks.
  await admin
    .from("student_placement_profiles")
    .update({ cgpa: null, setup_complete: false })
    .eq("student_id", studentId);

  // 4. Concurrent flow — one request with cgpa, one without, fired together.
  const [cGood, cBad] = await Promise.all([
    post({ setup_complete: true, cgpa: 7.5 }),
    post({ setup_complete: true }),
  ]);
  console.log("[concurrent good]", cGood.status, "[concurrent bad]", cBad.status);
  // Order of arrival at the DB is not guaranteed, but the no-cgpa request must
  // never be accepted regardless of race outcome, and at least one 400 must appear
  // whenever a request omitting cgpa lands after cgpa is still unset.
  if (cBad.status === 200 && cBad.json?.profile?.cgpa == null) {
    console.error("FAIL: concurrent no-cgpa request succeeded while cgpa remained null");
    pass = false;
  } else {
    console.log("PASS: concurrent no-cgpa request did not silently complete setup with null cgpa");
  }

  // Reset again before the interrupted-flow check.
  await admin
    .from("student_placement_profiles")
    .update({ cgpa: null, setup_complete: false })
    .eq("student_id", studentId);

  // 5. Interrupted flow — abort a request mid-flight, then confirm a fresh
  // request against the same route still behaves correctly (server not wedged).
  const ac = new AbortController();
  const abortedPromise = post({ setup_complete: true, cgpa: 9.1 }, ac.signal).catch((e) => ({
    aborted: true,
    message: String(e),
  }));
  ac.abort();
  const abortedResult = await abortedPromise;
  console.log("[interrupted] result:", abortedResult);
  const retry = await post({ setup_complete: true });
  if (retry.status !== 400) {
    console.error("FAIL: route did not recover cleanly after an aborted request (retry expected 400, no-cgpa)");
    pass = false;
  } else {
    console.log("PASS: route recovered cleanly after a client-aborted request and still validates CGPA");
  }

  console.log(pass ? "\n=== CP-22 VERIFY: ALL PASS ===" : "\n=== CP-22 VERIFY: FAILURES ===");
  await restore();
  process.exit(pass ? 0 : 1);
}

main().catch(async (err) => {
  console.error("harness error:", err);
  await restore();
  process.exit(1);
});
