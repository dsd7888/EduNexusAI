/**
 * CP-Q3 Part 1 verification — the answer key is not reachable by the student
 * who owns the session.
 *
 * What this actually proves, and what it deliberately does not:
 *
 *   PROVES   a real authenticated student session (anon key + a genuine JWT,
 *            i.e. the exact client a browser has) cannot SELECT any row from
 *            quiz_session_keys, including the key for its OWN in-progress
 *            session — the strongest case, since quiz_sessions_select_own
 *            grants that same student their session row.
 *   PROVES   quiz_sessions.config no longer carries `key` for a freshly
 *            created session (the write side actually moved, rather than
 *            writing to both places).
 *   PROVES   the key row does exist and is readable with the service role —
 *            otherwise "returns []" would pass vacuously against a table that
 *            was simply empty.
 *
 *   DOES NOT test the API surfaces; session_flow.ts covers grading end to end.
 *
 * PostgREST returns [] with NO ERROR when RLS matches no policy (§14), so the
 * assertion is "empty AND no error" — an error would mean something else went
 * wrong (bad JWT, missing table) and must not be read as "blocked".
 *
 * Self-cleaning, including on signals (CLAUDE.md harness rules — a `finally`
 * does not run on SIGPIPE, and piping this through `head` would leave a
 * session row behind).
 *
 *   npx tsx _cp_q3_verify/key_exposure.ts > out.txt 2>&1
 *
 * Auth: uses STUDENT_PASSWORD if set, otherwise mints a magic link with the
 * service role and redeems it for a real session — so no password needs to
 * live in .env.local for this to run.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
const STUDENT_PASSWORD = process.env.STUDENT_PASSWORD ?? "";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * A browser-equivalent client: anon key, real user JWT. Nothing about it is
 * privileged, which is the point — this is what a student can build in the
 * devtools console of a page they are already logged into.
 */
async function signInAsStudent(
  admin: SupabaseClient,
  url: string,
  anonKey: string
): Promise<SupabaseClient> {
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (STUDENT_PASSWORD) {
    const { error } = await client.auth.signInWithPassword({
      email: STUDENT_EMAIL,
      password: STUDENT_PASSWORD,
    });
    if (error) throw new Error(`password sign-in failed: ${error.message}`);
    return client;
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: STUDENT_EMAIL,
  });
  if (error) throw new Error(`generateLink failed: ${error.message}`);
  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) throw new Error("generateLink returned no hashed_token");

  const { error: otpError } = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (otpError) throw new Error(`verifyOtp failed: ${otpError.message}`);
  return client;
}

async function main() {
  const { createAdminClient } = await import("@/lib/db/supabase-server");
  const admin = createAdminClient();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !anonKey) throw new Error("missing Supabase URL / anon key");

  let sessionId: string | null = null;

  const cleanup = async (): Promise<string> => {
    if (!sessionId) return "nothing to clean";
    // ON DELETE CASCADE takes the key row with it; the explicit delete after
    // is a belt-and-braces residue check, not a second cleanup path.
    await admin.from("quiz_sessions").delete().eq("id", sessionId);
    const { data: keyResidue } = await admin
      .from("quiz_session_keys")
      .select("session_id")
      .eq("session_id", sessionId);
    const { data: sessionResidue } = await admin
      .from("quiz_sessions")
      .select("id")
      .eq("id", sessionId);
    return `session deleted; residue — quiz_sessions: ${
      (sessionResidue ?? []).length
    }, quiz_session_keys: ${(keyResidue ?? []).length}`;
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

  try {
    console.log("═".repeat(78));
    console.log("CP-Q3 Part 1 — quiz_session_keys exposure check");
    console.log("═".repeat(78));

    // ── fixtures ───────────────────────────────────────────────────────────
    const { data: studentRow } = await admin
      .from("profiles")
      .select("id, full_name, email")
      .eq("email", STUDENT_EMAIL)
      .maybeSingle();
    if (!studentRow) throw new Error(`student ${STUDENT_EMAIL} not found`);
    const student = studentRow as { id: string; full_name: string };

    const { data: subjectRow } = await admin
      .from("subjects")
      .select("id, code")
      .limit(1)
      .maybeSingle();
    if (!subjectRow) throw new Error("no subjects seeded");
    const subject = subjectRow as { id: string; code: string };

    console.log(`\n  student: ${student.full_name} (${STUDENT_EMAIL})`);
    console.log(`  subject: ${subject.code}`);

    // ── (a) create a session AS THE STUDENT WOULD OWN IT ───────────────────
    // Written with the service role rather than by driving /api/assessment/quick
    // so this check costs no AI spend and tests the storage shape in isolation.
    // The row is byte-identical in the fields that matter: same student_id,
    // same status, key in quiz_session_keys.
    console.log("\n(a) create an in_progress session owned by the student");
    sessionId = randomUUID();
    const fakeKey = [
      {
        slotId: "S1",
        type: "mcq",
        correctAnswer: "B",
        numericAnswer: null,
        numericTolerance: 0,
        explanation: "CANARY — if a student can read this string, the fix failed.",
        marks: 1,
        subjectId: subject.id,
        moduleId: null,
        bankQuestionId: null,
        source: "ai_fresh",
        questionText: "Canary question",
      },
    ];

    const { error: insertErr } = await admin.from("quiz_sessions").insert({
      id: sessionId,
      student_id: student.id,
      mode: "quick",
      subject_ids: [subject.id],
      module_ids: null,
      config: {
        question_count: 1,
        difficulty: "mixed",
        question_types: ["mcq"],
        questions: [
          {
            slotId: "S1",
            question: "Canary question",
            type: "mcq",
            options: ["A", "B", "C", "D"],
            marks: 1,
            subjectId: subject.id,
            moduleId: null,
            difficulty: "easy",
          },
        ],
      },
      status: "in_progress",
      total_marks: 1,
    });
    if (insertErr) throw new Error(`session insert failed: ${insertErr.message}`);

    const { error: keyErr } = await admin
      .from("quiz_session_keys")
      .insert({ session_id: sessionId, key: fakeKey });
    if (keyErr) throw new Error(`key insert failed: ${keyErr.message}`);
    check("session + key row created", true, `session ${sessionId.slice(0, 8)}…`);

    // ── (b) the key really is there, read with the service role ────────────
    // Without this, (c) could pass against an empty table and prove nothing.
    console.log("\n(b) service role CAN read the key (guards against a vacuous pass)");
    const { data: adminKey, error: adminKeyErr } = await admin
      .from("quiz_session_keys")
      .select("session_id, key")
      .eq("session_id", sessionId)
      .maybeSingle();
    check("adminClient read returns the row", !!adminKey && !adminKeyErr,
      adminKeyErr ? adminKeyErr.message : `key has ${
        Array.isArray((adminKey as { key?: unknown })?.key)
          ? ((adminKey as { key: unknown[] }).key).length
          : 0
      } entry(s)`);

    // ── (c) THE ASSERTION — the student's own client sees nothing ──────────
    console.log("\n(c) the owning student's browser client CANNOT read the key");
    const studentClient = await signInAsStudent(admin, url, anonKey);
    const { data: authData } = await studentClient.auth.getUser();
    check(
      "student client is authenticated as the session owner",
      authData.user?.id === student.id,
      `auth.uid()=${authData.user?.id?.slice(0, 8) ?? "none"}…`
    );

    // Targeted read: this exact session's key.
    const targeted = await studentClient
      .from("quiz_session_keys")
      .select("session_id, key")
      .eq("session_id", sessionId);
    check(
      "SELECT … WHERE session_id = <own session> returns []",
      (targeted.data ?? []).length === 0,
      `rows=${(targeted.data ?? []).length}`
    );
    check(
      "…and returns NO error (RLS no-policy behaviour, not a failed query)",
      targeted.error == null,
      targeted.error ? `error: ${targeted.error.message}` : "error=null"
    );

    // Unfiltered read: the "just select everything" attempt.
    const unfiltered = await studentClient.from("quiz_session_keys").select("*");
    check(
      "SELECT * (no filter) returns []",
      (unfiltered.data ?? []).length === 0,
      `rows=${(unfiltered.data ?? []).length}`
    );
    check(
      "…and returns NO error",
      unfiltered.error == null,
      unfiltered.error ? `error: ${unfiltered.error.message}` : "error=null"
    );

    // ── (d) the student CAN still read their session row — and it is clean ─
    // This is the counterpart assertion. quiz_sessions_select_own is still in
    // force (Part 3's "Continue where you left off" strip needs it), so the
    // fix has to be "the key is not in that row", not "the row is unreadable".
    console.log("\n(d) the student still reads their session row, and it carries no key");
    const own = await studentClient
      .from("quiz_sessions")
      .select("id, status, config")
      .eq("id", sessionId)
      .maybeSingle();
    check(
      "student reads own quiz_sessions row (policy intact)",
      own.data != null && own.error == null,
      own.error ? own.error.message : `status=${(own.data as { status?: string })?.status}`
    );
    const cfg = (own.data as { config?: Record<string, unknown> } | null)?.config ?? {};
    check(
      "config has no `key` property",
      !("key" in cfg),
      `config keys: ${Object.keys(cfg).join(", ")}`
    );
    const serialised = JSON.stringify(own.data ?? {});
    check(
      "the canary explanation string appears nowhere in the row",
      !serialised.includes("CANARY"),
      `payload ${serialised.length} chars`
    );

    // ── (e) no legacy rows left anywhere ───────────────────────────────────
    // The migration's backfill should have stripped every pre-existing
    // config.key. If this fails, the migration was not applied to this DB.
    console.log("\n(e) no quiz_sessions row anywhere still carries config.key");
    const { data: allSessions, error: scanErr } = await admin
      .from("quiz_sessions")
      .select("id, config");
    const legacy = ((allSessions ?? []) as Array<{ id: string; config: Record<string, unknown> | null }>)
      .filter((r) => r.config != null && "key" in r.config);
    check(
      "backfill complete across the whole table",
      scanErr == null && legacy.length === 0,
      scanErr ? scanErr.message : `${(allSessions ?? []).length} row(s) scanned, ${legacy.length} legacy`
    );

    await studentClient.auth.signOut();
  } finally {
    const notes = await cleanup();
    console.log(`\ncleanup: ${notes}`);
    console.log("\n" + "═".repeat(78));
    console.log(`RESULT  ${passed} passed, ${failed} failed`);
    console.log("═".repeat(78));
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
