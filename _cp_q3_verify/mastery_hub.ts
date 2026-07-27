/**
 * CP-Q3 Part 5B — GET /api/assessment/mastery (the hub), over real HTTP.
 *
 * Seeds student_topic_mastery rows directly (service role — no session needs
 * to actually run; the hub route only ever reads this table, so seeding it is
 * the correct isolation boundary, same precedent as key_exposure.ts).
 *
 * Three subjects, four modules, each picked to exercise a different corner of
 * the aggregation:
 *   - subject 1, module A: 8 attempts / 6 correct / easy — inside the
 *     "ready to level up" window (accuracy≥70%, 8≤attempts<10) →
 *     promotionProgress MUST be present, targeting 'medium'.
 *   - subject 1, module B: 20 attempts / 5 correct / medium — accuracy 25%,
 *     well past the promotion-attempt window → promotionProgress MUST be null.
 *   - subject 2, module C: 15 attempts / 12 correct / hard — high accuracy but
 *     already top tier → promotionProgress MUST be null (nothing above hard).
 *   - subject 3, module D: 3 attempts / 3 correct / easy — perfect but below
 *     the 8-attempt floor → promotionProgress MUST be null (too early to call).
 *
 * All "expected" numbers are computed independently in this file, not read
 * back from the route.
 *
 *   npx tsx _cp_q3_verify/mastery_hub.ts > out.txt 2>&1
 */

import {
  signInAsStudent,
  waitForServer,
  onSignals,
  makeChecker,
  hr,
  sub,
  type StudentSession,
} from "@/lib/testing/httpHarness";

interface HubModule {
  moduleId: string;
  moduleName: string;
  accuracy: number;
  attemptsCount: number;
  currentDifficulty: string;
  promotionProgress?: { targetTier: string; correctNeeded: number; attemptsAvailable: number };
}
interface HubSubject {
  subjectId: string;
  subjectName: string;
  aggregateMastery: number | null;
  moduleCount: number;
  practicedModuleCount: number;
  modules: HubModule[];
}
interface HubResponse {
  subjects: HubSubject[];
}

async function main() {
  const c = makeChecker();
  await waitForServer();

  const s: StudentSession = await signInAsStudent(undefined, undefined, {
    templateEmail: "teststudent@gmail.com",
  });
  onSignals(s.cleanup);

  try {
    hr("CP-Q3 Part 5B — MASTERY HUB (real HTTP)");
    console.log(`student ${s.email} (${s.userId})`);

    sub("1. pick 3 subjects with ≥1 module each, and 4 distinct modules across them");
    const { data: subjectRows } = await s.admin.from("subjects").select("id, name").limit(10);
    const subjects = (subjectRows ?? []) as Array<{ id: string; name: string }>;
    if (subjects.length < 3) throw new Error("need at least 3 subjects seeded for this harness");

    const modulesFor = async (subjectId: string, n: number) => {
      const { data } = await s.admin.from("modules").select("id, name").eq("subject_id", subjectId).limit(n);
      return (data ?? []) as Array<{ id: string; name: string }>;
    };

    const subj1Modules = await modulesFor(subjects[0].id, 2);
    const subj2Modules = await modulesFor(subjects[1].id, 1);
    const subj3Modules = await modulesFor(subjects[2].id, 1);
    if (subj1Modules.length < 2 || subj2Modules.length < 1 || subj3Modules.length < 1) {
      throw new Error("chosen subjects don't have enough modules seeded for this harness — pick different HARNESS subjects");
    }
    const [modA, modB] = subj1Modules;
    const [modC] = subj2Modules;
    const [modD] = subj3Modules;
    console.log(`  subject1=${subjects[0].name} (modA=${modA.name}, modB=${modB.name})`);
    console.log(`  subject2=${subjects[1].name} (modC=${modC.name})`);
    console.log(`  subject3=${subjects[2].name} (modD=${modD.name})`);

    sub("2. seed student_topic_mastery rows (service role)");
    const rows = [
      { subject: subjects[0].id, module: modA.id, attempts: 8, correct: 6, difficulty: "easy" },
      { subject: subjects[0].id, module: modB.id, attempts: 20, correct: 5, difficulty: "medium" },
      { subject: subjects[1].id, module: modC.id, attempts: 15, correct: 12, difficulty: "hard" },
      { subject: subjects[2].id, module: modD.id, attempts: 3, correct: 3, difficulty: "easy" },
    ];
    for (const r of rows) {
      const { error } = await s.admin.from("student_topic_mastery").insert({
        student_id: s.userId,
        subject_id: r.subject,
        module_id: r.module,
        attempts_count: r.attempts,
        correct_count: r.correct,
        sessions_count: 1,
        accuracy: r.correct / r.attempts,
        current_difficulty: r.difficulty,
        last_practiced_at: new Date().toISOString(),
      });
      if (error) throw new Error(`seed failed for module ${r.module}: ${error.message}`);
    }
    c.check("4 rows seeded", true);

    sub("3. GET /api/assessment/mastery");
    const res = await s.json<HubResponse>("/api/assessment/mastery");
    c.eq("status 200", res.status, 200);
    const hub = res.body;
    c.eq("3 subjects grouped", hub.subjects.length, 3);

    const s1 = hub.subjects.find((x) => x.subjectId === subjects[0].id);
    const s2 = hub.subjects.find((x) => x.subjectId === subjects[1].id);
    const s3 = hub.subjects.find((x) => x.subjectId === subjects[2].id);
    c.check("subject 1 present", !!s1);
    c.check("subject 2 present", !!s2);
    c.check("subject 3 present", !!s3);

    if (s1) {
      c.eq("subject1 practicedModuleCount = 2", s1.practicedModuleCount, 2);
      c.check("subject1 moduleCount ≥ practicedModuleCount", s1.moduleCount >= s1.practicedModuleCount, `${s1.moduleCount} ≥ ${s1.practicedModuleCount}`);
      // Attempt-weighted, NOT a mean of the two module percentages —
      // (6+5)/(8+20) = 39.29% ≠ mean(75%, 25%) = 50%.
      const expectedAgg = Math.round(((6 + 5) / (8 + 20)) * 100);
      c.eq("subject1 aggregateMastery is ATTEMPT-WEIGHTED (not a mean of module %s)", s1.aggregateMastery, expectedAgg);

      const a = s1.modules.find((m) => m.moduleId === modA.id);
      c.check("module A present", !!a);
      if (a) {
        c.eq("module A accuracy = 75%", a.accuracy, 75);
        c.check("module A HAS promotionProgress (in the ready-to-level-up window)", !!a.promotionProgress);
        if (a.promotionProgress) {
          c.eq("targetTier = 'medium'", a.promotionProgress.targetTier, "medium");
          c.eq("attemptsAvailable = 10 - 8 = 2", a.promotionProgress.attemptsAvailable, 2);
          // ceil(0.7*10)=7 correct needed by attempt 10; already has 6 → needs 1 more.
          c.eq("correctNeeded = 1 (needs 7 of 10 total, has 6)", a.promotionProgress.correctNeeded, 1);
        }
      }

      const b = s1.modules.find((m) => m.moduleId === modB.id);
      c.check("module B present", !!b);
      if (b) {
        c.eq("module B accuracy = 25%", b.accuracy, 25);
        c.check("module B has NO promotionProgress (accuracy well under 70%)", !b.promotionProgress);
      }
    }

    if (s2) {
      const cMod = s2.modules.find((m) => m.moduleId === modC.id);
      c.check("module C present", !!cMod);
      if (cMod) {
        c.eq("module C accuracy = 80%", cMod.accuracy, 80);
        c.eq("module C difficulty = hard", cMod.currentDifficulty, "hard");
        c.check("module C has NO promotionProgress (already top tier)", !cMod.promotionProgress);
      }
    }

    if (s3) {
      const d = s3.modules.find((m) => m.moduleId === modD.id);
      c.check("module D present", !!d);
      if (d) {
        c.eq("module D accuracy = 100%", d.accuracy, 100);
        c.check("module D has NO promotionProgress (below the 8-attempt floor)", !d.promotionProgress);
      }
    }

    sub("4. empty state — a student with no mastery rows at all");
    const other = await signInAsStudent(undefined, undefined, { templateEmail: "teststudent@gmail.com" });
    try {
      const emptyRes = await other.json<HubResponse>("/api/assessment/mastery");
      c.eq("status 200", emptyRes.status, 200);
      c.eq("empty subjects array, not an error", emptyRes.body.subjects.length, 0);
    } finally {
      console.log(`  cleanup (empty-state student): ${await other.cleanup()}`);
    }

    const { passed, failed } = c.summary();
    hr(`MASTERY HUB: ${passed} passed, ${failed} failed`);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    const notes = await s.cleanup();
    console.log(`\ncleanup: ${notes}`);
    const { data: residue } = await s.admin.from("student_topic_mastery").select("id").eq("student_id", s.userId);
    console.log(
      (residue ?? []).length === 0
        ? "residue check: clean — no student_topic_mastery rows remain"
        : `residue check: LEFTOVER ${(residue ?? []).length} row(s)`
    );
  }
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
