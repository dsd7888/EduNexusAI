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
const OUT = "_cp_a2_verify/screens";

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
  return ctx;
}

async function main() {
  const browser = await chromium.launch();

  // ── 1. Empty / never-set-up profile (Test Student 2 — no placement_profiles row) ──
  {
    const ctx = await authedContext(browser, "teststudent2@gmail.com");
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${BASE}/student/placement`, { waitUntil: "networkidle" });
    await page.waitForURL(/\/student\/placement\/setup/, { timeout: 10000 });
    console.log("[1] null-profile redirect: OK ->", page.url(), "console errors:", errors.length);
    await page.screenshot({ path: `${OUT}/unhappy-1-null-profile-redirect.png` });
    await ctx.close();
  }

  // ── 2. setup_complete: false (temporarily inserted for Test Student 3) ──
  const TS3 = "6fb0c90f-1349-4640-bd36-4b7e3b886e60";
  {
    const { error: insErr } = await admin.from("student_placement_profiles").insert({
      student_id: TS3,
      setup_complete: false,
      primary_target: "product",
      cgpa: 7.5,
      active_backlogs: 0,
    });
    if (insErr) throw new Error(`seed insert failed: ${insErr.message}`);

    const ctx = await authedContext(browser, "teststudent3@gmail.com");
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${BASE}/student/placement`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Finish your placement setup", { timeout: 10000 });
    const hasReadinessToggle = await page.getByRole("button", { name: "Your readiness" }).count();
    const hasSecondary = await page.locator("text=Return to").count();
    console.log(
      "[2] setup_complete=false renders hero-only:",
      "readinessToggle=",
      hasReadinessToggle,
      "secondaryMoves=",
      hasSecondary,
      "console errors:",
      errors.length
    );
    await page.screenshot({ path: `${OUT}/unhappy-2-setup-incomplete-hero-only.png` });
    await ctx.close();

    // cleanup — restore to exactly "no row" (the original state)
    const { error: delErr } = await admin.from("student_placement_profiles").delete().eq("student_id", TS3);
    if (delErr) throw new Error(`cleanup delete failed: ${delErr.message}`);
    const { data: check } = await admin
      .from("student_placement_profiles")
      .select("student_id")
      .eq("student_id", TS3)
      .maybeSingle();
    console.log("[2] cleanup verified — row present after delete:", check !== null);
  }

  // ── 3. Interrupted flow: navigate away before fetches resolve, then back ──
  {
    const ctx = await authedContext(browser, "teststudent@gmail.com");
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await page.goto(`${BASE}/student/placement`, { waitUntil: "domcontentloaded" });
    // Navigate away immediately, before the profile/companies/mastery fetches resolve.
    await page.goto(`${BASE}/student/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);
    // Now navigate back — a fresh mount, should render cleanly with no leaked state.
    await page.goto(`${BASE}/student/placement`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Next move", { timeout: 10000 });
    await page.waitForSelector("text=Return to Aptitude", { timeout: 10000 });
    console.log("[3] interrupted-flow re-navigate: OK, console/page errors:", errors.length, errors);
    await page.screenshot({ path: `${OUT}/unhappy-3-interrupted-then-back.png` });
    await ctx.close();
  }

  // ── 4. Concurrent: rapid focus/blur (double refetch) + rapid double-click on the readiness toggle ──
  {
    const ctx = await authedContext(browser, "teststudent@gmail.com");
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(`${BASE}/student/placement`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Next move", { timeout: 10000 });

    // Force the 60s staleness guard so focus actually triggers a refetch, then
    // fire two overlapping focus events back-to-back (two concurrent GETs racing).
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
    });
    await Promise.all([
      page.evaluate(() => window.dispatchEvent(new Event("focus"))),
      page.evaluate(() => window.dispatchEvent(new Event("focus"))),
    ]);
    await page.waitForTimeout(500);

    // Rapid double-click the readiness disclosure toggle (open/close race on the
    // same piece of local state).
    const toggle = page.getByRole("button", { name: "Your readiness" });
    await Promise.all([toggle.click(), toggle.click()]);
    await page.waitForTimeout(400);
    const expandedAfterDoubleClick = await page.locator("text=Overall").count();

    console.log(
      "[4] concurrent focus + double-click toggle: page errors=",
      errors.length,
      "readiness-expanded-count(should be even->closed or odd->open, either is fine, just no crash)=",
      expandedAfterDoubleClick
    );
    await page.screenshot({ path: `${OUT}/unhappy-4-concurrent.png` });
    await ctx.close();
  }

  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
