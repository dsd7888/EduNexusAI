/**
 * CP-N3 Part 4.4 — paper_counting: validates the two-query design and the
 * subject-wide `totalPapers` count against `coveredPapers` for one module.
 *
 * 3 distinct documents seeded on IDME3532: 2 tagged with M1's CO ("CO 5"),
 * 1 tagged with M2's CO ("CO 3") — a real paper that does NOT examine M1.
 * Asserts totalPapers===3 (subject-wide, both COs count), coveredPapers===2
 * for M1 (only the CO 5 papers), and that the third document's CO doesn't
 * leak into M1's coverage.
 *
 * M1 already carries a fresh cached module-scope note (see shared.ts) — this
 * GET is a cache hit, no AI spend.
 *
 *   npx tsx _cp_n3_verify/paper_counting.ts > /tmp/cp_n3_paper_counting.out 2>&1
 */
import {
  loadEnvLocal,
  signInAsStudent,
  waitForServer,
  onSignals,
  makeChecker,
  hr,
  type StudentSession,
} from "./shared";
import {
  N3_FIXTURES,
  resolveSubjectId,
  seedPyqDocument,
  purgeSeededPyq,
  getSuperadminProfileId,
} from "./shared";

type ModuleResponse = {
  blocks: Array<{
    id: string;
    kind: string;
    pyqSignal?: { kind: string; coveredPapers?: number; totalPapers?: number; questionsCount?: number };
  }>;
  pyqEnriched?: boolean;
};

async function main() {
  loadEnvLocal();
  await waitForServer();

  const checker = makeChecker();

  hr("CP-N3 Part 4.4 — paper_counting");

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
    const doc1 = await seedPyqDocument(session.admin, {
      subjectId,
      co: m1.co,
      questionCount: 3,
      uploadedBy,
    });
    const doc2 = await seedPyqDocument(session.admin, {
      subjectId,
      co: m1.co,
      questionCount: 3,
      uploadedBy,
    });
    // A real paper that does NOT examine M1 — must count toward totalPapers
    // (subject-wide) but never toward M1's coveredPapers.
    const doc3 = await seedPyqDocument(session.admin, {
      subjectId,
      co: m2.co,
      questionCount: 2,
      uploadedBy,
    });
    seededDocIds = [doc1.documentId, doc2.documentId, doc3.documentId];

    const res = await session.json<ModuleResponse>(
      `/api/notes/module/${m1.id}`,
    );
    checker.check("200 returned", res.status === 200, `status=${res.status}`);
    const signalBlock = (res.body?.blocks ?? []).find((b) => b.pyqSignal);
    checker.check("a block carries a pyqSignal", !!signalBlock);
    const signal = signalBlock?.pyqSignal;
    checker.eq("signal.kind === 'rich'", signal?.kind, "rich");
    checker.eq("totalPapers === 3", signal?.totalPapers, 3);
    checker.eq("coveredPapers === 2", signal?.coveredPapers, 2);
    checker.check(
      "the third document (M2's CO) is not reflected in coveredPapers",
      signal?.coveredPapers !== 3,
      `coveredPapers=${signal?.coveredPapers}`,
    );
  } finally {
    console.log(`\nCleanup: ${await cleanup()}`);
  }

  const { passed, failed } = checker.summary();
  console.log(`\npaper_counting: ${passed}/${passed + failed} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[paper_counting] fatal:", err);
  process.exit(1);
});
