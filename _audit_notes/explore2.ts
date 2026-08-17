import { loadEnvLocal } from "../src/lib/testing/httpHarness";
import { createClient } from "@supabase/supabase-js";

async function main() {
  loadEnvLocal();
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  for (const code of ["SECE2250", "IDME3532", "SECE3260"]) {
    const { data: subj } = await admin.from("subjects").select("id, name, code, semester, branch").eq("code", code).maybeSingle();
    if (!subj) { console.log(code, "NOT FOUND"); continue; }
    const { data: modules } = await admin.from("modules").select("id, module_number, name, description").eq("subject_id", subj.id).order("module_number");
    const { data: notes } = await admin.from("study_notes").select("id, scope, is_stale, version, module_id, content_hash, created_at").eq("subject_id", subj.id).order("created_at");
    const { data: pyq } = await admin.from("pyq_questions").select("id, co, document_id").eq("subject_id", subj.id).limit(5);
    const { data: coMap } = await admin.from("module_co_mapping").select("module_id, co_code").in("module_id", (modules ?? []).map((m:any)=>m.id)).limit(10);
    console.log(`\n=== ${code} — ${subj.name} (${subj.id}) sem${subj.semester} branch=${subj.branch} ===`);
    console.log("modules:", (modules ?? []).map((m:any) => `M${m.module_number}:${m.name}`));
    console.log("study_notes rows:", notes);
    console.log("pyq_questions sample:", pyq?.length ?? 0, pyq);
    console.log("module_co_mapping sample:", coMap?.length ?? 0);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
