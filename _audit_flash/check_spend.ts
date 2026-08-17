import { loadEnvLocal } from "../src/lib/testing/httpHarness";
import { createClient } from "@supabase/supabase-js";

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key);

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // last hour
  const { data, error } = await admin
    .from("ai_call_logs")
    .select("id, feature, task, status, created_at, user_id")
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  console.log("ai_call_logs in last hour:", data?.length, error?.message);
  console.log(JSON.stringify(data, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
