/**
 * CP-Q3 — exam_sim server-side timer enforcement, over real HTTP.
 *
 * THE BRIEF SAID "10-second timeLimit, wait 12s, assert post-timeout
 * rejection". Two things in the code make that assertion wrong as written, and
 * this harness tests what the route ACTUALLY does instead:
 *
 *   1. `timeLimit` is in MINUTES, not seconds (routeHandler.ts →
 *      `time_limit_minutes`). A 10-second limit is `timeLimit: 10/60`.
 *
 *   2. There is a deliberate 5-second grace. answer/route.ts rejects only when
 *          elapsed > limit * 60 + 5
 *      "5s grace absorbs request latency on an answer sent right at the buzzer
 *      — a network hop should not cost a student a question."
 *      So a 10s limit really expires at 15s, and an answer at 12s is ACCEPTED.
 *      Asserting rejection at 12s would have failed against correct code.
 *
 * This harness therefore probes BOTH SIDES of the real boundary — accepted
 * inside the grace window, rejected past it — which is a strictly stronger
 * test: it proves the timer fires AND that it does not fire early.
 *
 * "REJECTION OR AUTO-ABANDONMENT?" — VERIFIED: rejection.
 * The route returns 409 "Time is up for this session" and leaves the row
 * `in_progress`. Auto-abandonment is an unrelated mechanism on a different
 * timescale: /api/cron/abandon-stale-assessments sweeps sessions started more
 * than STALE_HOURS = 4 hours ago. Nothing marks a session `abandoned` at
 * time-limit expiry. Both halves are asserted below.
 *
 * ALSO ASSERTED, and worth knowing: /api/assessment/submit does NOT enforce the
 * timer. A student whose clock has run out is blocked from ANSWERING but can
 * still submit what they already had. That is defensible (the alternative
 * destroys finished work on a slow last request) but it is an undocumented
 * asymmetry, so it is pinned here rather than left to be rediscovered.
 *
 * All waits are driven off the SERVER's `started_at`, never the harness's wall
 * clock — the session's clock starts when the row is inserted, which is after
 * question generation, and generation time varies by tens of seconds.
 *
 * Costs one of the 3/day exam-sim rate-limit allowance, on an ephemeral student
 * that cleanup deletes, so the allowance is not consumed for a real user.
 *
 *   npx tsx _cp_q3_verify/exam_sim_timing.ts > out.txt 2>&1
 */

import {
  signInAsStudent,
  waitForServer,
  onSignals,
  makeChecker,
  sleep,
  hr,
  sub,
  type StudentSession,
} from "@/lib/testing/httpHarness";

const SUBJECT_ID = process.env.HARNESS_SUBJECT_ID ?? "74e25bc8-d2bc-4a11-8242-e0fefae8f3af";

/** Seconds. The route's grace is +5, so the effective deadline is 15s. */
const LIMIT_SECONDS = 10;
const GRACE_SECONDS = 5;
const EFFECTIVE_DEADLINE = LIMIT_SECONDS + GRACE_SECONDS;

/** Inside the grace window — must still be accepted. (The brief's "12s".) */
const PROBE_INSIDE_GRACE = 12;
/** Past the grace window — must be rejected. */
const PROBE_PAST_DEADLINE = 18;

interface ExamResponse {
  sessionId: string;
  mode: string;
  immediateFeedback: boolean;
  timeLimitMinutes: number | null;
  questions: Array<{ slotId: string; options?: string[] | null }>;
  warnings: string[];
}

interface KeyEntry {
  slotId: string;
  correctAnswer: string;
}

async function main() {
  const c = makeChecker();
  await waitForServer();

  const s: StudentSession = await signInAsStudent(undefined, undefined, {
    templateEmail: "teststudent@gmail.com",
  });
  onSignals(s.cleanup);

  try {
    hr("CP-Q3 — EXAM_SIM TIMER ENFORCEMENT");
    console.log(`student ${s.email} (${s.userId})`);
    console.log(
      `limit ${LIMIT_SECONDS}s + ${GRACE_SECONDS}s grace → effective deadline ${EFFECTIVE_DEADLINE}s`
    );

    // ── 1. create a timed exam_sim session ─────────────────────────────────
    sub("1. POST /api/assessment/exam-sim (timeLimit = 10 seconds)");
    const created = await s.json<ExamResponse>("/api/assessment/exam-sim", {
      method: "POST",
      body: JSON.stringify({
        subjectIds: [SUBJECT_ID],
        questionCount: 10, // exam_sim minimum
        questionTypes: ["mcq"],
        timeLimit: LIMIT_SECONDS / 60, // MINUTES — this is the units trap
      }),
    });
    c.eq("status 200", created.status, 200);
    if (created.status !== 200) {
      console.log("  body:", JSON.stringify(created.body).slice(0, 800));
      throw new Error("exam_sim creation failed — nothing downstream is meaningful");
    }
    const exam = created.body;
    console.log(`  created in ${created.ms}ms, sessionId ${exam.sessionId}`);
    c.eq("mode is exam_sim", exam.mode, "exam_sim");
    c.eq(
      "immediateFeedback is FALSE for exam_sim (deferred feedback)",
      exam.immediateFeedback,
      false
    );
    c.check(
      "the fractional minute limit round-trips",
      Math.abs((exam.timeLimitMinutes ?? 0) - LIMIT_SECONDS / 60) < 1e-9,
      `${exam.timeLimitMinutes} minutes = ${(exam.timeLimitMinutes ?? 0) * 60}s`
    );

    // The server's clock, not ours.
    const { data: sessRow } = await s.admin
      .from("quiz_sessions")
      .select("started_at, status")
      .eq("id", exam.sessionId)
      .maybeSingle();
    const startedAt = new Date(
      (sessRow as { started_at: string }).started_at
    ).getTime();
    const elapsed = () => (Date.now() - startedAt) / 1000;
    const waitUntil = async (t: number) => {
      const remaining = t - elapsed();
      if (remaining > 0) await sleep(remaining * 1000 + 250);
    };
    console.log(`  elapsed at first probe: ${elapsed().toFixed(1)}s`);

    const { data: keyRow } = await s.admin
      .from("quiz_session_keys")
      .select("key")
      .eq("session_id", exam.sessionId)
      .maybeSingle();
    const key = ((keyRow as { key?: KeyEntry[] } | null)?.key ?? []) as KeyEntry[];
    const bySlot = new Map(key.map((k) => [k.slotId, k.correctAnswer]));
    const slots = exam.questions.map((q) => q.slotId);
    const answerAt = (slotId: string) =>
      s.json<Record<string, unknown>>("/api/assessment/answer", {
        method: "POST",
        body: JSON.stringify({
          sessionId: exam.sessionId,
          slotId,
          studentAnswer: bySlot.get(slotId) ?? "A",
          timeTakenSeconds: 3,
        }),
      });

    // ── 2. before the deadline: accepted, and feedback WITHHELD ────────────
    sub("2. answer well inside the limit");
    const early = await answerAt(slots[0]);
    console.log(`  answered at t=${elapsed().toFixed(1)}s → ${early.status}`);
    c.eq("accepted (200)", early.status, 200);
    c.eq("returns { recorded: true } — deferred feedback", early.body.recorded, true);
    c.check(
      "NO correctAnswer leaked mid-exam",
      !JSON.stringify(early.body).includes("correctAnswer"),
      JSON.stringify(early.body)
    );
    c.check(
      "NO explanation leaked mid-exam",
      !JSON.stringify(early.body).includes("explanation")
    );
    c.check("no isCorrect field either", early.body.isCorrect === undefined);

    // ── 3. inside the 5s grace: STILL accepted ─────────────────────────────
    sub(`3. answer at t=${PROBE_INSIDE_GRACE}s — past the limit, inside the grace`);
    if (elapsed() > PROBE_INSIDE_GRACE) {
      console.log(
        `  ⚠ skipped: already t=${elapsed().toFixed(1)}s at this point (generation was slow)`
      );
    } else {
      await waitUntil(PROBE_INSIDE_GRACE);
      // The server evaluates the timer when it RECEIVES the request, so the
      // precondition is measured before the call, not after it — in dev the
      // round trip is seconds and post-response elapsed would overstate t.
      const tSent = elapsed();
      const inGrace = await answerAt(slots[1]);
      console.log(
        `  answered at t=${tSent.toFixed(1)}s (response at ${elapsed().toFixed(1)}s) → ${inGrace.status}`
      );
      c.check(
        `t=${tSent.toFixed(1)}s at send is past the ${LIMIT_SECONDS}s limit but inside the ${EFFECTIVE_DEADLINE}s deadline`,
        tSent > LIMIT_SECONDS && tSent < EFFECTIVE_DEADLINE,
        "precondition for this probe"
      );
      c.eq(
        "STILL ACCEPTED (200) — the 5s grace is real, and the brief's 12s assertion would have been wrong",
        inGrace.status,
        200
      );
    }

    // ── 4. past the deadline: rejected ─────────────────────────────────────
    sub(`4. answer at t=${PROBE_PAST_DEADLINE}s — past limit + grace`);
    await waitUntil(PROBE_PAST_DEADLINE);
    const late = await answerAt(slots[2]);
    const tLate = elapsed();
    console.log(`  answered at t=${tLate.toFixed(1)}s → ${late.status}`);
    c.check(`t=${tLate.toFixed(1)}s is past the ${EFFECTIVE_DEADLINE}s deadline`, tLate > EFFECTIVE_DEADLINE);
    c.eq("REJECTED with 409", late.status, 409);
    c.check(
      "the error names the timer",
      String(late.body.error ?? "").toLowerCase().includes("time is up"),
      String(late.body.error)
    );

    // Not a fluke of one slot: an untouched slot is rejected identically.
    const late2 = await answerAt(slots[3]);
    c.eq("a different slot is rejected the same way (409)", late2.status, 409);

    // ── 5. rejection, NOT auto-abandonment ─────────────────────────────────
    sub("5. which behaviour is it — rejection or auto-abandonment?");
    const { data: afterRow } = await s.admin
      .from("quiz_sessions")
      .select("status, completed_at")
      .eq("id", exam.sessionId)
      .maybeSingle();
    const after = afterRow as { status: string; completed_at: string | null };
    c.eq(
      "session is STILL in_progress — expiry rejects answers, it does not abandon the session",
      after.status,
      "in_progress"
    );
    c.check("completed_at is still null", after.completed_at === null);

    const resume = await s.json<Record<string, unknown>>(
      `/api/assessment/session/${exam.sessionId}`
    );
    c.eq("resume still reports in_progress", resume.body.status, "in_progress");
    c.eq("remainingSeconds has floored at 0 (never negative)", resume.body.remainingSeconds, 0);
    console.log(
      `  auto-abandonment is a SEPARATE mechanism: /api/cron/abandon-stale-assessments,` +
        ` STALE_HOURS = 4. Nothing abandons a session at time-limit expiry.`
    );

    // ── 6. the asymmetry: submit is NOT time-gated ─────────────────────────
    sub("6. submit after expiry");
    const submitted = await s.json<Record<string, unknown>>("/api/assessment/submit", {
      method: "POST",
      body: JSON.stringify({
        sessionId: exam.sessionId,
        answers: slots.map((slotId, i) => ({
          questionIndex: i,
          slotId,
          studentAnswer: bySlot.get(slotId) ?? "A",
          timeTakenSeconds: 2,
        })),
      }),
    });
    c.eq(
      "submit SUCCEEDS after the timer expired — /submit has no time check, unlike /answer",
      submitted.status,
      200
    );
    c.check(
      "exam_sim does NOT return masteryDeltas (benchmark instrument, not a practice loop)",
      submitted.body.masteryDeltas === undefined
    );

    const { data: masteryRows } = await s.admin
      .from("student_topic_mastery")
      .select("id")
      .eq("student_id", s.userId);
    c.eq(
      "student_topic_mastery is untouched by exam_sim",
      (masteryRows ?? []).length,
      0
    );

    const { data: attempts } = await s.admin
      .from("student_question_attempts")
      .select("id")
      .eq("session_id", exam.sessionId);
    c.check(
      "attempts ARE recorded for exam_sim (history feeds the 30-day bank exclusion)",
      (attempts ?? []).length > 0,
      `${(attempts ?? []).length} row(s)`
    );

    const { passed, failed } = c.summary();
    hr(`EXAM_SIM TIMING: ${passed} passed, ${failed} failed`);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    const notes = await s.cleanup();
    console.log(`\ncleanup: ${notes}`);
    const residue: string[] = [];
    for (const [table, col] of [
      ["quiz_sessions", "student_id"],
      ["student_question_attempts", "student_id"],
      ["student_topic_mastery", "student_id"],
    ] as const) {
      const { data } = await s.admin.from(table).select("id").eq(col, s.userId);
      if ((data ?? []).length > 0) residue.push(`${table}=${(data ?? []).length}`);
    }
    console.log(
      residue.length === 0
        ? "residue check: clean — no rows remain for this student"
        : `residue check: LEFTOVER ${residue.join(", ")}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
