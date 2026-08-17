/**
 * Follow-up to priv_escalation.ts: once student A has self-escalated
 * `profiles.role` to 'superadmin' via a direct RLS-scoped update() (see
 * priv_escalation.ts), does the SAME session's client also satisfy the
 * "Admins can update all profiles" FOR ALL RLS policy well enough to WRITE
 * another real student's row (not just read it)? Uses two disposable
 * harness-created accounts only — never touches real seeded accounts.
 */
import { signInAsStudent, onSignals, hr, makeChecker } from "../src/lib/testing/httpHarness";

async function main() {
  const chk = makeChecker();
  const a = await signInAsStudent();
  const b = await signInAsStudent();
  onSignals(async () => {
    const n1 = await a.cleanup();
    const n2 = await b.cleanup();
    return `${n1}; ${n2}`;
  });

  hr("AU-SHELL: cross-student WRITE after self-escalation (two disposable accounts)");
  console.log(`A (attacker): ${a.email} (${a.userId})`);
  console.log(`B (victim):   ${b.email} (${b.userId})`);

  // A escalates itself.
  const esc = await a.client.from("profiles").update({ role: "superadmin" }).eq("id", a.userId);
  console.log("A self-escalation error:", esc.error?.message ?? "none");

  // A now attempts to overwrite B's branch/semester/role using A's own client
  // (same JWT as before, no re-login).
  const crossWrite = await a.client
    .from("profiles")
    .update({ branch: "MECH", semester: 8, role: "faculty" })
    .eq("id", b.userId)
    .select("id, branch, semester, role");
  console.log("A -> B cross-write response:", JSON.stringify(crossWrite));

  const bAfter = await b.admin
    .from("profiles")
    .select("branch, semester, role")
    .eq("id", b.userId)
    .single();
  console.log("B row per admin after A's write attempt:", bAfter.data);

  chk.check(
    "B's profile was NOT modified by A (should be blocked)",
    bAfter.data?.role === "student" && bAfter.data?.branch === "CSE",
    `B is now: ${JSON.stringify(bAfter.data)}`
  );

  const summary = chk.summary();
  console.log(`\n${summary.passed} passed, ${summary.failed} failed`);
  const n1 = await a.cleanup();
  const n2 = await b.cleanup();
  console.log(`cleanup A: ${n1}`);
  console.log(`cleanup B: ${n2}`);
  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
