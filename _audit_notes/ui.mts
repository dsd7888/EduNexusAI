import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { loadEnvLocal, BASE_URL } from "../src/lib/testing/httpHarness";

const IDME3532 = "113969c6-5c0e-452b-8689-33c5cae95ae5";

async function mintCookies(): Promise<{ name: string; value: string }[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: "teststudent@gmail.com",
  });
  if (error || !data.properties?.hashed_token) {
    throw new Error(`generateLink failed: ${error?.message}`);
  }

  const jar = new Map<string, string>();
  const browserLike = createBrowserClient(url, anonKey, {
    isSingleton: false,
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => { for (const { name, value } of list) jar.set(name, value); },
    },
  });
  const { error: otpErr } = await browserLike.auth.verifyOtp({
    type: "email",
    token_hash: data.properties.hashed_token,
  });
  if (otpErr) throw new Error(`verifyOtp failed: ${otpErr.message}`);

  return [...jar.entries()].map(([name, value]) => ({ name, value }));
}

async function main() {
  loadEnvLocal();
  const browser = await chromium.launch();

  async function shot(viewport: { width: number; height: number }, name: string, colorScheme: "light" | "dark") {
    const cookies = await mintCookies();
    const context = await browser.newContext({ viewport, colorScheme });
    await context.addCookies(
      cookies.map((c) => ({
        name: c.name,
        value: c.value,
        url: BASE_URL,
      }))
    );
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
    await page.goto(`${BASE_URL}/student/notes/${IDME3532}`, { waitUntil: "networkidle", timeout: 20000 }).catch((e) => console.log("nav warn:", e.message));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `_audit_notes/${name}.png`, fullPage: true });
    console.log(`${name}: url=${page.url()} consoleErrors=${JSON.stringify(consoleErrors)}`);
    await context.close();
  }

  await shot({ width: 1280, height: 900 }, "reading-desktop-light", "light");
  await shot({ width: 390, height: 844 }, "reading-mobile-light", "light");
  await shot({ width: 1280, height: 900 }, "reading-desktop-dark", "dark");

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
