/**
 * CP-Q4 Part 5a — the access invariant, over real HTTP with real cookies.
 *
 *   A faculty user sees analytics ONLY for subjects in their
 *   faculty_assignments. Dean/HOD see analytics only within their role_scope.
 *   Students see none of it.
 *
 * WHY EVERY ASSERTION HAS A POSITIVE AND A NEGATIVE HALF
 * "Faculty B gets 403 on subject Y" passes identically against a policy that
 * denies everybody, and a suite that only proves things are blocked passes
 * just as well against an outage. So each role is checked BOTH ways: the
 * subject it should reach returns 200 with real data, and the subject it
 * should not returns 403. (CLAUDE.md, RLS four-assertion template — the same
 * principle applied at the route layer rather than the policy layer.)
 *
 * THE DEAN CASE IS THE ONE THAT HAS NEVER RUN IN PRODUCTION. `role_scope` is
 * empty on the live database and there are no dean/hod profiles, so this
 * harness is the only place the oversight branch of assertAnalyticsAccess and
 * of the `fas_select_oversight_scoped` policy is exercised before pilot. It
 * therefore seeds BOTH scoping shapes:
 *   · a dean with department IS NULL  → entire school
 *   · an HOD with a specific department → that department only
 * and an out-of-scope subject in a different school, to prove the OR branch
 * discriminates rather than always matching.
 *
 * Requires a dev server:  npm run dev
 *   npx tsx _cp_q4_verify/access_invariants.ts > out.txt 2>&1
 */

import { randomUUID } from "node:crypto";
import {
  signInAsStudent,
  makeChecker,
  hr,
  sub,
  onSignals,
  waitForServer,
  type StudentSession,
} from "@/lib/testing/httpHarness";
import { seedScenario, type SeedScenario } from "./seed";
import { SCENARIO } from "./scenario";

const ROUTES = (subjectId: string, studentId: string, questionId: string) => [
  { label: "subject", path: `/api/faculty/analytics/subject/${subjectId}` },
  {
    label: "subject/students",
    path: `/api/faculty/analytics/subject/${subjectId}/students`,
  },
  { label: "question", path: `/api/faculty/analytics/question/${questionId}` },
  {
    label: "student",
    path: `/api/faculty/analytics/student/${studentId}?subjectId=${subjectId}`,
  },
];

async function main() {
  const c = makeChecker();
  hr("CP-Q4 Part 5a — ACCESS INVARIANTS (real HTTP, real cookies)");
  await waitForServer();

  let scenario: SeedScenario | null = null;
  const sessions: StudentSession[] = [];
  // Every subject this harness creates OUTSIDE seedScenario. Tracked in one
  // list rather than as individual variables: the first version of this file
  // deleted the out-of-scope subject and silently leaked Subject Y on every
  // run, because the cleanup enumerated variables by hand and one was missed.
  const extraSubjectIds: string[] = [];

  const cleanupAll = async (): Promise<string> => {
    const notes: string[] = [];
    for (const s of sessions) notes.push(await s.cleanup());
    if (scenario && extraSubjectIds.length > 0) {
      // Snapshots FK to subjects with ON DELETE CASCADE, but a faculty read
      // may have created one before the subject is dropped — delete explicitly
      // so a cascade failure cannot leave an orphan behind unnoticed.
      await scenario.admin
        .from("faculty_analytics_snapshots")
        .delete()
        .in("subject_id", extraSubjectIds);
      await scenario.admin
        .from("faculty_assignments")
        .delete()
        .in("subject_id", extraSubjectIds);
      const { error } = await scenario.admin
        .from("subjects")
        .delete()
        .in("id", extraSubjectIds);
      notes.push(
        error
          ? `extra subjects: ${error.message}`
          : `${extraSubjectIds.length} extra subject(s) deleted`
      );
    }
    if (scenario) notes.push(await scenario.cleanup());
    return notes.join("; ");
  };
  onSignals(cleanupAll);

  try {
    sub("0. Seed: subject X (with data), subject Y, and an out-of-school subject");
    scenario = await seedScenario(SCENARIO);
    const s = scenario;
    const subjectX = s.subjectId;
    const questionId = s.questionIds[0][0];
    const studentId = s.studentIds[0];

    // Subject Y — same school, no assignment for Faculty A.
    const subjectY = randomUUID();
    await s.admin.from("subjects").insert({
      id: subjectY,
      name: `CPQ4 Subject Y ${s.marker}`,
      code: `CPQ4Y${s.marker.toUpperCase()}`,
      department: "Engineering",
      branch: "CSE",
      semester: 1,
      school: "School of Engineering",
    });
    extraSubjectIds.push(subjectY);

    // Out-of-scope subject — a DIFFERENT school, so the dean's role_scope
    // must not match it.
    const outOfScopeSubjectId = randomUUID();
    extraSubjectIds.push(outOfScopeSubjectId);
    await s.admin.from("subjects").insert({
      id: outOfScopeSubjectId,
      name: `CPQ4 Other School ${s.marker}`,
      code: `CPQ4O${s.marker.toUpperCase()}`,
      department: "Engineering",
      branch: "CSE",
      semester: 1,
      school: "School of Management",
    });
    console.log(`  X=${subjectX}  Y=${subjectY}  out-of-scope=${outOfScopeSubjectId}`);

    // ── Faculty A: assigned to X only ────────────────────────────────────────
    sub("1. Faculty A — assigned to X, not to Y");
    const facultyA = await signInAsStudent(undefined, undefined, {
      role: "faculty",
      fullName: "CPQ4 Faculty A",
    });
    sessions.push(facultyA);
    await facultyA.admin.from("faculty_assignments").insert({
      faculty_id: facultyA.userId,
      subject_id: subjectX,
      assigned_by: facultyA.userId,
    });

    const aOnX = await facultyA.json<{ snapshot?: unknown }>(
      `/api/faculty/analytics/subject/${subjectX}`
    );
    c.eq("GET subject X → 200", aOnX.status, 200);
    c.check(
      "…and the 200 carries a real snapshot (not an empty success)",
      aOnX.body?.snapshot != null
    );

    const aOnY = await facultyA.json(`/api/faculty/analytics/subject/${subjectY}`);
    c.eq("GET subject Y → 403", aOnY.status, 403);

    // ── Faculty B: assigned to Y only ────────────────────────────────────────
    sub("2. Faculty B — assigned to Y; probes a student who has no sessions on Y");
    const facultyB = await signInAsStudent(undefined, undefined, {
      role: "faculty",
      fullName: "CPQ4 Faculty B",
    });
    sessions.push(facultyB);
    await facultyB.admin.from("faculty_assignments").insert({
      faculty_id: facultyB.userId,
      subject_id: subjectY,
      assigned_by: facultyB.userId,
    });

    const bOnY = await facultyB.json(`/api/faculty/analytics/subject/${subjectY}`);
    c.eq("GET subject Y → 200 (positive control)", bOnY.status, 200);

    // The student exists and has sessions — but on X, which B cannot see.
    const bOnStudentViaY = await facultyB.json(
      `/api/faculty/analytics/student/${studentId}?subjectId=${subjectY}`
    );
    c.eq(
      "GET student (real student, no sessions on B's subject) → 404 NOT 403",
      bOnStudentViaY.status,
      404
    );
    c.check(
      "…and the 404 body does not leak that the student exists",
      !JSON.stringify(bOnStudentViaY.body ?? {}).includes(studentId)
    );

    // Same student, via a subject B has no access to at all — must be
    // indistinguishable from the above.
    const bOnStudentViaX = await facultyB.json(
      `/api/faculty/analytics/student/${studentId}?subjectId=${subjectX}`
    );
    c.eq(
      "GET student via a subject B cannot access → 404 (same as above)",
      bOnStudentViaX.status,
      404
    );
    c.eq(
      "…the two 404 bodies are byte-identical (no oracle)",
      JSON.stringify(bOnStudentViaY.body),
      JSON.stringify(bOnStudentViaX.body)
    );

    // Faculty A CAN see that student, on X — the positive control that proves
    // the 404s above are scope, not a broken route.
    const aOnStudent = await facultyA.json<{ student?: { id: string } }>(
      `/api/faculty/analytics/student/${studentId}?subjectId=${subjectX}`
    );
    c.eq("Faculty A GET the same student on X → 200", aOnStudent.status, 200);
    c.eq(
      "…and it is the right student",
      aOnStudent.body?.student?.id,
      studentId
    );

    // ── Dean: entire school (department IS NULL) ─────────────────────────────
    sub("3. Dean — role_scope with department IS NULL (entire school)");
    let dean: StudentSession | null = null;
    try {
      dean = await signInAsStudent(undefined, undefined, {
        role: "dean",
        fullName: "CPQ4 Dean",
      });
      sessions.push(dean);
    } catch (err) {
      c.check(
        "dean profile can be created (profiles.role CHECK permits 'dean')",
        false,
        String(err)
      );
    }

    if (dean) {
      c.check("dean profile created", true);
      const { error: rsErr } = await dean.admin.from("role_scope").insert({
        user_id: dean.userId,
        school: "School of Engineering",
        department: null,
      });
      c.check("role_scope row inserted (school-wide)", !rsErr, rsErr?.message ?? "ok");

      const dOnX = await dean.json(`/api/faculty/analytics/subject/${subjectX}`);
      c.eq("dean GET in-scope subject X → 200", dOnX.status, 200);
      const dOnY = await dean.json(`/api/faculty/analytics/subject/${subjectY}`);
      c.eq("dean GET in-scope subject Y → 200 (school-wide, no assignment)", dOnY.status, 200);
      const dOnOut = await dean.json(
        `/api/faculty/analytics/subject/${outOfScopeSubjectId}`
      );
      c.eq("dean GET out-of-school subject → 403", dOnOut.status, 403);
    }

    // ── HOD: a specific department ───────────────────────────────────────────
    sub("4. HOD — role_scope with a specific department");
    let hod: StudentSession | null = null;
    try {
      hod = await signInAsStudent(undefined, undefined, {
        role: "hod",
        fullName: "CPQ4 HOD",
      });
      sessions.push(hod);
    } catch (err) {
      c.check("hod profile can be created", false, String(err));
    }

    if (hod) {
      await hod.admin.from("role_scope").insert({
        user_id: hod.userId,
        school: "School of Engineering",
        department: "Engineering",
      });
      const hOnX = await hod.json(`/api/faculty/analytics/subject/${subjectX}`);
      c.eq("hod GET matching-department subject → 200", hOnX.status, 200);
      const hOnOut = await hod.json(
        `/api/faculty/analytics/subject/${outOfScopeSubjectId}`
      );
      c.eq("hod GET other-school subject → 403", hOnOut.status, 403);
    }

    // ── A dean with NO role_scope row fails closed ───────────────────────────
    sub("5. Dean with NO role_scope row — fails closed, sees nothing");
    const unscoped = await signInAsStudent(undefined, undefined, {
      role: "dean",
      fullName: "CPQ4 Unscoped Dean",
    });
    sessions.push(unscoped);
    const uOnX = await unscoped.json(`/api/faculty/analytics/subject/${subjectX}`);
    c.eq(
      "unscoped dean → 403 (no legacy institution-wide fallthrough)",
      uOnX.status,
      403
    );

    // ── Student: locked out of every analytics route ─────────────────────────
    sub("6. Student — 403 on every faculty analytics route");
    const student = await signInAsStudent();
    sessions.push(student);
    for (const r of ROUTES(subjectX, studentId, questionId)) {
      const res = await student.json(r.path);
      c.eq(`student GET ${r.label} → 403`, res.status, 403);
    }
    // The cron route's gate is the CRON_SECRET, not a role — it runs on behalf
    // of no user. Its behaviour is therefore env-dependent, and the harness
    // asserts the ACTUAL rule rather than a status code that would be wrong in
    // one of the two environments.
    const cronAsStudent = await student.json(
      "/api/cron/refresh-analytics-snapshots"
    );
    if (process.env.CRON_SECRET) {
      c.eq(
        "CRON_SECRET set → student GET cron route → 401",
        cronAsStudent.status,
        401
      );
    } else {
      console.log(
        `  ⓘ CRON_SECRET unset in this environment — cron route returned ${cronAsStudent.status} (dev allowance)`
      );
      const { readFileSync } = await import("node:fs");
      const src = readFileSync(
        "src/app/api/cron/refresh-analytics-snapshots/route.ts",
        "utf8"
      );
      c.check(
        "route fails closed in production when CRON_SECRET is unset",
        src.includes('process.env.NODE_ENV === "production"') &&
          /NODE_ENV === "production"[\s\S]{0,400}status: 401/.test(src)
      );
    }

    // ── The grep-verifiable invariant, checked as a fact not a habit ─────────
    sub("7. Every analytics route file calls assertAnalyticsAccess");
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(join(dir, e.name))
          : e.name === "route.ts"
            ? [join(dir, e.name)]
            : []
      );
    const routeFiles = walk("src/app/api/faculty/analytics");
    c.check("found analytics route files", routeFiles.length > 0, `${routeFiles.length} files`);
    for (const f of routeFiles) {
      c.check(
        `${f.replace("src/app/api/faculty/analytics/", "")} calls assertAnalyticsAccess`,
        readFileSync(f, "utf8").includes("assertAnalyticsAccess")
      );
    }
  } catch (err) {
    c.check("harness ran without throwing", false, String(err));
  } finally {
    sub("8. Cleanup — verified, not assumed");
    const notes = await cleanupAll();
    console.log(`  cleanup: ${notes}`);
    if (scenario) {
      const { count } = await scenario.admin
        .from("role_scope")
        .select("*", { count: "exact", head: true });
      c.eq("role_scope is empty again (it was empty before this run)", count ?? 0, 0);
    }
  }

  const { passed, failed } = c.summary();
  hr(`RESULT — ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
