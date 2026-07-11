/**
 * Checkpoint-2 test harness: generate a lesson plan for one real subject and
 * print the VALIDATED payload (post gate) for manual inspection.
 *
 *   npx tsx scripts/test-lessonplan-generator.ts            # defaults to DAA
 *   SUBJECT=SEIT3032 npx tsx scripts/test-lessonplan-generator.ts
 *   SUBJECT=<subject-uuid> npx tsx scripts/test-lessonplan-generator.ts
 *
 * This calls the real Gemini API (costs money). It drives the production
 * generator (which uses routeAI → after() for logging); routeAI's after() call
 * requires a Next request scope, so we enter a minimal fake one via
 * workAsyncStorage. This shim lives ONLY in the harness — production always runs
 * inside a real request scope.
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

async function main() {
  const { workAsyncStorage } = await import(
    "next/dist/server/app-render/work-async-storage.external"
  );
  const { createAdminClient } = await import("@/lib/db/supabase-server");
  const {
    loadLessonPlanContext,
    generateTheorySection,
    generatePracticalSection,
  } = await import("@/lib/lessonplan/generator");

  const admin = createAdminClient();
  const subjectArg = process.env.SUBJECT ?? "SEIT3032";

  // resolve subject by id, then code, then fuzzy name
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
  let subjectId: string | null = null;
  let subjectLabel = subjectArg;

  if (uuidRe.test(subjectArg)) {
    subjectId = subjectArg;
  } else {
    const { data: byCode } = await admin
      .from("subjects")
      .select("id, name, code")
      .eq("code", subjectArg)
      .maybeSingle();
    if (byCode) {
      subjectId = (byCode as { id: string }).id;
      subjectLabel = `${(byCode as { code: string }).code} — ${(byCode as { name: string }).name}`;
    } else {
      const { data: byName } = await admin
        .from("subjects")
        .select("id, name, code")
        .ilike("name", "%algorithm%")
        .limit(1);
      const row = (byName ?? [])[0] as { id: string; name: string; code: string } | undefined;
      if (row) {
        subjectId = row.id;
        subjectLabel = `${row.code} — ${row.name}`;
      }
    }
  }

  if (!subjectId) {
    console.error(`Could not resolve a subject for "${subjectArg}".`);
    process.exit(1);
  }

  console.log(`\n=== Subject: ${subjectLabel} (${subjectId}) ===\n`);

  const ctx = await loadLessonPlanContext(subjectId);
  console.log(
    `Modules: ${ctx.modules.length} | COs: ${ctx.courseOutcomes.length} | Practicals: ${ctx.practicals.length}`,
  );
  console.log(
    "Module hours: " +
      ctx.modules.map((m) => `M${m.module_number}=${m.hours ?? "∅"}`).join(", "),
  );

  const logContext = {
    userId: null,
    userEmail: "harness@test",
    userRole: "faculty",
    subjectId: ctx.subjectId,
    subjectCode: ctx.subjectCode,
    jobId: crypto.randomUUID(),
    relatedContentId: null,
    feature: "lesson_plan_gen_test",
    metadata: {},
  };

  // Run generation inside a minimal fake request scope so routeAI's after()
  // logging call finds a store instead of throwing.
  const store = {
    afterContext: { after: (_fn: unknown) => { void _fn; } },
  };

  await workAsyncStorage.run(store as never, async () => {
    console.log("\n--- Generating THEORY (per-module Flash calls) ---");
    const theory = await generateTheorySection(ctx, null, undefined, logContext);
    console.log(`\nTheory sessions: ${theory.sessions.length}`);
    if (theory.defaultedModules.length) {
      console.log(
        `Defaulted (null/0 hours) modules: ${theory.defaultedModules.join(", ")}`,
      );
    }
    for (const s of theory.sessions) {
      console.log(
        `\n  #${s.sessionNo} [M${s.moduleNumber}] BTL${s.btl} ${s.method} CO=${s.coCodes.join("/")}`,
      );
      console.log(`    topics: ${s.topics.join(" | ")}`);
      console.log(`    objective: ${s.objective}`);
      console.log(`    method-note: ${s.methodNote}`);
      console.log(`    misconception: ${s.misconception}`);
      if (s.examNote) console.log(`    exam-note: ${s.examNote}`);
    }
    console.log(`\nTheory warnings (${theory.warnings.length}):`);
    for (const w of theory.warnings) console.log(`  [${w.kind}] ${w.message}`);

    if (ctx.practicals.length > 0) {
      console.log("\n--- Generating PRACTICALS (one Flash call) ---");
      const prac = await generatePracticalSection(ctx, logContext);
      for (const p of prac.practicals) {
        console.log(`\n  P#${p.practicalNo} (${p.hours}h) CO=${p.coCodes.join("/")}`);
        console.log(`    title: ${p.title}`);
        console.log(`    prep: ${p.prepNote}`);
        console.log(`    assess: ${p.assessmentHint}`);
        console.log(`    viva: ${p.vivaSeed}`);
      }
      console.log(`\nPractical warnings (${prac.warnings.length}):`);
      for (const w of prac.warnings) console.log(`  [${w.kind}] ${w.message}`);
    } else {
      console.log("\n(no practicals for this subject)");
    }
  });

  console.log("\n=== done ===\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("Harness failed:", e);
  process.exit(1);
});
