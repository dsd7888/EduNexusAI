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
  await page.waitForSelector('[data-testid="flashcard-surface"]', { timeout: 10000 });
  await page.waitForTimeout(500);

  const nextBtn = page.locator('button[aria-label="Next card"]');
  for (let i = 0; i < 25; i++) {
    await page.click('[data-testid="flashcard-surface"]');
    await page.waitForTimeout(200);
    const counter = await page.locator("header span.font-plex-mono").textContent();
    const title = await page.evaluate(() => document.querySelector("h2")?.textContent ?? "?");
    const text = await page.evaluate(() => document.body.innerText);
    console.log(i, counter, title, text.includes("Worked example") ? "<-- HAS WORKED EXAMPLE" : "");
    if (text.includes("Worked example")) {
      console.log("FOUND formula-with-workedExample at", counter);
      await page.screenshot({ path: "_audit_flash/15-formula-workedexample-back.png" });
      break;
    }
    const disabled = await nextBtn.isDisabled();
    if (disabled) { console.log("exhausted deck without finding a workedExample card"); break; }
    await nextBtn.click();
    await page.waitForTimeout(150);
  }
  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
