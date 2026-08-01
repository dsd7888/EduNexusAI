/**
 * CP-N5 harness 1 — GET /api/notes/subject/:subjectId/export over real HTTP.
 *
 * Covers: a real PDF comes back for an entitled student (full subject and
 * single-module scoping), a subject with no fresh subject-scope row 404s
 * rather than silently generating one, unauthenticated and wrong-branch
 * requests are refused, and the 5/day rate limit actually bites on the 6th
 * request in one day.
 *
 * THREE STUDENT SESSIONS, NOT ONE. The rate-limit block deliberately spends a
 * student's entire daily allowance — reusing the "entitled" student for it
 * would make the earlier positive-control/module-scoped assertions consume
 * quota those checks don't care about, and their order would then matter to
 * whether "first 5 succeed" is still true. A THIRD, separately-minted
 * ephemeral student isolates that spend completely: its quota starts at 0
 * regardless of what any other session in this run did. `cleanup()` sweeps
 * `usage_analytics` for the user id it created (httpHarness.ts), which is
 * this harness's "reset usage_analytics after" (the spec's other suggested
 * mitigation) — nothing manual needed on top of the standard teardown.
 *
 * `purgeSubjectNotes(..., "subject")` — SUBJECT scope only, never "module".
 * Deleting module-scope rows would force real AI regeneration on every
 * re-run of this harness; the "no fresh subject row" precondition only needs
 * the subject-scope row gone, and re-priming after re-assembles for free from
 * the module rows this harness (or CP-N2/CP-N4's) already paid for.
 *
 * Requires `npm run dev`.
 * Run: npx tsx _cp_n5_verify/export_route.ts > /tmp/cpn5_export.log 2>&1
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
  ensureFreshSubjectNotes,
  N5_FIXTURES,
} from "./shared";

loadEnvLocal();

async function main() {
  const admin = adminClient();
  const c = makeChecker();
  const { check, eq } = c;

  hr("CP-N5 harness 1 — export_route");
  await waitForServer();

  const subject = await resolveSubject(admin, N5_FIXTURES.MULTI_MODULE);
  const EXPORT = `/api/notes/subject/${subject.subjectId}/export`;
  console.log(`target: ${subject.code} "${subject.name}" — ${subject.modules.length} modules`);

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
      fullName: "CP-N5 Entitled",
    });
    sessions.push(entitled);

    // ── Subject with no fresh subject-scope row ─────────────────────────────
    sub("no fresh subject-scope row — 404, never auto-generates");
    await purgeSubjectNotes(admin, subject.subjectId, "subject");
    const missing = await entitled.json<{ error?: string; message?: string }>(EXPORT);
    eq("status is 404", missing.status, 404);
    eq("error is 'no_notes'", missing.body?.error, "no_notes");
    check(
      "message tells the student to generate notes first",
      typeof missing.body?.message === "string" && missing.body.message.length > 0,
      String(missing.body?.message)
    );

    // ── Unauthenticated ───────────────────────────────────────────────────
    sub("unauthenticated — refused before any DB read");
    const anonRes = await fetch(`${process.env.HARNESS_BASE_URL ?? "http://localhost:3000"}${EXPORT}`, {
      redirect: "manual",
    });
    check(
      "anonymous GET is refused (401 or a redirect to login)",
      anonRes.status === 401 || anonRes.status === 307 || anonRes.status === 302,
      String(anonRes.status)
    );

    // ── Wrong-branch student ────────────────────────────────────────────────
    sub("wrong-branch student — 403, same rule as the view route");
    const foreign = await signInAsStudent(undefined, undefined, {
      role: "student",
      branch: N5_FIXTURES.FOREIGN_BRANCH,
      semester: subject.offering.semester,
      fullName: "CP-N5 Foreign",
    });
    sessions.push(foreign);
    const foreignRes = await foreign.fetch(EXPORT, { redirect: "manual" });
    eq("status is 403", foreignRes.status, 403);

    // ── Prime a real fresh subject-scope row via the production path ───────
    sub("priming: ensure module notes exist, assemble via the real view route");
    await ensureFreshSubjectNotes(admin, subject, entitled);

    // ── Positive control — full-subject export ──────────────────────────────
    sub("entitled student — full-subject export");
    const full = await entitled.fetch(EXPORT);
    eq("status is 200", full.status, 200);
    eq(
      "Content-Type is application/pdf",
      full.headers.get("content-type")?.split(";")[0].trim(),
      "application/pdf"
    );
    const fullDisposition = full.headers.get("content-disposition") ?? "";
    check(
      "Content-Disposition carries 'attachment'",
      fullDisposition.includes("attachment"),
      fullDisposition
    );
    const fullBytes = Buffer.from(await full.arrayBuffer());
    check("body is a real PDF, not empty (> 1000 bytes)", fullBytes.length > 1000, `${fullBytes.length} bytes`);
    check(
      "first 4 bytes are the PDF magic number",
      fullBytes.subarray(0, 4).toString("latin1") === "%PDF",
      JSON.stringify(fullBytes.subarray(0, 4).toString("latin1"))
    );

    // ── Module-scoped export ────────────────────────────────────────────────
    sub("entitled student — single-module export");
    const targetModule = subject.modules[0];
    const moduleRes = await entitled.fetch(`${EXPORT}?moduleId=${encodeURIComponent(targetModule.id)}`);
    eq("status is 200", moduleRes.status, 200);
    eq(
      "Content-Type is application/pdf",
      moduleRes.headers.get("content-type")?.split(";")[0].trim(),
      "application/pdf"
    );
    const moduleBytes = Buffer.from(await moduleRes.arrayBuffer());
    check(
      "body is a real PDF (> 500 bytes)",
      moduleBytes.length > 500,
      `${moduleBytes.length} bytes`
    );
    const moduleDisposition = moduleRes.headers.get("content-disposition") ?? "";
    const moduleSlugFragment = targetModule.name
      .toLowerCase()
      .replace(/['’ʼ`]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 12);
    check(
      "filename in Content-Disposition reflects the module (slug fragment present)",
      moduleSlugFragment.length === 0 || moduleDisposition.toLowerCase().includes(moduleSlugFragment),
      moduleDisposition
    );

    // Unknown moduleId — 400, not a silent full-subject fallback.
    const badModule = await entitled.json<{ error?: string }>(`${EXPORT}?moduleId=00000000-0000-0000-0000-000000000000`);
    eq("unknown moduleId is 400 'module_not_found'", badModule.status, 400);
    eq("error is 'module_not_found'", badModule.body?.error, "module_not_found");

    // ── Rate limit — dedicated third session, isolated quota ───────────────
    sub("rate limit — 6 requests in succession on a fresh student, 5/day allowance");
    const limited = await signInAsStudent(undefined, undefined, {
      role: "student",
      branch: subject.offering.branch,
      semester: subject.offering.semester,
      fullName: "CP-N5 RateLimit",
    });
    sessions.push(limited);

    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await limited.fetch(EXPORT);
      statuses.push(res.status);
      // Drain the body so the connection is freed before the next request.
      await res.arrayBuffer();
    }
    console.log(`  statuses: ${statuses.join(", ")}`);
    check(
      "first 5 requests succeed (200)",
      statuses.slice(0, 5).every((s) => s === 200),
      statuses.slice(0, 5).join(",")
    );
    eq("6th request is 429", statuses[5], 429);

    const { passed, failed } = c.summary();
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
