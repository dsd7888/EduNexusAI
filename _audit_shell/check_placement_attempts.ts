import { signInAsStudent, onSignals, hr } from "../src/lib/testing/httpHarness";

async function main() {
  const s = await signInAsStudent(undefined, undefined, { templateEmail: "teststudent@gmail.com" });
  onSignals(s.cleanup);
  hr("AU-SHELL: dashboard's usePlacementHistory query against `placement_attempts`");

  const res = await s.client
    .from("placement_attempts")
    .select("id, company_id, score, category_scores, time_taken, created_at")
    .eq("student_id", s.userId)
    .order("created_at", { ascending: false })
    .limit(5);
  console.log("client (RLS, same as browser) query result:", JSON.stringify(res, null, 2));

  const note = await s.cleanup();
  console.log(`cleanup: ${note}`);
}
main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
