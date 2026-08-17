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

  // mobile viewport, no fullPage -> shows fixed bottom bar
  const cookies = await mintCookies();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: BASE_URL })));
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/student/notes/${IDME3532}`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `_audit_notes/reading-mobile-viewport-top.png` });

  // measure touch targets
  const measurements = await page.evaluate(() => {
    const out: { label: string; w: number; h: number }[] = [];
    document.querySelectorAll("button, a").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        out.push({ label: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) });
      }
    });
    return out;
  });
  console.log("Interactive element sizes (mobile viewport):");
  for (const m of measurements) console.log(`  ${m.h}h x ${m.w}w — "${m.label}"`);

  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `_audit_notes/reading-mobile-viewport-scrolled.png` });

  await context.close();

  // desktop viewport top (nav sizing)
  const cookies2 = await mintCookies();
  const context2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context2.addCookies(cookies2.map((c) => ({ name: c.name, value: c.value, url: BASE_URL })));
  const page2 = await context2.newPage();
  await page2.goto(`${BASE_URL}/student/notes/${IDME3532}`, { waitUntil: "networkidle", timeout: 20000 });
  await page2.waitForTimeout(1200);
  await page2.screenshot({ path: `_audit_notes/reading-desktop-viewport-top.png` });
  await context2.close();

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
