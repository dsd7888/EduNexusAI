/**
 * CP-N4 harness 4 — /student/quiz/legacy is gone.
 *
 * A REGRESSION GUARD IN ITS OWN FILE, deliberately not folded into
 * route_accessibility.ts, so that `grep -rn "quiz/legacy"` finds a test as well
 * as a roadmap entry. The page was a `git mv` in CP-Q3 and could be restored by
 * a merge as easily as it was moved.
 *
 * IT MUST AUTHENTICATE, AND THAT IS THE WHOLE SUBTLETY. Unauthenticated, this
 * path returns 307 — proxy.ts redirects every /student/* route to /login before
 * routing ever resolves, so an anonymous request cannot distinguish "deleted"
 * from "exists but gated". Asserting 404 without a session would fail for a
 * reason that has nothing to do with the deletion. The positive control below
 * (/student/quiz still 200s for the same session) is what proves the 404 means
 * "this route is gone" rather than "this student cannot see anything".
 *
 * Requires `npm run dev`.
 * Run: npx tsx _cp_n4_verify/legacy_route_removed.ts > /tmp/cpn4_legacy.log 2>&1
 */
import { signInAsStudent, waitForServer, type StudentSession } from "@/lib/testing/httpHarness";

import {
  loadEnvLocal,
  adminClient,
  makeChecker,
  hr,
  sub,
  onSignals,
  resolveSubject,
  N4_FIXTURES,
} from "./shared";

loadEnvLocal();

async function main() {
  const admin = adminClient();
  const { check, eq, summary } = makeChecker();

  hr("CP-N4 harness 4 — legacy_route_removed");
  await waitForServer();

  const subject = await resolveSubject(admin, N4_FIXTURES.MULTI_MODULE);
  const sessions: StudentSession[] = [];
  let cleaned = false;
  const cleanup = async (): Promise<string> => {
    if (cleaned) return "already cleaned";
    cleaned = true;
    const notes: string[] = [];
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
    const student = await signInAsStudent(undefined, undefined, {
      role: "student",
      branch: subject.offering.branch,
      semester: subject.offering.semester,
      fullName: "CP-N4 Legacy Guard",
    });
    sessions.push(student);

    sub("the deleted route");
    const legacy = await student.fetch("/student/quiz/legacy", {
      redirect: "manual",
    });
    eq("GET /student/quiz/legacy is 404", legacy.status, 404);

    // Positive control. Without it a 404 would also pass against a broken
    // session, a dead server, or a student who can reach nothing at all.
    sub("positive control — the surviving route");
    const current = await student.fetch("/student/quiz", { redirect: "manual" });
    eq("GET /student/quiz is 200 for the same session", current.status, 200);

    // And the documented anonymous behaviour, asserted rather than assumed, so
    // the 307 is recorded as expected rather than rediscovered as a surprise.
    sub("anonymous — proxy.ts gates before routing");
    const anon = await fetch(
      `${process.env.HARNESS_BASE_URL ?? "http://localhost:3000"}/student/quiz/legacy`,
      { redirect: "manual" }
    );
    check(
      "unauthenticated GET redirects (307/302), never 404",
      anon.status === 307 || anon.status === 302,
      String(anon.status)
    );

    const { passed, failed } = summary();
    console.log(`\n${passed} passed, ${failed} failed`);
    console.log(`cleanup: ${await cleanup()}`);
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error(err);
    console.log(`cleanup: ${await cleanup()}`);
    process.exit(1);
  }
}

main();
