import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const raw = readFileSync(".env.local", "utf8");
const env: Record<string, string> = {};
for (const line of raw.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  let val = t.slice(eq + 1).trim();
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  env[t.slice(0, eq).trim()] = val;
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data, error } = await admin
    .from("ai_call_logs")
    .select("id, cost_usd, feature, task, status, created_at")
    .eq("feature", "placement")
    .gte("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false });
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log("rows:", data.length);
  const total = data.reduce((a, r) => a + (Number(r.cost_usd) || 0), 0);
  console.log("total cost_usd:", total);
  console.log(JSON.stringify(data.slice(0, 5), null, 2));
}

main();
