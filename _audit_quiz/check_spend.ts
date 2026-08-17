import { loadEnvLocal } from "../src/lib/testing/httpHarness";
import { createClient } from "@supabase/supabase-js";

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key);
  const since = process.argv[2] ?? new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("ai_call_logs")
    .select("id, feature, task, model, cost_usd, status, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  if (error) { console.error(error); return; }
  console.log(`rows since ${since}: ${data?.length}`);
  let total = 0;
  for (const r of data ?? []) {
    total += Number(r.cost_usd ?? 0);
    console.log(`${r.created_at} ${r.feature} ${r.task} ${r.model} $${r.cost_usd} ${r.status}`);
  }
  console.log(`TOTAL: $${total.toFixed(4)}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
