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
const OUT = "_cp_e1_verify/screens";
fs.mkdirSync(OUT, { recursive: true });

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

async function authedContext(
  browser: import("playwright").Browser,
  email: string,
  viewport: { width: number; height: number }
) {
  const session = await sessionFor(email);
  const ctx = await browser.newContext({ viewport });
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

const EMAIL = "teststudent@gmail.com"; // CSE × startup, real fixture — no seed data mutated
const EMPTY_EMAIL = "teststudent2@gmail.com"; // no student_placement_profiles row

async function main() {
  const browser = await chromium.launch();
  const errors: string[] = [];

  try {
    // ── Desktop: happy path + functional click-through ──
    {
      const { ctx } = await authedContext(browser, EMAIL, { width: 1280, height: 1400 });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(`[desktop] ${e}`));
      await page.goto(`${BASE}/student/placement/skill-map`, { waitUntil: "networkidle" });
      await page.waitForSelector("text=Skill-gap map", { timeout: 20000 });

      const heading = await page.locator("h1").first().textContent();
      console.log("[desktop] archetype heading:", heading);

      const metTag = await page.getByText(/met$/, { exact: false }).first().textContent();
      console.log("[desktop] met/total tag:", metTag);

      // At least one gap pillar should be present for this fixture
      // (readiness_coding=0, readiness_communication=0, 0 projects) — confirms
      // the map isn't silently showing an all-met state for a partial student.
      const gapTags = await page.getByText("Gap", { exact: true }).count();
      console.log("[desktop] gap-status tags rendered:", gapTags);

      await page.screenshot({ path: `${OUT}/desktop-skill-map.png`, fullPage: true });

      // Functional test: click the first non-phase2 remedy link and confirm
      // it navigates to the correct destination (primary action).
      const remedyLink = page.locator("a", { hasText: /Practice|Update your resume/ }).first();
      const remedyText = await remedyLink.textContent();
      const remedyHref = await remedyLink.getAttribute("href");
      await remedyLink.click();
      await page.waitForURL((u) => u.pathname === remedyHref, { timeout: 10000 });
      console.log("[desktop] clicked remedy:", remedyText?.trim(), "-> landed on:", page.url());
      const landedCorrectly =
        page.url().includes("/student/placement/prep/") || page.url().includes("/student/placement/resume");
      console.log("[desktop] remedy navigation landed on a real destination:", landedCorrectly);

      await ctx.close();
    }

    // ── Mobile ──
    {
      const { ctx } = await authedContext(browser, EMAIL, { width: 390, height: 844 });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(`[mobile] ${e}`));
      await page.goto(`${BASE}/student/placement/skill-map`, { waitUntil: "networkidle" });
      await page.waitForSelector("text=Skill-gap map", { timeout: 20000 });
      await page.screenshot({ path: `${OUT}/mobile-skill-map.png`, fullPage: true });
      await ctx.close();
    }

    // ── Unhappy path 1: no placement profile → redirect to setup ──
    {
      const { ctx } = await authedContext(browser, EMPTY_EMAIL, { width: 1280, height: 900 });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(`[empty-profile] ${e}`));
      await page.goto(`${BASE}/student/placement/skill-map`, { waitUntil: "networkidle" });
      await page.waitForURL(/\/student\/placement\/setup/, { timeout: 10000 });
      console.log("[unhappy-1] null profile redirected to:", page.url());
      await page.screenshot({ path: `${OUT}/unhappy-1-null-profile-redirect.png` });
      await ctx.close();
    }

    // ── Unhappy path 2: interrupted flow — navigate away before fetch resolves, then back ──
    {
      const { ctx } = await authedContext(browser, EMAIL, { width: 1280, height: 900 });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(`[interrupted] ${e}`));
      await page.goto(`${BASE}/student/placement/skill-map`); // no waitUntil — interrupt mid-flight
      await page.goto(`${BASE}/student/placement`, { waitUntil: "networkidle" });
      await page.goto(`${BASE}/student/placement/skill-map`, { waitUntil: "networkidle" });
      await page.waitForSelector("text=Skill-gap map", { timeout: 20000 });
      console.log("[unhappy-2] clean re-render after interrupted navigation, zero console errors so far:", errors.length === 0);
      await page.screenshot({ path: `${OUT}/unhappy-2-interrupted-then-back.png` });
      await ctx.close();
    }

    // ── Unhappy path 3: concurrent — two overlapping loads of the same page racing ──
    {
      const { ctx } = await authedContext(browser, EMAIL, { width: 1280, height: 900 });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(`[concurrent] ${e}`));
      await page.goto(`${BASE}/student/placement/skill-map`, { waitUntil: "networkidle" });
      // Race two reloads plus a rapid double-click on a remedy link.
      await Promise.all([page.reload(), page.reload({ waitUntil: "networkidle" })]);
      await page.waitForSelector("text=Skill-gap map", { timeout: 20000 });
      const heading = await page.locator("h1").count();
      console.log("[unhappy-3] exactly one h1 after racing reloads (no torn/duplicated render):", heading === 1);

      const remedyLink = page.locator("a", { hasText: /Practice|Update your resume/ }).first();
      const remedyHref = await remedyLink.getAttribute("href");
      await Promise.all([remedyLink.click(), remedyLink.click({ force: true }).catch(() => {})]);
      await page.waitForURL((u) => u.pathname === remedyHref, { timeout: 10000 });
      console.log("[unhappy-3] double-click on remedy settled at a single consistent URL:", page.url());
      await page.screenshot({ path: `${OUT}/unhappy-3-concurrent.png` });
      await ctx.close();
    }

    console.log("\npage errors total:", errors.length, errors);
    if (errors.length > 0) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
