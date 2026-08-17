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
  const { data: prof } = await admin.from("profiles").select("id, full_name, role").eq("email", "teststudent@gmail.com").maybeSingle();
  console.log("teststudent profile:", prof);
  const userId = prof!.id;

  const { count: v1Count } = await admin.from("quiz_attempts").select("id", { count: "exact", head: true }).eq("student_id", userId);
  const { count: v2Count } = await admin.from("quiz_sessions").select("id", { count: "exact", head: true }).eq("student_id", userId);
  const { data: v2Completed } = await admin
    .from("quiz_sessions")
    .select("id, status, created_at, mode")
    .eq("student_id", userId)
    .order("created_at", { ascending: false })
    .limit(5);
  console.log(`quiz_attempts (v1, what dashboard reads) rows for this student: ${v1Count}`);
  console.log(`quiz_sessions (v2, what the real engine writes) rows for this student: ${v2Count}`);
  console.log("most recent quiz_sessions:", v2Completed);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
