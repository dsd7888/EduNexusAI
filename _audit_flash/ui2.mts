import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { loadEnvLocal, BASE_URL } from "../src/lib/testing/httpHarness";

const IDME3532 = "113969c6-5c0e-452b-8689-33c5cae95ae5";

async function mintCookies() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: "teststudent@gmail.com" });
  if (error || !data.properties?.hashed_token) throw new Error(`generateLink failed: ${error?.message}`);
  const jar = new Map<string, string>();
  const browserLike = createBrowserClient(url, anonKey, {
    isSingleton: false,
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => { for (const { name, value } of list) jar.set(name, value); },
    },
  });
  const { error: otpErr } = await browserLike.auth.verifyOtp({ type: "email", token_hash: data.properties.hashed_token });
  if (otpErr) throw new Error(`verifyOtp failed: ${otpErr.message}`);
  return [...jar.entries()].map(([name, value]) => ({ name, value }));
}

async function main() {
  loadEnvLocal();
  const browser = await chromium.launch();
  const cookies = await mintCookies();

  // ── B: interrupted flow — navigate to page A, then before it settles, navigate
  // to page B (module-filtered) via client-side routing (Link click), the same
  // shape as a student tapping "back" then a different module link fast. Exercises
  // useSubjectNotes' reqRef staleness guard.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
    await ctx.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: BASE_URL })));
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(`${BASE_URL}/student/notes/${IDME3532}/flashcards`, { waitUntil: "domcontentloaded", timeout: 20000 });
    // interrupt: immediately navigate again (client nav) to a module-filtered URL
    await page.goto(`${BASE_URL}/student/notes/${IDME3532}/flashcards?moduleId=075426a6-a1c2-4ca2-b94b-2d015eb557ad`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "_audit_flash/12-interrupted-nav-settled.png" });
    const counter = await page.locator("header span.font-plex-mono").textContent().catch(() => "N/A");
    console.log("interrupted-nav settled counter:", counter, "errs:", errs);
    await ctx.close();
  }

  // ── C: concurrency — rapid double-click Next + Reveal race ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
    await ctx.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: BASE_URL })));
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(`${BASE_URL}/student/notes/${IDME3532}/flashcards`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(800);
    const nextBtn = page.locator('button[aria-label="Next card"]');
    const revealBtn = page.locator("footer button", { hasText: /Reveal|Hide answer/ });
    // fire many rapid clicks concurrently to look for skipped/duplicated cards or stuck reveal state
    await Promise.all([
      nextBtn.click(), revealBtn.click(), nextBtn.click(), revealBtn.click(), nextBtn.click(),
    ]);
    await page.waitForTimeout(400);
    const counter = await page.locator("header span.font-plex-mono").textContent().catch(() => "N/A");
    console.log("after rapid concurrent clicks, counter:", counter, "errs:", errs);
    await page.screenshot({ path: "_audit_flash/13-concurrent-clicks-settled.png" });
    await ctx.close();
  }

  // ── D: keyboard space-reveal-then-advance rhythm across several cards ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
    await ctx.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: BASE_URL })));
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/student/notes/${IDME3532}/flashcards`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(800);
    const sequence: string[] = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press(" ");
      await page.waitForTimeout(150);
      const counter = await page.locator("header span.font-plex-mono").textContent().catch(() => "?");
      sequence.push(counter ?? "?");
    }
    console.log("space-key sequence (expect 1,1,2,2,3,3 — reveal,advance,reveal,advance...):", sequence);
    await ctx.close();
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
