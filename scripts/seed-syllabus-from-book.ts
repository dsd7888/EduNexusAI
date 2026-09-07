/**
 * Seed subjects/modules/COs/mappings/exam-scheme from ONE whole syllabus book PDF,
 * without pre-splitting it into per-subject pages.
 *
 * Why no splitting: subject sections in these books run 2-4 pages each with no
 * consistent boundary, so a page-range cut is guesswork. Instead this sends the
 * FULL book as the attachment on every call (same routeAI inlineData path the
 * faculty/superadmin single-subject upload already uses) and scopes each call with
 * an instruction naming the one subject to extract. Gemini does the page-finding;
 * you only need a roster (code/name/branch/semester), not page numbers.
 *
 * Roster JSON shape (array):
 *   [{ "code": "CS301", "name": "Data Structures", "branch": "ML", "semester": 3 }]
 *
 * Usage:
 *   npx tsx scripts/seed-syllabus-from-book.ts <book.pdf> <roster.json> [--dry-run] [--reuse-existing]
 *
 * --dry-run prints the plan (REUSE vs NEW per subject, queried against the live
 * DB) without calling the AI or writing anything — use it to sanity-check the
 * roster file first, since a typo'd code silently creates a duplicate subject
 * otherwise.
 *
 * --reuse-existing: when a roster row's code already has a subjects row (e.g.
 * seeded for a different branch earlier), SKIP the AI call and persist step
 * entirely — just add the subject_offerings row for this branch/semester. This
 * is the app's own designed reuse path (see subject_offerings migration: "the
 * same syllabus content is often reused across branches ... without re-running
 * extraction/classification for a second branch"). Without this flag, an
 * existing subject's content is always re-extracted and overwritten, which is
 * what you want when correcting a previous run's mistakes but NOT when the
 * overlap is a genuinely shared course.
 *
 * SCOPE: single curriculum-year only (this repo currently has no curriculum-year
 * axis — subjects.code is globally UNIQUE, deliberately reused across
 * departments/branches via subject_offerings). Re-running is otherwise safe:
 * subjects/offerings are found-or-created by code, and persistSyllabusAndClassify
 * upserts modules by (subject_id, module_number) and replaces CO/mapping tables.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

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

type RosterRow = { code: string; name: string; branch: string; semester: number };

const DEPARTMENT = "Engineering"; // repo-wide invariant, see CLAUDE.md

function scopedUserPrompt(basePrompt: string, row: RosterRow): string {
  return (
    `This PDF is a full syllabus book covering MULTIPLE subjects across multiple ` +
    `semesters. Extract data for ONLY this one subject — ignore every other ` +
    `subject and semester in the document:\n\n` +
    `  Subject code: ${row.code}\n` +
    `  Subject name: ${row.name}\n` +
    `  Semester: ${row.semester}\n\n` +
    basePrompt
  );
}

async function main(): Promise<void> {
  const [bookPath, rosterPath, ...rest] = process.argv.slice(2);
  const dryRun = rest.includes("--dry-run");
  const reuseExisting = rest.includes("--reuse-existing");

  if (!bookPath || !rosterPath) {
    console.error(
      "Usage: npx tsx scripts/seed-syllabus-from-book.ts <book.pdf> <roster.json> [--dry-run] [--reuse-existing]"
    );
    process.exit(1);
  }

  const roster: RosterRow[] = JSON.parse(readFileSync(resolve(rosterPath), "utf8"));
  if (!Array.isArray(roster) || roster.length === 0) {
    console.error("Roster file must be a non-empty JSON array.");
    process.exit(1);
  }
  for (const row of roster) {
    if (!row.code || !row.name || !row.branch || !row.semester) {
      console.error(`Roster row missing a field: ${JSON.stringify(row)}`);
      process.exit(1);
    }
  }

  const { createAdminClient } = await import("@/lib/db/supabase-server");
  const admin = createAdminClient();

  const { data: existingRows } = await admin
    .from("subjects")
    .select("code")
    .in("code", roster.map((r) => r.code));
  const existingCodes = new Set(((existingRows ?? []) as { code: string }[]).map((r) => r.code));

  console.log(`Book: ${bookPath}`);
  console.log(`Roster: ${roster.length} subjects`);
  roster.forEach((r) => {
    const tag = existingCodes.has(r.code)
      ? reuseExisting
        ? "[REUSE — will skip AI, just add offering]"
        : "[EXISTS — will re-extract & overwrite]"
      : "[NEW — will extract]";
    console.log(`  ${r.code}  ${r.name}  (${r.branch} sem ${r.semester})  ${tag}`);
  });

  if (dryRun) {
    console.log("\n--dry-run: no AI calls, no DB writes.");
    return;
  }

  const base64Data = readFileSync(resolve(bookPath)).toString("base64");

  // Same fake-request-scope shim as test-syllabus-audit-suggest.ts: routeAI logs
  // via next/server's after(), which needs a request scope outside Next's runtime.
  const { workAsyncStorage } = await import(
    "next/dist/server/app-render/work-async-storage.external.js"
  );
  const { routeAI } = await import("@/lib/ai/router");
  const { parseExtractedSyllabus } = await import("@/lib/syllabus/parser");
  const {
    SYLLABUS_EXTRACT_SYSTEM_PROMPT,
    SYLLABUS_EXTRACT_USER_PROMPT,
  } = await import("@/lib/syllabus/prompts");
  const { persistSyllabusAndClassify } = await import(
    "@/lib/syllabus/persistAndClassify"
  );

  const actor = { userId: null as unknown as string, userEmail: "seed-script@local", userRole: "superadmin" };
  const store = { afterContext: { after: (fn: unknown) => { void fn; } } };

  let totalCostInr = 0;
  let ok = 0;
  let failed = 0;

  await workAsyncStorage.run(store as never, async () => {
    for (const row of roster) {
      console.log(`\n=== ${row.code} — ${row.name} ===`);
      try {
        // 1. Find-or-create the subject row.
        const { data: existingSubject } = await admin
          .from("subjects")
          .select("id")
          .eq("code", row.code)
          .maybeSingle();

        let subjectId = (existingSubject as { id: string } | null)?.id ?? null;
        if (!subjectId) {
          const { data: created, error } = await admin
            .from("subjects")
            .insert({
              name: row.name,
              code: row.code,
              department: DEPARTMENT,
              branch: row.branch,
              semester: row.semester,
            })
            .select("id")
            .single();
          if (error || !created) throw new Error(`subject insert: ${error?.message}`);
          subjectId = (created as { id: string }).id;
          console.log(`  created subject ${subjectId}`);
        } else {
          console.log(`  found existing subject ${subjectId}`);
        }

        // 2. Ensure the (subject, branch, semester) offering exists.
        const { error: offeringError } = await admin
          .from("subject_offerings")
          .upsert(
            { subject_id: subjectId, branch: row.branch, semester: row.semester },
            { onConflict: "subject_id,branch,semester" }
          );
        if (offeringError) console.log(`  offering warning: ${offeringError.message}`);

        // 2b. Reuse mode: an already-existing subject just got a new offering
        // above (e.g. the same shared course now taught to a second branch).
        // Skip the AI call and persist step entirely — its content doesn't change.
        if (reuseExisting && existingCodes.has(row.code)) {
          console.log(`  ↺ reused existing content, offering added — no AI call`);
          ok++;
          continue;
        }

        // 3. Scoped extraction call against the FULL book.
        const jobId = crypto.randomUUID();
        const ai = await routeAI("syllabus_extract", {
          systemPrompt: SYLLABUS_EXTRACT_SYSTEM_PROMPT,
          messages: [
            { role: "user", content: scopedUserPrompt(SYLLABUS_EXTRACT_USER_PROMPT, row) },
          ],
          attachments: [{ mediaType: "application/pdf", data: base64Data }],
          logContext: {
            userId: null,
            userEmail: actor.userEmail,
            userRole: actor.userRole,
            subjectId,
            subjectCode: row.code,
            jobId,
            relatedContentId: null,
            feature: "syllabus_seed_script",
          },
        });
        totalCostInr += ai.costInr ?? 0;

        const extracted = parseExtractedSyllabus(String(ai.content ?? ""));
        if (!extracted) {
          console.log(`  ✗ parse failed — preview: ${String(ai.content ?? "").slice(0, 200)}`);
          failed++;
          continue;
        }

        // 4. Persist.
        const { warnings } = await persistSyllabusAndClassify(admin, subjectId, extracted, {
          userId: actor.userId,
          userEmail: actor.userEmail,
          userRole: actor.userRole,
        });
        if (warnings.length > 0) {
          console.log(`  warnings: ${warnings.join("; ")}`);
        }
        console.log(
          `  ✓ persisted (${extracted.modules?.length ?? 0} modules, ` +
            `${extracted.course_outcomes?.length ?? 0} COs, cost ₹${(ai.costInr ?? 0).toFixed(3)})`
        );
        ok++;
      } catch (err) {
        console.log(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
        failed++;
      }
    }
  });

  console.log(`\n${"═".repeat(60)}`);
  console.log(`${ok} succeeded, ${failed} failed. Total AI cost: ₹${totalCostInr.toFixed(3)}`);
  console.log("═".repeat(60));
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
