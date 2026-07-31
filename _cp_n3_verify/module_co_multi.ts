/**
 * CP-N3 Part 4.5 — module_co_multi: MAX-for-papers vs SUM-for-questions, on a
 * real two-CO module.
 *
 * SECE3260 M4 is the only fixture found (by direct query) with exactly two
 * real module_co_mapping rows ("CO 1", "CO 2"). Seeds:
 *   Document 1: 2 questions, CO 1 only
 *   Document 2: 2 questions, CO 2 only
 *   Document 3: 1 question each for CO 1 and CO 2 (both COs, one paper)
 * Total: 6 question ROWS (2+2+1+1 — the checkpoint brief's own worked example
 * states "5 questions" here, which does not add up under the real schema:
 * pyq_questions.co is a single text column, so "both COs" for one paper can
 * only be represented as two separate rows, never one row counted twice.
 * questionsCount sums row counts per CO, so 6 is the only value the actual
 * data supports; the assertion below uses 6, not the brief's arithmetic),
 * 3 distinct papers touching this module.
 *
 * If papers were summed per-CO instead of unioned by document id, document 3
 * would be counted twice (once under each CO), giving coveredPapers=4 — this
 * harness's entire point is proving that does NOT happen.
 *
 * M4 has no existing study_notes row, so this GET pays for one real Flash
 * generation (`notes_gen_module`) — same cost class CP-N1/N2 accept elsewhere.
 *
 *   npx tsx _cp_n3_verify/module_co_multi.ts > /tmp/cp_n3_module_co_multi.out 2>&1
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

  hr("CP-N3 Part 4.5 — module_co_multi");

  const session: StudentSession = await signInAsStudent(undefined, undefined, {
    branch: N3_FIXTURES.MULTI_CO.branch,
    semester: N3_FIXTURES.MULTI_CO.semester,
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
    N3_FIXTURES.MULTI_CO.subjectCode,
  );
  const uploadedBy = await getSuperadminProfileId(session.admin);
  const [coA, coB] = N3_FIXTURES.MULTI_CO.cos;
  const moduleId = N3_FIXTURES.MULTI_CO.moduleId;

  try {
    const doc1 = await seedPyqDocument(session.admin, {
      subjectId,
      co: coA,
      questionCount: 2,
      uploadedBy,
    });
    const doc2 = await seedPyqDocument(session.admin, {
      subjectId,
      co: coB,
      questionCount: 2,
      uploadedBy,
    });
    // Document 3 covers BOTH COs of this module — one question per CO,
    // inserted directly rather than via seedPyqDocument (which tags every
    // row with a single CO).
    const { data: doc3, error: doc3Err } = await session.admin
      .from("documents")
      .insert({
        subject_id: subjectId,
        type: "pyq",
        title: "CP-N3 harness fixture (dual-CO paper)",
        file_path: `harness/cp-n3/${crypto.randomUUID()}.pdf`,
        year: 2025,
        uploaded_by: uploadedBy,
        status: "ready",
      })
      .select("id")
      .single();
    if (doc3Err || !doc3) throw new Error(`doc3 insert failed: ${doc3Err?.message}`);
    const { error: q3Err } = await session.admin.from("pyq_questions").insert([
      {
        document_id: doc3.id,
        subject_id: subjectId,
        section_name: "Section I",
        q_number: "Q-1",
        question_text: "CP-N3 harness fixture dual-CO question A",
        question_type: "descriptive",
        marks: 5,
        co: coA,
        btl: 2,
        year: 2025,
      },
      {
        document_id: doc3.id,
        subject_id: subjectId,
        section_name: "Section I",
        q_number: "Q-2",
        question_text: "CP-N3 harness fixture dual-CO question B",
        question_type: "descriptive",
        marks: 5,
        co: coB,
        btl: 2,
        year: 2025,
      },
    ]);
    if (q3Err) throw new Error(`doc3 questions insert failed: ${q3Err.message}`);

    seededDocIds = [doc1.documentId, doc2.documentId, doc3.id as string];

    const res = await session.json<ModuleResponse>(
      `/api/notes/module/${moduleId}`,
    );
    checker.check("200 returned", res.status === 200, `status=${res.status}`);
    const signalBlock = (res.body?.blocks ?? []).find((b) => b.pyqSignal);
    checker.check("a block carries a pyqSignal", !!signalBlock, JSON.stringify(res.body).slice(0, 300));
    const signal = signalBlock?.pyqSignal;
    checker.eq(
      "coveredPapers === 3 (union of document ids across the module's COs, not per-CO SUM which would give 4)",
      signal?.coveredPapers,
      3,
    );
    checker.eq(
      "questionsCount === 6 (sum of per-CO row counts; the actual physical row count seeded)",
      signal?.questionsCount,
      6,
    );
    checker.eq("signal.kind === 'rich' (>=2 papers AND >=5 questions)", signal?.kind, "rich");
  } finally {
    console.log(`\nCleanup: ${await cleanup()}`);
  }

  const { passed, failed } = checker.summary();
  console.log(`\nmodule_co_multi: ${passed}/${passed + failed} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[module_co_multi] fatal:", err);
  process.exit(1);
});
