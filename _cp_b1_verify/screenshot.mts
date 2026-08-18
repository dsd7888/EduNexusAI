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
const OUT = "_cp_b1_verify/screens";
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
  return ctx;
}

async function main() {
  const browser = await chromium.launch();

  // ── Desktop, light: default (all sections collapsed) ───────────────────
  {
    const ctx = await authedContext(browser, "teststudent@gmail.com", { width: 1280, height: 900 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/student/placement/prep`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Placement Prep", { timeout: 15000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/after-desktop-collapsed.png`, fullPage: true });
    const height = await page.evaluate(() => document.body.scrollHeight);
    console.log("[after] desktop collapsed-view scrollHeight:", height, "px");

    // Expand a section
    await page.getByRole("button", { name: /Quantitative Ability/ }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/after-desktop-section-expanded.png`, fullPage: true });

    // Switch track tab
    await page.getByRole("tab", { name: "Core Domain" }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/after-desktop-domain-tab.png`, fullPage: true });

    await ctx.close();
  }

  // ── Desktop, light: search ──────────────────────────────────────────────
  {
    const ctx = await authedContext(browser, "teststudent@gmail.com", { width: 1280, height: 900 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/student/placement/prep`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Placement Prep", { timeout: 15000 });
    await page.getByRole("searchbox", { name: "Search a topic across every track" }).fill("time");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/after-desktop-search-results.png`, fullPage: true });

    // Empty result
    await page.getByRole("searchbox", { name: "Search a topic across every track" }).fill("zzzznotopic");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/after-desktop-search-empty.png`, fullPage: true });
    await ctx.close();
  }

  // ── Mobile, light ────────────────────────────────────────────────────────
  {
    const ctx = await authedContext(browser, "teststudent@gmail.com", { width: 390, height: 844 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/student/placement/prep`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Placement Prep", { timeout: 15000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/after-mobile-collapsed.png`, fullPage: true });
    const height = await page.evaluate(() => document.body.scrollHeight);
    console.log("[after] mobile collapsed-view scrollHeight:", height, "px");

    await page.getByRole("searchbox", { name: "Search a topic across every track" }).fill("sql");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/after-mobile-search-results.png`, fullPage: true });
    await ctx.close();
  }

  await browser.close();
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
