import { loadEnvLocal } from "../src/lib/testing/httpHarness";
import { createClient } from "@supabase/supabase-js";

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key);

  const { data: subs } = await admin
    .from("subjects")
    .select("id, name, code, branch, semester")
    .eq("branch", "CSE")
    .order("semester", { ascending: true });
  console.log(`subjects: ${subs?.length}`);

  for (const s of subs ?? []) {
    const { count: modCount } = await admin
      .from("modules")
      .select("id", { count: "exact", head: true })
      .eq("subject_id", s.id);
    const { count: bankCount } = await admin
      .from("faculty_question_bank")
      .select("id", { count: "exact", head: true })
      .eq("subject_id", s.id);
    if ((modCount ?? 0) > 0) {
      console.log(
        `${s.code} sem${s.semester} — ${s.name} — modules=${modCount} bank=${bankCount}  id=${s.id}`
      );
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
