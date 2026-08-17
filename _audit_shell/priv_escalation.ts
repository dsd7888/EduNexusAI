/**
 * AU-SHELL runtime check: can a student's own RLS-scoped client (anon key + real
 * JWT — exactly what every browser tab holds) escalate its own `profiles.role`
 * via a direct Supabase table update, bypassing every app-level role check in
 * proxy.ts / requireRole()?
 *
 * The "Users can update own profile" RLS policy is:
 *   FOR UPDATE USING (auth.uid() = id)
 * with no WITH CHECK and, more importantly, no column allow-list — Postgres RLS
 * restricts which ROWS a client can touch, not which COLUMNS, unless a trigger
 * or column-level GRANT does that separately. This harness checks whether it
 * really does bypass.
 */
import {
  signInAsStudent,
  onSignals,
  hr,
  makeChecker,
} from "../src/lib/testing/httpHarness";

async function main() {
  const chk = makeChecker();
  const s = await signInAsStudent();
  onSignals(s.cleanup);

  hr("AU-SHELL: profiles RLS column-scope check (self privilege escalation)");
  console.log(`ephemeral student: ${s.email} (${s.userId})`);

  // Baseline via admin (bypasses RLS) — confirm starting role.
  const before = await s.admin
    .from("profiles")
    .select("role, branch, semester, department, must_change_password")
    .eq("id", s.userId)
    .single();
  console.log("before (admin view):", before.data, before.error?.message);

  // The exact call any authenticated student's browser tab can issue via the
  // shipped anon key + their own session — no server route involved at all.
  const upd = await s.client
    .from("profiles")
    .update({ role: "superadmin" })
    .eq("id", s.userId)
    .select("id, role");

  console.log("update() response:", JSON.stringify(upd));

  const after = await s.admin
    .from("profiles")
    .select("role")
    .eq("id", s.userId)
    .single();
  console.log("after (admin view):", after.data, after.error?.message);

  chk.check(
    "update() call itself reports an error (should, if blocked)",
    !!upd.error,
    upd.error ? upd.error.message : "NO ERROR — update call succeeded"
  );
  chk.check(
    "role in DB unchanged from 'student' after the update attempt",
    after.data?.role === "student",
    `role is now: ${after.data?.role}`
  );

  // Also check: can the student flip must_change_password / department (other
  // non-student-owned columns) on their own row the same way?
  const updDept = await s.client
    .from("profiles")
    .update({ department: "NOT-ENGINEERING" })
    .eq("id", s.userId)
    .select("id, department");
  const afterDept = await s.admin
    .from("profiles")
    .select("department")
    .eq("id", s.userId)
    .single();
  chk.check(
    "department column also NOT student-writable via own-row update",
    afterDept.data?.department === "Engineering",
    `department is now: ${afterDept.data?.department}, update() response: ${JSON.stringify(updDept)}`
  );

  // Blast-radius check: with role now (if the bug is real) 'superadmin' in the
  // DB, does the SAME already-issued JWT immediately unlock the
  // "Admins can view all profiles" RLS policy — i.e. cross-student PII read —
  // with no new login, no token refresh, nothing but the update() call above?
  const allProfiles = await s.client
    .from("profiles")
    .select("id, email, full_name, role")
    .limit(5);
  console.log(
    "cross-student profiles read after self-escalation:",
    JSON.stringify(allProfiles.data),
    allProfiles.error?.message
  );
  chk.check(
    "cross-student profile rows NOT readable after self-escalation (should be blocked)",
    !allProfiles.data || allProfiles.data.length <= 1,
    `read ${allProfiles.data?.length ?? 0} profile rows (other students: ${
      (allProfiles.data ?? []).filter((r: any) => r.id !== s.userId).length
    })`
  );

  const summary = chk.summary();
  console.log(`\n${summary.passed} passed, ${summary.failed} failed`);

  const note = await s.cleanup();
  console.log(`cleanup: ${note}`);
  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
