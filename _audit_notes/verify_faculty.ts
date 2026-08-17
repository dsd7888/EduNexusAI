import { signInAsStudent, makeChecker, onSignals, waitForServer, loadEnvLocal } from "../src/lib/testing/httpHarness";

const SECE3260 = "74e25bc8-d2bc-4a11-8242-e0fefae8f3af";

async function main() {
  loadEnvLocal();
  await waitForServer();
  const checker = makeChecker();

  const faculty = await signInAsStudent(undefined, undefined, { role: "faculty", fullName: "CP Harness Unassigned Faculty" });
  onSignals(faculty.cleanup);
  console.log(`Signed in as unassigned faculty ${faculty.email}`);

  try {
    const { data: mod } = await faculty.admin.from("modules").select("id").eq("subject_id", SECE3260).eq("module_number", 2).maybeSingle();
    const res = await faculty.json<any>(`/api/notes/module/${mod.id}/regenerate`, { method: "POST" });
    checker.check(
      "unassigned faculty regenerate denied (scope gate, not just role gate)",
      res.status === 403,
      `status=${res.status} body=${JSON.stringify(res.body)}`
    );

    const subjRes = await faculty.json<any>(`/api/notes/subject/${SECE3260}/regenerate`, { method: "POST" });
    checker.check(
      "unassigned faculty subject-regenerate denied",
      subjRes.status === 403,
      `status=${subjRes.status} body=${JSON.stringify(subjRes.body)}`
    );

    // Also confirm unassigned faculty cannot even READ notes for a subject they're not assigned to
    const readRes = await faculty.json<any>(`/api/notes/subject/${SECE3260}`);
    checker.check(
      "unassigned faculty read also denied",
      readRes.status === 403,
      `status=${readRes.status} body=${JSON.stringify(readRes.body)}`
    );
  } finally {
    const note = await faculty.cleanup();
    console.log(`Cleanup: ${note}`);
  }

  const { passed, failed } = checker.summary();
  console.log(`${passed} passed, ${failed} failed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
