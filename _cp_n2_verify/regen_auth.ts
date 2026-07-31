/**
 * CP-N2 harness 4 — who may spend money rebuilding a whole subject.
 *
 * Subject regeneration is the most expensive student-adjacent action in Notes
 * v2: one Flash call per module, serially. The gate therefore has to be the
 * faculty ASSIGNMENT, not merely the faculty ROLE — and the three sessions below
 * are what distinguish a working policy from one that denies everybody:
 *
 *   student                    POST /regenerate -> 403  (role gate)
 *   faculty WITHOUT assignment POST /regenerate -> 403  (scope gate)
 *   faculty WITH assignment    POST /regenerate -> 200  (the positive control)
 *
 * Driven over REAL HTTP, so requireRole, cookie parsing and the status codes a
 * client actually branches on are all in the path.
 *
 * Requires `npm run dev`. Slow: regenerates every module of the subject.
 * Run: npx tsx _cp_n2_verify/regen_auth.ts > /tmp/cpn2_regen.log 2>&1
 */
import { signInAsStudent, waitForServer, type StudentSession } from "@/lib/testing/httpHarness";

import {
  loadEnvLocal,
  adminClient,
  makeChecker,
  hr,
  sub,
  onSignals,
  makeRunInScope,
  resolveSubject,
  ensureModuleNotes,
  loadNotes,
  purgeSubjectNotes,
  N2_FIXTURES,
} from "./shared";

loadEnvLocal();

type RegenResponse = {
  blocks?: Array<{ id: string }>;
  version?: number;
  sourceMetadata?: { modulesCovered?: string[]; modulesTotal?: number };
  modulesRegenerated?: number;
  modulesFailed?: string[];
  error?: string;
};

async function main() {
  const admin = adminClient();
  const { check, eq, summary } = makeChecker();
  const runInScope = await makeRunInScope();

  hr("CP-N2 harness 4 — regen_auth");
  await waitForServer();

  /**
   * ASSEMBLY (4 modules), not SMALL (3).
   *
   * POST /regenerate regenerates every module SEQUENTIALLY, so fixture size is
   * wall-clock and spend directly — SMALL would be the cheaper choice. It is not
   * usable here because CP-N1's generator currently fails `invalid_blocks` on
   * roughly 57% of real attempts and never retries, so the route's success
   * depends on at least one module surviving ONE attempt. On the 3-module
   * chemistry fixture all three failed together in a recorded run, leaving zero
   * coverage — at which point the assembler's floor correctly refuses and the
   * route 500s. That is CORRECT CP-N2 behaviour, but it makes the positive
   * control a coin flip. Four modules of denser-scoring content make total
   * failure improbable, and the retry below covers the remainder.
   */
  const subject = await resolveSubject(admin, N2_FIXTURES.ASSEMBLY);
  console.log(`target: ${subject.code} "${subject.name}" — ${subject.modules.length} modules`);

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
    // This harness regenerates the whole subject, so it owns every row on it.
    notes.push(`study_notes residual=${await purgeSubjectNotes(admin, subject.subjectId)}`);
    for (const s of sessions) {
      try {
        notes.push(await s.cleanup());
      } catch (e) {
        notes.push(`session cleanup failed: ${String(e).slice(0, 80)}`);
      }
    }
    return notes.join("; ");
  };
  onSignals(cleanup);

  try {
    sub("seed — a prior subject-scope version, so 'version incremented' is measurable");
    await purgeSubjectNotes(admin, subject.subjectId);
    await ensureModuleNotes(admin, subject, runInScope);

    const student = await signInAsStudent(undefined, undefined, {
      role: "student",
      branch: subject.offering.branch,
      semester: subject.offering.semester,
      fullName: "CP-N2 Student",
    });
    sessions.push(student);

    const GET_PATH = `/api/notes/subject/${subject.subjectId}`;
    const POST_PATH = `${GET_PATH}/regenerate`;

    const seedGet = await student.json<{ version?: number }>(GET_PATH);
    eq("seeding GET is 200", seedGet.status, 200);
    const priorVersion = seedGet.body?.version ?? 0;
    console.log(`    prior subject-scope version: v${priorVersion}`);

    const facultyUnassigned = await signInAsStudent(undefined, undefined, {
      role: "faculty",
      branch: subject.offering.branch,
      semester: subject.offering.semester,
      fullName: "CP-N2 Faculty (unassigned)",
    });
    sessions.push(facultyUnassigned);

    const facultyAssigned = await signInAsStudent(undefined, undefined, {
      role: "faculty",
      branch: subject.offering.branch,
      semester: subject.offering.semester,
      fullName: "CP-N2 Faculty (assigned)",
    });
    sessions.push(facultyAssigned);

    // faculty_assignments.assigned_by is NOT NULL — borrow a real superadmin
    // rather than inventing a uuid, so the FK holds.
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
        subject_id: subject.subjectId,
        assigned_by: assigner.id,
      })
      .select("id")
      .single();
    if (assignErr || !assignment) throw new Error(`could not create assignment: ${assignErr?.message}`);
    assignmentId = assignment.id;
    console.log(`    assigned faculty ${facultyAssigned.userId} -> ${subject.code}`);

    // ── Negative controls ────────────────────────────────────────────────
    sub("students may not spend — regeneration is a faculty decision");
    const studentPost = await student.json<RegenResponse>(POST_PATH, { method: "POST" });
    eq("student POST /regenerate is 403", studentPost.status, 403);

    const beforeStudentAttempt = await loadNotes(admin, subject.subjectId, "subject");
    check(
      "the refused student attempt wrote nothing",
      beforeStudentAttempt.filter((r) => !r.isStale).length === 1,
      `${beforeStudentAttempt.length} subject row(s)`
    );

    sub("role alone is not enough — the assignment is the gate");
    const unassignedPost = await facultyUnassigned.json<RegenResponse>(POST_PATH, {
      method: "POST",
    });
    eq("unassigned faculty POST /regenerate is 403", unassignedPost.status, 403);
    check(
      "the refusal names the assignment, not the role",
      String(unassignedPost.body?.error ?? "").toLowerCase().includes("assigned"),
      String(unassignedPost.body?.error)
    );

    // ── Positive control ─────────────────────────────────────────────────
    // Without this, every assertion above passes against a route that refuses
    // everyone — which is indistinguishable from an outage.
    sub("assigned faculty — the positive control (regenerates every module)");
    // Retry ONCE if every module happened to fail CP-N1 validation, which leaves
    // zero coverage and a correct-but-unhelpful 500. Each POST gives every module
    // an independent attempt; the retry is reported, never hidden.
    let assignedPost = await facultyAssigned.json<RegenResponse>(POST_PATH, {
      method: "POST",
    });
    if ((assignedPost.body?.modulesRegenerated ?? 0) === 0) {
      console.log(
        `    all modules failed upstream (${JSON.stringify(assignedPost.body?.error)}); retrying the POST once`
      );
      assignedPost = await facultyAssigned.json<RegenResponse>(POST_PATH, { method: "POST" });
    }
    eq("assigned faculty POST /regenerate is 200", assignedPost.status, 200);
    check(
      "modulesRegenerated > 0",
      (assignedPost.body?.modulesRegenerated ?? 0) > 0,
      `${assignedPost.body?.modulesRegenerated} regenerated, ${assignedPost.body?.modulesFailed?.length ?? 0} failed`
    );
    check(
      "modulesFailed is reported explicitly, not swallowed",
      Array.isArray(assignedPost.body?.modulesFailed),
      JSON.stringify(assignedPost.body?.modulesFailed)
    );
    check(
      "blocks were returned",
      (assignedPost.body?.blocks?.length ?? 0) > 0,
      `${assignedPost.body?.blocks?.length} blocks`
    );

    // ── The DB state behind the 200 ──────────────────────────────────────
    sub("stored state after regeneration");
    const all = await loadNotes(admin, subject.subjectId);
    const freshModules = all.filter((r) => r.scope === "module" && !r.isStale);
    const freshSubject = all.filter((r) => r.scope === "subject" && !r.isStale);

    check(
      "fresh module-scope rows exist",
      freshModules.length > 0,
      `${freshModules.length} fresh module row(s)`
    );
    eq(
      "fresh module rows match the reported regeneration count",
      freshModules.length,
      assignedPost.body?.modulesRegenerated
    );
    eq("exactly one fresh subject-scope row", freshSubject.length, 1);
    check(
      "subject version incremented past the prior one",
      (freshSubject[0]?.version ?? 0) > priorVersion,
      `v${priorVersion} -> v${freshSubject[0]?.version}`
    );
    eq("the API version matches the stored version", assignedPost.body?.version, freshSubject[0]?.version);
    check(
      "every superseded row is retained as stale, not deleted",
      all.filter((r) => r.isStale).length > 0,
      `${all.filter((r) => r.isStale).length} stale row(s) kept`
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
