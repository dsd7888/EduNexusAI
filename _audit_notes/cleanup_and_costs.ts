import { loadEnvLocal } from "../src/lib/testing/httpHarness";
import { createClient } from "@supabase/supabase-js";

const SECE2250 = "b862c433-29d1-4e43-ac54-4a1369a7f195";
const IDME3532 = "113969c6-5c0e-452b-8689-33c5cae95ae5";
const SECE3260 = "74e25bc8-d2bc-4a11-8242-e0fefae8f3af";

async function main() {
  loadEnvLocal();
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  console.log("── AI call log spend for this audit run (feature=notes, last hour) ──");
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: logs } = await admin
    .from("ai_call_logs")
    .select("id, task, feature, status, cost_inr, tokens_input, tokens_output, created_at, user_id")
    .gte("created_at", since)
    .order("created_at");
  const notesLogs = (logs ?? []).filter((l: any) => l.feature === "notes");
  const chatMislabelled = (logs ?? []).filter((l: any) => l.task?.startsWith("notes") && l.feature !== "notes");
  console.log(`total ai_call_logs rows in last hour: ${logs?.length ?? 0}`);
  console.log(`feature=notes rows: ${notesLogs.length}`);
  console.log(`notes-task rows mislabelled under a different feature: ${chatMislabelled.length}`, chatMislabelled);
  const totalCost = notesLogs.reduce((s: number, l: any) => s + (l.cost_inr ?? 0), 0);
  console.log(`aggregate cost_inr for feature=notes in window: ${totalCost}`);
  for (const l of notesLogs) {
    console.log(`  ${l.created_at} task=${l.task} status=${l.status} cost=${l.cost_inr} tokens_in=${l.tokens_input} tokens_out=${l.tokens_output}`);
  }

  console.log("\n── Cleanup: deleting audit-generated study_notes rows ──");
  const del = async (label: string, subjectId: string, extra: Record<string, unknown>) => {
    const { data, error } = await admin.from("study_notes").select("id").eq("subject_id", subjectId).match(extra);
    console.log(`  ${label}: found ${data?.length ?? 0} row(s) to delete`, error ? `ERROR: ${error.message}` : "");
    if (data && data.length > 0) {
      const { error: delErr } = await admin.from("study_notes").delete().eq("subject_id", subjectId).match(extra);
      console.log(`    delete result: ${delErr ? `ERROR: ${delErr.message}` : "ok"}`);
    }
  };

  // SECE2250 module 1 — fresh generation from section 1
  const { data: sece2250Mod1 } = await admin.from("modules").select("id").eq("subject_id", SECE2250).eq("module_number", 1).maybeSingle();
  if (sece2250Mod1) await del("SECE2250 module 1 notes", SECE2250, { module_id: sece2250Mod1.id, scope: "module" });

  // IDME3532 subject-scope assembly row
  await del("IDME3532 subject-scope notes", IDME3532, { scope: "subject" });

  // SECE3260 module 3 — created by the concurrency race test
  const { data: sece3260Mod3 } = await admin.from("modules").select("id").eq("subject_id", SECE3260).eq("module_number", 3).maybeSingle();
  if (sece3260Mod3) await del("SECE3260 module 3 notes", SECE3260, { module_id: sece3260Mod3.id, scope: "module" });

  console.log("\n── Verify: DB back to original state ──");
  for (const [label, sid] of [["SECE2250", SECE2250], ["IDME3532", IDME3532], ["SECE3260", SECE3260]] as const) {
    const { data: rows } = await admin.from("study_notes").select("id, scope, module_id, version").eq("subject_id", sid);
    console.log(`  ${label}: ${rows?.length ?? 0} study_notes row(s) remaining`);
  }

  // teststudent@gmail.com usage_analytics pollution check (should be 0 new rows — all our
  // reads against it were cache hits per the harness log)
  const { data: profile } = await admin.from("profiles").select("id").eq("email", "teststudent@gmail.com").maybeSingle();
  if (profile) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await admin
      .from("usage_analytics")
      .select("event_type, event_count, subject_id")
      .eq("user_id", profile.id)
      .eq("date", today)
      .in("subject_id", [SECE2250, IDME3532, SECE3260]);
    console.log(`  teststudent@gmail.com usage_analytics rows today for audited subjects: ${JSON.stringify(usage)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
