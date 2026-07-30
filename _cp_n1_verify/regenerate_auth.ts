/**
 * CP-N1 harness 4 — who may spend money rebuilding notes.
 *
 * Driven over REAL HTTP through proxy.ts and the route handlers, not by calling
 * lib functions: the claim is about a ROUTE's status codes, and a direct call
 * would skip cookie parsing, requireAuth and the role gate that actually
 * enforce them.
 *
 * Three sessions, because two of them are what distinguish a working policy
 * from one that simply denies everybody:
 *
 *   student                    POST /regenerate -> 403   (consumes, never spends)
 *   faculty WITHOUT assignment POST /regenerate -> 403   (role alone is not enough)
 *   faculty WITH assignment    POST /regenerate -> 200   (the positive control)
 *
 * Plus the read side, since a checkpoint that only proves things are blocked
 * passes just as well against an outage: the student must still be able to GET
 * the notes they are entitled to.
 *
 * Requires `npm run dev`.
 * Run: npx tsx _cp_n1_verify/regenerate_auth.ts > /tmp/cpn1_auth.log 2>&1
 */
import {
  signInAsStudent,
  waitForServer,
  type StudentSession,
} from "@/lib/testing/httpHarness";

import {
  loadEnvLocal,
  adminClient,
  makeChecker,
  hr,
  sub,
  onSignals,
  resolveModule,
  purgeNotes,
  FIXTURES,
} from "./shared";

loadEnvLocal();

async function main() {
  const admin = adminClient();
  const { check, eq, summary } = makeChecker();

  hr("CP-N1 harness 4 — regenerate_auth");

  await waitForServer();

  const target = await resolveModule(
    admin,
    FIXTURES.IDSH2020.code,
    FIXTURES.IDSH2020.moduleOne
  );
  console.log(`target: ${target.subjectCode} M${target.moduleNumber} "${target.moduleName}"`);

  // The branch this subject is actually offered to — the student's read access
  // is resolved through subject_offerings, so an arbitrary branch would 403 for
  // the right reason and prove nothing.
  const { data: offering } = await admin
    .from("subject_offerings")
    .select("branch, semester")
    .eq("subject_id", target.subjectId)
    .limit(1)
    .maybeSingle();
  if (!offering) throw new Error("fixture subject has no offering");
  console.log(`offered to: branch=${offering.branch} semester=${offering.semester}`);

  const sessions: StudentSession[] = [];
  let assignmentId: string | null = null;

  let cleaned = false;
  const cleanup = async (): Promise<string> => {
    if (cleaned) return "already cleaned";
    cleaned = true;
    const notes: string[] = [];
    if (assignmentId) {
      await admin.from("faculty_assignments").delete().eq("id", assignmentId);
      const { count } = await admin
        .from("faculty_assignments")
        .select("*", { count: "exact", head: true })
        .eq("id", assignmentId);
      notes.push(`assignment removed (residual=${count ?? 0})`);
    }
    for (const s of sessions) {
      try {
        notes.push(await s.cleanup());
      } catch (e) {
        notes.push(`session cleanup failed: ${String(e).slice(0, 80)}`);
      }
    }
    notes.push(`study_notes residual=${await purgeNotes(admin, [target.moduleId])}`);
    return notes.join("; ");
  };
  onSignals(cleanup);

  try {
    await purgeNotes(admin, [target.moduleId]);

    const student = await signInAsStudent(undefined, undefined, {
      role: "student",
      branch: offering.branch,
      semester: offering.semester,
      fullName: "CP-N1 Student",
    });
    sessions.push(student);

    const facultyUnassigned = await signInAsStudent(undefined, undefined, {
      role: "faculty",
      branch: offering.branch,
      semester: offering.semester,
      fullName: "CP-N1 Faculty (unassigned)",
    });
    sessions.push(facultyUnassigned);

    const facultyAssigned = await signInAsStudent(undefined, undefined, {
      role: "faculty",
      branch: offering.branch,
      semester: offering.semester,
      fullName: "CP-N1 Faculty (assigned)",
    });
    sessions.push(facultyAssigned);

    // faculty_assignments.assigned_by is NOT NULL — in production the
    // superadmin who made the assignment. Borrow a real one rather than
    // inventing a uuid, so the FK holds.
    const { data: assigner } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "superadmin")
      .limit(1)
      .maybeSingle();
    if (!assigner) throw new Error("no superadmin profile to attribute the assignment to");

    const { data: assignment, error: assignErr } = await admin
      .from("faculty_assignments")
      .insert({
        faculty_id: facultyAssigned.userId,
        subject_id: target.subjectId,
        assigned_by: assigner.id,
      })
      .select("id")
      .single();
    if (assignErr || !assignment) {
      throw new Error(`could not create assignment: ${assignErr?.message}`);
    }
    assignmentId = assignment.id;
    console.log(`assigned faculty ${facultyAssigned.userId} -> ${target.subjectCode}`);

    const GET_PATH = `/api/notes/module/${target.moduleId}`;
    const POST_PATH = `${GET_PATH}/regenerate`;

    // ── Read side ────────────────────────────────────────────────────────────
    sub("GET — the read side still works for those entitled to it");
    const studentGet = await student.json<{ blocks?: unknown[]; version?: number; source?: string }>(
      GET_PATH
    );
    eq("student GET is 200", studentGet.status, 200);
    check(
      "student receives blocks",
      Array.isArray(studentGet.body?.blocks) && studentGet.body.blocks.length > 0,
      `${studentGet.body?.blocks?.length ?? 0} blocks, source=${studentGet.body?.source}`
    );

    const unassignedGet = await facultyUnassigned.json(GET_PATH);
    eq("unassigned faculty GET is 403", unassignedGet.status, 403);

    const assignedGet = await facultyAssigned.json<{ blocks?: unknown[] }>(GET_PATH);
    eq("assigned faculty GET is 200", assignedGet.status, 200);

    // ── Write side ───────────────────────────────────────────────────────────
    sub("POST /regenerate — only assigned faculty may spend");

    const studentPost = await student.json<{ error?: string }>(POST_PATH, {
      method: "POST",
    });
    eq("student POST /regenerate is 403", studentPost.status, 403);
    check(
      "student refusal names the role gate",
      String(studentPost.body?.error ?? "").toLowerCase().includes("faculty"),
      String(studentPost.body?.error)
    );

    const unassignedPost = await facultyUnassigned.json<{ error?: string }>(POST_PATH, {
      method: "POST",
    });
    eq("unassigned faculty POST /regenerate is 403", unassignedPost.status, 403);
    check(
      "unassigned refusal names the assignment, not the role",
      String(unassignedPost.body?.error ?? "").toLowerCase().includes("assigned"),
      String(unassignedPost.body?.error)
    );

    // Positive control. Without it, every assertion above would pass against a
    // route that refuses everyone.
    const before = await admin
      .from("study_notes")
      .select("version, is_stale")
      .eq("module_id", target.moduleId)
      .order("version");
    const assignedPost = await facultyAssigned.json<{ version?: number; source?: string }>(
      POST_PATH,
      { method: "POST" }
    );
    eq("assigned faculty POST /regenerate is 200", assignedPost.status, 200);
    check(
      "regeneration produced a new version",
      (assignedPost.body?.version ?? 0) > (before.data?.[0]?.version ?? 0),
      `v${before.data?.[0]?.version ?? 0} -> v${assignedPost.body?.version}`
    );
    eq("regenerated notes are fresh, not cached", assignedPost.body?.source, "fresh");

    const { data: after } = await admin
      .from("study_notes")
      .select("version, is_stale")
      .eq("module_id", target.moduleId)
      .order("version");
    const stale = (after ?? []).filter((r) => r.is_stale);
    check(
      "every previous version was marked stale",
      stale.length === (after?.length ?? 0) - 1,
      `${stale.length} stale of ${after?.length ?? 0}`
    );

    sub("unauthenticated");
    const anon = await fetch(`http://localhost:3000${POST_PATH}`, { method: "POST" });
    check(
      "anonymous POST is refused (401/403/redirect)",
      [401, 403, 307, 302].includes(anon.status),
      String(anon.status)
    );

    const { passed, failed } = summary();
    console.log(`\n${passed} passed, ${failed} failed`);
    console.log(`cleanup: ${await cleanup()}`);
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error("harness error:", err);
    console.log(`cleanup: ${await cleanup()}`);
    process.exit(1);
  }
}

main();
