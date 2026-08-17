import { loadEnvLocal } from "../src/lib/testing/httpHarness";
import { createClient } from "@supabase/supabase-js";

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key);

  const { data: harnessUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const leftoverHarness = (harnessUsers?.users ?? []).filter((u: any) => u.email?.includes("edunexus-harness.invalid"));
  console.log("leftover harness auth users:", leftoverHarness.length, leftoverHarness.map((u:any)=>u.email));

  const { data: testStudentProfile } = await admin.from("profiles").select("id").eq("email", "teststudent@gmail.com").maybeSingle();
  const { data: tsSessions } = await admin.from("quiz_sessions").select("id, mode, status, created_at").eq("student_id", testStudentProfile?.id);
  console.log("teststudent@gmail.com quiz_sessions remaining:", tsSessions?.length, tsSessions);

  const { count: mastery } = await admin.from("student_topic_mastery").select("id", { count: "exact", head: true }).eq("student_id", testStudentProfile?.id);
  console.log("teststudent mastery rows:", mastery);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
