/**
 * CP-Q2 verification harness — modes, verifier, mastery, GATE, session hygiene.
 *
 *   (a) Quick mode      — plan → bank → generate → submit → mastery UPDATED.
 *   (b) Mastery mode    — adaptive plan → scripted 80% run → mastery rows
 *                         written, difficulty promoted where §16 thresholds met.
 *   (c) Exam sim + GATE — 65Q, exact type distribution, every NAT verified,
 *                         discards surfaced with reason='nat_verify_discard'.
 *   (d) VERIFIER PROBES — the acceptance evidence. Two targets × 10 iterations:
 *                         the Vigenère module (SECE3260 M2) and a borderline
 *                         module (SOEEC1010 M4). Reports discard rate for each,
 *                         which is what distinguishes "gate 2 catches a
 *                         Vigenère-specific failure" from "gate 2 catches a
 *                         general NAT-on-marginal-content failure".
 *   (e) Abandonment     — in_progress session backdated 5h → cron → 'abandoned',
 *                         with its attempts still present.
 *
 * Cleans up everything it creates: quiz_sessions, student_question_attempts,
 * student_topic_mastery, write-through bank rows, and any module quant state it
 * had to set. Signal-safe (see CP-Q1.5 harness — do not pipe through head).
 *
 *   npx tsx _cp_q2_verify/verify.ts > out.txt 2>&1
 *   PROBE_ITERATIONS=10 npx tsx _cp_q2_verify/verify.ts
 *   SKIP_GATE=1 npx tsx _cp_q2_verify/verify.ts    # skip the 65Q exam sim
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvLocal();

const STUDENT_EMAIL = process.env.STUDENT ?? "teststudent@gmail.com";
const PROBE_ITERATIONS = Number(process.env.PROBE_ITERATIONS ?? 10);

function hr(title: string): void {
  console.log(`\n${"═".repeat(78)}\n${title}\n${"═".repeat(78)}`);
}
function sub(title: string): void {
  console.log(`\n${"─".repeat(70)}\n${title}\n${"─".repeat(70)}`);
}

interface Created {
  sessionIds: string[];
  attemptIds: string[];
  masteryIds: string[];
  bankIds: string[];
  quantModules: Array<{
    id: string;
    quant_profile: string | null;
    quant_confidence: string | null;
    quant_source: string | null;
    quant_classified_at: string | null;
  }>;
}

async function main() {
  const { workAsyncStorage } = await import(
    "next/dist/server/app-render/work-async-storage.external"
  );
  const { createAdminClient } = await import("@/lib/db/supabase-server");
  const { runAssessment } = await import("@/lib/assessment/runner");
  const { planAssessment } = await import("@/lib/assessment/engine");
  const { loadSubjectContexts, generateFreshQuestions } = await import(
    "@/lib/assessment/generator"
  );
  const { verifyNatQuestions } = await import("@/lib/assessment/natVerify");
  const { gradeSubmission, updateMastery } = await import(
    "@/lib/assessment/grading"
  );
  const { GATE_PRESET, MODE_CONFIG } = await import("@/lib/assessment/presets");

  const admin = createAdminClient();
  // NOTE: this shim EXECUTES the callback rather than discarding it (the CP-Q1
  // harnesses discard). routeAI logs every call to ai_call_logs via after(), so
  // discarding would make the "AI call mix" check below vacuously pass — it
  // would be asserting over an empty table. Executing means the harness's real
  // spend lands in ai_call_logs, which is also where it belongs.
  const store = {
    afterContext: {
      after: (fn: unknown) => {
        if (typeof fn === "function") void (fn as () => unknown)();
      },
    },
  };
  const runInScope = <T>(fn: () => Promise<T>): Promise<T> =>
    workAsyncStorage.run(store as never, fn);

  const created: Created = {
    sessionIds: [],
    attemptIds: [],
    masteryIds: [],
    bankIds: [],
    quantModules: [],
  };

  const cleanup = async (): Promise<string> => {
    const notes: string[] = [];
    if (created.sessionIds.length) {
      await admin
        .from("student_question_attempts")
        .delete()
        .in("session_id", created.sessionIds);
      const { data } = await admin
        .from("quiz_sessions")
        .delete()
        .in("id", created.sessionIds)
        .select("id");
      notes.push(`quiz_sessions: ${(data ?? []).length}`);
    }
    // Attempts written outside a session (probe runs) and any stragglers.
    const { data: strayAttempts } = await admin
      .from("student_question_attempts")
      .delete()
      .in("id", created.attemptIds.length ? created.attemptIds : ["none"])
      .select("id");
    notes.push(`stray attempts: ${(strayAttempts ?? []).length}`);

    if (created.masteryIds.length) {
      const { data } = await admin
        .from("student_topic_mastery")
        .delete()
        .in("id", created.masteryIds)
        .select("id");
      notes.push(`mastery rows: ${(data ?? []).length}`);
    }
    if (created.bankIds.length) {
      const { data } = await admin
        .from("faculty_question_bank")
        .delete()
        .in("id", created.bankIds)
        .select("id");
      notes.push(`bank rows: ${(data ?? []).length}`);
    }
    for (const m of created.quantModules) {
      await admin
        .from("modules")
        .update({
          quant_profile: m.quant_profile,
          quant_confidence: m.quant_confidence,
          quant_source: m.quant_source,
          quant_classified_at: m.quant_classified_at,
        })
        .eq("id", m.id);
    }
    if (created.quantModules.length) {
      notes.push(`module quant restored: ${created.quantModules.length}`);
    }
    return notes.join(", ") || "nothing to clean";
  };

  let cleaning = false;
  for (const sig of ["SIGINT", "SIGTERM", "SIGPIPE", "SIGHUP"] as const) {
    process.on(sig, () => {
      if (cleaning) return;
      cleaning = true;
      void cleanup().then((n) => {
        console.error(`\n[${sig}] cleanup: ${n}`);
        process.exit(130);
      });
    });
  }

  /** Bank rows written during a run, so cleanup can remove them. */
  const trackBankWrites = async (since: string) => {
    const { data } = await admin
      .from("faculty_question_bank")
      .select("id")
      .eq("source", "ai_generated")
      .gt("created_at", since);
    for (const r of (data ?? []) as Array<{ id: string }>) {
      if (!created.bankIds.includes(r.id)) created.bankIds.push(r.id);
    }
  };

  try {
    // ── fixtures ───────────────────────────────────────────────────────────
    hr("PREFLIGHT");
    const { data: studentRow } = await admin
      .from("profiles")
      .select("id, full_name")
      .eq("email", STUDENT_EMAIL)
      .maybeSingle();
    if (!studentRow) throw new Error(`student ${STUDENT_EMAIL} not found`);
    const student = studentRow as { id: string; full_name: string };

    const subjectByCode = async (code: string) => {
      const { data } = await admin
        .from("subjects")
        .select("id, name, code")
        .eq("code", code)
        .maybeSingle();
      if (!data) throw new Error(`subject ${code} not found`);
      return data as { id: string; name: string; code: string };
    };
    const crypto = await subjectByCode("SECE3260");
    const eee = await subjectByCode("SOEEC1010");

    const modulesOf = async (subjectId: string) => {
      const { data } = await admin
        .from("modules")
        .select(
          "id, module_number, name, quant_profile, quant_confidence, quant_source, quant_classified_at"
        )
        .eq("subject_id", subjectId)
        .order("module_number");
      return (data ?? []) as Array<{
        id: string;
        module_number: number;
        name: string;
        quant_profile: string | null;
        quant_confidence: string | null;
        quant_source: string | null;
        quant_classified_at: string | null;
      }>;
    };
    const cryptoModules = await modulesOf(crypto.id);
    const eeeModules = await modulesOf(eee.id);

    console.log(`  student: ${student.full_name}`);
    console.log(`  subjects: ${crypto.code} (${cryptoModules.length} modules), ${eee.code} (${eeeModules.length} modules)`);
    console.log(
      `  quant state: ${crypto.code}=${cryptoModules.filter((m) => m.quant_profile).length}/${cryptoModules.length} classified, ${eee.code}=${eeeModules.filter((m) => m.quant_profile).length}/${eeeModules.length}`
    );
    console.log(`  probe iterations: ${PROBE_ITERATIONS} per target`);

    // Clear any prior mastery/attempt state for this student so (a)/(b)
    // assertions are about THIS run.
    const { data: preMastery } = await admin
      .from("student_topic_mastery")
      .select("id")
      .eq("student_id", student.id);
    if ((preMastery ?? []).length > 0) {
      console.log(
        `  NOTE: ${(preMastery ?? []).length} pre-existing mastery row(s) for this student; they are left alone and excluded from assertions.`
      );
    }
    const preMasteryIds = new Set(
      ((preMastery ?? []) as Array<{ id: string }>).map((r) => r.id)
    );

    const logContext = (feature: string) => ({
      userId: student.id,
      userEmail: STUDENT_EMAIL,
      userRole: "student",
      subjectId: crypto.id,
      subjectCode: crypto.code,
      jobId: randomUUID(),
      relatedContentId: null,
      feature,
      metadata: {},
    });

    // ── (a) QUICK ──────────────────────────────────────────────────────────
    hr("(a) QUICK MODE — 10Q, MCQ default, submit, mastery UPDATED");
    const sinceA = new Date().toISOString();
    const quick = await runInScope(() =>
      runAssessment(
        {
          studentId: student.id,
          subjectIds: [crypto.id],
          questionCount: MODE_CONFIG.quick.defaultQuestionCount,
          difficulty: "mixed",
          questionTypes: MODE_CONFIG.quick.defaultQuestionTypes,
          mode: "quick",
        },
        admin,
        logContext("assessment_quick")
      )
    );
    if (quick.sessionId) created.sessionIds.push(quick.sessionId);
    await trackBankWrites(sinceA);
    console.log(
      `  questions=${quick.questions.length} fromBank=${quick.sourcing.fromBank} fromAi=${quick.sourcing.fromAi} failed=${quick.failed.length} totalMarks=${quick.totalMarks}`
    );
    console.log(`  byType=${JSON.stringify(quick.sourcing.byType)} natVerified=${quick.sourcing.natVerified} natDiscarded=${quick.sourcing.natDiscarded}`);
    console.log(`  sessionId=${quick.sessionId}`);
    for (const w of quick.warnings) console.log(`  warning: ${w}`);

    // Script a submission: first 7 correct, rest wrong.
    const { data: quickSession } = await admin
      .from("quiz_sessions")
      .select("config")
      .eq("id", quick.sessionId!)
      .maybeSingle();
    const quickKey = ((quickSession as { config?: { key?: unknown[] } } | null)
      ?.config?.key ?? []) as Array<{
      slotId: string;
      correctAnswer: string;
      type: string;
    }>;
    const quickAnswers = quickKey.map((k, i) => ({
      questionIndex: i,
      slotId: k.slotId,
      studentAnswer: i < 7 ? k.correctAnswer : wrongAnswerFor(k),
      timeTakenSeconds: 20,
    }));
    const quickScore = gradeSubmission(quickKey as never, quickAnswers, {
      negativeMarking: false,
      negativeMarkingRule: null,
    });
    console.log(
      `\n  graded: score=${quickScore.score}/${quickScore.totalMarks} correct=${quickScore.correctCount} wrong=${quickScore.wrongCount}`
    );
    const quickDeltas = await updateMastery(
      admin,
      student.id,
      quickScore.results
    );
    console.log(
      `  mode updatesMastery=${MODE_CONFIG.quick.updatesMastery} → masteryDeltas=${quickDeltas.length}`
    );
    for (const d of quickDeltas) {
      console.log(
        `    module ${d.moduleId.slice(0, 8)} attempts ${d.attemptsBefore}→${d.attemptsAfter} accuracy ${d.accuracyBefore == null ? "—" : (d.accuracyBefore * 100).toFixed(0) + "%"}→${(d.accuracyAfter * 100).toFixed(0)}% difficulty ${d.difficultyBefore}→${d.difficultyAfter}`
      );
    }
    console.log(
      `  → quick updates mastery: ${quickDeltas.length > 0 ? "YES (correct)" : "NO (WRONG — spec says quick updates mastery)"}`
    );

    // ── (b) MASTERY ────────────────────────────────────────────────────────
    hr("(b) MASTERY MODE — 20Q adaptive, scripted 80% run, promotion check");
    const sinceB = new Date().toISOString();
    const mastery = await runInScope(() =>
      runAssessment(
        {
          studentId: student.id,
          subjectIds: [crypto.id],
          questionCount: 20,
          difficulty: "adaptive",
          questionTypes: ["mcq"],
          mode: "mastery",
        },
        admin,
        logContext("assessment_mastery")
      )
    );
    if (mastery.sessionId) created.sessionIds.push(mastery.sessionId);
    await trackBankWrites(sinceB);
    console.log(
      `  questions=${mastery.questions.length} fromBank=${mastery.sourcing.fromBank} fromAi=${mastery.sourcing.fromAi} adaptiveApplied=${mastery.sourcing.adaptiveApplied}`
    );
    console.log(`  byDifficulty=${JSON.stringify(mastery.sourcing.byDifficulty)}`);

    const { data: masterySession } = await admin
      .from("quiz_sessions")
      .select("config")
      .eq("id", mastery.sessionId!)
      .maybeSingle();
    const masteryKey = ((masterySession as { config?: { key?: unknown[] } } | null)
      ?.config?.key ?? []) as Array<{
      slotId: string;
      correctAnswer: string;
      type: string;
    }>;
    const correctTarget = Math.round(masteryKey.length * 0.8);
    const masteryAnswers = masteryKey.map((k, i) => ({
      questionIndex: i,
      slotId: k.slotId,
      studentAnswer: i < correctTarget ? k.correctAnswer : wrongAnswerFor(k),
      timeTakenSeconds: 25,
    }));
    const masteryScore = gradeSubmission(masteryKey as never, masteryAnswers, {
      negativeMarking: false,
      negativeMarkingRule: null,
    });
    console.log(
      `\n  scripted 80% run: score=${masteryScore.score}/${masteryScore.totalMarks} correct=${masteryScore.correctCount}/${masteryKey.length}`
    );
    const masteryDeltas = await updateMastery(
      admin,
      student.id,
      masteryScore.results
    );
    console.log(`  masteryDeltas=${masteryDeltas.length}`);
    for (const d of masteryDeltas) {
      const mod = cryptoModules.find((m) => m.id === d.moduleId);
      console.log(
        `    M${mod?.module_number ?? "?"} attempts ${d.attemptsBefore}→${d.attemptsAfter} sessions→${d.attemptsAfter > 0 ? "" : ""} accuracy ${d.accuracyBefore == null ? "—" : (d.accuracyBefore * 100).toFixed(0) + "%"}→${(d.accuracyAfter * 100).toFixed(0)}% difficulty ${d.difficultyBefore}→${d.difficultyAfter}${d.promoted ? "  ⬆ PROMOTED" : d.demoted ? "  ⬇ DEMOTED" : ""}`
      );
    }
    const { data: masteryRows } = await admin
      .from("student_topic_mastery")
      .select("id, module_id, attempts_count, correct_count, sessions_count, accuracy, current_difficulty")
      .eq("student_id", student.id);
    for (const r of (masteryRows ?? []) as Array<{ id: string }>) {
      if (!preMasteryIds.has(r.id) && !created.masteryIds.includes(r.id)) {
        created.masteryIds.push(r.id);
      }
    }
    console.log(`\n  student_topic_mastery rows written: ${created.masteryIds.length}`);
    for (const r of (masteryRows ?? []) as Array<{
      id: string;
      module_id: string;
      attempts_count: number;
      correct_count: number;
      sessions_count: number;
      accuracy: number;
      current_difficulty: string;
    }>) {
      if (preMasteryIds.has(r.id)) continue;
      const mod = cryptoModules.find((m) => m.id === r.module_id);
      console.log(
        `    M${mod?.module_number ?? "?"} attempts=${r.attempts_count} correct=${r.correct_count} sessions=${r.sessions_count} accuracy=${(r.accuracy * 100).toFixed(0)}% difficulty=${r.current_difficulty}`
      );
    }
    const promoted = masteryDeltas.filter((d) => d.promoted).length;
    console.log(
      `  → promotions: ${promoted} (§16 needs accuracy≥70% AND attempts≥10 AND sessions≥2 per module)`
    );

    // ── (b2) PROMOTION ─────────────────────────────────────────────────────
    // (b) alone leaves the promotion path unproven: with 20 questions spread
    // over 6 modules no single module reaches the §16 threshold of 10 attempts,
    // so "0 promotions" is correct but demonstrates nothing. This runs a third
    // session scoped to ONE module, answered fully correctly, which pushes that
    // module past 10 attempts / 2 sessions / 70% and MUST promote easy→medium.
    hr("(b2) PROMOTION — single-module mastery session, all correct, §16 thresholds crossed");

    // Pure-function truth table first — free, exhaustive, and the actual rule.
    console.log("  nextDifficulty() threshold table:");
    const cases: Array<[string, number, number, number, string]> = [
      ["easy", 0.7, 10, 2, "promote"],
      ["easy", 0.69, 10, 2, "hold (accuracy)"],
      ["easy", 0.7, 9, 2, "hold (attempts)"],
      ["easy", 0.7, 10, 1, "hold (sessions)"],
      ["medium", 0.9, 20, 5, "promote"],
      ["hard", 0.9, 20, 5, "hold (ceiling)"],
      ["medium", 0.39, 5, 3, "demote"],
      ["medium", 0.39, 4, 3, "hold (attempts)"],
      ["easy", 0.1, 30, 9, "hold (floor)"],
    ];
    const { nextDifficulty } = await import("@/lib/assessment/grading");
    for (const [from, acc, att, ses, expect] of cases) {
      const to = nextDifficulty(from as never, acc, att, ses);
      const moved = to === from ? "hold" : to > from ? "" : "";
      void moved;
      console.log(
        `    ${from.padEnd(6)} acc=${String(acc).padEnd(5)} att=${String(att).padStart(2)} ses=${ses} → ${to.padEnd(6)} (expected ${expect})`
      );
    }

    const promoModule = cryptoModules.find((m) => m.module_number === 3)!;
    const sinceB2 = new Date().toISOString();
    const promo = await runInScope(() =>
      runAssessment(
        {
          studentId: student.id,
          subjectIds: [crypto.id],
          moduleIds: [promoModule.id],
          questionCount: 10,
          difficulty: "adaptive",
          questionTypes: ["mcq"],
          mode: "mastery",
        },
        admin,
        logContext("assessment_mastery")
      )
    );
    if (promo.sessionId) created.sessionIds.push(promo.sessionId);
    await trackBankWrites(sinceB2);
    const { data: promoSession } = await admin
      .from("quiz_sessions")
      .select("config")
      .eq("id", promo.sessionId!)
      .maybeSingle();
    const promoKey = ((promoSession as { config?: { key?: unknown[] } } | null)
      ?.config?.key ?? []) as Array<{ slotId: string; correctAnswer: string; type: string }>;
    const promoScore = gradeSubmission(
      promoKey as never,
      promoKey.map((k, i) => ({
        questionIndex: i,
        slotId: k.slotId,
        studentAnswer: k.correctAnswer,
        timeTakenSeconds: 15,
      })),
      { negativeMarking: false, negativeMarkingRule: null }
    );
    const promoDeltas = await updateMastery(admin, student.id, promoScore.results);
    console.log(
      `\n  M${promoModule.module_number} session: ${promoScore.correctCount}/${promoKey.length} correct`
    );
    for (const d of promoDeltas) {
      console.log(
        `    attempts ${d.attemptsBefore}→${d.attemptsAfter}  accuracy ${d.accuracyBefore == null ? "—" : (d.accuracyBefore * 100).toFixed(0) + "%"}→${(d.accuracyAfter * 100).toFixed(0)}%  difficulty ${d.difficultyBefore}→${d.difficultyAfter}${d.promoted ? "  ⬆ PROMOTED" : ""}`
      );
    }
    console.log(
      `  → live promotion observed: ${promoDeltas.some((d) => d.promoted) ? "YES" : "NO"}`
    );

    // ── (c) EXAM SIM + GATE ────────────────────────────────────────────────
    if (process.env.SKIP_GATE === "1") {
      hr("(c) EXAM SIM + GATE — SKIPPED (SKIP_GATE=1)");
    } else {
      hr("(c) EXAM SIM + GATE PRESET — 65Q, exact distribution, all NAT verified");
      const sinceC = new Date().toISOString();
      const gatePlan = await planAssessment(
        {
          studentId: student.id,
          subjectIds: [crypto.id],
          questionCount: GATE_PRESET.questionCount,
          difficulty: GATE_PRESET.difficulty,
          questionTypes: GATE_PRESET.questionTypes,
          mode: "exam_sim",
          preset: "gate",
          typeDistribution: GATE_PRESET.typeDistribution,
          marksRule: GATE_PRESET.marksRule,
        },
        admin
      );
      console.log(
        `  PLAN: slots=${gatePlan.slots.length} byType=${JSON.stringify(gatePlan.sourcing.byType)}`
      );
      console.log(
        `  marks: Q1=${gatePlan.slots[0]?.marks}M Q25=${gatePlan.slots[24]?.marks}M Q26=${gatePlan.slots[25]?.marks}M Q65=${gatePlan.slots[64]?.marks}M  total=${gatePlan.slots.reduce((s, x) => s + x.marks, 0)}M`
      );
      console.log(`  natDegraded=${JSON.stringify(gatePlan.sourcing.natDegraded)}`);
      for (const w of gatePlan.warnings) console.log(`  warning: ${w}`);

      const gate = await runInScope(() =>
        runAssessment(
          {
            studentId: student.id,
            subjectIds: [crypto.id],
            questionCount: GATE_PRESET.questionCount,
            difficulty: GATE_PRESET.difficulty,
            questionTypes: GATE_PRESET.questionTypes,
            mode: "exam_sim",
            preset: "gate",
            typeDistribution: GATE_PRESET.typeDistribution,
            marksRule: GATE_PRESET.marksRule,
            timeLimitMinutes: GATE_PRESET.timeLimit,
            negativeMarking: GATE_PRESET.negativeMarking,
            negativeMarkingRule: GATE_PRESET.negativeMarkingRule,
          },
          admin,
          logContext("assessment_exam_sim")
        )
      );
      if (gate.sessionId) created.sessionIds.push(gate.sessionId);
      await trackBankWrites(sinceC);

      const delivered: Record<string, number> = {};
      for (const q of gate.questions) {
        delivered[q.type] = (delivered[q.type] ?? 0) + 1;
      }
      console.log(
        `\n  DELIVERED: ${gate.questions.length}/65 questions, byType=${JSON.stringify(delivered)}`
      );
      console.log(
        `  fromBank=${gate.sourcing.fromBank} fromAi=${gate.sourcing.fromAi} totalMarks=${gate.totalMarks}`
      );
      console.log(
        `  NAT: verified=${gate.sourcing.natVerified} discarded=${gate.sourcing.natDiscarded} agreement=${JSON.stringify(gate.sourcing.natAgreement)}`
      );
      const natDiscards = gate.failed.filter(
        (f) => f.reason === "nat_verify_discard"
      );
      console.log(`\n  failed slots: ${gate.failed.length} (${natDiscards.length} nat_verify_discard)`);
      for (const f of gate.failed.slice(0, 12)) {
        console.log(`    ${f.slotId} ${f.questionType} ${f.reason}${f.detail ? ` — ${f.detail}` : ""}`);
      }
      const natDelivered = delivered.nat ?? 0;
      console.log(
        `\n  → NAT bounded above by 15: ${natDelivered <= 15 ? "YES" : "NO"} (delivered ${natDelivered})`
      );
      const natAttempted = natDelivered + natDiscards.length;
      console.log(
        `  → observed NAT discard rate: ${natAttempted > 0 ? ((natDiscards.length / natAttempted) * 100).toFixed(1) : "—"}% (${natDiscards.length}/${natAttempted})`
      );
    }

    // ── (d) VERIFIER PROBES ────────────────────────────────────────────────
    hr(`(d) VERIFIER PROBES — ${PROBE_ITERATIONS} iterations × 2 targets`);
    const probeTargets = [
      {
        label: "Vigenère (SECE3260 M2 — Classical Cryptography Techniques)",
        subject: crypto,
        module: cryptoModules.find((m) => m.module_number === 2)!,
      },
      {
        label: "Borderline (SOEEC1010 M4 — Semiconductor Devices and Analog Electronics)",
        subject: eee,
        module: eeeModules.find((m) => m.module_number === 4)!,
      },
    ];

    const probeResults: Array<{
      label: string;
      attempted: number;
      passed: number;
      discarded: number;
      byReason: Record<string, number>;
      agreementDisagreements: number;
      examples: string[];
    }> = [];

    for (const target of probeTargets) {
      sub(target.label);
      // Force the module NAT-eligible so the probe tests gate 2, not gate 1.
      const original = { ...target.module };
      created.quantModules.push({
        id: original.id,
        quant_profile: original.quant_profile,
        quant_confidence: original.quant_confidence,
        quant_source: original.quant_source,
        quant_classified_at: original.quant_classified_at,
      });
      await admin
        .from("modules")
        .update({
          quant_profile: "quantitative",
          quant_confidence: "high",
          quant_source: "ai_classified",
          quant_classified_at: new Date().toISOString(),
        })
        .eq("id", original.id);

      const contexts = await loadSubjectContexts([target.subject.id], admin);
      const stats = {
        label: target.label,
        attempted: 0,
        passed: 0,
        discarded: 0,
        byReason: {} as Record<string, number>,
        agreementDisagreements: 0,
        examples: [] as string[],
      };

      for (let iter = 0; iter < PROBE_ITERATIONS; iter++) {
        const sinceP = new Date().toISOString();
        const plan = await planAssessment(
          {
            studentId: student.id,
            subjectIds: [target.subject.id],
            moduleIds: [original.id],
            questionCount: 1,
            difficulty: "medium",
            questionTypes: ["nat"],
            mode: "quick",
          },
          admin
        );
        const gen = await runInScope(() =>
          generateFreshQuestions(
            plan.slots,
            contexts,
            admin,
            logContext("assessment_nat_probe")
          )
        );
        await trackBankWrites(sinceP);
        if (gen.generated.length === 0) {
          console.log(`  #${iter + 1} generation failed — not counted`);
          continue;
        }
        const v = await runInScope(() =>
          verifyNatQuestions(gen.generated, contexts, logContext("assessment_nat_probe"))
        );
        for (const o of v.outcomes) {
          stats.attempted += 1;
          if (o.passed) stats.passed += 1;
          else {
            stats.discarded += 1;
            const reason = o.discardReason ?? "unknown";
            stats.byReason[reason] = (stats.byReason[reason] ?? 0) + 1;
          }
        }
        stats.agreementDisagreements +=
          v.agreement.boolTrueNumericFalse + v.agreement.boolFalseNumericTrue;

        const q = gen.generated[0];
        const o = v.outcomes[0];
        const verdict = o?.passed ? "PASS" : `DISCARD(${o?.discardReason})`;
        console.log(
          `  #${iter + 1} ${verdict}  claimed=${q.numericAnswer} verifier=${o?.computedAnswer ?? "—"}  "${q.question.slice(0, 72)}…"`
        );
        if (!o?.passed && stats.examples.length < 3) {
          stats.examples.push(
            `claimed ${o?.claimedAnswer} vs verifier ${o?.computedAnswer ?? "—"} — ${o?.reason ?? ""}`
          );
        }
      }

      const rate =
        stats.attempted > 0
          ? ((stats.discarded / stats.attempted) * 100).toFixed(1)
          : "—";
      console.log(
        `\n  ${target.label}\n  attempted=${stats.attempted} passed=${stats.passed} discarded=${stats.discarded} → DISCARD RATE ${rate}%`
      );
      console.log(`  by reason: ${JSON.stringify(stats.byReason)}`);
      console.log(
        `  bool-vs-numeric disagreements: ${stats.agreementDisagreements}`
      );
      probeResults.push(stats);
    }

    sub("PROBE SUMMARY — the CP-Q2 acceptance evidence");
    for (const p of probeResults) {
      const rate =
        p.attempted > 0 ? ((p.discarded / p.attempted) * 100).toFixed(1) : "—";
      console.log(`  ${rate.padStart(6)}%  ${p.discarded}/${p.attempted}  ${p.label}`);
      for (const e of p.examples) console.log(`           e.g. ${e}`);
    }

    // ── (e) ABANDONMENT ────────────────────────────────────────────────────
    hr("(e) SESSION ABANDONMENT — backdate 5h, sweep, attempts preserved");
    const staleId = randomUUID();
    await admin.from("quiz_sessions").insert({
      id: staleId,
      student_id: student.id,
      mode: "quick",
      subject_ids: [crypto.id],
      config: { question_count: 1, note: "cp-q2 harness stale session" },
      status: "in_progress",
      started_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    });
    created.sessionIds.push(staleId);
    const { data: staleAttempt } = await admin
      .from("student_question_attempts")
      .insert({
        student_id: student.id,
        subject_id: crypto.id,
        module_id: cryptoModules[0].id,
        question_text: "[CP-Q2 harness] attempt on an abandoned session",
        question_type: "mcq",
        student_answer: "A",
        is_correct: true,
        source: "ai_fresh",
        session_id: staleId,
      })
      .select("id");
    for (const r of (staleAttempt ?? []) as Array<{ id: string }>) {
      created.attemptIds.push(r.id);
    }
    console.log(`  created in_progress session backdated 5h, with 1 attempt`);

    const { GET: cronGet } = await import(
      "@/app/api/cron/abandon-stale-assessments/route"
    );
    const cronRes = await cronGet(
      new Request("http://localhost/api/cron/abandon-stale-assessments") as never
    );
    console.log(`  cron response: ${JSON.stringify(await cronRes.json())}`);

    const { data: sweptRow } = await admin
      .from("quiz_sessions")
      .select("status")
      .eq("id", staleId)
      .maybeSingle();
    const { count: attemptsLeft } = await admin
      .from("student_question_attempts")
      .select("id", { count: "exact", head: true })
      .eq("session_id", staleId);
    console.log(
      `  session status: ${(sweptRow as { status: string } | null)?.status} → ${
        (sweptRow as { status: string } | null)?.status === "abandoned"
          ? "ABANDONED (correct)"
          : "NOT ABANDONED (WRONG)"
      }`
    );
    console.log(
      `  attempts still present: ${attemptsLeft} → ${attemptsLeft === 1 ? "PRESERVED (correct)" : "LOST (WRONG)"}`
    );

    // ── AI call mix ────────────────────────────────────────────────────────
    hr("AI CALL MIX (ai_call_logs, this run)");
    const { data: logs } = await admin
      .from("ai_call_logs")
      .select("task, cost_inr")
      .gte("created_at", sinceA);
    const byTask = new Map<string, { n: number; inr: number }>();
    for (const l of (logs ?? []) as Array<{ task: string; cost_inr: number }>) {
      const e = byTask.get(l.task) ?? { n: 0, inr: 0 };
      e.n += 1;
      e.inr += Number(l.cost_inr ?? 0);
      byTask.set(l.task, e);
    }
    if (byTask.size === 0) {
      console.log("  (no rows — after() logging did not land)");
    }
    for (const [task, e] of [...byTask.entries()].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`  ${task.padEnd(24)} ${String(e.n).padStart(4)} calls  ₹${e.inr.toFixed(2)}`);
    }
    const unexpected = [...byTask.keys()].filter(
      (t) => !["quiz_gen_v2", "nat_verify"].includes(t)
    );
    console.log(
      `  → only quiz_gen_v2 + nat_verify expected: ${unexpected.length === 0 ? "YES" : `NO — also saw ${unexpected.join(", ")}`}`
    );
  } finally {
    hr("CLEANUP");
    console.log(`  ${await cleanup()}`);
  }

  console.log("\n=== done ===\n");
  process.exit(0);
}

/** A deterministic wrong answer for a scripted run. */
function wrongAnswerFor(k: { correctAnswer: string; type: string }): string {
  if (k.type === "nat") return String(Number(k.correctAnswer) + 7777);
  if (k.type === "msq" || k.type === "multiple_correct") {
    return k.correctAnswer.includes("A") ? "B" : "A";
  }
  const letters = ["A", "B", "C", "D"];
  const current = k.correctAnswer.trim().toUpperCase();
  return letters.find((l) => l !== current) ?? "D";
}

main().catch((e) => {
  console.error("Harness failed:", e);
  process.exit(1);
});
