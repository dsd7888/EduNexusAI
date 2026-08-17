/**
 * AU-SHELL concurrency check (CLAUDE.md verification protocol: at least one
 * interrupted/concurrent flow, not just happy path): on /student/history,
 * click session A, then immediately click session B before A's message fetch
 * resolves. The code has a staleness guard
 * (`prev.id === session.id ? {...prev, messages: data} : prev`) in
 * handleSelectSession — this test confirms whether it actually holds when A's
 * slow response lands AFTER B's fast one, not just when both are similar speed.
 */
import { chromium } from "playwright";
import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal(): void {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvLocal();

const BASE_URL = "http://localhost:3000";

// Real teststudent sessions (see check_teststudent_data.ts output):
const SESSION_A = "5647b705-a286-4159-b9e9-968341b6379a"; // PHARMACEUTICAL TECHNOLOGY, 6 msgs
const SESSION_B = "c853951d-be91-4754-8182-3c9d9e0415ab"; // Cryptography Fundamentals, 12 msgs

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const jar = new Map<string, string>();
  const browserLike = createBrowserClient(url, anonKey, {
    isSingleton: false,
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value } of list) jar.set(name, value);
      },
    },
  });
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: "teststudent@gmail.com" });
  if (linkErr || !link.properties?.hashed_token) throw new Error(`generateLink failed: ${linkErr?.message}`);
  const { error: otpErr } = await browserLike.auth.verifyOtp({ type: "email", token_hash: link.properties.hashed_token });
  if (otpErr) throw new Error(`verifyOtp failed: ${otpErr.message}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addCookies([...jar.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));

  // Delay ONLY the request whose body/query references SESSION_A, so its response
  // lands after SESSION_B's fast one — the exact ordering needed to catch a stale
  // overwrite.
  await context.route("**/rest/v1/chat_messages*", async (route) => {
    const req = route.request();
    const url2 = req.url();
    if (url2.includes(encodeURIComponent(SESSION_A)) || url2.includes(SESSION_A)) {
      await new Promise((r) => setTimeout(r, 2500));
    }
    await route.continue();
  });

  const page = await context.newPage();
  await page.goto(`${BASE_URL}/student/history`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(800);

  const cards = page.locator('div.cursor-pointer');
  const count = await cards.count();
  console.log(`session cards found: ${count}`);
  const texts = await cards.allTextContents();
  console.log("card texts:", texts);

  // Click the card containing SESSION_A's subject name first (Pharmaceutical),
  // then immediately the one containing Cryptography (SESSION_B).
  const cardA = page.locator('div.cursor-pointer', { hasText: "PHARMACEUTICAL" }).first();
  const cardB = page.locator('div.cursor-pointer', { hasText: "Cryptography" }).first();

  await cardA.click();
  await page.waitForTimeout(50); // fire A's fetch, then immediately switch
  await cardB.click();

  await page.waitForTimeout(3500); // let both A's (delayed) and B's responses land

  const headerText = await page.locator("h2, .font-semibold").first().textContent().catch(() => null);
  const bodyText = await page.locator("main").innerText();
  const mentionsPharma = bodyText.includes("PHARMACEUTICAL") || bodyText.toLowerCase().includes("pharmaceutical");
  const mentionsCrypto = bodyText.toLowerCase().includes("cryptography") || bodyText.toLowerCase().includes("feistel") || bodyText.toLowerCase().includes("cipher");

  console.log("final right-pane header snippet:", headerText);
  console.log(`right pane mentions PHARMACEUTICAL (stale A) content: ${mentionsPharma}`);
  console.log(`right pane mentions Cryptography (intended B) content: ${mentionsCrypto}`);

  await page.screenshot({ path: "_audit_shell/screenshots/history-race-result.png", fullPage: false });

  await context.close();
  await browser.close();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exitCode = 1;
});
