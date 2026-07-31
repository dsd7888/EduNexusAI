/**
 * CP-N2 harness 5 — spend is attributed to 'notes', and quota to 'notes_view'.
 *
 * Two regressions this guards, both of which are invisible until someone reads a
 * cost report and believes it:
 *
 *  1. feature='chat' on notes spend. This is not hypothetical — it is exactly
 *     what Notes v1 did, and it is why historical chat spend in this product is
 *     permanently overstated (CLAUDE_CONTEXT §7). Every ai_call_logs row
 *     produced by a notes generation must read 'notes'.
 *
 *  2. notes_view ≠ hint. The MODULE route borrows the 30/day `hint` bucket; the
 *     SUBJECT route must use its own 20/day `notes_view` bucket. If subject
 *     reads silently drained the hint allowance, students would lose quiz hints
 *     by reading notes and nothing would say so.
 *
 * ── ONE CORRECTION TO THE SPEC'S WORDING ─────────────────────────────────────
 * The checkpoint asks for "no row in ai_call_logs with eventType='hint'".
 * ai_call_logs has no eventType column (task/feature/model/... — the bucket
 * lives in usage_analytics.event_type). The assertion is made where the data
 * actually is: usage_analytics must gain a 'notes_view' row and NO 'hint' row.
 *
 * ── AND ONE ASSERTION THE SPEC IMPLIES BUT DOES NOT STATE ────────────────────
 * Subject ASSEMBLY makes no AI call at all, so a cache-miss GET must add ZERO
 * ai_call_logs rows — the notes-feature rows come from the module generations
 * beneath it. Asserting that explicitly is what proves the assembler is
 * deterministic rather than quietly calling a model.
 *
 * Requires `npm run dev`.
 * Run: npx tsx _cp_n2_verify/rate_limit_event.ts > /tmp/cpn2_rate.log 2>&1
 */
// ./shared FIRST: it installs the globalThis.AsyncLocalStorage shim as an
// import side effect, and anything that transitively pulls in Next's
// work-async-storage before that throws "AsyncLocalStorage accessed in runtime
// where it is not available". `@/lib/utils/rate-limit` is such a module (it
// imports supabase-server), so it is loaded dynamically at runtime below rather
// than statically here.
import {
  loadEnvLocal,
  adminClient,
  makeChecker,
  hr,
  sub,
  onSignals,
  makeRunInScope,
  resolveSubject,
  ensureModuleNotes,
  purgeSubjectNotes,
  N2_FIXTURES,
} from "./shared";
import { signInAsStudent, waitForServer, type StudentSession } from "@/lib/testing/httpHarness";

loadEnvLocal();

type NotesResponse = { blocks?: unknown[]; version?: number; source?: string };

async function main() {
  const admin = adminClient();
  const { check, eq, summary } = makeChecker();
  const runInScope = await makeRunInScope();

  hr("CP-N2 harness 5 — rate_limit_event");
  await waitForServer();

  const subject = await resolveSubject(admin, N2_FIXTURES.ASSEMBLY);
  console.log(`target: ${subject.code} "${subject.name}"`);

  const sessions: StudentSession[] = [];
  let cleaned = false;
  const cleanup = async (): Promise<string> => {
    if (cleaned) return "already cleaned";
    cleaned = true;
    const notes: string[] = [];
    notes.push(
      `subject-scope residual=${await purgeSubjectNotes(admin, subject.subjectId, "subject")}`
    );
    // Sessions sweep their own usage_analytics rows (httpHarness cleanup).
    for (const s of sessions) {
      try {
        notes.push(await s.cleanup());
      } catch (e) {
        notes.push(`session cleanup failed: ${String(e).slice(0, 80)}`);
      }
    }
    return notes.join("; ");
  };
  onSignals(cleanup);

  const countLogs = async (): Promise<number> => {
    const { count } = await admin
      .from("ai_call_logs")
      .select("*", { count: "exact", head: true })
      .eq("subject_id", subject.subjectId);
    return count ?? 0;
  };

  try {
    // ── The constant itself ──────────────────────────────────────────────
    sub("RATE_LIMITS.notes_view — a named constant, imported, not a magic number");
    // Read from the real module, not restated here — a harness that hardcodes
    // 20 on both sides of the comparison proves nothing.
    const { RATE_LIMITS } = await import("@/lib/utils/rate-limit");
    check(
      "RATE_LIMITS.notes_view is exported and defined",
      Object.prototype.hasOwnProperty.call(RATE_LIMITS, "notes_view"),
      Object.keys(RATE_LIMITS).join(", ")
    );
    eq("RATE_LIMITS.notes_view === 20", RATE_LIMITS.notes_view, 20);
    check(
      "the subject route contains no inline rate-limit literal",
      !/limit:\s*\d+/.test(
        await import("node:fs").then((fs) =>
          fs.readFileSync("src/app/api/notes/subject/[subjectId]/route.ts", "utf8")
        )
      ),
      "grep: limit: <number>"
    );

    // ── Seed: real module generations, which DO make AI calls ────────────
    sub("seed — module generations are the only AI calls in the notes path");
    await purgeSubjectNotes(admin, subject.subjectId, "subject");
    const beforeSeed = await countLogs();
    const seed = await ensureModuleNotes(admin, subject, runInScope);
    const afterSeed = await countLogs();
    console.log(`    ai_call_logs for this subject: ${beforeSeed} -> ${afterSeed}`);

    const { data: notesLogs } = await admin
      .from("ai_call_logs")
      .select("feature, task, model")
      .eq("subject_id", subject.subjectId)
      .order("created_at", { ascending: false })
      .limit(50);
    const rows = notesLogs ?? [];

    check("ai_call_logs holds rows for this subject", rows.length > 0, `${rows.length} row(s)`);
    check(
      "at least one row carries feature='notes'",
      rows.some((r) => r.feature === "notes"),
      `features: ${[...new Set(rows.map((r) => r.feature))].join(", ")}`
    );
    eq(
      "NO row carries feature='chat' (the v1 mis-attribution regression)",
      rows.filter((r) => r.feature === "chat").length,
      0
    );
    check(
      "every notes-task row is bucketed as 'notes'",
      rows.filter((r) => r.task === "notes_gen_module").every((r) => r.feature === "notes"),
      `${rows.filter((r) => r.task === "notes_gen_module").length} notes_gen_module row(s)`
    );

    const student = await signInAsStudent(undefined, undefined, {
      role: "student",
      branch: subject.offering.branch,
      semester: subject.offering.semester,
      fullName: "CP-N2 Student",
    });
    sessions.push(student);
    const PATH = `/api/notes/subject/${subject.subjectId}`;

    // ── Cache MISS: assembly, and it must cost no AI call ────────────────
    sub("GET #1 (cache miss) — assembly is deterministic: zero AI calls");
    const logsBeforeMiss = await countLogs();
    const miss = await student.json<NotesResponse>(PATH);
    eq("status is 200", miss.status, 200);
    eq("source is 'fresh'", miss.body?.source, "fresh");
    const logsAfterMiss = await countLogs();
    eq(
      "the assembling GET added ZERO ai_call_logs rows",
      logsAfterMiss - logsBeforeMiss,
      0
    );

    // ── Quota bucket ─────────────────────────────────────────────────────
    sub("quota — notes_view is charged, hint is not");
    const { data: usage } = await admin
      .from("usage_analytics")
      .select("event_type, event_count, subject_id")
      .eq("user_id", student.userId);
    const usageRows = usage ?? [];
    console.log(`    usage_analytics: ${JSON.stringify(usageRows)}`);

    check(
      "a notes_view row was written for this student",
      usageRows.some((r) => r.event_type === "notes_view"),
      `event_types: ${[...new Set(usageRows.map((r) => r.event_type))].join(", ") || "(none)"}`
    );
    eq(
      "NO hint row was written (notes_view != hint regression check)",
      usageRows.filter((r) => r.event_type === "hint").length,
      0
    );
    check(
      "the notes_view row is scoped to this subject",
      usageRows
        .filter((r) => r.event_type === "notes_view")
        .every((r) => r.subject_id === subject.subjectId),
      subject.subjectId
    );

    // ── Cache HIT: no AI call, and no quota ──────────────────────────────
    sub("GET #2 (cache hit) — costs neither an AI call nor a unit of quota");
    const logsBeforeHit = await countLogs();
    const hit = await student.json<NotesResponse>(PATH);
    eq("status is 200", hit.status, 200);
    eq("source is 'cache'", hit.body?.source, "cache");
    eq("the cached GET added ZERO ai_call_logs rows", (await countLogs()) - logsBeforeHit, 0);

    const { data: usageAfter } = await admin
      .from("usage_analytics")
      .select("event_type, event_count")
      .eq("user_id", student.userId)
      .eq("event_type", "notes_view");
    const countBefore = usageRows
      .filter((r) => r.event_type === "notes_view")
      .reduce((s, r) => s + (r.event_count ?? 0), 0);
    const countAfter = (usageAfter ?? []).reduce((s, r) => s + (r.event_count ?? 0), 0);
    eq("a cache hit consumes no notes_view quota", countAfter, countBefore);

    console.log(
      `\n  INFO seeded ${seed.generated.length} module generation(s); ${rows.length} ai_call_logs row(s) inspected`
    );

    const { passed, failed } = summary();
    console.log(`\n${passed} passed, ${failed} failed`);
    console.log(`cleanup: ${await cleanup()}`);
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error("harness error:", err);
    console.log(`cleanup: ${await cleanup()}`);
    process.exit(1);
  }
}

main();
