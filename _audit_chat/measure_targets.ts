import { chromium } from "playwright";
import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

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

const SUBJECT_ID = "74e25bc8-d2bc-4a11-8242-e0fefae8f3af";
const BASE_URL = "http://localhost:3000";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `cp-audit-measure-${randomUUID().slice(0, 8)}@edunexus-harness.invalid`;
  const { data: created } = await admin.auth.admin.createUser({ email, password: `Hx-${randomUUID()}`, email_confirm: true });
  const userId = created.user!.id;
  for (let i = 0; i < 20; i++) {
    const { data } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (data) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await admin.from("profiles").update({ role: "student", branch: "CSE", semester: 1, department: "Engineering" }).eq("id", userId);
  const jar = new Map<string, string>();
  const browserLike = createBrowserClient(url, anonKey, {
    isSingleton: false,
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => { for (const { name, value } of list) jar.set(name, value); },
    },
  });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  await browserLike.auth.verifyOtp({ type: "email", token_hash: link.properties!.hashed_token! });

  const browser = await chromium.launch();
  for (const vp of [{ name: "mobile", width: 390, height: 844 }, { name: "desktop", width: 1280, height: 800 }]) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    await context.addCookies([...jar.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/student/chat/${SUBJECT_ID}`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1200);

    console.log(`\n--- ${vp.name} (${vp.width}x${vp.height}) ---`);
    const targets = [
      ["Send button", 'button:has-text("Send")'],
      ["Auto mode pill", 'button:has-text("Auto")'],
      ["Deep mode pill", 'button:has-text("Deep")'],
      ["Research mode pill", 'button:has-text("Research")'],
      ["Hamburger menu (mobile)", 'button[aria-label="Open menu"]'],
      ["Kebab / export menu", 'button[aria-haspopup]'],
    ] as const;
    for (const [label, selector] of targets) {
      const loc = page.locator(selector).first();
      const box = await loc.boundingBox().catch(() => null);
      if (box) console.log(`  ${label}: ${Math.round(box.width)}x${Math.round(box.height)}px ${box.height < 44 || box.width < 44 ? "  <-- UNDER 44px" : ""}`);
      else console.log(`  ${label}: not found/not visible`);
    }
    await context.close();
  }
  await browser.close();

  await admin.from("profiles").delete().eq("id", userId);
  await admin.auth.admin.deleteUser(userId);
  console.log("\ncleanup done");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exitCode = 1;
});
