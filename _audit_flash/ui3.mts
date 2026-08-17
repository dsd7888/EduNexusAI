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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  await ctx.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: BASE_URL })));
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/student/notes/${IDME3532}/flashcards`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(1000);

  const before = await page.locator("header span.font-plex-mono").textContent();
  console.log("before:", before);

  // Dispatch TWO real click events on "Next card" synchronously within one JS task,
  // guaranteeing React 18 batches both onClick handler invocations into the same
  // render cycle (no `await` between them at all).
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Next card"]') as HTMLButtonElement;
    btn.click();
    btn.click();
  });
  await page.waitForTimeout(300);
  const after2 = await page.locator("header span.font-plex-mono").textContent();
  console.log("after two synchronous next-clicks (expect Card 3 of 23 if both counted, Card 2 if collapsed):", after2);

  // Reset and try THREE synchronous clicks.
  await page.goto(`${BASE_URL}/student/notes/${IDME3532}/flashcards`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForSelector('button[aria-label="Next card"]', { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Next card"]') as HTMLButtonElement;
    btn.click(); btn.click(); btn.click();
  });
  await page.waitForTimeout(300);
  const after3 = await page.locator("header span.font-plex-mono").textContent();
  console.log("after three synchronous next-clicks (expect Card 4 of 23 if all counted):", after3);

  // Same test with keyboard ArrowRight x2 fired synchronously (dispatchEvent, not page.keyboard.press,
  // to avoid Playwright's own per-key delay reintroducing separate ticks) from a REVEALED state,
  // so both keydowns take the "advance" branch, not the "reveal" branch.
  await page.goto(`${BASE_URL}/student/notes/${IDME3532}/flashcards`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForSelector('[data-testid="flashcard-surface"]', { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.click('[data-testid="flashcard-surface"]'); // reveal card 1
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
  });
  await page.waitForTimeout(300);
  const afterArrow = await page.locator("header span.font-plex-mono").textContent();
  console.log("after two synchronous ArrowRight (both from revealed state, expect Card 3 of 23 if both counted):", afterArrow);

  await page.screenshot({ path: "_audit_flash/14-double-advance-repro.png" });
  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
