/**
 * CP-19 verify — desktop sidebar collapse in the student shell.
 * Confirms: toggle collapses/expands the rail, width transitions to w-16/w-64,
 * localStorage persists the preference across reload, and the interrupted/
 * concurrent-click paths don't leave the UI in a broken state.
 */
import { chromium } from "playwright";
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

async function main() {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: STUDENT_EMAIL,
  });
  if (error || !data) throw new Error(`generateLink failed: ${error?.message}`);
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr || !verified.session)
    throw new Error(`verifyOtp failed: ${verifyErr?.message}`);

  const cookieValue =
    "base64-" + Buffer.from(JSON.stringify(verified.session), "utf8").toString("base64url");

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: cookieValue,
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
    },
  ]);
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  let ok = true;
  try {
    await page.goto(`${BASE}/student/dashboard`, { waitUntil: "networkidle" });

    const aside = page.locator("aside.hidden.lg\\:flex");
    const toggleBtn = aside.locator("button[title='Collapse menu'], button[title='Expand menu']");

    // --- happy path: collapse, check width + main margin ---
    const widthBefore = await aside.evaluate((el) => el.getBoundingClientRect().width);
    console.log("aside width before collapse:", widthBefore);
    if (Math.round(widthBefore) !== 256) {
      ok = false;
      console.error("FAIL: expected expanded rail width 256px (w-64), got", widthBefore);
    }

    await toggleBtn.click();
    await page.waitForTimeout(300); // let the width transition settle
    const widthAfter = await aside.evaluate((el) => el.getBoundingClientRect().width);
    console.log("aside width after collapse:", widthAfter);
    if (Math.round(widthAfter) !== 64) {
      ok = false;
      console.error("FAIL: expected collapsed rail width 64px (w-16), got", widthAfter);
    }

    const navLabelVisible = await aside.locator("nav a:has-text('Dashboard')").isVisible().catch(() => false);
    if (navLabelVisible) {
      ok = false;
      console.error("FAIL: nav label text still visible while collapsed");
    }

    // --- persistence across reload ---
    const stored = await page.evaluate(() => localStorage.getItem("student_nav_collapsed"));
    console.log("localStorage student_nav_collapsed:", stored);
    if (stored !== "true") {
      ok = false;
      console.error("FAIL: collapsed preference not persisted to localStorage");
    }

    await page.reload({ waitUntil: "networkidle" });
    const widthAfterReload = await page
      .locator("aside.hidden.lg\\:flex")
      .evaluate((el) => el.getBoundingClientRect().width);
    console.log("aside width after reload:", widthAfterReload);
    if (Math.round(widthAfterReload) !== 64) {
      ok = false;
      console.error("FAIL: collapsed state did not survive reload");
    }

    // --- unhappy path 1: interrupted flow — navigate away mid-toggle-click,
    // before the click's localStorage write / re-render settles ---
    const toggleBtn2 = page
      .locator("aside.hidden.lg\\:flex")
      .locator("button[title='Collapse menu'], button[title='Expand menu']");
    await toggleBtn2.click(); // expand again
    await page.waitForTimeout(100);
    // Real in-app navigation (client-side Link, not a hard page.goto reload) so the
    // layout stays mounted and its pathname-change-triggers-collapse render logic runs.
    await Promise.all([
      page.waitForURL(/\/student\/subjects/),
      page.locator("aside.hidden.lg\\:flex nav a[href='/student/subjects']").click(),
    ]);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(200);
    // Per the ported FacultyShell pattern, any navigation auto-re-collapses the rail.
    const widthAfterNavInterrupt = await page
      .locator("aside.hidden.lg\\:flex")
      .evaluate((el) => el.getBoundingClientRect().width);
    console.log("aside width after nav-interrupted toggle:", widthAfterNavInterrupt);
    if (Math.round(widthAfterNavInterrupt) !== 64) {
      ok = false;
      console.error("FAIL: rail did not settle to collapsed state after nav interrupted the toggle click");
    }

    // --- unhappy path 2: concurrent action — rapid double-click the toggle ---
    const toggleBtn3 = page
      .locator("aside.hidden.lg\\:flex")
      .locator("button[title='Collapse menu'], button[title='Expand menu']");
    await Promise.all([toggleBtn3.click(), toggleBtn3.click()]);
    await page.waitForTimeout(300);
    const widthAfterDoubleClick = await page
      .locator("aside.hidden.lg\\:flex")
      .evaluate((el) => el.getBoundingClientRect().width);
    console.log("aside width after rapid double-click:", widthAfterDoubleClick);
    if (Math.round(widthAfterDoubleClick) !== 256 && Math.round(widthAfterDoubleClick) !== 64) {
      ok = false;
      console.error("FAIL: double-click left the rail at an inconsistent/broken width:", widthAfterDoubleClick);
    } else {
      console.log("double-click settled cleanly at", widthAfterDoubleClick, "(no torn/broken state)");
    }

    // mobile drawer must still have NO collapse toggle (icon-only rail is desktop-only)
    await page.setViewportSize({ width: 500, height: 900 });
    await page.goto(`${BASE}/student/dashboard`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.waitForTimeout(200);
    const mobileToggle = await page
      .locator("button[title='Collapse menu'], button[title='Expand menu']")
      .isVisible()
      .catch(() => false);
    if (mobileToggle) {
      ok = false;
      console.error("FAIL: collapse toggle visible in mobile drawer (should be desktop-only)");
    }
    const mobileCloseVisible = await page.getByRole("button", { name: "Close menu", exact: true }).isVisible();
    if (!mobileCloseVisible) {
      ok = false;
      console.error("FAIL: mobile drawer close (X) button missing");
    }
  } catch (e) {
    ok = false;
    console.error("EXCEPTION:", e);
  } finally {
    if (consoleErrors.length > 0) {
      console.error("Console errors observed:", consoleErrors);
      ok = false;
    }
    await browser.close();
  }

  console.log(ok ? "\nCP-19 verify: PASS" : "\nCP-19 verify: FAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
