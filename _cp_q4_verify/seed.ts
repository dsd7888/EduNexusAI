/**
 * Shared seeding for the CP-Q4 harnesses.
 *
 * Several harnesses need the SAME controlled scenario — 3 students, 1 subject,
 * 3 modules, scripted answers — because `aggregate_correctness.ts` and
 * `co_attainment.ts` assert different properties of one computation. Seeding it
 * twice, separately, would let the two harnesses silently drift apart and start
 * verifying different worlds.
 *
 * Everything created here is namespaced with a run-unique marker so cleanup can
 * find it even if a previous run died. Cleanup runs on signals as well as in
 * `finally` (CLAUDE.md harness rules — SIGPIPE from piping through `head` does
 * not run a `finally`, and a half-seeded subject once poisoned the NEXT run's
 * idea of "original state").
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { loadEnvLocal } from "@/lib/testing/httpHarness";

export interface ScriptedAnswer {
  moduleIndex: number;
  /** Index into the seeded bank questions for that module. */
  questionIndex: number;
  correct: boolean;
  timeSeconds: number;
}

export interface SeedScenario {
  admin: SupabaseClient;
  marker: string;
  subjectId: string;
  moduleIds: string[];
  questionIds: string[][];
  studentIds: string[];
  sessionIds: string[];
  /** Owner of the seeded bank questions, assigned to the seeded subject. */
  facultyId: string;
  cleanup: () => Promise<string>;
}

export function adminClient(): SupabaseClient {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("[seed] missing Supabase env vars");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Create a throwaway student auth user + profile. Returns the user id.
 * These are real auth users because `student_question_attempts.student_id`
 * and `quiz_sessions.student_id` both FK to `profiles(id)` which FKs to
 * `auth.users(id)` — a fabricated uuid would fail the insert, and a harness
 * that works around that by dropping the FK is testing a different database.
 */
export async function makeStudent(
  admin: SupabaseClient,
  marker: string,
  n: number
): Promise<string> {
  return makeUser(admin, `cpq4-${marker}-s${n}`, `CPQ4 Student ${n}`, "student");
}

/** Create a throwaway auth user + profile at any role. */
export async function makeUser(
  admin: SupabaseClient,
  slug: string,
  fullName: string,
  role: "student" | "faculty" | "dean" | "hod"
): Promise<string> {
  const email = `${slug}@edunexus-harness.invalid`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: `Hx-${randomUUID()}`,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) {
    throw new Error(`[seed] createUser(${email}): ${error?.message ?? "no user"}`);
  }
  const id = data.user.id;
  // handle_new_user inserts a bare profile on the auth trigger; wait for it,
  // then set the columns the engine actually reads.
  for (let i = 0; i < 20; i += 1) {
    const { data: p } = await admin
      .from("profiles")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (p) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const { error: upErr } = await admin
    .from("profiles")
    .update({
      full_name: fullName,
      role,
      branch: "CSE",
      semester: 1,
      department: "Engineering",
    })
    .eq("id", id);
  if (upErr) {
    // A CHECK constraint rejecting 'dean'/'hod' surfaces HERE with a clear
    // message, rather than as a confusing 403 from every analytics route.
    throw new Error(`[seed] profile role='${role}': ${upErr.message}`);
  }
  return id;
}

/**
 * The controlled scenario: 1 subject, N modules, N students, scripted answers.
 *
 * `sessionsByStudent[i][j]` is student i's j-th session. Each inner entry
 * becomes ONE `student_question_attempts` row; each session becomes ONE
 * completed `quiz_sessions` row whose score is that session's correct count —
 * so the point-biserial has a real, varying "overall score" to correlate
 * against. Multiple sessions per student is not decoration: with one session
 * each, every attempt by a given student would share one overall score and the
 * discrimination statistic would be testing a degenerate case.
 */
export async function seedScenario(
  sessionsByStudent: ScriptedAnswer[][][],
  opts: { moduleCount?: number; questionsPerModule?: number } = {}
): Promise<SeedScenario> {
  const admin = adminClient();
  const marker = randomUUID().slice(0, 8);
  const moduleCount = opts.moduleCount ?? 3;
  const questionsPerModule = opts.questionsPerModule ?? 3;

  const created = {
    subjectId: "",
    moduleIds: [] as string[],
    questionIds: [] as string[][],
    studentIds: [] as string[],
    sessionIds: [] as string[],
    facultyId: "",
  };

  const cleanup = async (): Promise<string> => {
    const notes: string[] = [];
    const say = async (label: string, p: PromiseLike<{ error: unknown }>) => {
      const { error } = await p;
      if (error) notes.push(`${label}: ${String((error as Error).message)}`);
    };
    if (created.sessionIds.length > 0) {
      await say(
        "quiz_session_keys",
        admin.from("quiz_session_keys").delete().in("session_id", created.sessionIds)
      );
    }
    if (created.studentIds.length > 0) {
      await say(
        "attempts",
        admin
          .from("student_question_attempts")
          .delete()
          .in("student_id", created.studentIds)
      );
      await say(
        "sessions",
        admin.from("quiz_sessions").delete().in("student_id", created.studentIds)
      );
      await say(
        "mastery",
        admin
          .from("student_topic_mastery")
          .delete()
          .in("student_id", created.studentIds)
      );
      for (const id of created.studentIds) {
        await admin.from("profiles").delete().eq("id", id);
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) notes.push(`auth ${id}: ${error.message}`);
      }
    }
    if (created.subjectId) {
      await say(
        "snapshot",
        admin
          .from("faculty_analytics_snapshots")
          .delete()
          .eq("subject_id", created.subjectId)
      );
      await say(
        "bank",
        admin.from("faculty_question_bank").delete().eq("subject_id", created.subjectId)
      );
      if (created.moduleIds.length > 0) {
        await say(
          "module_co_mapping",
          admin.from("module_co_mapping").delete().in("module_id", created.moduleIds)
        );
      }
      await say(
        "modules",
        admin.from("modules").delete().eq("subject_id", created.subjectId)
      );
      await say(
        "faculty_assignments",
        admin.from("faculty_assignments").delete().eq("subject_id", created.subjectId)
      );
      await say("subject", admin.from("subjects").delete().eq("id", created.subjectId));
    }
    if (created.facultyId) {
      await admin.from("role_scope").delete().eq("user_id", created.facultyId);
      await admin.from("profiles").delete().eq("id", created.facultyId);
      const { error } = await admin.auth.admin.deleteUser(created.facultyId);
      if (error) notes.push(`auth faculty: ${error.message}`);
    }
    return notes.length > 0 ? notes.join("; ") : "clean";
  };

  // A throw partway through seeding must not leak what was already created.
  // The cleanup closure is only reachable through a SUCCESSFUL return, so
  // without this an early failure (a NOT NULL violation, a CHECK constraint)
  // leaves a half-built subject behind — and it did, twice, during CP-Q4
  // development. Same lesson as the signal handlers: the failure paths need
  // the cleanup as much as the happy path does.
  try {
    // ── subject ──
    const subjectId = randomUUID();
    const { error: subjErr } = await admin.from("subjects").insert({
      id: subjectId,
      name: `CPQ4 Harness Subject ${marker}`,
      code: `CPQ4${marker.toUpperCase()}`,
      department: "Engineering",
      branch: "CSE",
      semester: 1,
      school: "School of Engineering",
    });
    if (subjErr) throw new Error(`[seed] subject: ${subjErr.message}`);
    created.subjectId = subjectId;

    // ── modules ──
    for (let i = 0; i < moduleCount; i += 1) {
      const id = randomUUID();
      const { error } = await admin.from("modules").insert({
        id,
        subject_id: subjectId,
        name: `CPQ4 Module ${i + 1}`,
        module_number: i + 1,
        weightage_percent: 100 / moduleCount,
      });
      if (error) throw new Error(`[seed] module ${i}: ${error.message}`);
      created.moduleIds.push(id);
    }

    // ── owning faculty ──
    // faculty_question_bank.faculty_id is NOT NULL, so the bank needs a real
    // owner. This faculty is also assigned to the subject, which makes it the
    // natural "faculty who legitimately has access" for the access harness.
    const facultyId = await makeUser(
      admin,
      `cpq4-${marker}-fac`,
      "CPQ4 Faculty Owner",
      "faculty"
    );
    created.facultyId = facultyId;
    const { error: assignErr } = await admin.from("faculty_assignments").insert({
      faculty_id: facultyId,
      subject_id: subjectId,
      assigned_by: facultyId,
    });
    if (assignErr) throw new Error(`[seed] faculty_assignment: ${assignErr.message}`);

    // ── bank questions ──
    for (let m = 0; m < moduleCount; m += 1) {
      const ids: string[] = [];
      for (let q = 0; q < questionsPerModule; q += 1) {
        const id = randomUUID();
        const { error } = await admin.from("faculty_question_bank").insert({
          id,
          subject_id: subjectId,
          faculty_id: facultyId,
          module_id: created.moduleIds[m],
          question_text: `CPQ4 M${m + 1}Q${q + 1} — what is ${m}+${q}?`,
          question_type: "mcq",
          marks: 1,
          options: [
            { label: "A", text: "right", is_correct: true },
            { label: "B", text: "wrong", is_correct: false },
            { label: "C", text: "also wrong", is_correct: false },
            { label: "D", text: "very wrong", is_correct: false },
          ],
          model_answer: "A",
          difficulty: "easy",
          source: "ai_generated",
        });
        if (error) throw new Error(`[seed] question m${m}q${q}: ${error.message}`);
        ids.push(id);
      }
      created.questionIds.push(ids);
    }

    // ── students, sessions, attempts ──
    for (let s = 0; s < sessionsByStudent.length; s += 1) {
      const studentId = await makeStudent(admin, marker, s + 1);
      created.studentIds.push(studentId);

      for (let j = 0; j < sessionsByStudent[s].length; j += 1) {
        const script = sessionsByStudent[s][j];
        const correctCount = script.filter((a) => a.correct).length;
        const sessionId = randomUUID();
        // Sessions are spread over recent days so the engagement window and the
        // streak buckets have something other than a single instant to bucket.
        const at = new Date(Date.now() - j * 24 * 60 * 60 * 1000).toISOString();
        const { error: sErr } = await admin.from("quiz_sessions").insert({
          id: sessionId,
          student_id: studentId,
          mode: "quick",
          subject_ids: [subjectId],
          module_ids: created.moduleIds,
          config: { question_count: script.length },
          status: "completed",
          score: correctCount,
          total_marks: script.length,
          started_at: at,
          completed_at: at,
        });
        if (sErr) throw new Error(`[seed] session s${s}/${j}: ${sErr.message}`);
        created.sessionIds.push(sessionId);

        for (const a of script) {
          const { error } = await admin.from("student_question_attempts").insert({
            student_id: studentId,
            question_id: created.questionIds[a.moduleIndex][a.questionIndex],
            subject_id: subjectId,
            module_id: created.moduleIds[a.moduleIndex],
            question_text: `CPQ4 M${a.moduleIndex + 1}Q${a.questionIndex + 1}`,
            question_type: "mcq",
            student_answer: a.correct ? "A" : "B",
            is_correct: a.correct,
            time_taken_seconds: a.timeSeconds,
            source: "bank",
            session_id: sessionId,
            created_at: at,
          });
          if (error) throw new Error(`[seed] attempt: ${error.message}`);
        }
      }
    }

  } catch (err) {
    const notes = await cleanup();
    console.error(`[seed] failed, rolled back: ${notes}`);
    throw err;
  }

  return {
    admin,
    marker,
    subjectId: created.subjectId,
    moduleIds: created.moduleIds,
    questionIds: created.questionIds,
    studentIds: created.studentIds,
    sessionIds: created.sessionIds,
    facultyId: created.facultyId,
    cleanup,
  };
}
