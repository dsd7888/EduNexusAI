/**
 * CP-N4 harness 1 — the two new routes exist, and are gated correctly.
 *
 * WHAT "GATED CORRECTLY" MEANS HERE, precisely, because the answer is not the
 * one the checkpoint spec assumed. `/student/notes/[subjectId]` is a CLIENT
 * page: proxy.ts enforces the session, but the SUBJECT-level access check lives
 * in the API route it calls (assertNotesSubjectAccess on
 * /api/notes/subject/:id). So a student from the wrong branch gets 200 for the
 * page shell and 403 from the data call — the page then renders its error
 * state. Asserting 403 on the PAGE would be asserting a design the app does not
 * have, and would fail for the wrong reason.
 *
 * This harness therefore asserts, separately:
 *   - the page renders for an entitled student (200)
 *   - the page is session-gated (anonymous → 307/302 to login)
 *   - the DATA is cohort-gated (wrong-branch student → 403 from the API)
 *   - an entitled student DOES get their data (positive control, so the 403
 *     above cannot pass against a subject that is simply broken)
 *
 * Requires `npm run dev`.
 * Run: npx tsx _cp_n4_verify/route_accessibility.ts > /tmp/cpn4_routes.log 2>&1
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
  purgeSubjectNotes,
  N4_FIXTURES,
} from "./shared";

loadEnvLocal();

const BASE = process.env.HARNESS_BASE_URL ?? "http://localhost:3000";

async function main() {
  const admin = adminClient();
  const { check, eq, summary } = makeChecker();

  hr("CP-N4 harness 1 — route_accessibility");
  await waitForServer();

  const subject = await resolveSubject(admin, N4_FIXTURES.MULTI_MODULE);
  const READING = `/student/notes/${subject.subjectId}`;
  const CARDS = `/student/notes/${subject.subjectId}/flashcards`;
  const API = `/api/notes/subject/${subject.subjectId}`;
  console.log(
    `target: ${subject.code} — offered to ${subject.offering.branch}/sem${subject.offering.semester}`
  );

  const sessions: StudentSession[] = [];
  let cleaned = false;
  const cleanup = async (): Promise<string> => {
    if (cleaned) return "already cleaned";
    cleaned = true;
    const notes: string[] = [
      `subject-scope residual=${await purgeSubjectNotes(admin, subject.subjectId, "subject")}`,
    ];
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
    const entitled = await signInAsStudent(undefined, undefined, {
      role: "student",
      branch: subject.offering.branch,
      semester: subject.offering.semester,
      fullName: "CP-N4 Entitled",
    });
    sessions.push(entitled);

    sub("entitled student — both pages render");
    const reading = await entitled.fetch(READING, { redirect: "manual" });
    eq("GET /student/notes/[subjectId] is 200", reading.status, 200);
    const cards = await entitled.fetch(CARDS, { redirect: "manual" });
    eq("GET /student/notes/[subjectId]/flashcards is 200", cards.status, 200);

    // Positive control for the 403 below: this subject's data IS reachable.
    sub("positive control — entitled student reads the data");
    const okData = await entitled.json<{ blocks?: unknown[] }>(API);
    eq("GET /api/notes/subject/[id] is 200", okData.status, 200);
    check(
      "response carries blocks",
      Array.isArray(okData.body?.blocks) && (okData.body!.blocks as unknown[]).length > 0,
      `${(okData.body?.blocks as unknown[] | undefined)?.length ?? 0} blocks`
    );

    sub("unauthenticated — proxy.ts gates both pages");
    for (const [label, path] of [
      ["reading view", READING],
      ["flashcards", CARDS],
    ] as const) {
      const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
      check(
        `anonymous GET ${label} redirects to login (307/302)`,
        res.status === 307 || res.status === 302,
        `${res.status} → ${res.headers.get("location") ?? "-"}`
      );
    }

    sub("wrong-branch student — page shell renders, DATA is refused");
    const foreign = await signInAsStudent(undefined, undefined, {
      role: "student",
      branch: N4_FIXTURES.FOREIGN_BRANCH,
      semester: subject.offering.semester,
      fullName: "CP-N4 Foreign",
    });
    sessions.push(foreign);

    const foreignPage = await foreign.fetch(READING, { redirect: "manual" });
    check(
      "page shell still renders (access is enforced at the API, not the route)",
      foreignPage.status === 200,
      String(foreignPage.status)
    );

    const foreignData = await foreign.json<{ error?: string }>(API);
    check(
      "GET /api/notes/subject/[id] is refused (403/404)",
      foreignData.status === 403 || foreignData.status === 404,
      String(foreignData.status)
    );
    // Empty-and-no-error would be indistinguishable from an empty subject; the
    // refusal must be an explicit status, and the positive control above proves
    // the subject is not simply empty.
    check(
      "refusal carries no note blocks",
      !Array.isArray((foreignData.body as { blocks?: unknown[] })?.blocks),
      JSON.stringify(foreignData.body).slice(0, 90)
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
