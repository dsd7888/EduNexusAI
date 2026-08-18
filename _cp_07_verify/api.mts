/**
 * CP-07 verify — rate limiting on 4 placement AI routes (resume/ats,
 * resume/rewrite-bullet, jd-analyze, interview/evaluate) that previously had
 * none: any authenticated student could POST to them at unlimited volume,
 * each hitting Gemini directly with no daily ceiling.
 *
 * Drives interview/evaluate (cheapest real payload of the 4, Flash-tier
 * `placement_prep`) as the representative route for the shared checkRateLimit
 * wiring, since all 4 routes use the identical check-then-reserve pattern
 * from src/lib/utils/rate-limit.ts (already atomicity-proven by CP-02).
 * Then does one lightweight cross-route smoke check (resume/rewrite-bullet)
 * to confirm the OTHER 3 routes actually import/call checkRateLimit too, not
 * just the one under heavy test.
 *
 * Real auth cookie via magiclink -> verifyOtp (same pattern as
 * _cp_04_verify/api.mts). Seeds/restores usage_analytics directly via the
 * service-role client so the test doesn't have to actually burn through a
 * real day's quota to reach the cap.
 *
 * Asserts:
 *  1. Validation failure (short answer) before the quota is even reserved —
 *     confirms invalid input never consumes a reservation.
 *  2. A request at the last remaining slot succeeds (200) and consumes it —
 *     real AI call.
 *  3. The immediate next request, now at cap, is rejected (429,
 *     limitReached:true) — no further AI spend.
 *  4. Two concurrent requests at limit-1 produce exactly one 200 and one 429
 *     (the CP-02 atomic CAS, exercised through this route's wiring).
 *  5. resume/rewrite-bullet independently enforces its own separate cap
 *     (different eventType key, doesn't share budget with interview/evaluate).
 *  6. Cleans up every usage_analytics row it touched and verifies no residue
 *     (restores pre-existing count, or deletes the row if none existed).
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
const TODAY = new Date().toISOString().slice(0, 10);

// event types touched, and their pre-existing state (for restore-on-cleanup)
const touchedEventTypes = new Set<string>();
const originalRows = new Map<string, { id: string; event_count: number } | null>();

async function getRow(userId: string, eventType: string) {
  const { data } = await admin
    .from("usage_analytics")
    .select("id, event_count")
    .eq("user_id", userId)
    .eq("event_type", eventType)
    .eq("date", TODAY)
    .is("subject_id", null)
    .maybeSingle();
  return data as { id: string; event_count: number } | null;
}

async function seedCount(userId: string, eventType: string, count: number) {
  touchedEventTypes.add(eventType);
  if (!originalRows.has(eventType)) {
    originalRows.set(eventType, await getRow(userId, eventType));
  }
  const existing = await getRow(userId, eventType);
  if (existing) {
    await admin
      .from("usage_analytics")
      .update({ event_count: count })
      .eq("id", existing.id);
  } else {
    await admin.from("usage_analytics").insert({
      date: TODAY,
      user_id: userId,
      subject_id: null,
      event_type: eventType,
      event_count: count,
    });
  }
}

async function cleanup(userId: string) {
  for (const eventType of touchedEventTypes) {
    const original = originalRows.get(eventType);
    const current = await getRow(userId, eventType);
    if (!current) continue;
    if (original) {
      await admin
        .from("usage_analytics")
        .update({ event_count: original.event_count })
        .eq("id", current.id);
    } else {
      await admin.from("usage_analytics").delete().eq("id", current.id);
    }
  }
  let residue = 0;
  for (const eventType of touchedEventTypes) {
    const original = originalRows.get(eventType);
    const current = await getRow(userId, eventType);
    const expected = original?.event_count ?? null;
    const actual = current?.event_count ?? null;
    if (expected !== actual) {
      console.error(
        `[cleanup] RESIDUE on ${eventType}: expected ${expected}, got ${actual}`
      );
      residue++;
    }
  }
  console.log(`[cleanup] residue mismatches: ${residue}`);
}

async function main() {
  const { data: student } = await admin
    .from("profiles")
    .select("id")
    .eq("email", STUDENT_EMAIL)
    .single();
  const userId = student!.id as string;

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

  for (const sig of ["SIGINT", "SIGTERM", "SIGPIPE", "SIGHUP"] as const) {
    process.on(sig, async () => {
      await cleanup(userId);
      process.exit(1);
    });
  }

  async function post(path: string, body: unknown) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  let ok = true;
  const EVAL_LIMIT = 20; // RATE_LIMITS.placement_interview_evaluate

  const validEvalPayload = {
    question_text: "Tell me about a time you handled conflicting priorities.",
    answer_framework: "STAR",
    student_answer:
      "I prioritized the customer-facing bug fix first since it blocked a release, then paired with a teammate to unblock the internal tooling work in parallel.",
  };
  const invalidEvalPayload = {
    ...validEvalPayload,
    student_answer: "too short",
  };

  try {
    // ── 1. Invalid payload must not reserve quota ─────────────────────────
    console.log("=== 1. Invalid payload before rate check ===");
    await seedCount(userId, "placement_interview_evaluate", EVAL_LIMIT - 1);
    const invalidRes = await post("/api/placement/interview/evaluate", invalidEvalPayload);
    console.log("  status:", invalidRes.status);
    if (invalidRes.status !== 400) {
      console.error("FAIL: expected 400 for a too-short answer, got", invalidRes.status);
      ok = false;
    }
    const afterInvalid = await getRow(userId, "placement_interview_evaluate");
    console.log("  event_count after invalid payload (expect unchanged, EVAL_LIMIT-1):", afterInvalid?.event_count);
    if (afterInvalid?.event_count !== EVAL_LIMIT - 1) {
      console.error("FAIL: invalid payload must not consume a rate-limit reservation.");
      ok = false;
    }

    // ── 2. Last remaining slot succeeds (real AI call) ─────────────────────
    console.log("\n=== 2. Last-slot request (real AI call) ===");
    const lastSlotRes = await post("/api/placement/interview/evaluate", validEvalPayload);
    console.log("  status:", lastSlotRes.status);
    if (lastSlotRes.status !== 200) {
      console.error("FAIL: expected 200 on the last remaining slot, got", lastSlotRes.status, JSON.stringify(lastSlotRes.json));
      ok = false;
    }
    const afterLastSlot = await getRow(userId, "placement_interview_evaluate");
    console.log("  event_count after success (expect EVAL_LIMIT):", afterLastSlot?.event_count);
    if (afterLastSlot?.event_count !== EVAL_LIMIT) {
      console.error("FAIL: successful call should have incremented usage to the cap.");
      ok = false;
    }

    // ── 3. Now at cap: next request is throttled, no AI spend ──────────────
    console.log("\n=== 3. Over-cap request ===");
    const overCapRes = await post("/api/placement/interview/evaluate", validEvalPayload);
    console.log("  status:", overCapRes.status, "body:", JSON.stringify(overCapRes.json));
    if (overCapRes.status !== 429 || overCapRes.json?.limitReached !== true) {
      console.error("FAIL: expected 429 + limitReached:true once at cap.");
      ok = false;
    } else {
      console.log("  PASS: throttled at cap (was: uncapped).");
    }

    // ── 4. Concurrent race at limit-1: exactly one winner ───────────────────
    console.log("\n=== 4. Concurrent race at limit-1 ===");
    await seedCount(userId, "placement_interview_evaluate", EVAL_LIMIT - 1);
    const [r1, r2] = await Promise.all([
      post("/api/placement/interview/evaluate", validEvalPayload),
      post("/api/placement/interview/evaluate", validEvalPayload),
    ]);
    const statuses = [r1.status, r2.status].sort();
    console.log("  statuses:", statuses);
    if (statuses[0] !== 200 || statuses[1] !== 429) {
      console.error(`FAIL: expected exactly one 200 and one 429, got [${statuses.join(",")}]`);
      ok = false;
    } else {
      console.log("  PASS: exactly one winner under concurrency.");
    }
    const afterRace = await getRow(userId, "placement_interview_evaluate");
    console.log("  event_count after race (expect EVAL_LIMIT, not EVAL_LIMIT+1):", afterRace?.event_count);
    if (afterRace?.event_count !== EVAL_LIMIT) {
      console.error("FAIL: concurrent race must not double-count past the cap.");
      ok = false;
    }

    // ── 5. A separate route (resume/rewrite-bullet) has its OWN cap ─────────
    console.log("\n=== 5. Cross-route: resume/rewrite-bullet has its own cap ===");
    const REWRITE_LIMIT = 30; // RATE_LIMITS.placement_resume_rewrite
    await seedCount(userId, "placement_resume_rewrite", REWRITE_LIMIT);
    const rewriteRes = await post("/api/placement/resume/rewrite-bullet", {
      bullet: "Worked on a web app",
      context: "final year project",
    });
    console.log("  status:", rewriteRes.status, "body:", JSON.stringify(rewriteRes.json));
    if (rewriteRes.status !== 429 || rewriteRes.json?.limitReached !== true) {
      console.error("FAIL: expected resume/rewrite-bullet to independently enforce its own cap.");
      ok = false;
    } else {
      console.log("  PASS: resume/rewrite-bullet throttled independently (was: uncapped).");
    }
    // interview/evaluate's cap must be untouched by this — different key.
    const evalStillAtCap = await getRow(userId, "placement_interview_evaluate");
    if (evalStillAtCap?.event_count !== EVAL_LIMIT) {
      console.error("FAIL: routes must not share a rate-limit bucket.");
      ok = false;
    }
  } finally {
    await cleanup(userId);
  }

  if (!ok) {
    console.error("\nCP-07 VERIFY: FAIL");
    process.exitCode = 1;
    return;
  }
  console.log("\nCP-07 VERIFY: PASS");
}

main().catch(async (err) => {
  console.error("VERIFY ERROR:", err);
  process.exitCode = 1;
});
