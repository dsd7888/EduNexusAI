import { loadEnvLocal } from "../src/lib/testing/httpHarness";
import { createClient } from "@supabase/supabase-js";

async function main() {
  loadEnvLocal();
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: profile } = await admin.from("profiles").select("id, branch, semester, role").eq("email", "teststudent@gmail.com").maybeSingle();
  console.log("profile:", profile);
  if (!profile) return;
  const { data: offerings } = await admin.from("subject_offerings").select("subject_id, branch").eq("branch", profile.branch).limit(50);
  const subjectIds = (offerings ?? []).map((o: any) => o.subject_id);
  console.log("offerings count:", subjectIds.length);
  for (const sid of subjectIds) {
    const { data: subj } = await admin.from("subjects").select("id, name, code, semester").eq("id", sid).maybeSingle();
    const { data: content } = await admin.from("subject_content").select("content").eq("subject_id", sid).maybeSingle();
    const { data: modules } = await admin.from("modules").select("id, module_number, name").eq("subject_id", sid).order("module_number");
    const { data: notes } = await admin.from("study_notes").select("id, scope, is_stale, version, module_id").eq("subject_id", sid);
    console.log(`- ${subj?.code} ${subj?.name} sem${subj?.semester} content=${content?.content ? content.content.length + "chars" : "NONE"} modules=${modules?.length ?? 0} notes_rows=${notes?.length ?? 0}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
