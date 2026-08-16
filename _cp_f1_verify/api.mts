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
const EMAIL = "teststudent@gmail.com";
const FOLLOWUP_PATH = "/api/placement/interview/mock/follow-up";
const REACTIVE_KIND = "interview_reactive_followup";

const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// ── Track everything this harness inserts, so cleanup is exact rather than
// a blanket delete that could touch real spend rows from other tests. ──────
const insertedLogIds: string[] = [];

async function cleanup() {
  if (insertedLogIds.length === 0) {
    console.log("[cleanup] nothing to remove");
    return;
  }
  const { error } = await admin.from("ai_call_logs").delete().in("id", insertedLogIds);
  if (error) {
    console.error("[cleanup] delete failed:", error);
    return;
  }
  // Verify, don't assume — per CLAUDE.md's harness rules.
  const { data: remaining } = await admin
    .from("ai_call_logs")
    .select("id")
    .in("id", insertedLogIds);
  console.log(
    `[cleanup] deleted ${insertedLogIds.length} rows this harness inserted; ` +
      `residue check: ${remaining?.length ?? 0} still present (expect 0)`
  );
}

let cleaningUp = false;
async function cleanupOnSignal(signal: string) {
  if (cleaningUp) return;
  cleaningUp = true;
  console.log(`\n[signal] ${signal} received — cleaning up before exit`);
  await cleanup();
  process.exit(1);
}
process.on("SIGINT", () => void cleanupOnSignal("SIGINT"));
process.on("SIGTERM", () => void cleanupOnSignal("SIGTERM"));
process.on("SIGHUP", () => void cleanupOnSignal("SIGHUP"));
process.on("SIGPIPE", () => void cleanupOnSignal("SIGPIPE"));

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

function cookieHeaderFor(session: unknown): string {
  const value = "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${COOKIE_NAME}=${value}`;
}

const PROJECT_CONTEXT =
  "Order Processing Service (Java, Spring Boot, PostgreSQL): Built a REST API for order " +
  "tracking used by 3 internal teams; used Kafka to process order events asynchronously.";
const STUDENT_ANSWER =
  "I built an order processing service using Java and Spring Boot. It exposes a REST API " +
  "that three internal teams use to track order status, and I used Kafka to handle order " +
  "events asynchronously so the API stays responsive under load.";

// Insert a synthetic ai_call_logs row directly (bypassing the AI call entirely) to
// simulate a prior reactive-follow-up call without spending on a real one — isolates
// the CAP LOGIC from AI-call flakiness/cost, per the harness's own tracked-cleanup rule.
async function seedSyntheticReactiveCall(studentId: string) {
  const { data, error } = await admin
    .from("ai_call_logs")
    .insert({
      user_id: studentId,
      user_email_snapshot: EMAIL,
      user_role_snapshot: "student",
      subject_id: null,
      subject_code_snapshot: null,
      task: "placement_prep",
      feature: "placement",
      model: "flash",
      unit_type: "tokens",
      input_tokens: 100,
      output_tokens: 50,
      thinking_tokens: 0,
      cost_usd: 0.0001,
      cost_inr: 0.01,
      fx_rate: 83,
      status: "success",
      job_id: crypto.randomUUID(),
      related_content_id: null,
      metadata: { kind: REACTIVE_KIND, synthetic: true },
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seed insert failed: ${error?.message}`);
  insertedLogIds.push(data.id);
  return data.id;
}

async function countReactiveRows(studentId: string, since: string): Promise<number> {
  const { data } = await admin
    .from("ai_call_logs")
    .select("id, metadata, created_at")
    .eq("user_id", studentId)
    .eq("task", "placement_prep")
    .gte("created_at", since);
  return (data ?? []).filter(
    (r) => r.metadata && typeof r.metadata === "object" && (r.metadata as Record<string, unknown>).kind === REACTIVE_KIND
  ).length;
}

async function main() {
  const session = await sessionFor(EMAIL);
  const cookie = cookieHeaderFor(session);
  const studentId = session.user.id;

  async function post(path: string, body: unknown) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  const t0 = new Date().toISOString();

  // ── 1. Validation ────────────────────────────────────────────────────────
  console.log("=== 1. Validation (unhappy path) ===");
  const shortAnswer = await post(FOLLOWUP_PATH, {
    student_answer: "too short",
    project_context: PROJECT_CONTEXT,
  });
  console.log("  answer < 20 chars -> status:", shortAnswer.status, "error:", shortAnswer.json.error);

  const noProjectContext = await post(FOLLOWUP_PATH, {
    student_answer: STUDENT_ANSWER,
    project_context: "",
  });
  console.log(
    "  empty project_context (no resume project) -> status:",
    noProjectContext.status,
    "error:",
    noProjectContext.json.error
  );

  // ── 2. Real happy-path call ─────────────────────────────────────────────
  console.log("\n=== 2. Real reactive follow-up call ===");
  const real = await post(FOLLOWUP_PATH, {
    student_answer: STUDENT_ANSWER,
    project_context: PROJECT_CONTEXT,
  });
  console.log("  status:", real.status);
  console.log("  follow_up_question:", real.json.follow_up_question);
  console.log("  why_it_probes:", real.json.why_it_probes);
  console.log(
    "  reactive_calls_used:",
    real.json.reactive_calls_used,
    "/ cap:",
    real.json.reactive_calls_cap
  );

  // after() logs asynchronously — poll rather than assume the insert landed
  // the instant fetch() returned (CLAUDE.md's own documented gotcha).
  let realRowCount = await countReactiveRows(studentId, t0);
  for (let i = 0; i < 8 && realRowCount < 1; i++) {
    await new Promise((r) => setTimeout(r, 750));
    realRowCount = await countReactiveRows(studentId, t0);
  }
  console.log("  ai_call_logs rows tagged kind=interview_reactive_followup since t0:", realRowCount);
  // Track this real row for cleanup too.
  const { data: realRows } = await admin
    .from("ai_call_logs")
    .select("id")
    .eq("user_id", studentId)
    .eq("task", "placement_prep")
    .gte("created_at", t0);
  for (const r of realRows ?? []) {
    if (!insertedLogIds.includes(r.id)) insertedLogIds.push(r.id);
  }

  // ── 3. Cap enforcement — seed 4 synthetic rows to reach the ceiling of 5,
  // then confirm the 6th attempt (a real request) is refused BEFORE any AI
  // call happens (no new ai_call_logs row from the refused attempt). ───────
  console.log("\n=== 3. Cap enforcement (server-side, cost gate) ===");
  const t1 = new Date().toISOString();
  for (let i = 0; i < 4; i++) await seedSyntheticReactiveCall(studentId);
  const countBeforeRefusal = await countReactiveRows(studentId, t0);
  console.log("  reactive rows in window before the capped attempt (expect 5):", countBeforeRefusal);

  const capped = await post(FOLLOWUP_PATH, {
    student_answer: STUDENT_ANSWER,
    project_context: PROJECT_CONTEXT,
  });
  console.log("  6th attempt -> status (expect 429):", capped.status, "error:", capped.json.error);

  const countAfterRefusal = await countReactiveRows(studentId, t0);
  console.log(
    "  reactive rows after the refused attempt (expect still 5, no AI call happened):",
    countAfterRefusal
  );
  console.log("  cap held (no row growth on refusal):", countAfterRefusal === countBeforeRefusal);
  void t1;

  // ── 4. Concurrent — two overlapping requests racing the same read-then-act
  // check. Documenting actual observed behavior, not assuming atomicity: the
  // count is read via a SELECT with no locking, so two requests that both
  // read "4 used" before either's insert lands could both proceed. ─────────
  console.log("\n=== 4. Concurrent requests at the cap boundary ===");
  // Reset window: delete the 4 synthetic rows, reseed exactly 3 so 2 real
  // slots remain (the 1 real call from step 2 + 3 synthetic = 4 used, 1 left
  // under the cap of 5) — fire 2 concurrent requests at that boundary.
  const toRemove = insertedLogIds.splice(insertedLogIds.length - 4, 4);
  await admin.from("ai_call_logs").delete().in("id", toRemove);
  for (let i = 0; i < 3; i++) await seedSyntheticReactiveCall(studentId);
  const beforeConcurrent = await countReactiveRows(studentId, t0);
  console.log("  reactive rows before concurrent pair (expect 4, 1 slot left under cap 5):", beforeConcurrent);

  const [respA, respB] = await Promise.all([
    post(FOLLOWUP_PATH, { student_answer: STUDENT_ANSWER, project_context: PROJECT_CONTEXT }),
    post(FOLLOWUP_PATH, { student_answer: STUDENT_ANSWER, project_context: PROJECT_CONTEXT }),
  ]);
  console.log("  concurrent A -> status:", respA.status);
  console.log("  concurrent B -> status:", respB.status);
  const bothSucceeded = respA.status === 200 && respB.status === 200;
  const oneRefused = [respA.status, respB.status].filter((s) => s === 429).length === 1;
  console.log(
    "  outcome:",
    bothSucceeded
      ? "BOTH succeeded — the read-then-act race let the cap slip past 5 by one (known limitation, documented below)"
      : oneRefused
        ? "one succeeded, one refused — cap held even under a concurrent race"
        : "both refused"
  );

  // Track any new rows from this section for cleanup.
  const { data: afterRows } = await admin
    .from("ai_call_logs")
    .select("id")
    .eq("user_id", studentId)
    .eq("task", "placement_prep")
    .gte("created_at", t0);
  for (const r of afterRows ?? []) {
    if (!insertedLogIds.includes(r.id)) insertedLogIds.push(r.id);
  }

  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error("FATAL:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
  });
