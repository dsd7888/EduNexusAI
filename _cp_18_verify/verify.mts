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

const admin = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const BASE = "http://localhost:3000";
const SUBJECT_ID = "74e25bc8-d2bc-4a11-8242-e0fefae8f3af";
const OUT = "_cp_18_verify/screens";
fs.mkdirSync(OUT, { recursive: true });

async function sessionFor(email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data) throw new Error(`generateLink failed: ${error?.message}`);
  const tokenHash = data.properties.hashed_token;
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verifyErr || !verified.session) throw new Error(`verifyOtp failed: ${verifyErr?.message}`);
  return verified.session;
}

function cookieValueFor(session: unknown): string {
  const json = JSON.stringify(session);
  const b64url = Buffer.from(json, "utf8").toString("base64url");
  return "base64-" + b64url;
}

async function main() {
  const session = await sessionFor("teststudent@gmail.com");
  const cookieValue = cookieValueFor(session);

  const browser = await chromium.launch();

  async function newAuthedContext(viewport: { width: number; height: number }) {
    const ctx = await browser.newContext({ viewport });
    await ctx.addCookies([
      {
        name: COOKIE_NAME,
        value: cookieValue,
        domain: "localhost",
        path: "/",
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
    ]);
    return ctx;
  }

  async function measure(page: import("playwright").Page) {
    return page.evaluate(() => {
      const main = document.querySelector("main");
      const composer = document.querySelector("textarea, [data-composer]")?.closest("div.sticky, div[class*='sticky']");
      // fall back: find the sticky bottom bar directly
      const stickyBar = document.querySelector("div.sticky.bottom-0");
      const mainRect = main?.getBoundingClientRect();
      const barRect = stickyBar?.getBoundingClientRect();
      return {
        mainScrollHeight: main?.scrollHeight,
        mainClientHeight: main?.clientHeight,
        mainHasVerticalOverflow: main ? main.scrollHeight > main.clientHeight + 2 : null,
        viewportHeight: window.innerHeight,
        barBottom: barRect?.bottom,
        mainBottom: mainRect?.bottom,
        gapBelowComposer: barRect && mainRect ? mainRect.bottom - barRect.bottom : null,
      };
    });
  }

  for (const viewport of [
    { name: "desktop", width: 1280, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const ctx = await newAuthedContext(viewport);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/student/chat/${SUBJECT_ID}`, { waitUntil: "networkidle" });
    await page.waitForSelector("textarea", { timeout: 15000 });
    await page.waitForTimeout(500);

    const m = await measure(page);
    console.log(`[${viewport.name}]`, JSON.stringify(m, null, 2));
    await page.screenshot({ path: `${OUT}/${viewport.name}-chat-layout.png`, fullPage: false });

    if (Math.abs(m.gapBelowComposer ?? 999) > 3) {
      console.error(`FAIL [${viewport.name}]: gap below composer = ${m.gapBelowComposer}px (expected ~0)`);
      process.exitCode = 1;
    } else {
      console.log(`PASS [${viewport.name}]: composer flush with main bottom (gap=${m.gapBelowComposer}px)`);
    }
    if (m.mainHasVerticalOverflow) {
      console.error(`FAIL [${viewport.name}]: main has extraneous vertical scroll (page-level scroll leaking through)`);
      process.exitCode = 1;
    } else {
      console.log(`PASS [${viewport.name}]: no extraneous main-level scroll`);
    }

    await ctx.close();
  }

  // ── Interrupted flow: navigate away mid-load, then back ──
  {
    const ctx = await newAuthedContext({ width: 1280, height: 900 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/student/chat/${SUBJECT_ID}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(150); // interrupt before network settles
    await page.goto(`${BASE}/student/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);
    await page.goto(`${BASE}/student/chat/${SUBJECT_ID}`, { waitUntil: "networkidle" });
    await page.waitForSelector("textarea", { timeout: 15000 });
    await page.waitForTimeout(500);
    const m = await measure(page);
    console.log("[interrupted-then-back]", JSON.stringify(m, null, 2));
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    await page.screenshot({ path: `${OUT}/interrupted-then-back.png` });
    if (Math.abs(m.gapBelowComposer ?? 999) > 3) {
      console.error(`FAIL [interrupted]: gap below composer = ${m.gapBelowComposer}px after interrupted nav`);
      process.exitCode = 1;
    } else {
      console.log(`PASS [interrupted]: layout still correct after interrupted navigation (gap=${m.gapBelowComposer}px)`);
    }
    await ctx.close();
  }

  // ── Concurrent: resize viewport rapidly while page settles (races layout recalcs) ──
  {
    const ctx = await newAuthedContext({ width: 1280, height: 900 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/student/chat/${SUBJECT_ID}`, { waitUntil: "domcontentloaded" });
    await Promise.all([
      page.setViewportSize({ width: 800, height: 700 }),
      page.setViewportSize({ width: 1280, height: 900 }),
      page.waitForTimeout(50).then(() => page.setViewportSize({ width: 390, height: 844 })),
    ]);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector("textarea", { timeout: 15000 });
    await page.waitForTimeout(500);
    const m = await measure(page);
    console.log("[concurrent-resize]", JSON.stringify(m, null, 2));
    await page.screenshot({ path: `${OUT}/concurrent-resize.png` });
    if (Math.abs(m.gapBelowComposer ?? 999) > 3) {
      console.error(`FAIL [concurrent]: gap below composer = ${m.gapBelowComposer}px after concurrent resizes`);
      process.exitCode = 1;
    } else {
      console.log(`PASS [concurrent]: layout settled correctly after racing viewport resizes (gap=${m.gapBelowComposer}px)`);
    }
    await ctx.close();
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
