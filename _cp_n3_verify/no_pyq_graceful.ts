/**
 * CP-N3 Part 4.2 — no_pyq_graceful: a subject with zero pyq_questions rows
 * must still serve notes normally, over real HTTP.
 *
 * IDME3532 has zero pyq_questions rows and no subject-scope study_notes row
 * yet, but all 4 modules already carry fresh module-scope notes (left by the
 * CP-N2 harnesses) — so GET /api/notes/subject/:id assembles fresh
 * deterministically (no AI call) and this harness asserts PYQ absence is not
 * a failure mode: 200, non-empty blocks, no pyqSignal anywhere, pyqEnriched:true.
 *
 *   npx tsx _cp_n3_verify/no_pyq_graceful.ts > /tmp/cp_n3_no_pyq_graceful.out 2>&1
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
import { N3_FIXTURES, resolveSubjectId } from "./shared";

type SubjectResponse = {
  blocks: Array<{ id: string; kind: string; pyqSignal?: unknown }>;
  version: number;
  source: string;
  pyqEnriched?: boolean;
};

async function main() {
  loadEnvLocal();
  await waitForServer();

  const checker = makeChecker();

  hr("CP-N3 Part 4.2 — no_pyq_graceful");

  const session: StudentSession = await signInAsStudent(undefined, undefined, {
    branch: N3_FIXTURES.MODULE_SCOPE.branch,
    semester: N3_FIXTURES.MODULE_SCOPE.semester,
  });
  const cleanup = async () => await session.cleanup();
  onSignals(cleanup);
  const subjectId = await resolveSubjectId(
    session.admin,
    N3_FIXTURES.MODULE_SCOPE.subjectCode,
  );

  const { count: pyqCount } = await session.admin
    .from("pyq_questions")
    .select("*", { count: "exact", head: true })
    .eq("subject_id", subjectId);
  checker.eq("precondition: subject has 0 pyq_questions rows", pyqCount ?? -1, 0);

  try {
    const res = await session.json<SubjectResponse>(
      `/api/notes/subject/${subjectId}`,
    );
    checker.check("200 returned", res.status === 200, `status=${res.status}`);
    checker.check(
      "blocks is a non-empty array (notes still served)",
      Array.isArray(res.body?.blocks) && res.body.blocks.length > 0,
      `count=${res.body?.blocks?.length}`,
    );
    checker.check(
      "every block has no pyqSignal field",
      (res.body?.blocks ?? []).every((b) => !("pyqSignal" in b)),
    );
    checker.check("pyqEnriched: true in response", res.body?.pyqEnriched === true);
  } finally {
    console.log(`\nCleanup: ${await cleanup()}`);
  }

  const { passed, failed } = checker.summary();
  console.log(`\nno_pyq_graceful: ${passed}/${passed + failed} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[no_pyq_graceful] fatal:", err);
  process.exit(1);
});
