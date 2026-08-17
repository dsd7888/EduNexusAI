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

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: prof } = await admin.from("profiles").select("id").eq("email", "teststudent@gmail.com").maybeSingle();
  const userId = prof!.id;
  const { data: sessions } = await admin
    .from("chat_sessions")
    .select("id, subject_id, created_at, subjects(name, code)")
    .eq("student_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);
  console.log("chat_sessions:", JSON.stringify(sessions, null, 2));
  for (const s of sessions ?? []) {
    const { count } = await admin.from("chat_messages").select("id", { count: "exact", head: true }).eq("session_id", (s as any).id);
    console.log(`  session ${(s as any).id}: ${count} messages`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
