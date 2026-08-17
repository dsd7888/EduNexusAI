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

  const email = `cp-audit-debug-${randomUUID().slice(0, 8)}@edunexus-harness.invalid`;
  const { data: created } = await admin.auth.admin.createUser({
    email,
    password: `Hx-${randomUUID()}`,
    email_confirm: true,
  });
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

  const { data: sessRow } = await admin
    .from("chat_sessions")
    .insert({ student_id: userId, subject_id: SUBJECT_ID })
    .select("id, created_at")
    .single();
  const sessionId = sessRow!.id;
  console.log(`created session ${sessionId} at ${sessRow!.created_at}`);

  const { error: insErr } = await admin.from("chat_messages").insert([
    { session_id: sessionId, role: "user", content: "debug question" },
    { session_id: sessionId, role: "assistant", content: "debug answer content" },
  ]);
  console.log(`insert error: ${insErr ? JSON.stringify(insErr) : "none"}`);
  const { data: msgCheck } = await admin.from("chat_messages").select("id, role").eq("session_id", sessionId);
  console.log(`admin can see ${msgCheck?.length} messages via service role`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addCookies(
    [...jar.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }))
  );
  const page = await context.newPage();

  page.on("console", (msg) => console.log(`[browser console] ${msg.type()}: ${msg.text()}`));
  page.on("requestfailed", (req) => console.log(`[request failed] ${req.url()} ${req.failure()?.errorText}`));
  page.on("response", async (res) => {
    const u = res.url();
    if (u.includes("/api/chat/session") || u.includes("/rest/v1/chat_messages") || u.includes("/rest/v1/chat_sessions")) {
      console.log(`[response] ${res.status()} ${u}`);
    }
  });

  await page.goto(`${BASE_URL}/student/chat/${SUBJECT_ID}`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2500);

  const bodyText = await page.locator("body").innerText();
  console.log("--- shows 'debug question'? ---", bodyText.includes("debug question"));
  console.log("--- shows 'Resumed'? ---", bodyText.includes("Resumed"));
  console.log("--- shows suggestion grid text (empty state)? ---", bodyText.includes("Ask anything"));

  await browser.close();

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
