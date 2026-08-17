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

  const { data: calls } = await admin
    .from("ai_call_logs")
    .select("task, cost_inr, feature, created_at")
    .eq("feature", "placement")
    .gte("created_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false });
  console.log("ai_call_logs (feature=placement, last 2h):", JSON.stringify(calls, null, 2));
  const totalCost = (calls ?? []).reduce((s: number, r: any) => s + (r.cost_inr ?? 0), 0);
  console.log("total cost INR:", totalCost, "call count:", (calls ?? []).length);

  // Leftover row check across every harness-audit email pattern used this run.
  const patterns = ["cp-harness-", "cp-audit-place-"];
  for (const table of [
    "profiles",
    "student_placement_profiles",
    "placement_topic_mastery",
    "placement_question_attempts",
    "placement_attempts",
    "practice_attempts",
  ]) {
    const { data } = await admin.from(table).select("*").limit(1000);
    const leftover = (data ?? []).filter((r: any) =>
      typeof r.email === "string" && patterns.some((p) => r.email.startsWith(p))
    );
    console.log(`${table}: total_rows_sampled=${(data ?? []).length} leftover_matching_harness_email=${leftover.length}`);
  }

  // Bank rows this run inserted via prep/generate (real AI-generated SQL Joins content) — sweep them.
  const { data: bankRows, error: bankErr } = await admin
    .from("placement_question_bank")
    .select("id, topic, topic_bucket, generated_at")
    .eq("topic", "SQL Queries & Joins")
    .gte("generated_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
  console.log("placement_question_bank rows generated this run (topic=SQL Queries & Joins, last 2h):", (bankRows ?? []).length);
  if (bankErr) console.log("bankErr", bankErr.message);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
