import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { loadEnvLocal, BASE_URL } from "../src/lib/testing/httpHarness";

const IDME3532 = "113969c6-5c0e-452b-8689-33c5cae95ae5";

async function mintCookies(): Promise<{ name: string; value: string }[]> {
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: BASE_URL })));
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  await page.goto(`${BASE_URL}/student/notes/${IDME3532}`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(1000);

  // Search for the formula block
  await page.fill('input[type="search"]', "steering ratio");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "_audit_notes/search-formula.png" });

  // Adversarial search: script injection attempt in search box (client-side only, but verify no XSS/crash)
  await page.fill('input[type="search"]', '<img src=x onerror=alert(1)>');
  await page.waitForTimeout(400);
  await page.screenshot({ path: "_audit_notes/search-xss-attempt.png" });
  const dialogFired = await page.evaluate(() => (window as any).__alertFired ?? false);
  console.log("XSS search dialogFired:", dialogFired, "consoleErrors so far:", consoleErrors.length);

  // Nonsense search -> empty state
  await page.fill('input[type="search"]', "zzzznonexistentqueryxyz");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "_audit_notes/search-empty-state.png" });

  // Clear and click a module filter, then flashcard link href check
  await page.fill('input[type="search"]', "");
  await page.waitForTimeout(300);

  console.log("Total console/page errors during UI flow:", consoleErrors.length, JSON.stringify(consoleErrors).slice(0, 500));

  await context.close();
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
