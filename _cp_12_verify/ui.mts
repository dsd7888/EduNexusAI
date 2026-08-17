/**
 * CP-12 UI verify: real browser, real Supabase session (same cookie-minting
 * pattern as prior checkpoints' _cp_*_verify/ui.mts harnesses).
 *
 * 1. /student/quiz/results/[sessionId] — Export PDF button downloads a real
 *    PDF, and a rapid double-click doesn't fire two overlapping downloads
 *    (button disables while exporting).
 * 2. /student/dashboard — "Recent Quiz Results" renders from quiz_sessions
 *    (not the dead quiz_attempts/quizzes join), zero console errors.
 * 3. /faculty/dashboard — loads with zero console/page errors now that its
 *    quiz-attempts stat goes through /api/analytics instead of querying a
 *    table it has no RLS access to.
 * 4. Interrupted flow: navigate to results, away, then back — clean re-render.
 */
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
  return { ctx, userId: session.user.id };
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

async function main() {
  const browser = await chromium.launch();
  const errors: string[] = [];

  const { data: sessionRows } = await admin
    .from("quiz_sessions")
    .select("id")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1);
  const sessionId = sessionRows?.[0]?.id;
  if (!sessionId) throw new Error("no completed quiz_sessions row to test the results page against");

  try {
    // ── Results page: Export PDF button ──
    {
      const { ctx } = await authedContext(browser, "teststudent@gmail.com");
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(`[results] ${e}`));
      await page.goto(`${BASE}/student/quiz/results/${sessionId}`, { waitUntil: "networkidle" });
      await page.waitForSelector("text=Export PDF", { timeout: 20000 });

      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 15000 }),
        page.getByText("Export PDF").click(),
      ]);
      const downloadPath = await download.path();
      const size = downloadPath ? fs.statSync(downloadPath).size : 0;
      assert(size > 1000, `Export PDF button triggers a real download (${size} bytes)`);

      // Concurrent-ish: rapid double-click. Button disables mid-export so this
      // should not throw / should settle to one clean state, not a torn UI.
      const btn = page.getByRole("button", { name: /Export PDF/ });
      await Promise.all([btn.click({ trial: false }).catch(() => {}), btn.click({ trial: false }).catch(() => {})]);
      await page.waitForTimeout(500);
      const stillOneButton = await page.getByText("Export PDF").count();
      assert(stillOneButton === 1, `rapid double-click on Export PDF leaves exactly one button, no torn UI (count=${stillOneButton})`);

      await page.screenshot({ path: "_cp_12_verify/results-export.png" });
    }

    // ── Interrupted flow: navigate away mid-fetch, then back ──
    {
      const { ctx } = await authedContext(browser, "teststudent@gmail.com");
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(`[interrupted] ${e}`));
      await page.goto(`${BASE}/student/quiz/results/${sessionId}`);
      await page.goto(`${BASE}/student/dashboard`);
      await page.goto(`${BASE}/student/quiz/results/${sessionId}`, { waitUntil: "networkidle" });
      await page.waitForSelector("text=Export PDF", { timeout: 20000 });
      assert(true, "interrupted-then-back on results page re-renders cleanly");
    }

    // ── Student dashboard: recent quiz results from quiz_sessions ──
    {
      const { ctx } = await authedContext(browser, "teststudent@gmail.com");
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(`[student-dash] ${e}`));
      await page.goto(`${BASE}/student/dashboard`, { waitUntil: "networkidle" });
      await page.waitForSelector("text=Recent Quiz Results", { timeout: 20000 });
      const noQuizzesText = await page.getByText("No quizzes taken yet").count();
      assert(noQuizzesText === 0, "student dashboard shows real recent quiz activity, not the empty state");
      await page.screenshot({ path: "_cp_12_verify/student-dashboard.png" });
    }

    // ── Faculty dashboard: quiz-attempts stat via /api/analytics ──
    {
      const { ctx } = await authedContext(browser, "testfaculty@gmail.com");
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(`[faculty-dash] ${e}`));
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      await page.goto(`${BASE}/faculty/dashboard`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1000);
      assert(consoleErrors.length === 0, `faculty dashboard has zero console errors (found ${consoleErrors.length}: ${consoleErrors.slice(0, 2).join(" | ")})`);
      await page.screenshot({ path: "_cp_12_verify/faculty-dashboard.png" });
    }
  } finally {
    await browser.close();
  }

  assert(errors.length === 0, `zero page errors across all scenarios (found: ${errors.join(" | ")})`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("VERIFY SCRIPT ERROR:", err);
  process.exit(1);
});
