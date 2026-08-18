/**
 * CP-06 verify — reserve_interview_followup atomic cap on
 * /api/placement/interview/mock/follow-up.
 *
 * Asserts:
 *  1. An 8-way concurrent burst from a fresh student lets AT MOST
 *     REACTIVE_FOLLOWUP_CAP (5) through — was: 8/8 (100% bypass) pre-fix.
 *     Confirmed both via HTTP response codes AND a direct read of
 *     interview_followup_reservations (real, separately-billed Gemini calls
 *     only happen for the ones that got a reservation).
 *  2. Release-on-failure: manually deleting a reservation row (simulating
 *     the route's own delete-on-downstream-failure path) frees the slot for
 *     a subsequent call within the same window.
 *
 * This run costs a handful of real Gemini calls (Flash-tier, maxTokens=500)
 * — unavoidable, this is the exact abuse scenario the checkpoint exists to
 * close and needs a real burst against the real route to prove.
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
const CAP = 5;

let studentId = "";
let preExistingIds: Set<string> = new Set();

async function residueCheck() {
  const { data } = await admin
    .from("interview_followup_reservations")
    .select("id")
    .eq("user_id", studentId);
  const extra = (data ?? []).filter((r) => !preExistingIds.has(r.id as string));
  if (extra.length > 0) {
    await admin
      .from("interview_followup_reservations")
      .delete()
      .in("id", extra.map((r) => r.id));
  }
  console.log(`[cleanup] extra reservation rows removed: ${extra.length}`);
}

for (const sig of ["SIGINT", "SIGTERM", "SIGPIPE", "SIGHUP"] as const) {
  process.on(sig, async () => {
    await residueCheck();
    process.exit(1);
  });
}

async function main() {
  let ok = true;

  const { data: student, error: studentErr } = await admin
    .from("profiles")
    .select("id")
    .eq("email", STUDENT_EMAIL)
    .single();
  if (studentErr || !student) throw new Error(`test student lookup failed: ${studentErr?.message}`);
  studentId = student.id as string;

  const { data: existing } = await admin
    .from("interview_followup_reservations")
    .select("id")
    .eq("user_id", studentId);
  preExistingIds = new Set((existing ?? []).map((r) => r.id as string));
  console.log(`[setup] pre-existing reservation rows for this student in-window: ${preExistingIds.size}`);
  if (preExistingIds.size > 0) {
    console.log("  (these will NOT be touched; burst results are read as new-rows-beyond-this-baseline)");
  }

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

  async function post() {
    const res = await fetch(`${BASE}/api/placement/interview/mock/follow-up`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        student_answer:
          "I built the caching layer using Redis with a write-through strategy to keep latency low.",
        project_context:
          "A distributed job queue system built with Node.js, Redis, and PostgreSQL, handling 10k jobs/day.",
      }),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  // ── 1. 8-way concurrent burst ─────────────────────────────────────────────
  console.log("\n=== 1. 8-way concurrent burst (cap=5) ===");
  const results = await Promise.all(Array.from({ length: 8 }, () => post()));
  const statuses = results.map((r) => r.status);
  console.log("  statuses:", statuses.join(", "));
  const succeeded = statuses.filter((s) => s === 200).length;
  const rejected = statuses.filter((s) => s === 429).length;
  const other = statuses.filter((s) => s !== 200 && s !== 429);
  console.log(`  200s: ${succeeded}, 429s: ${rejected}, other: ${JSON.stringify(other)}`);

  if (other.length > 0) {
    console.error("FAIL: unexpected status code(s) in the burst:", other);
    ok = false;
  }
  if (succeeded > CAP) {
    console.error(`FAIL: ${succeeded} requests got through against a cap of ${CAP} (was 8/8 pre-fix).`);
    ok = false;
  } else {
    console.log(`  PASS: at most ${CAP} succeeded (${succeeded}/${CAP}), not 8/8.`);
  }

  const { data: afterBurst } = await admin
    .from("interview_followup_reservations")
    .select("id, created_at")
    .eq("user_id", studentId);
  const newRows = (afterBurst ?? []).filter((r) => !preExistingIds.has(r.id as string));
  console.log(`  interview_followup_reservations new rows: ${newRows.length}`);
  if (newRows.length !== succeeded) {
    console.error(
      `FAIL: reservation row count (${newRows.length}) should equal the number of 200s (${succeeded}) — a rejected request must never insert a row.`
    );
    ok = false;
  } else {
    console.log("  PASS: reservation row count matches accepted-request count exactly.");
  }
  if (newRows.length > CAP) {
    console.error(`FAIL: ${newRows.length} reservation rows written against a cap of ${CAP}.`);
    ok = false;
  }

  // ── 2. Release-on-failure mechanism ───────────────────────────────────────
  console.log("\n=== 2. Release-on-failure frees a slot ===");
  // At this point the window is at cap (assuming succeeded === CAP). Manually
  // delete one reservation the burst created, simulating the route's own
  // catch-block cleanup on a downstream AI/parse failure, then confirm a
  // fresh request can now succeed where it would otherwise 429.
  if (newRows.length >= CAP) {
    const toDelete = newRows[0].id;
    const { error: delErr } = await admin
      .from("interview_followup_reservations")
      .delete()
      .eq("id", toDelete);
    if (delErr) {
      console.error("FAIL: could not delete a reservation row to simulate release:", delErr.message);
      ok = false;
    } else {
      const freed = await post();
      console.log("  status after freeing one slot:", freed.status);
      if (freed.status !== 200) {
        console.error("FAIL: expected 200 after a slot was freed by release-on-failure, got", freed.status);
        ok = false;
      } else {
        console.log("  PASS: a released reservation correctly frees a slot for a subsequent call.");
      }
    }
  } else {
    console.log(`  SKIPPED: burst only filled ${newRows.length}/${CAP} slots, nothing to release-test against a full cap.`);
  }

  await residueCheck();

  if (!ok) {
    console.error("\nCP-06 VERIFY: FAIL");
    process.exitCode = 1;
    return;
  }
  console.log("\nCP-06 VERIFY: PASS");
}

main().catch(async (err) => {
  console.error("VERIFY ERROR:", err);
  await residueCheck();
  process.exitCode = 1;
});
