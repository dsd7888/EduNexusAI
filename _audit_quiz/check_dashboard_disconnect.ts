import { loadEnvLocal } from "../src/lib/testing/httpHarness";
import { createClient } from "@supabase/supabase-js";

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key);

  const { count: qsCount } = await admin
    .from("quiz_sessions")
    .select("id", { count: "exact", head: true })
    .eq("status", "completed");
  console.log("quiz_sessions completed (all students, all time):", qsCount);

  const { count: qaCount } = await admin
    .from("quiz_attempts")
    .select("id", { count: "exact", head: true });
  console.log("quiz_attempts rows (old v1 table, all time):", qaCount);

  const { count: quizzesCount } = await admin
    .from("quizzes")
    .select("id", { count: "exact", head: true });
  console.log("quizzes rows (old v1 table, all time):", quizzesCount);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
