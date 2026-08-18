-- ============================================================================
-- CP-Q3 Part 1 — move the assessment answer key off quiz_sessions.config
--
-- THE HOLE THIS CLOSES (flagged in CP_Q2_MODES_AND_VERIFIER.md §4 and at
-- createSession() in src/lib/assessment/runner.ts):
--
--   quiz_sessions.config.key holds the full answer key — correctAnswer,
--   numericAnswer, numericTolerance and explanation for every served question.
--   quiz_sessions carries "quiz_sessions_select_own" (SELECT USING student_id =
--   auth.uid()), so the OWNING STUDENT can read their own row directly with the
--   browser client and pull the key out of config mid-session. Every API route
--   already reads through the admin client and never returns the key, so nothing
--   leaks through the API — but for a deferred-feedback exam_sim, direct table
--   access is a straight integrity hole.
--
--   It is latent in CP-Q2 only because no student-facing UI reads that table.
--   CP-Q3 ships exactly such a UI, so it becomes live-reachable and is fixed
--   here, schema-first, BEFORE any of that UI is built.
--
-- THE FIX: a sibling table holding only the key, with RLS enabled and NO
-- SELECT policy for authenticated users. Not "a narrower policy" — no policy at
-- all. Superadmin read is the single exception, via get_my_role() (§14),
-- matching the oversight shape every other table in this system uses.
--
--   * There is no legitimate client-side read of an answer key. Every read is
--     server-side through createAdminClient(), which bypasses RLS by design
--     (§14: "All API routes use createAdminClient(). RLS only affects browser
--     client calls."). So "no policy" is not an oversight to be patched later
--     when something breaks — it IS the access-control decision, and anything
--     that breaks against it is a code path that should not exist.
--   * The alternative considered and rejected was dropping
--     quiz_sessions_select_own instead. That policy is still wanted: the
--     landing page's "Continue where you left off" strip (CP-Q3 Part 3) reads
--     the student's own in_progress sessions. Splitting the table is the
--     smaller blast radius than removing a policy other surfaces rely on.
--
-- BEFORE → AFTER, stated once so it is readable at the source:
--
--   BEFORE  quiz_sessions.config = { …, questions: [student-safe], key: [FULL] }
--           policy: quiz_sessions_select_own → student reads own row → key
--                   readable by the one person who must not have it.
--
--   AFTER   quiz_sessions.config = { …, questions: [student-safe] }
--           quiz_session_keys.key = [FULL]
--           policies on quiz_session_keys: superadmin ALL, and nothing else.
--           A student SELECT returns [] with no error (PostgREST's behaviour
--           when no policy matches — §14). Grading, resume and per-answer
--           feedback all read it server-side with the service role.
--
-- Apply manually (Supabase SQL editor). Safe to re-run: every statement is
-- IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS guarded, and the backfill
-- is a no-op on a second run (nothing left matches `config ? 'key'`).
-- ============================================================================


-- ─── 1. The table ───────────────────────────────────────────────────────────
-- session_id is BOTH the primary key and the FK: exactly one key row per
-- session, and ON DELETE CASCADE means deleting a session cannot orphan its
-- key. (The reverse orphan — a key with no session — is impossible by the FK.)
CREATE TABLE IF NOT EXISTS quiz_session_keys (
  session_id uuid PRIMARY KEY REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  key        jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE quiz_session_keys IS
  'Answer keys for quiz_sessions. RLS enabled with NO SELECT policy for '
  'authenticated users — this is deliberate, not an omission. Every read is '
  'server-side via createAdminClient() (service role, bypasses RLS). See the '
  'header of 20260727000000_quiz_session_keys.sql.';

ALTER TABLE quiz_session_keys ENABLE ROW LEVEL SECURITY;


-- ─── 2. Policies ────────────────────────────────────────────────────────────
-- Superadmin only. No student policy, no faculty policy, no oversight
-- (dean/hod) policy — unlike student_question_attempts / student_topic_mastery,
-- an answer key has no oversight value that reading the question bank does not
-- already provide, and every additional reader is another way for a key to
-- reach a browser.
DROP POLICY IF EXISTS "quiz_session_keys_all_superadmin" ON quiz_session_keys;
CREATE POLICY "quiz_session_keys_all_superadmin" ON quiz_session_keys
  FOR ALL USING (get_my_role() = 'superadmin');


-- ─── 3. Backfill, then strip ────────────────────────────────────────────────
-- Order matters: copy first, delete second, so an interrupted run leaves the
-- key duplicated (recoverable) rather than destroyed (not).
--
-- ON CONFLICT DO NOTHING makes the copy idempotent if the migration is re-run
-- against a DB where some rows were already moved.
INSERT INTO quiz_session_keys (session_id, key)
SELECT id, config->'key'
FROM quiz_sessions
WHERE config ? 'key'
ON CONFLICT (session_id) DO NOTHING;

UPDATE quiz_sessions
SET config = config - 'key'
WHERE config ? 'key';


-- ─── 4. Post-condition check ────────────────────────────────────────────────
-- Fails loudly rather than leaving a half-migrated table. If this raises, the
-- backfill above did not cover every row and the strip must not be trusted.
DO $$
DECLARE
  leftover integer;
BEGIN
  SELECT count(*) INTO leftover FROM quiz_sessions WHERE config ? 'key';
  IF leftover > 0 THEN
    RAISE EXCEPTION
      'quiz_session_keys migration incomplete: % quiz_sessions row(s) still carry config.key',
      leftover;
  END IF;
END $$;
