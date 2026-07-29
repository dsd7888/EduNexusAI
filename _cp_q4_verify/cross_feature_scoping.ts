/**
 * CP-Q4 Part 5f — analytics is scoped to ASSESSMENT, and nothing else.
 *
 * Seeds one student with real data in three other surfaces — chat, placement,
 * and faculty-generated content — then drives the per-student analytics route
 * as an entitled faculty member and asserts none of it comes back.
 *
 * ── WHY CANARY STRINGS AND NOT FIELD-ABSENCE CHECKS ────────────────────────
 * Asserting `body.chat === undefined` is weaker than it looks: the value can
 * survive inside a nested blob, a joined row, a `config` jsonb, or a field
 * nobody thought to enumerate. So every seeded row carries a unique sentinel,
 * and the assertion is that the sentinel appears NOWHERE in
 * `JSON.stringify(response)`. (CLAUDE.md, RLS four-assertion template,
 * assertion 4 — applied to a response body rather than a table read.)
 *
 * ── AND THE POSITIVE CONTROL ───────────────────────────────────────────────
 * "No canaries found" passes identically against a route that returns nothing
 * at all, or 404s. So the same response is asserted to CONTAIN the student's
 * assessment data. A scoping test that only proves absence passes just as well
 * against an outage.
 *
 * Requires a dev server:  npm run dev
 *   npx tsx _cp_q4_verify/cross_feature_scoping.ts > out.txt 2>&1
 */

import { randomUUID } from "node:crypto";
import {
  signInAsStudent,
  makeChecker,
  hr,
  sub,
  onSignals,
  waitForServer,
  type StudentSession,
} from "@/lib/testing/httpHarness";
import { seedScenario, type SeedScenario } from "./seed";
import { SCENARIO } from "./scenario";

/** Fields the per-student analytics response is ALLOWED to have. */
const ALLOWED_TOP_LEVEL = new Set([
  "student",
  "subjectId",
  "sessionCount",
  "aggregateAccuracy",
  "attemptCount",
  "lastActive",
  "streak",
  "perModule",
  "recentSessions",
]);

async function main() {
  const c = makeChecker();
  hr("CP-Q4 Part 5f — CROSS-FEATURE SCOPING (chat / placement / content stay out)");
  await waitForServer();

  let scenario: SeedScenario | null = null;
  let faculty: StudentSession | null = null;
  const seeded: Array<{ table: string; column: string; value: string }> = [];

  const cleanupAll = async (): Promise<string> => {
    const notes: string[] = [];
    if (scenario) {
      for (const s of seeded) {
        const { error } = await scenario.admin
          .from(s.table)
          .delete()
          .eq(s.column, s.value);
        if (error) notes.push(`${s.table}: ${error.message}`);
      }
    }
    if (faculty) notes.push(await faculty.cleanup());
    if (scenario) notes.push(await scenario.cleanup());
    return notes.join("; ");
  };
  onSignals(cleanupAll);

  try {
    sub("0. Seed the assessment scenario + an entitled faculty");
    scenario = await seedScenario(SCENARIO);
    const s = scenario;
    const studentId = s.studentIds[0];

    faculty = await signInAsStudent(undefined, undefined, {
      role: "faculty",
      fullName: "CPQ4 Scoping Faculty",
    });
    await faculty.admin.from("faculty_assignments").insert({
      faculty_id: faculty.userId,
      subject_id: s.subjectId,
      assigned_by: faculty.userId,
    });

    // ── canaries ──
    const canary = {
      chat: `CANARY-CHAT-${randomUUID()}`,
      content: `CANARY-CONTENT-${randomUUID()}`,
      placement: `CANARY-PLACEMENT-${randomUUID()}`,
    };

    sub("1. Seed the student into three OTHER surfaces");

    // chat
    const chatSessionId = randomUUID();
    const { error: csErr } = await s.admin.from("chat_sessions").insert({
      id: chatSessionId,
      student_id: studentId,
      subject_id: s.subjectId,
    });
    c.check("chat_session seeded", !csErr, csErr?.message ?? "ok");
    if (!csErr) {
      seeded.push({ table: "chat_sessions", column: "id", value: chatSessionId });
      const { error: cmErr } = await s.admin.from("chat_messages").insert({
        session_id: chatSessionId,
        role: "user",
        content: `I do not understand recursion at all ${canary.chat}`,
      });
      c.check("chat_message with canary seeded", !cmErr, cmErr?.message ?? "ok");
      seeded.unshift({
        table: "chat_messages",
        column: "session_id",
        value: chatSessionId,
      });
    }

    // faculty-generated content
    const contentId = randomUUID();
    const { error: gcErr } = await s.admin.from("generated_content").insert({
      id: contentId,
      subject_id: s.subjectId,
      type: "refined_notes",
      title: `Notes ${canary.content}`,
      generated_by: faculty.userId,
      status: "completed",
    });
    c.check("generated_content with canary seeded", !gcErr, gcErr?.message ?? "ok");
    if (!gcErr) {
      seeded.push({ table: "generated_content", column: "id", value: contentId });
    }

    // placement
    const { error: pmErr } = await s.admin
      .from("placement_topic_mastery")
      .insert({
        student_id: studentId,
        track: "aptitude",
        topic: `Percentages ${canary.placement}`,
        attempts_count: 12,
        correct_count: 3,
        sessions_count: 2,
        recent_accuracy: 0.25,
      });
    c.check("placement_topic_mastery with canary seeded", !pmErr, pmErr?.message ?? "ok");
    if (!pmErr) {
      seeded.push({
        table: "placement_topic_mastery",
        column: "student_id",
        value: studentId,
      });
    }

    // ── the route under test ──
    sub("2. GET the per-student analytics route as the entitled faculty");
    const res = await faculty.json<Record<string, unknown>>(
      `/api/faculty/analytics/student/${studentId}?subjectId=${s.subjectId}`
    );
    c.eq("status 200", res.status, 200);
    const serialised = JSON.stringify(res.body ?? {});

    sub("3. POSITIVE CONTROL — the response really does carry assessment data");
    c.check(
      "response is non-trivial",
      serialised.length > 100,
      `${serialised.length} bytes`
    );
    const body = res.body as
      | {
          student?: { id?: string };
          sessionCount?: number;
          attemptCount?: number;
          perModule?: unknown[];
          recentSessions?: unknown[];
        }
      | undefined;
    c.eq("it is the right student", body?.student?.id, studentId);
    c.eq("sessionCount is the seeded 2", body?.sessionCount, 2);
    c.eq("attemptCount is the seeded 6", body?.attemptCount, 6);
    c.check("perModule is populated", (body?.perModule?.length ?? 0) > 0);
    c.check("recentSessions is populated", (body?.recentSessions?.length ?? 0) > 0);

    sub("4. THE CANARIES — none may appear anywhere in the payload");
    c.check(
      "no chat canary in the response",
      !serialised.includes(canary.chat)
    );
    c.check(
      "no generated-content canary in the response",
      !serialised.includes(canary.content)
    );
    c.check(
      "no placement canary in the response",
      !serialised.includes(canary.placement)
    );
    c.check(
      "no bare 'CANARY-' substring at all (catches a partial/encoded leak)",
      !serialised.includes("CANARY-")
    );

    sub("5. The response shape is exactly the assessment-scoped field set");
    const keys = Object.keys(res.body ?? {});
    const unexpected = keys.filter((k) => !ALLOWED_TOP_LEVEL.has(k));
    c.eq("no unexpected top-level fields", unexpected, []);
    for (const k of ALLOWED_TOP_LEVEL) {
      c.check(`field '${k}' present`, keys.includes(k));
    }
    for (const forbidden of ["chat", "placement", "content", "messages"]) {
      c.check(
        `no top-level field mentioning '${forbidden}'`,
        !keys.some((k) => k.toLowerCase().includes(forbidden))
      );
    }

    // ── the aggregate surfaces too ──
    sub("6. The subject dashboard and roster are equally clean");
    const subj = await faculty.json(
      `/api/faculty/analytics/subject/${s.subjectId}`
    );
    c.check(
      "subject snapshot carries no canary",
      !JSON.stringify(subj.body ?? {}).includes("CANARY-")
    );
    const roster = await faculty.json(
      `/api/faculty/analytics/subject/${s.subjectId}/students`
    );
    c.check(
      "students roster carries no canary",
      !JSON.stringify(roster.body ?? {}).includes("CANARY-")
    );

    // ── and prove the canaries were actually reachable ──
    sub("7. CONTROL — the seeded canaries genuinely exist and are readable");
    const { data: chatCheck } = await s.admin
      .from("chat_messages")
      .select("content")
      .eq("session_id", chatSessionId);
    c.check(
      "chat canary IS in the database (so its absence above means something)",
      JSON.stringify(chatCheck ?? []).includes(canary.chat)
    );
    const { data: pmCheck } = await s.admin
      .from("placement_topic_mastery")
      .select("topic")
      .eq("student_id", studentId);
    c.check(
      "placement canary IS in the database",
      JSON.stringify(pmCheck ?? []).includes(canary.placement)
    );
  } catch (err) {
    c.check("harness ran without throwing", false, String(err));
  } finally {
    sub("8. Cleanup — verified, not assumed");
    const notes = await cleanupAll();
    console.log(`  cleanup: ${notes}`);
    if (scenario) {
      const { count: chatLeft } = await scenario.admin
        .from("chat_sessions")
        .select("*", { count: "exact", head: true })
        .eq("subject_id", scenario.subjectId);
      c.eq("no chat_sessions left behind", chatLeft ?? 0, 0);
      const { count: contentLeft } = await scenario.admin
        .from("generated_content")
        .select("*", { count: "exact", head: true })
        .eq("subject_id", scenario.subjectId);
      c.eq("no generated_content left behind", contentLeft ?? 0, 0);
    }
  }

  const { passed, failed } = c.summary();
  hr(`RESULT — ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
