import { loadEnvLocal } from "../src/lib/testing/httpHarness";
import { createClient } from "@supabase/supabase-js";

async function main() {
  loadEnvLocal();
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: latest, error } = await admin
    .from("ai_call_logs")
    .select("id, task, feature, status, cost_inr, created_at")
    .order("created_at", { ascending: false })
    .limit(15);
  console.log("latest 15 ai_call_logs rows overall:", error ?? "");
  for (const l of latest ?? []) console.log(`  ${l.created_at} task=${l.task} feature=${l.feature} status=${l.status} cost=${l.cost_inr}`);

  const { data: notesTask, error: e2 } = await admin
    .from("ai_call_logs")
    .select("id, task, feature, status, cost_inr, created_at")
    .ilike("task", "notes%")
    .order("created_at", { ascending: false })
    .limit(15);
  console.log("\nrows with task LIKE 'notes%':", e2 ?? "", notesTask?.length);
  for (const l of notesTask ?? []) console.log(`  ${l.created_at} task=${l.task} feature=${l.feature} status=${l.status} cost=${l.cost_inr}`);

  console.log("\nserver clock check (now):", new Date().toISOString());
}

main().catch((e) => { console.error(e); process.exit(1); });
