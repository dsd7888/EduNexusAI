/**
 * CP-N4 harness 3 — moduleBreakpoints is a valid tiling of the blocks array.
 *
 * This validates the Part 1 assembler extension against the exact contract the
 * reading view and the flashcard deck depend on. The assertions are not
 * "the field exists" but the four invariants that make it USABLE:
 *
 *   1. ordered by moduleNumber ASC — section headers render in syllabus order
 *   2. startIndex values tile the array with no gap and no overlap
 *   3. counts sum to blocks.length — every block belongs to exactly one module
 *   4. count >= 1 — a module that contributed nothing is ABSENT, never a
 *      zero-count entry (that is what keeps invariant 3 true when assembly
 *      skips a module whose blocks failed validation)
 *
 * Checked on BOTH the fresh-assembly and the cache-hit response, because they
 * are different code paths: one computes breakpoints during assembly, the other
 * reads them from stored source_metadata or derives them from the blocks'
 * `_moduleId` tags. A harness that only exercised one would miss a divergence.
 *
 * Also asserts `_moduleId` never reaches the client — it is internal routing
 * metadata, and CP-N4 exists partly so it never has to.
 *
 * ── NEVER COMPARE jsonb ROUND-TRIPS WITH JSON.stringify ──────────────────────
 * Postgres `jsonb` does not preserve object key order — it stores keys in its
 * own normalised order — so a value written as {moduleId, moduleName, …} comes
 * back as {count, moduleId, …} with IDENTICAL contents. `JSON.stringify` is
 * key-order sensitive, so comparing a stored payload against the one that
 * produced it fails on ordering alone. That happened while writing this file:
 * the fresh-vs-cache assertion failed and looked exactly like a product bug.
 *
 * Compare field-by-field, or map to a canonical string, as `canon()` does below.
 * The same applies to `makeChecker`'s `eq()`, which is stringify-based and is
 * therefore safe only for scalars, arrays of scalars, and objects that never
 * went through Postgres. This applies to EVERY jsonb column in this codebase —
 * study_notes.blocks, study_notes.source_metadata, qpaper_templates.structure.
 *
 * Requires `npm run dev`.
 * Run: npx tsx _cp_n4_verify/module_filter_param.ts > /tmp/cpn4_bp.log 2>&1
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

type Breakpoint = {
  moduleId: string;
  moduleName: string;
  moduleNumber: number;
  startIndex: number;
  count: number;
};

type NotesResponse = {
  blocks?: Array<Record<string, unknown>>;
  source?: string;
  sourceMetadata?: { moduleBreakpoints?: Breakpoint[]; modulesTotal?: number };
};

function assertBreakpoints(
  label: string,
  body: NotesResponse | undefined,
  moduleIds: Set<string>,
  c: ReturnType<typeof makeChecker>
) {
  const { check, eq } = c;
  const blocks = body?.blocks ?? [];
  const bps = body?.sourceMetadata?.moduleBreakpoints;

  check(`[${label}] moduleBreakpoints is an array`, Array.isArray(bps), `${typeof bps}`);
  if (!Array.isArray(bps)) return;

  check(`[${label}] is non-empty`, bps.length > 0, `${bps.length} entries`);

  const shapeOk = bps.every(
    (b) =>
      typeof b.moduleId === "string" &&
      b.moduleId.length > 0 &&
      typeof b.moduleName === "string" &&
      Number.isInteger(b.moduleNumber) &&
      Number.isInteger(b.startIndex) &&
      b.startIndex >= 0 &&
      Number.isInteger(b.count)
  );
  check(`[${label}] every entry has the full typed shape`, shapeOk);

  // Invariant 4 — absent, never zero.
  check(
    `[${label}] every count >= 1 (a skipped module is absent, not zero-count)`,
    bps.every((b) => b.count >= 1),
    JSON.stringify(bps.map((b) => b.count))
  );

  // Invariant 1 — syllabus order.
  const ordered = bps.every((b, i) => i === 0 || bps[i - 1].moduleNumber < b.moduleNumber);
  check(
    `[${label}] ordered by moduleNumber ASC`,
    ordered,
    bps.map((b) => b.moduleNumber).join(" < ")
  );

  // Invariant 2 — a gapless, overlap-free tiling.
  let offset = 0;
  let tiles = true;
  for (const b of bps) {
    if (b.startIndex !== offset) tiles = false;
    offset += b.count;
  }
  check(
    `[${label}] startIndex values tile the array with no gap or overlap`,
    tiles,
    bps.map((b) => `[${b.startIndex}..${b.startIndex + b.count - 1}]`).join(" ")
  );

  // Invariant 3 — total coverage.
  eq(`[${label}] sum of counts === blocks.length`, offset, blocks.length);

  // Every breakpoint names a module that really belongs to this subject.
  check(
    `[${label}] every moduleId belongs to the subject`,
    bps.every((b) => moduleIds.has(b.moduleId)),
    `${bps.length} checked`
  );

  // Names are what the section header renders; an empty one is a blank heading.
  check(
    `[${label}] every moduleName is non-empty`,
    bps.every((b) => b.moduleName.trim().length > 0),
    JSON.stringify(bps.map((b) => b.moduleName))
  );

  // The reason breakpoints exist at all.
  check(
    `[${label}] _moduleId is NOT leaked to the client`,
    blocks.every((b) => !("_moduleId" in b)),
    `${blocks.length} blocks checked`
  );
}

async function main() {
  const admin = adminClient();
  const c = makeChecker();

  hr("CP-N4 harness 3 — module_filter_param");
  await waitForServer();

  const subject = await resolveSubject(admin, N4_FIXTURES.MULTI_MODULE);
  const moduleIds = new Set(subject.modules.map((m) => m.id));
  console.log(
    `target: ${subject.code} "${subject.name}" — ${subject.modules.length} modules`
  );

  const sessions: StudentSession[] = [];
  let cleaned = false;
  const cleanup = async (): Promise<string> => {
    if (cleaned) return "already cleaned";
    cleaned = true;
    const notes: string[] = [];
    // Subject scope only — module rows stay so re-runs pay no generation cost.
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
    // Start from no subject-scope row so GET #1 is genuinely a fresh assembly.
    await purgeSubjectNotes(admin, subject.subjectId, "subject");

    const student = await signInAsStudent(undefined, undefined, {
      role: "student",
      branch: subject.offering.branch,
      semester: subject.offering.semester,
      fullName: "CP-N4 Breakpoints",
    });
    sessions.push(student);

    const PATH = `/api/notes/subject/${subject.subjectId}`;

    sub("GET #1 — fresh assembly (breakpoints computed during assembly)");
    const first = await student.json<NotesResponse>(PATH);
    c.eq("status is 200", first.status, 200);
    c.eq("source is 'fresh'", first.body?.source, "fresh");
    assertBreakpoints("fresh", first.body, moduleIds, c);

    sub("GET #2 — cache hit (breakpoints read from stored source_metadata)");
    const second = await student.json<NotesResponse>(PATH);
    c.eq("status is 200", second.status, 200);
    c.eq("source is 'cache'", second.body?.source, "cache");
    assertBreakpoints("cache", second.body, moduleIds, c);

    sub("the two paths agree");
    // FIELD-WISE, NOT JSON.stringify. Postgres `jsonb` does not preserve object
    // key order — it stores keys in its own normalised order — so the cached
    // row round-trips with the same VALUES under a different key order. A
    // stringify comparison fails on that and would be a test bug reported as a
    // product bug. Compare the fields that actually form the contract.
    const canon = (bps: Breakpoint[] | undefined) =>
      (bps ?? []).map((b) =>
        [b.moduleId, b.moduleName, b.moduleNumber, b.startIndex, b.count].join("|")
      );
    c.eq(
      "cache breakpoints carry identical values to fresh (key order is jsonb's own)",
      canon(second.body?.sourceMetadata?.moduleBreakpoints),
      canon(first.body?.sourceMetadata?.moduleBreakpoints)
    );

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
