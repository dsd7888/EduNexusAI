/**
 * CP-N2 harness 3 — partial coverage is a valid assembly, not an error.
 *
 * A subject where some modules have notes and some do not is the NORMAL state
 * during rollout, and the design decision under test is that it renders rather
 * than 500s: assemble from what exists, and record the shortfall in
 * source_metadata so CP-N4 can say "2 of 3 modules covered" instead of showing
 * nothing. A route that failed closed here would make the feature invisible for
 * every subject until its last module finished generating.
 *
 * The absence check captures the removed module's real block ids BEFORE deleting
 * it, rather than guessing a slug from the module name — a name-derived slug can
 * miss (block ids come from block titles, not module titles) and would pass
 * vacuously.
 *
 * Requires `npm run dev`.
 * Run: npx tsx _cp_n2_verify/partial_coverage.ts > /tmp/cpn2_partial.log 2>&1
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

type NotesResponse = {
  blocks?: Array<{ id: string }>;
  version?: number;
  source?: string;
  sourceMetadata?: { modulesCovered?: string[]; modulesTotal?: number };
};

async function main() {
  const admin = adminClient();
  const { check, eq, summary } = makeChecker();
  const runInScope = await makeRunInScope();

  hr("CP-N2 harness 3 — partial_coverage");
  await waitForServer();

  // ASSEMBLY (4 modules), not SMALL: IDCH3051 M3 fails CP-N1 block validation on
  // every attempt (Flash overshoots the 80-char comparison-value ceiling on
  // distillation content), so that fixture cannot reach full coverage and the
  // "remove one from a full set" precondition would be untestable there.
  const subject = await resolveSubject(admin, N2_FIXTURES.ASSEMBLY);
  console.log(`target: ${subject.code} "${subject.name}" — ${subject.modules.length} modules`);

  const sessions: StudentSession[] = [];
  let cleaned = false;
  const cleanup = async (): Promise<string> => {
    if (cleaned) return "already cleaned";
    cleaned = true;
    const notes: string[] = [];
    notes.push(
      `subject-scope residual=${await purgeSubjectNotes(admin, subject.subjectId, "subject")}`
    );
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
    sub("seed — full coverage first, so the partial state is a REMOVAL not an absence");
    await purgeSubjectNotes(admin, subject.subjectId, "subject");
    await ensureModuleNotes(admin, subject, runInScope);

    const full = (await loadNotes(admin, subject.subjectId, "module")).filter((r) => !r.isStale);
    check(
      "at least 3 modules carry fresh notes before removal",
      full.length >= 3,
      `${full.length} of ${subject.modules.length}`
    );

    const student = await signInAsStudent(undefined, undefined, {
      role: "student",
      branch: subject.offering.branch,
      semester: subject.offering.semester,
      fullName: "CP-N2 Student",
    });
    sessions.push(student);
    const PATH = `/api/notes/subject/${subject.subjectId}`;

    // ── Remove one module's notes entirely ───────────────────────────────
    sub("remove — one module's notes are marked stale, then deleted outright");
    const victim = full[full.length - 1];
    const victimModule = subject.modules.find((m) => m.id === victim.moduleId);
    const victimBlockIds = victim.blocks.map((b) => b.id);
    console.log(
      `    removing M${victimModule?.moduleNumber} "${victimModule?.name}" (${victimBlockIds.length} blocks)`
    );

    await admin.from("study_notes").update({ is_stale: true }).eq("id", victim.id);
    await admin.from("study_notes").delete().eq("id", victim.id);
    const stillThere = (await loadNotes(admin, subject.subjectId, "module")).some(
      (r) => r.id === victim.id
    );
    eq("the victim row is gone", stillThere, false);

    // Deleting a module row propagates nothing on its own (no generator ran), so
    // clear any subject row explicitly — otherwise a cached hit would mask the
    // partial assembly this harness is here to observe.
    await purgeSubjectNotes(admin, subject.subjectId, "subject");

    // ── Assemble over the gap ────────────────────────────────────────────
    sub("GET — partial coverage returns 200, not 500");
    const res = await student.json<NotesResponse>(PATH);
    eq("status is 200 (partial is valid)", res.status, 200);
    eq("source is 'fresh'", res.body?.source, "fresh");

    const meta = res.body?.sourceMetadata;
    const covered = meta?.modulesCovered ?? [];
    const total = meta?.modulesTotal ?? -1;
    check(
      "modulesCovered.length < modulesTotal (the shortfall is recorded)",
      covered.length < total,
      `${covered.length} of ${total} modules covered`
    );
    eq("modulesTotal still counts every module on the subject", total, subject.modules.length);
    check(
      "the removed module is absent from modulesCovered",
      !covered.includes(victim.moduleId as string),
      `covered=[${covered.map((c) => subject.modules.find((m) => m.id === c)?.moduleNumber).join(",")}]`
    );

    // ── The removed module's content must not appear ─────────────────────
    sub("absence — no block from the removed module survives in the assembly");
    const assembledIds = new Set((res.body?.blocks ?? []).map((b) => b.id));
    const leaked = victimBlockIds.filter((id) => assembledIds.has(id));
    check(
      "none of the removed module's block ids appear in the assembled array",
      leaked.length === 0,
      leaked.length === 0 ? `checked ${victimBlockIds.length} ids` : `LEAKED: ${leaked.join(", ")}`
    );

    const expectedBlockCount = (await loadNotes(admin, subject.subjectId, "module"))
      .filter((r) => !r.isStale)
      .reduce((s, r) => s + r.blocks.length, 0);
    eq(
      "assembled block count equals the sum over surviving modules only",
      res.body?.blocks?.length,
      expectedBlockCount
    );

    console.log(
      `\n  INFO partial state: ${covered.length}/${total} modules covered, ${res.body?.blocks?.length} blocks assembled (M${victimModule?.moduleNumber} intentionally absent)`
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
