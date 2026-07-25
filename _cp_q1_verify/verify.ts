/**
 * CP-Q1 verification harness — Assessment Engine.
 *
 * There is no route and no UI in this checkpoint, so this script IS the test
 * surface. It exercises all three lib entry points against REAL data:
 *
 *   (a) planAssessment()        — 30-question mastery request across 3 modules
 *                                 of a real subject; prints the apportionment
 *                                 next to the syllabus weightages it came from.
 *   (b) fillFromBank()          — against a subject that HAS bank content (and
 *                                 with 3 verified rows seeded first, to prove
 *                                 is_verified-first ordering), and against one
 *                                 that has none (every slot must come back
 *                                 unfilled, not silently dropped).
 *   (c) generateFreshQuestions()— one MCQ, one MSQ and one NAT slot; prints the
 *                                 full normalised objects so the two new
 *                                 GATE types can be eyeballed.
 *
 * Everything it writes, it deletes: seeded bank rows, write-through bank rows,
 * and any attempt rows. Cleanup runs in a finally block, so a mid-run failure
 * still cleans up.
 *
 *   npx tsx _cp_q1_verify/verify.ts
 *   SUBJECT=SECE3260 npx tsx _cp_q1_verify/verify.ts
 *   SKIP_AI=1 npx tsx _cp_q1_verify/verify.ts      # (a) + (b) only, costs nothing
 *
 * (c) makes real Gemini calls (3 batches → 3 Flash calls, a few paise).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

// Next's internal storages assert this global exists before they load.
(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

// ── env (Next.js does not load .env.local for standalone scripts) ──
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

import type { AssessmentQuestion, QuestionSlot } from "../src/lib/assessment/types";

const BANK_SUBJECT_CODE = process.env.SUBJECT ?? "SECE3260";
const STUDENT_EMAIL = process.env.STUDENT ?? "teststudent@gmail.com";

function hr(title: string): void {
  console.log(`\n${"─".repeat(78)}\n${title}\n${"─".repeat(78)}`);
}

function slotLine(s: QuestionSlot): string {
  return `${s.slotId.padEnd(4)} M${String(s.moduleNumber ?? "-").padEnd(2)} ${s.questionType.padEnd(4)} ${s.difficulty.padEnd(6)} ${s.marks}M ${s.targetCo ? `CO=${s.targetCo}` : ""}`;
}

function printQuestion(q: AssessmentQuestion): void {
  console.log(`\n  [${q.slotId}] type=${q.type} difficulty=${q.difficulty} marks=${q.marks} source=${q.source} co=${q.coCode ?? "-"}`);
  console.log(`  Q: ${q.question}`);
  if (q.options) {
    q.options.forEach((o, i) =>
      console.log(`     ${"ABCDE"[i]}. ${o}`)
    );
  }
  console.log(`  correctAnswer: ${JSON.stringify(q.correctAnswer)}`);
  if (q.numericAnswer !== undefined) {
    console.log(`  numericAnswer: ${q.numericAnswer}  numericTolerance: ${q.numericTolerance}%`);
  }
  console.log(`  explanation: ${q.explanation}`);
}

async function main() {
  const { workAsyncStorage } = await import(
    "next/dist/server/app-render/work-async-storage.external"
  );
  const { createAdminClient } = await import("@/lib/db/supabase-server");
  const { planAssessment } = await import("@/lib/assessment/engine");
  const { fillFromBank } = await import("@/lib/assessment/bankFill");
  const { generateFreshQuestions, loadSubjectContexts } = await import(
    "@/lib/assessment/generator"
  );

  const admin = createAdminClient();

  // Everything this script creates, tracked for cleanup.
  const createdBankIds: string[] = [];
  const createdAttemptIds: string[] = [];

  try {
    // ── preflight ─────────────────────────────────────────────────────────
    hr("PREFLIGHT — migration state");
    for (const table of [
      "quiz_sessions",
      "student_question_attempts",
      "student_topic_mastery",
    ]) {
      const { error } = await admin.from(table).select("id").limit(1);
      console.log(
        `  ${table.padEnd(28)} ${error ? `MISSING (${error.message})` : "present"}`
      );
    }
    {
      const { error } = await admin
        .from("faculty_question_bank")
        .select("id, numeric_answer, numeric_tolerance")
        .limit(1);
      console.log(
        `  ${"fqb.numeric_answer/tolerance".padEnd(28)} ${error ? `MISSING (${error.message})` : "present"}`
      );
    }

    // Column listing — the \d equivalent available over PostgREST. The REST
    // root serves an OpenAPI document whose `definitions` carry every exposed
    // table's columns, types and NOT NULL-ness.
    if (process.env.SKIP_SCHEMA !== "1") {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`,
        {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
          },
        }
      );
      const doc = (await res.json()) as {
        definitions?: Record<
          string,
          { properties?: Record<string, { format?: string; description?: string }> }
        >;
      };
      for (const table of [
        "quiz_sessions",
        "student_question_attempts",
        "student_topic_mastery",
      ]) {
        const props = doc.definitions?.[table]?.properties ?? {};
        console.log(`\n  ${table}:`);
        for (const [col, meta] of Object.entries(props)) {
          const note = (meta.description ?? "").replace(/\s+/g, " ").trim();
          console.log(
            `    ${col.padEnd(20)} ${(meta.format ?? "?").padEnd(28)} ${note.slice(0, 60)}`
          );
        }
      }
      const fqb = doc.definitions?.faculty_question_bank?.properties ?? {};
      console.log("\n  faculty_question_bank (new columns only):");
      for (const col of ["numeric_answer", "numeric_tolerance"]) {
        console.log(
          `    ${col.padEnd(20)} ${(fqb[col]?.format ?? "ABSENT").padEnd(28)}`
        );
      }
    }

    // CHECK-constraint probe. PostgREST cannot read pg_constraint, so prove the
    // expansion behaviourally: 'msq' must now be accepted and a bogus type must
    // still be rejected with 23514. Both rows are removed immediately.
    {
      const { data: probeSubject } = await admin
        .from("subjects")
        .select("id")
        .limit(1)
        .maybeSingle();
      const { data: probeFaculty } = await admin
        .from("faculty_assignments")
        .select("faculty_id")
        .limit(1)
        .maybeSingle();
      const sid = (probeSubject as { id: string } | null)?.id;
      const fid = (probeFaculty as { faculty_id: string } | null)?.faculty_id;
      if (sid && fid) {
        const probeRow = (question_type: string) => ({
          subject_id: sid,
          faculty_id: fid,
          question_text: "[CP-Q1 VERIFY SEED constraint probe]",
          question_type,
          marks: 1,
          source: "ai_generated",
          is_verified: false,
        });
        for (const t of ["msq", "nat", "definitely_not_a_type"]) {
          const { data, error } = await admin
            .from("faculty_question_bank")
            .insert(probeRow(t))
            .select("id");
          const id = ((data ?? []) as Array<{ id: string }>)[0]?.id;
          if (id) await admin.from("faculty_question_bank").delete().eq("id", id);
          console.log(
            `\n  question_type='${t}' → ${error ? `REJECTED (${error.code ?? "?"}: ${error.message.slice(0, 70)})` : "accepted"}`
          );
        }
      }
    }

    // ── fixtures ──────────────────────────────────────────────────────────
    const { data: subjRow } = await admin
      .from("subjects")
      .select("id, name, code")
      .eq("code", BANK_SUBJECT_CODE)
      .maybeSingle();
    if (!subjRow) throw new Error(`subject ${BANK_SUBJECT_CODE} not found`);
    const bankSubject = subjRow as { id: string; name: string; code: string };

    const { data: studentRow } = await admin
      .from("profiles")
      .select("id, full_name")
      .eq("email", STUDENT_EMAIL)
      .maybeSingle();
    if (!studentRow) throw new Error(`student ${STUDENT_EMAIL} not found`);
    const student = studentRow as { id: string; full_name: string };

    const { data: modRows } = await admin
      .from("modules")
      .select("id, module_number, name, weightage_percent")
      .eq("subject_id", bankSubject.id)
      .order("module_number");
    const modules = (modRows ?? []) as Array<{
      id: string;
      module_number: number;
      name: string;
      weightage_percent: number | null;
    }>;

    // A subject with NO bank content, for the negative half of (b).
    const { data: allBank } = await admin
      .from("faculty_question_bank")
      .select("subject_id");
    const withBank = new Set(
      ((allBank ?? []) as Array<{ subject_id: string }>).map((r) => r.subject_id)
    );
    const { data: candidates } = await admin
      .from("subjects")
      .select("id, name, code")
      .limit(200);
    const emptySubject = ((candidates ?? []) as Array<{
      id: string;
      name: string;
      code: string;
    }>).find((s) => !withBank.has(s.id) && s.id !== bankSubject.id);
    if (!emptySubject) throw new Error("no bank-empty subject found");

    const { data: faRow } = await admin
      .from("faculty_assignments")
      .select("faculty_id")
      .eq("subject_id", bankSubject.id)
      .limit(1)
      .maybeSingle();
    const facultyId = (faRow as { faculty_id: string } | null)?.faculty_id ?? null;

    console.log(`\nStudent : ${student.full_name} (${student.id})`);
    console.log(`Subject : ${bankSubject.code} — ${bankSubject.name}`);
    console.log(`Modules : ${modules.map((m) => `M${m.module_number}=${m.weightage_percent ?? "∅"}%`).join(" ")}`);
    console.log(`Empty   : ${emptySubject.code} — ${emptySubject.name} (no bank rows)`);

    // ── (a) planAssessment ────────────────────────────────────────────────
    hr("(a) planAssessment — 30 questions, mastery, 3 modules, mixed difficulty");
    const threeModules = modules.slice(0, 3);
    const planA = await planAssessment(
      {
        studentId: student.id,
        subjectIds: [bankSubject.id],
        moduleIds: threeModules.map((m) => m.id),
        questionCount: 30,
        difficulty: "mixed",
        questionTypes: ["mcq", "msq", "nat"],
        mode: "mastery",
      },
      admin
    );

    const wSum = threeModules.reduce(
      (s, m) => s + (m.weightage_percent ?? 0),
      0
    );
    console.log("\n  module   weightage   expected share   slots   actual share");
    for (const m of threeModules) {
      const n = planA.sourcing.byModule[m.id] ?? 0;
      const exp = wSum > 0 ? ((m.weightage_percent ?? 0) / wSum) * 100 : 0;
      console.log(
        `  M${String(m.module_number).padEnd(7)} ${String(m.weightage_percent ?? "∅").padEnd(11)} ${exp.toFixed(1).padStart(9)}%     ${String(n).padStart(4)}   ${((n / planA.slots.length) * 100).toFixed(1).padStart(9)}%`
      );
    }
    console.log(
      `\n  totalSlots=${planA.sourcing.totalSlots}  byDifficulty=${JSON.stringify(planA.sourcing.byDifficulty)}  byType=${JSON.stringify(planA.sourcing.byType)}`
    );
    if (planA.sourcing.warnings.length) {
      console.log(`  warnings: ${planA.sourcing.warnings.join(" | ")}`);
    }
    console.log("\n  slots (plan order — note difficulty/type interleaving):");
    for (const s of planA.slots) console.log(`    ${slotLine(s)}`);

    // GATE preset: proves msq+nat are forced in and marks follow the GATE scheme.
    const planGate = await planAssessment(
      {
        studentId: student.id,
        subjectIds: [bankSubject.id],
        questionCount: 9,
        difficulty: "adaptive",
        questionTypes: ["mcq"],
        mode: "exam_sim",
        preset: "gate",
      },
      admin
    );
    console.log(
      `\n  GATE preset (asked for mcq only, difficulty=adaptive): byType=${JSON.stringify(planGate.sourcing.byType)} byDifficulty=${JSON.stringify(planGate.sourcing.byDifficulty)} adaptiveApplied=${planGate.sourcing.adaptiveApplied}`
    );
    console.log(
      `  marks: ${planGate.slots.map((s) => `${s.questionType}=${s.marks}`).slice(0, 3).join(" ")}`
    );
    for (const w of planGate.sourcing.warnings) console.log(`  warning: ${w}`);

    // ── (b) fillFromBank ──────────────────────────────────────────────────
    hr("(b) fillFromBank — subject WITH bank content, then subject WITHOUT");

    // Seed 3 verified easy MCQs on module 1 so verified-first ordering is
    // observable against the existing unverified rows. Deleted in cleanup.
    if (facultyId && modules[0]) {
      const seed = [1, 2, 3].map((n) => ({
        subject_id: bankSubject.id,
        faculty_id: facultyId,
        module_id: modules[0].id,
        question_text: `[CP-Q1 VERIFY SEED ${n}] Which statement about ${modules[0].name} is correct?`,
        question_type: "mcq",
        marks: 1,
        model_answer: "Seeded verification row.",
        options: [
          { label: "A", text: `Seed ${n} option A (correct)`, is_correct: true },
          { label: "B", text: `Seed ${n} option B`, is_correct: false },
          { label: "C", text: `Seed ${n} option C`, is_correct: false },
          { label: "D", text: `Seed ${n} option D`, is_correct: false },
        ],
        co_code: "CO1",
        difficulty: "easy",
        source: "ai_generated",
        is_verified: true,
        usage_count: 0,
      }));
      const { data: seeded, error: seedErr } = await admin
        .from("faculty_question_bank")
        .insert(seed)
        .select("id");
      if (seedErr) console.log(`  (seed insert failed: ${seedErr.message})`);
      for (const r of (seeded ?? []) as Array<{ id: string }>) {
        createdBankIds.push(r.id);
      }
      console.log(`  seeded ${createdBankIds.length} verified easy MCQ rows on M${modules[0].module_number}`);
    } else {
      console.log("  (no faculty assigned to this subject — skipping seed)");
    }

    const planB = await planAssessment(
      {
        studentId: student.id,
        subjectIds: [bankSubject.id],
        moduleIds: [modules[0].id],
        questionCount: 6,
        difficulty: "easy",
        questionTypes: ["mcq"],
        mode: "quick",
      },
      admin
    );
    // What the bank holds for these slots, so the served order can be checked
    // against it rather than taken on trust.
    const { data: poolRows } = await admin
      .from("faculty_question_bank")
      .select("id, is_verified, usage_count, question_text")
      .eq("subject_id", bankSubject.id)
      .eq("module_id", modules[0].id)
      .eq("question_type", "mcq")
      .eq("difficulty", "easy");
    const pool = (poolRows ?? []) as Array<{
      id: string;
      is_verified: boolean;
      usage_count: number;
      question_text: string;
    }>;
    console.log(
      `\n  candidate pool for (M${modules[0].module_number}, mcq, easy): ${pool.length} rows — ` +
        `${pool.filter((r) => r.is_verified).length} verified / ${pool.filter((r) => !r.is_verified).length} unverified`
    );

    const verifiedById = new Map(pool.map((r) => [r.id, r.is_verified]));
    const fillB = await fillFromBank(planB.slots, student.id, admin);
    console.log(
      `\n  WITH bank : ${planB.slots.length} slots → filled=${fillB.filled.length} unfilled=${fillB.unfilled.length} excludedByRecency=${fillB.excludedByRecency}`
    );
    for (const q of fillB.filled) {
      const v = verifiedById.get(q.bankQuestionId ?? "");
      console.log(
        `    ${q.slotId} ← bank ${q.bankQuestionId?.slice(0, 8)} [${v ? "VERIFIED  " : "unverified"}]  "${q.question.slice(0, 55)}…"  key=${q.correctAnswer}`
      );
    }
    for (const s of fillB.unfilled) {
      console.log(`    ${s.slotId} → AI (no bank match: ${s.questionType}/${s.difficulty})`);
    }
    const servedOrder = fillB.filled.map((q) =>
      verifiedById.get(q.bankQuestionId ?? "") ? "V" : "u"
    );
    const orderingHolds = servedOrder.join("").indexOf("V") === -1 ||
      !servedOrder.join("").includes("uV");
    console.log(
      `  served order (V=verified): ${servedOrder.join(" ")} → is_verified-first ${orderingHolds ? "HOLDS" : "VIOLATED"}`
    );

    // ── 30-day exclusion, demonstrated live ───────────────────────────────
    // Record an attempt for every question just served, then re-run the SAME
    // plan. Bank-first must not serve any of them again.
    hr("(b2) 30-day per-student exclusion — re-run after recording attempts");
    const attemptRows = fillB.filled.map((q) => ({
      student_id: student.id,
      question_id: q.bankQuestionId ?? null,
      subject_id: q.subjectId,
      module_id: q.moduleId,
      question_text: q.question,
      question_type: q.type,
      student_answer: q.correctAnswer,
      is_correct: true,
      time_taken_seconds: 30,
      source: q.source,
      session_id: null,
    }));
    if (attemptRows.length > 0) {
      const { data: attempts, error: attErr } = await admin
        .from("student_question_attempts")
        .insert(attemptRows)
        .select("id");
      if (attErr) console.log(`  attempt insert failed: ${attErr.message}`);
      for (const r of (attempts ?? []) as Array<{ id: string }>) {
        createdAttemptIds.push(r.id);
      }
      console.log(
        `  recorded ${createdAttemptIds.length} attempt(s) for the questions served above`
      );
    }

    const fillB2 = await fillFromBank(planB.slots, student.id, admin);
    const servedFirst = new Set(
      fillB.filled.map((q) => q.bankQuestionId).filter(Boolean)
    );
    const repeats = fillB2.filled.filter((q) =>
      servedFirst.has(q.bankQuestionId ?? "")
    );
    console.log(
      `\n  re-run    : filled=${fillB2.filled.length} unfilled=${fillB2.unfilled.length} excludedByRecency=${fillB2.excludedByRecency}`
    );
    for (const q of fillB2.filled) {
      const v = verifiedById.get(q.bankQuestionId ?? "");
      console.log(
        `    ${q.slotId} ← bank ${q.bankQuestionId?.slice(0, 8)} [${v ? "VERIFIED  " : "unverified"}]  "${q.question.slice(0, 55)}…"`
      );
    }
    console.log(
      `  repeats of the just-attempted questions: ${repeats.length} → 30-day exclusion ${repeats.length === 0 ? "HOLDS" : "VIOLATED"}`
    );

    const planEmpty = await planAssessment(
      {
        studentId: student.id,
        subjectIds: [emptySubject.id],
        questionCount: 4,
        difficulty: "medium",
        questionTypes: ["mcq"],
        mode: "quick",
      },
      admin
    );
    const fillEmpty = await fillFromBank(planEmpty.slots, student.id, admin);
    console.log(
      `\n  NO bank   : ${planEmpty.slots.length} slots → filled=${fillEmpty.filled.length} unfilled=${fillEmpty.unfilled.length}  (all unfilled slots returned to the caller, not dropped)`
    );

    // ── (c) generateFreshQuestions ────────────────────────────────────────
    if (process.env.SKIP_AI === "1") {
      hr("(c) generateFreshQuestions — SKIPPED (SKIP_AI=1)");
    } else {
      hr("(c) generateFreshQuestions — one MCQ + one MSQ + one NAT slot");
      const planC = await planAssessment(
        {
          studentId: student.id,
          subjectIds: [bankSubject.id],
          moduleIds: [modules[0].id, modules[1]?.id].filter(Boolean) as string[],
          questionCount: 3,
          difficulty: "medium",
          questionTypes: ["mcq", "msq", "nat"],
          mode: "exam_sim",
          preset: "gate",
        },
        admin
      );
      console.log("  slots:");
      for (const s of planC.slots) console.log(`    ${slotLine(s)}`);

      const contexts = await loadSubjectContexts([bankSubject.id], admin);
      const ctx = contexts.get(bankSubject.id)!;
      console.log(
        `\n  context: syllabus=${ctx.syllabus.length} chars (NOT truncated), modules=${ctx.modules.length}, COs=${ctx.courseOutcomes.length}, pyqs=${ctx.pyqs.length}, mathChem=${ctx.mathChem}, facultyId=${ctx.facultyId ? "set" : "none"}`
      );

      const logContext = {
        userId: student.id,
        userEmail: STUDENT_EMAIL,
        userRole: "student",
        subjectId: bankSubject.id,
        subjectCode: bankSubject.code,
        jobId: crypto.randomUUID(),
        relatedContentId: null,
        feature: "assessment_cp_q1_verify",
        metadata: {},
      };

      // routeAI logs cost via after(); enter a minimal fake request scope.
      const store = { afterContext: { after: (_fn: unknown) => { void _fn; } } };
      await workAsyncStorage.run(store as never, async () => {
        const result = await generateFreshQuestions(
          planC.slots,
          contexts,
          admin,
          logContext
        );
        console.log(
          `\n  generated=${result.generated.length} failed=${result.failed.length} writtenToBank=${result.writtenToBank}`
        );
        for (const e of result.errors) console.log(`  error: ${e}`);
        for (const q of result.generated) {
          printQuestion(q);
          if (q.bankQuestionId) createdBankIds.push(q.bankQuestionId);
        }
        for (const s of result.failed) {
          console.log(`\n  FAILED slot ${s.slotId} (${s.questionType}/${s.difficulty})`);
        }
      });
    }
  } finally {
    hr("CLEANUP");
    if (createdBankIds.length > 0) {
      const { error } = await admin
        .from("faculty_question_bank")
        .delete()
        .in("id", createdBankIds);
      console.log(
        `  faculty_question_bank: deleted ${createdBankIds.length} row(s)${error ? ` — ERROR ${error.message}` : ""}`
      );
    } else {
      console.log("  faculty_question_bank: nothing to delete");
    }
    if (createdAttemptIds.length > 0) {
      await admin
        .from("student_question_attempts")
        .delete()
        .in("id", createdAttemptIds);
      console.log(
        `  student_question_attempts: deleted ${createdAttemptIds.length} row(s)`
      );
    } else {
      console.log("  student_question_attempts: nothing to delete");
    }
    // Safety net: remove any stray seed rows from an earlier interrupted run.
    const { data: strays } = await admin
      .from("faculty_question_bank")
      .select("id")
      .like("question_text", "[CP-Q1 VERIFY SEED%");
    const strayIds = ((strays ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (strayIds.length > 0) {
      await admin.from("faculty_question_bank").delete().in("id", strayIds);
      console.log(`  swept ${strayIds.length} stray seed row(s) from a previous run`);
    }
  }

  console.log("\n=== done ===\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("Harness failed:", e);
  process.exit(1);
});
