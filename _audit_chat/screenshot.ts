/**
 * AU-CHAT UI verification: desktop + mobile, light + dark, of the chat page.
 * Re-derives a real @supabase/ssr browser session (same technique as
 * httpHarness.signInAsStudent) but keeps the raw cookie jar so the exact
 * cookies can be transplanted into a Playwright browser context.
 */
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvLocal();

const SUBJECT_ID = "74e25bc8-d2bc-4a11-8242-e0fefae8f3af";
const BASE_URL = "http://localhost:3000";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const email = `cp-audit-ui-${randomUUID().slice(0, 8)}@edunexus-harness.invalid`;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: `Hx-${randomUUID()}`,
    email_confirm: true,
    user_metadata: { full_name: "AU-CHAT UI Audit" },
  });
  if (createErr || !created.user) throw new Error(`createUser failed: ${createErr?.message}`);
  const userId = created.user.id;

  // wait for profile trigger
  for (let i = 0; i < 20; i++) {
    const { data } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (data) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await admin
    .from("profiles")
    .update({ role: "student", branch: "CSE", semester: 1, full_name: "AU-CHAT UI Audit", department: "Engineering" })
    .eq("id", userId);

  const jar = new Map<string, { value: string; raw: string }>();
  const browserLike = createBrowserClient(url, anonKey, {
    isSingleton: false,
    cookies: {
      getAll: () => [...jar.entries()].map(([name, v]) => ({ name, value: v.value })),
      setAll: (list) => {
        for (const { name, value } of list) jar.set(name, { value, raw: value });
      },
    },
  });

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !link.properties?.hashed_token) throw new Error(`generateLink failed: ${linkErr?.message}`);
  const { error: otpErr } = await browserLike.auth.verifyOtp({ type: "email", token_hash: link.properties.hashed_token });
  if (otpErr) throw new Error(`verifyOtp failed: ${otpErr.message}`);

  console.log(`signed in as ${email}, cookies: ${[...jar.keys()].join(", ")}`);

  // Seed a chat session + exchange so the screenshot has real content.
  const { data: sessRow, error: sessErr } = await admin
    .from("chat_sessions")
    .insert({ student_id: userId, subject_id: SUBJECT_ID })
    .select("id")
    .single();
  if (sessErr || !sessRow) throw new Error(`session insert failed: ${sessErr?.message}`);
  const sessionId = sessRow.id;
  await admin.from("chat_messages").insert([
    { session_id: sessionId, role: "user", content: "What is a Feistel network?" },
    {
      session_id: sessionId,
      role: "assistant",
      content:
        "A **Feistel network** is a symmetric structure used in block cipher design (e.g. DES). It splits the block into two halves and applies a round function repeatedly.\n\n1. Split the block into L0 and R0.\n2. For each round: L(i+1) = R(i), R(i+1) = L(i) XOR F(R(i), K(i)).\n3. Repeat for N rounds, then combine.\n\nThis structure makes encryption and decryption nearly identical to implement, which is a big practical win in hardware.\n\nWant a quick quiz on this?",
      status: "done",
      model_used: "gemini-2.5-flash",
    },
  ]);
  console.log(`seeded session ${sessionId} with 2 messages`);

  const browser = await chromium.launch();
  const cookiesForPlaywright = [...jar.entries()].map(([name, v]) => ({
    name,
    value: v.value,
    domain: "localhost",
    path: "/",
  }));

  const viewports: { name: string; width: number; height: number }[] = [
    { name: "desktop", width: 1280, height: 800 },
    { name: "mobile", width: 390, height: 844 },
  ];
  const schemes: ("light" | "dark")[] = ["light", "dark"];

  for (const vp of viewports) {
    for (const scheme of schemes) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: scheme,
      });
      await context.addCookies(cookiesForPlaywright);
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/student/chat/${SUBJECT_ID}`, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(1500);
      const path = `_audit_chat/screenshots/chat-${vp.name}-${scheme}.png`;
      await page.screenshot({ path, fullPage: false });
      console.log(`wrote ${path}`);

      // Also probe: is there ANY collapse control for the desktop sidebar?
      if (vp.name === "desktop") {
        const asideVisible = await page.locator("aside").first().isVisible().catch(() => false);
        const collapseButtons = await page
          .locator('button[aria-label*="collapse" i], button[aria-label*="Collapse" i]')
          .count();
        console.log(`  desktop aside visible=${asideVisible}, collapse-labeled buttons found=${collapseButtons}`);

        // Measure viewport vs. composer bottom gap.
        const composer = page.locator("textarea, [data-composer]").first();
        const box = await composer.boundingBox().catch(() => null);
        console.log(`  composer boundingBox=${JSON.stringify(box)} viewportHeight=${vp.height}`);
        if (box) {
          const gap = vp.height - (box.y + box.height);
          console.log(`  gap between composer bottom and viewport bottom = ${gap}px`);
        }
        // Check whole-page scrollability (outer main overflow-auto).
        const bodyScrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        console.log(`  document.scrollHeight=${bodyScrollHeight} vs viewport ${vp.height} (extra=${bodyScrollHeight - vp.height})`);
      }
      await context.close();
    }
  }

  await browser.close();

  // cleanup
  await admin.from("chat_messages").delete().eq("session_id", sessionId);
  await admin.from("chat_sessions").delete().eq("id", sessionId);
  await admin.from("profiles").delete().eq("id", userId);
  await admin.auth.admin.deleteUser(userId);
  console.log("cleanup done");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exitCode = 1;
});
