import { loadEnvLocal } from "../src/lib/testing/httpHarness";
import { createClient } from "@supabase/supabase-js";

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key);

  const { data: notes, error } = await admin
    .from("study_notes")
    .select("subject_id, module_id, version, created_at")
    .order("created_at", { ascending: false })
    .limit(30);
  console.log("study_notes rows:", notes?.length, error);
  console.log(JSON.stringify(notes, null, 2));

  const { data: student } = await admin
    .from("profiles")
    .select("id, email, role, branch, semester")
    .eq("email", "teststudent@gmail.com")
    .maybeSingle();
  console.log("teststudent profile:", student);

  if (student) {
    const { data: subs } = await admin
      .from("subjects")
      .select("id, code, name, branch, semester")
      .eq("branch", student.branch)
      .eq("semester", student.semester);
    console.log("subjects offered:", JSON.stringify(subs, null, 2));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
