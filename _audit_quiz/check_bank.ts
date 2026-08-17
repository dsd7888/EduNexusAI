import { loadEnvLocal } from "../src/lib/testing/httpHarness";
import { createClient } from "@supabase/supabase-js";

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key);
  const { data } = await admin
    .from("faculty_question_bank")
    .select("id, question_type, question_text, module_id")
    .eq("subject_id", "b862c433-29d1-4e43-ac54-4a1369a7f195");
  const byType: Record<string, number> = {};
  for (const q of data ?? []) {
    byType[q.question_type] = (byType[q.question_type] ?? 0) + 1;
  }
  console.log(JSON.stringify(byType, null, 2));
  console.log("total:", data?.length);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
