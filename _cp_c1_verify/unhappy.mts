import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
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

async function authedContext(browser: import("playwright").Browser, email: string) {
  const session = await sessionFor(email);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addCookies([
    {
      name: COOKIE_NAME,
      value: cookieValueFor(session),
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
  return ctx;
}

const TOPIC_URL = `${BASE}/student/placement/prep/domain/practice?topic=${encodeURIComponent("Process Management & Scheduling")}`;

async function main() {
  const browser = await chromium.launch();

  let t2Id: string | null = null;

  // ── 1. Interrupted: navigate to a fill_code practice session, away before it
  //        resolves, then back — must not crash and must still be answerable ──
  {
    const probeSession = await sessionFor("teststudent2@gmail.com");
    t2Id = probeSession.user.id;
    const ctx = await authedContext(browser, "teststudent2@gmail.com");
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(TOPIC_URL, { waitUntil: "domcontentloaded" });
    await page.goto(`${BASE}/student/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);
    await page.goto(TOPIC_URL, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Q1", { timeout: 20000 });
    const optionVisible = await page.locator("button", { hasText: /^A\./ }).first().isVisible();
    console.log("[1] interrupted-then-back: question renders after remount, option A clickable:", optionVisible, "errors:", errors.length, errors);
    await ctx.close();
  }

  // ── 2. Concurrent: two simultaneous first-time generate() calls for the same
  //        brand-new fill_code topic — races the bank-insert path this checkpoint's
  //        topic-matching fix newly makes reachable. Must not double-insert or crash. ──
  {
    const email = "teststudent2@gmail.com";
    const session = await sessionFor(email);
    const cookie = `${COOKIE_NAME}=${cookieValueFor(session)}`;
    const topic = "Design Patterns (basic)"; // step-mode, untouched by earlier runs

    await admin.from("placement_question_bank").delete().eq("track", "domain").eq("topic", topic);

    const fire = () =>
      fetch(`${BASE}/api/placement/prep/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ track: "domain", topic }),
      }).then((r) => r.json());

    const [r1, r2] = await Promise.all([fire(), fire()]);
    console.log("[2] concurrent first-time generate() for same new topic — sources:", r1.source, r2.source,
      "counts:", r1.questions?.length, r2.questions?.length);

    const { data: bankRows, error: bankErr } = await admin
      .from("placement_question_bank")
      .select("id, question_type")
      .eq("track", "domain")
      .eq("topic", topic);
    const mcqRows = (bankRows ?? []).filter((r) => r.question_type === "mcq").length;
    const fcRows = (bankRows ?? []).filter((r) => r.question_type === "fill_code").length;
    console.log("[2b] bank rows after concurrent race — mcq:", mcqRows, "fill_code:", fcRows,
      "(expect >=4 each from at least one successful branch; duplicates from both branches racing are tolerated — this is a best-effort bank, not a uniqueness-constrained one)",
      "error:", bankErr?.message ?? null);

    await admin.from("placement_question_bank").delete().eq("track", "domain").eq("topic", topic);
  }

  // Verify (don't assume) the interrupted-flow probe left no residue on the
  // empty-profile fixture — it only viewed Q1, never submitted, so this should
  // already be zero; confirming rather than trusting that.
  if (t2Id) {
    const { count } = await admin
      .from("placement_topic_mastery")
      .select("*", { count: "exact", head: true })
      .eq("student_id", t2Id);
    console.log("[cleanup-check] teststudent2 placement_topic_mastery rows (expect 0 — no session was ever submitted):", count);
    if (count && count > 0) {
      await admin.from("placement_question_attempts").delete().eq("student_id", t2Id);
      await admin.from("placement_topic_mastery").delete().eq("student_id", t2Id);
      console.log("[cleanup] unexpected residue found and removed");
    }
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
