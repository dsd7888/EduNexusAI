/**
 * CP-N2 harness 1 — subject assembly is a faithful, ordered join.
 *
 * The claim under test is that a subject-scope row is EXACTLY the concatenation
 * of its modules' blocks in module_number order — not a re-generation, not a
 * summary, not a reordering. So the ordering assertion is not "block ids look
 * sorted" (they encode titles, not modules) but SLICE EQUALITY: the assembled
 * array must decompose, in order, into the stored per-module block arrays. That
 * is falsifiable in a way an eyeball check is not, and it catches interleaving,
 * dropped blocks and reordering in one assertion.
 *
 * Requires `npm run dev`.
 * Run: npx tsx _cp_n2_verify/subject_assembly.ts > /tmp/cpn2_assembly.log 2>&1
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
  isSha256Hex,
  N2_FIXTURES,
} from "./shared";

loadEnvLocal();

type NotesResponse = {
  blocks?: Array<{ id: string; kind: string }>;
  version?: number;
  generatedAt?: string;
  source?: string;
  sourceMetadata?: {
    modulesCovered?: string[];
    modulesTotal?: number;
    aggregateTokensUsed?: number;
    aggregateCostInr?: number;
  };
};

async function main() {
  const admin = adminClient();
  const { check, eq, summary } = makeChecker();
  const runInScope = await makeRunInScope();

  hr("CP-N2 harness 1 — subject_assembly");
  await waitForServer();

  const subject = await resolveSubject(admin, N2_FIXTURES.ASSEMBLY);
  console.log(
    `target: ${subject.code} "${subject.name}" — ${subject.modules.length} modules, offered to ${subject.offering.branch}/sem${subject.offering.semester}`
  );

  const sessions: StudentSession[] = [];
  let cleaned = false;
  const cleanup = async (): Promise<string> => {
    if (cleaned) return "already cleaned";
    cleaned = true;
    const notes: string[] = [];
    // Subject scope ONLY. Module rows are left in place for the other harnesses
    // (and to keep re-runs from re-paying for generation).
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
    sub("seed — every module needs fresh notes before a subject can be assembled");
    // Any subject-scope row left by a previous run would be served from cache
    // and this harness would assert nothing about assembly.
    await purgeSubjectNotes(admin, subject.subjectId, "subject");
    const seed = await ensureModuleNotes(admin, subject, runInScope);
    console.log(`    generated ${seed.generated.length}, reused ${subject.modules.length - seed.generated.length - seed.failed.length}, failed ${seed.failed.length}`);

    const moduleRows = (await loadNotes(admin, subject.subjectId, "module"))
      .filter((r) => !r.isStale)
      .sort((a, b) => {
        const an = subject.modules.find((m) => m.id === a.moduleId)?.moduleNumber ?? 0;
        const bn = subject.modules.find((m) => m.id === b.moduleId)?.moduleNumber ?? 0;
        return an - bn;
      });
    check(
      "at least 3 modules carry fresh notes",
      moduleRows.length >= 3,
      `${moduleRows.length} of ${subject.modules.length}`
    );

    const student = await signInAsStudent(undefined, undefined, {
      role: "student",
      branch: subject.offering.branch,
      semester: subject.offering.semester,
      fullName: "CP-N2 Student",
    });
    sessions.push(student);

    const PATH = `/api/notes/subject/${subject.subjectId}`;

    // ── First call: assembly ─────────────────────────────────────────────
    sub("GET #1 — fresh assembly");
    const first = await student.json<NotesResponse>(PATH);
    eq("status is 200", first.status, 200);
    eq("source is 'fresh'", first.body?.source, "fresh");

    const blocks = first.body?.blocks ?? [];
    check("blocks is a non-empty array", Array.isArray(blocks) && blocks.length > 0, `${blocks.length} blocks`);

    // ── Ordering: slice equality against the stored module rows ──────────
    sub("ordering — assembled array decomposes into per-module slices, in module order");
    let offset = 0;
    let sliceMismatch: string | null = null;
    const boundaries: Array<{ moduleNumber: number; from: number; to: number }> = [];
    for (const row of moduleRows) {
      const mod = subject.modules.find((m) => m.id === row.moduleId);
      const expected = row.blocks.map((b) => b.id);
      const actual = blocks.slice(offset, offset + expected.length).map((b) => b.id);
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        sliceMismatch = `M${mod?.moduleNumber} at offset ${offset}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
        break;
      }
      boundaries.push({
        moduleNumber: mod?.moduleNumber ?? -1,
        from: offset,
        to: offset + expected.length - 1,
      });
      offset += expected.length;
    }
    check(
      "each module's blocks appear as a contiguous slice, in its original order",
      sliceMismatch === null,
      sliceMismatch ?? boundaries.map((b) => `M${b.moduleNumber}[${b.from}..${b.to}]`).join(" ")
    );
    eq("the slices account for every assembled block (nothing extra, nothing dropped)", offset, blocks.length);
    check(
      "slice boundaries are in strictly ascending module_number order",
      boundaries.every((b, i) => i === 0 || b.moduleNumber > boundaries[i - 1].moduleNumber),
      boundaries.map((b) => b.moduleNumber).join(" < ")
    );

    // ── Coverage metadata ────────────────────────────────────────────────
    sub("source_metadata — the coverage denominator CP-N4 will render");
    const meta = first.body?.sourceMetadata;
    const covered = meta?.modulesCovered ?? [];
    const total = meta?.modulesTotal ?? -1;
    check("modulesCovered is an array of module ids", Array.isArray(covered) && covered.length > 0, `${covered.length}`);
    eq("modulesTotal equals the subject's real module count", total, subject.modules.length);
    check("modulesCovered.length <= modulesTotal", covered.length <= total, `${covered.length} <= ${total}`);
    check(
      "aggregate tokens are the sum of the contributing module rows",
      meta?.aggregateTokensUsed === moduleRows.reduce((s, r) => s + (r.tokensUsed ?? 0), 0),
      `${meta?.aggregateTokensUsed} vs ${moduleRows.reduce((s, r) => s + (r.tokensUsed ?? 0), 0)}`
    );

    // ── The stored row ───────────────────────────────────────────────────
    sub("stored subject-scope row");
    const subjectRows = await loadNotes(admin, subject.subjectId, "subject");
    eq("exactly one subject-scope row exists", subjectRows.length, 1);
    const row = subjectRows[0];
    eq("version is 1", row?.version, 1);
    eq("module_id is NULL on a subject-scope row", row?.moduleId, null);
    eq("row is not stale", row?.isStale, false);
    check("content_hash is 64-char hex", isSha256Hex(row?.contentHash), String(row?.contentHash).slice(0, 16) + "…");

    // ── Second call: cache ───────────────────────────────────────────────
    sub("GET #2 — served from cache, no new row");
    const second = await student.json<NotesResponse>(PATH);
    eq("status is 200", second.status, 200);
    eq("source is 'cache'", second.body?.source, "cache");
    eq("same version returned", second.body?.version, first.body?.version);
    eq(
      "same blocks returned",
      (second.body?.blocks ?? []).map((b) => b.id),
      blocks.map((b) => b.id)
    );
    const afterCache = await loadNotes(admin, subject.subjectId, "subject");
    eq("no second subject-scope row was written", afterCache.length, 1);

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
