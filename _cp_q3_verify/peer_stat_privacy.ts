/**
 * CP-Q3 Part 4 verification — peer-stat privacy rules.
 *
 * Costs NO AI spend: it seeds student_question_attempts directly and calls
 * computePeerStat() in process. That is the point of splitting the compute out
 * of the route (see peerStatCompute.ts) — the privacy rules are the thing under
 * test, not the HTTP plumbing.
 *
 * SCENARIOS
 *   (a) 15 attempts, 9 correct (60%)  → peerStat = 60          [shown]
 *   (b) 5 attempts, 3 correct (60%)   → omitted                [below floor]
 *   (c) 12 attempts, 11 correct (92%) → omitted                [above window]
 *   (d) 12 attempts, 1 correct (8%)   → omitted                [below window]
 *   (e) no bankQuestionId             → omitted                [fresh question]
 *   (f) subject scoping               → attempts on another subject don't count
 *   (g) the cache actually caches, and a cleared cache re-reads
 *
 * Attempts are seeded across DISTINCT students, because that is what the stat
 * claims to measure. Seeding 15 rows for one student would test the arithmetic
 * while missing the point.
 *
 *   npx tsx _cp_q3_verify/peer_stat_privacy.ts > out.txt 2>&1
 */
import { randomUUID } from "node:crypto";
import {
  hr,
  loadEnvLocal,
  makeChecker,
  onSignals,
  sub,
} from "./shared";

loadEnvLocal();

async function main() {
  const { createAdminClient } = await import("@/lib/db/supabase-server");
  const { computePeerStat, __clearPeerStatCache } = await import(
    "@/lib/assessment/peerStatCompute"
  );
  const { PEER_STAT_MIN_ATTEMPTS, PEER_STAT_MIN_PCT, PEER_STAT_MAX_PCT } =
    await import("@/lib/assessment/peerStat");

  const admin = createAdminClient();
  const { check, eq, summary } = makeChecker();

  const created = {
    attemptIds: [] as string[],
    bankIds: [] as string[],
  };

  const cleanup = async (): Promise<string> => {
    const notes: string[] = [];
    if (created.attemptIds.length) {
      const { data } = await admin
        .from("student_question_attempts")
        .delete()
        .in("id", created.attemptIds)
        .select("id");
      notes.push(`attempts: ${(data ?? []).length}`);
    }
    if (created.bankIds.length) {
      const { data } = await admin
        .from("faculty_question_bank")
        .delete()
        .in("id", created.bankIds)
        .select("id");
      notes.push(`bank rows: ${(data ?? []).length}`);
    }
    // Residue check, not an assumption (CLAUDE.md harness rules).
    const { data: residueAttempts } = await admin
      .from("student_question_attempts")
      .select("id")
      .in("id", created.attemptIds.length ? created.attemptIds : ["none"]);
    const { data: residueBank } = await admin
      .from("faculty_question_bank")
      .select("id")
      .in("id", created.bankIds.length ? created.bankIds : ["none"]);
    notes.push(
      `residue — attempts: ${(residueAttempts ?? []).length}, bank: ${(residueBank ?? []).length}`
    );
    return notes.join(", ");
  };
  onSignals(cleanup);

  try {
    hr("CP-Q3 Part 4 — peer-stat privacy rules");
    console.log(
      `  floor=${PEER_STAT_MIN_ATTEMPTS} attempts, window=${PEER_STAT_MIN_PCT}–${PEER_STAT_MAX_PCT}%`
    );

    // ── fixtures ───────────────────────────────────────────────────────────
    const { data: students } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "student")
      .limit(20);
    const studentIds = ((students ?? []) as Array<{ id: string }>).map((s) => s.id);
    if (studentIds.length === 0) throw new Error("no student profiles found");

    const { data: subjects } = await admin
      .from("subjects")
      .select("id, code")
      .limit(2);
    const subjectRows = (subjects ?? []) as Array<{ id: string; code: string }>;
    if (subjectRows.length < 2) throw new Error("need 2 subjects for the scoping test");
    const [subjectA, subjectB] = subjectRows;

    const { data: modules } = await admin
      .from("modules")
      .select("id")
      .eq("subject_id", subjectA.id)
      .limit(1);
    const moduleId = ((modules ?? []) as Array<{ id: string }>)[0]?.id ?? null;

    const { data: faculty } = await admin
      .from("profiles")
      .select("id")
      .in("role", ["faculty", "superadmin"])
      .limit(1);
    const facultyId = ((faculty ?? []) as Array<{ id: string }>)[0]?.id;
    if (!facultyId) throw new Error("no faculty/superadmin profile for bank rows");

    console.log(
      `  fixtures: ${studentIds.length} students, subjects ${subjectA.code} / ${subjectB.code}`
    );

    /** Create a bank question to hang attempts off. */
    const makeBankQuestion = async (label: string): Promise<string> => {
      const id = randomUUID();
      const { error } = await admin.from("faculty_question_bank").insert({
        id,
        subject_id: subjectA.id,
        faculty_id: facultyId,
        module_id: moduleId,
        question_text: `[CP-Q3 peer-stat probe] ${label}`,
        question_type: "mcq",
        marks: 1,
        options: ["A", "B", "C", "D"],
        model_answer: "B",
        difficulty: "medium",
        source: "ai_generated",
        is_verified: false,
      });
      if (error) throw new Error(`bank insert failed: ${error.message}`);
      created.bankIds.push(id);
      return id;
    };

    /** Seed `n` attempts, `correct` of them correct, across distinct students. */
    const seedAttempts = async (
      questionId: string | null,
      subjectId: string,
      n: number,
      correct: number
    ) => {
      const rows = Array.from({ length: n }, (_, i) => ({
        id: randomUUID(),
        // Cycle through real students — the stat is about distinct people.
        student_id: studentIds[i % studentIds.length],
        question_id: questionId,
        subject_id: subjectId,
        module_id: moduleId,
        question_text: "[CP-Q3 peer-stat probe] attempt",
        question_type: "mcq",
        student_answer: i < correct ? "B" : "A",
        is_correct: i < correct,
        time_taken_seconds: 20,
        source: questionId ? "bank" : "ai_fresh",
        session_id: null,
      }));
      const { error } = await admin.from("student_question_attempts").insert(rows);
      if (error) throw new Error(`attempt insert failed: ${error.message}`);
      created.attemptIds.push(...rows.map((r) => r.id));
    };

    // ── (a) 15 attempts, 60% correct → shown ───────────────────────────────
    sub("(a) 15 attempts, 9 correct (60%) → peerStat = 60");
    const qA = await makeBankQuestion("scenario-a-15-attempts-60pct");
    await seedAttempts(qA, subjectA.id, 15, 9);
    __clearPeerStatCache();
    const a = await computePeerStat(admin, qA, subjectA.id);
    eq("peerStat", a.pct, 60);
    eq("n counted", a.debug.n, 15);
    eq("not suppressed", a.debug.suppressed, null);

    // ── (b) 5 attempts → below the floor ───────────────────────────────────
    sub("(b) 5 attempts, 3 correct (60%) → omitted, below the 10-attempt floor");
    const qB = await makeBankQuestion("scenario-b-5-attempts");
    await seedAttempts(qB, subjectA.id, 5, 3);
    __clearPeerStatCache();
    const b = await computePeerStat(admin, qB, subjectA.id);
    eq("peerStat omitted", b.pct, null);
    eq("suppression reason", b.debug.suppressed, "below_floor");
    check(
      "the raw rate was computable but withheld",
      b.debug.rawPct === 60,
      `rawPct=${b.debug.rawPct} — the floor is a privacy rule, not a missing number`
    );

    // ── (c) above the window ───────────────────────────────────────────────
    sub("(c) 12 attempts, 11 correct (92%) → omitted, above the 80% window");
    const qC = await makeBankQuestion("scenario-c-92pct");
    await seedAttempts(qC, subjectA.id, 12, 11);
    __clearPeerStatCache();
    const c = await computePeerStat(admin, qC, subjectA.id);
    eq("peerStat omitted", c.pct, null);
    eq("suppression reason", c.debug.suppressed, "outside_window");
    eq("raw rate was 92", c.debug.rawPct, 92);

    // ── (d) below the window ───────────────────────────────────────────────
    sub("(d) 12 attempts, 1 correct (8%) → omitted, below the 20% window");
    const qD = await makeBankQuestion("scenario-d-8pct");
    await seedAttempts(qD, subjectA.id, 12, 1);
    __clearPeerStatCache();
    const d = await computePeerStat(admin, qD, subjectA.id);
    eq("peerStat omitted", d.pct, null);
    eq("suppression reason", d.debug.suppressed, "outside_window");
    eq("raw rate was 8", d.debug.rawPct, 8);

    // ── (e) a fresh question has no peers ──────────────────────────────────
    sub("(e) no bankQuestionId → omitted by construction");
    __clearPeerStatCache();
    const e = await computePeerStat(admin, null, subjectA.id);
    eq("peerStat omitted", e.pct, null);
    eq("suppression reason", e.debug.suppressed, "no_bank_question");
    check(
      "no query was issued",
      e.debug.n === 0,
      "a freshly generated question has been served to exactly one student"
    );

    // ── (f) subject scoping ────────────────────────────────────────────────
    sub("(f) attempts on another subject do not count toward the stat");
    const qF = await makeBankQuestion("scenario-f-scoping");
    await seedAttempts(qF, subjectA.id, 12, 6); // 50% in subject A
    await seedAttempts(qF, subjectB.id, 12, 12); // 100% in subject B
    __clearPeerStatCache();
    const fA = await computePeerStat(admin, qF, subjectA.id);
    eq("subject A sees only its own cohort", fA.debug.n, 12);
    eq("…and its own rate", fA.pct, 50);
    __clearPeerStatCache();
    const fB = await computePeerStat(admin, qF, subjectB.id);
    eq("subject B is a separate cohort", fB.debug.n, 12);
    check(
      "subject B's 100% is correctly withheld",
      fB.pct === null && fB.debug.rawPct === 100,
      `rawPct=${fB.debug.rawPct}`
    );

    // ── (g) the cache ──────────────────────────────────────────────────────
    sub("(g) cache behaviour");
    __clearPeerStatCache();
    const g1 = await computePeerStat(admin, qA, subjectA.id);
    const g2 = await computePeerStat(admin, qA, subjectA.id);
    eq("first call is a miss", g1.debug.fromCache, false);
    eq("second call is a hit", g2.debug.fromCache, true);
    eq("…returning the same value", g2.pct, g1.pct);
    // A new attempt landing while the entry is cached must NOT change the
    // served value — that is the deliberate staleness, and it is worth
    // asserting so nobody "fixes" the cache into a per-request query.
    await seedAttempts(qA, subjectA.id, 5, 0);
    const g3 = await computePeerStat(admin, qA, subjectA.id);
    eq("a cached entry stays stale within its TTL", g3.pct, g1.pct);
    __clearPeerStatCache();
    const g4 = await computePeerStat(admin, qA, subjectA.id);
    check(
      "…and re-reads once cleared",
      g4.debug.n === 20 && g4.debug.fromCache === false,
      `n=${g4.debug.n}, pct=${g4.pct}`
    );
  } finally {
    const notes = await cleanup();
    console.log(`\ncleanup: ${notes}`);
    const { passed, failed } = summary();
    hr(`RESULT  ${passed} passed, ${failed} failed`);
    process.exitCode = failed === 0 ? 0 : 1;
  }
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
