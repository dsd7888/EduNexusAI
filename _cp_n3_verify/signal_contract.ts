/**
 * CP-N3 Part 4.1 — the three-state PYQ signal contract, over real HTTP.
 *
 * Subtest A (rich): 2 distinct papers, 6 questions total, on IDME3532 M1's CO
 *   ("CO 5"). coveredPapers>=2 AND questionsCount>=5 → rich, with the exact
 *   fields exposed.
 * Subtest B (weak): 1 paper, 3 questions, same CO. coveredPapers=1 → weak,
 *   and weak MUST NOT expose coveredPapers/questionsCount (type-level: the
 *   PyqSignal union's weak variant has no other fields).
 * Subtest C (none): IDME3532 M2 (CO "CO 3"), with zero seeded PYQ data at that
 *   point — pyqSignal absent from every block, `pyqEnriched: true` present.
 *
 * Both M1 and M2 already carry a fresh, cached module-scope study_notes row
 * (see shared.ts) — every GET below is a cache hit, so this harness makes no
 * AI calls.
 *
 *   npx tsx _cp_n3_verify/signal_contract.ts > /tmp/cp_n3_signal_contract.out 2>&1
 */
import {
  loadEnvLocal,
  signInAsStudent,
  waitForServer,
  onSignals,
  makeChecker,
  hr,
  sub,
  type StudentSession,
} from "./shared";
import {
  N3_FIXTURES,
  resolveSubjectId,
  seedPyqDocument,
  purgeSeededPyq,
  getSuperadminProfileId,
} from "./shared";

type EnrichedBlock = { id: string; kind: string; pyqSignal?: unknown };
type ModuleResponse = {
  blocks: EnrichedBlock[];
  version: number;
  source: string;
  pyqEnriched?: boolean;
};

async function main() {
  loadEnvLocal();
  await waitForServer();

  const checker = makeChecker();

  hr("CP-N3 Part 4.1 — signal_contract");

  const session: StudentSession = await signInAsStudent(undefined, undefined, {
    branch: N3_FIXTURES.MODULE_SCOPE.branch,
    semester: N3_FIXTURES.MODULE_SCOPE.semester,
  });

  let seededDocIds: string[] = [];
  const cleanup = async () => {
    const notes: string[] = [];
    if (seededDocIds.length > 0) {
      const res = await purgeSeededPyq(session.admin, seededDocIds);
      notes.push(
        `purged ${seededDocIds.length} doc(s); residual q=${res.residualQuestions} doc=${res.residualDocuments}`,
      );
    }
    notes.push(await session.cleanup());
    return notes.join("; ");
  };
  onSignals(cleanup);
  const subjectId = await resolveSubjectId(
    session.admin,
    N3_FIXTURES.MODULE_SCOPE.subjectCode,
  );
  const uploadedBy = await getSuperadminProfileId(session.admin);
  const m1 = N3_FIXTURES.MODULE_SCOPE.m1;
  const m2 = N3_FIXTURES.MODULE_SCOPE.m2;

  try {
    // ── Subtest A: rich ──────────────────────────────────────────────────
    sub("Subtest A — rich signal");
    const docA1 = await seedPyqDocument(session.admin, {
      subjectId,
      co: m1.co,
      questionCount: 3,
      uploadedBy,
    });
    const docA2 = await seedPyqDocument(session.admin, {
      subjectId,
      co: m1.co,
      questionCount: 3,
      uploadedBy,
    });
    seededDocIds = [docA1.documentId, docA2.documentId];

    const resA = await session.json<ModuleResponse>(
      `/api/notes/module/${m1.id}`,
    );
    checker.check("A: 200 OK", resA.status === 200, `status=${resA.status}`);
    checker.check("A: pyqEnriched true", resA.body?.pyqEnriched === true);
    const richBlock = (resA.body?.blocks ?? []).find((b) => b.pyqSignal);
    checker.check("A: at least one block carries pyqSignal", !!richBlock);
    const richSignal = richBlock?.pyqSignal as
      | { kind: string; coveredPapers: number; totalPapers: number; questionsCount: number }
      | undefined;
    checker.eq("A: signal.kind", richSignal?.kind, "rich");
    checker.check(
      "A: coveredPapers >= 2",
      (richSignal?.coveredPapers ?? 0) >= 2,
      `coveredPapers=${richSignal?.coveredPapers}`,
    );
    checker.check(
      "A: questionsCount >= 5",
      (richSignal?.questionsCount ?? 0) >= 5,
      `questionsCount=${richSignal?.questionsCount}`,
    );
    checker.eq("A: totalPapers === 2", richSignal?.totalPapers, 2);
    checker.check(
      "A: every block with a signal agrees (module-level, not block-level)",
      (resA.body?.blocks ?? [])
        .filter((b) => b.pyqSignal)
        .every(
          (b) => JSON.stringify(b.pyqSignal) === JSON.stringify(richSignal),
        ),
    );

    await purgeSeededPyq(session.admin, seededDocIds);
    seededDocIds = [];

    // ── Subtest B: weak ──────────────────────────────────────────────────
    sub("Subtest B — weak signal");
    const docB = await seedPyqDocument(session.admin, {
      subjectId,
      co: m1.co,
      questionCount: 3,
      uploadedBy,
    });
    seededDocIds = [docB.documentId];

    const resB = await session.json<ModuleResponse>(
      `/api/notes/module/${m1.id}`,
    );
    checker.check("B: 200 OK", resB.status === 200, `status=${resB.status}`);
    const weakBlocks = (resB.body?.blocks ?? []).filter((b) => b.pyqSignal);
    checker.check("B: at least one block carries pyqSignal", weakBlocks.length > 0);
    checker.check(
      "B: every carrying block is kind='weak'",
      weakBlocks.every((b) => (b.pyqSignal as { kind: string }).kind === "weak"),
    );
    checker.check(
      "B: weak signal exposes no coveredPapers/questionsCount",
      weakBlocks.every(
        (b) => Object.keys(b.pyqSignal as object).length === 1,
      ),
      JSON.stringify(weakBlocks[0]?.pyqSignal),
    );

    await purgeSeededPyq(session.admin, seededDocIds);
    seededDocIds = [];

    // ── Subtest C: none ──────────────────────────────────────────────────
    sub("Subtest C — none (absent, not a third union member)");
    const resC = await session.json<ModuleResponse>(
      `/api/notes/module/${m2.id}`,
    );
    checker.check("C: 200 OK", resC.status === 200, `status=${resC.status}`);
    checker.check("C: pyqEnriched true", resC.body?.pyqEnriched === true);
    checker.check(
      "C: no block carries pyqSignal",
      (resC.body?.blocks ?? []).every((b) => !("pyqSignal" in b)),
    );
  } finally {
    const note = await cleanup();
    console.log(`\nCleanup: ${note}`);
  }

  const { passed, failed } = checker.summary();
  console.log(`\nsignal_contract: ${passed}/${passed + failed} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[signal_contract] fatal:", err);
  process.exit(1);
});
