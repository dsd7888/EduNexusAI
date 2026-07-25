-- ============================================================================
-- Assessment Engine (CP-Q1) — student-side, slot-based, bank-first quizzing
--
-- This generalises two lineages that already work in production:
--
--   * PLACEMENT (§16) proved bank-first serving with a per-student recency
--     exclusion and adaptive per-topic difficulty — but only for placement
--     tracks (aptitude/verbal/domain/communication), keyed on a text `track`.
--   * Q PAPER (§12) proved deterministic slot allocation from syllabus
--     weightage, with faculty_question_bank as the reusable question store.
--
-- The engine that the three student quiz modes (quick / mastery / exam_sim)
-- will consume in CP-Q2 needs BOTH: placement's per-student history + adaptive
-- difficulty, and Q paper's syllabus-weighted slots over real modules. So the
-- two placement tables are generalised here from "track/topic" to
-- "(subject_id, module_id)", and a session table is added to hold the run.
--
-- NOTHING IS DROPPED. placement_question_attempts and placement_topic_mastery
-- stay exactly as they are and keep serving /student/placement — the placement
-- module is not being migrated onto these tables in this checkpoint. These are
-- ADDITIVE tables for the syllabus-quiz side.
--
-- Apply manually (Supabase SQL editor). Safe to re-run: every statement is
-- IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS guarded.
-- ============================================================================


-- ─── 0. faculty_question_bank: allow the two GATE-critical question types ────
-- The engine writes AI-generated student questions back into the SAME bank
-- faculty use (write-through, mirroring placement's bank-first-with-writethrough),
-- so 'msq' (multiple-select) and 'nat' (numerical answer type) must be legal
-- question_type values there. Existing values are untouched.
ALTER TABLE faculty_question_bank
  DROP CONSTRAINT IF EXISTS faculty_question_bank_question_type_check;

ALTER TABLE faculty_question_bank
  ADD CONSTRAINT faculty_question_bank_question_type_check
  CHECK (question_type IN
    ('mcq','short_answer','long_answer','numerical','fill_blank','msq','nat'));

-- A NAT question's answer is a NUMBER WITH A TOLERANCE, not text. Storing it in
-- model_answer would make the bank row unusable for grading on read-back (the
-- whole point of write-through is that a good AI question becomes reusable bank
-- material — a NAT row that loses its tolerance is not reusable). Both columns
-- are nullable and only ever populated for question_type='nat', so no existing
-- row or code path is affected. numeric_tolerance is a PERCENTAGE of the
-- expected value (GATE convention).
ALTER TABLE faculty_question_bank
  ADD COLUMN IF NOT EXISTS numeric_answer    numeric,
  ADD COLUMN IF NOT EXISTS numeric_tolerance numeric;


-- ─── 1. quiz_sessions ───────────────────────────────────────────────────────
-- One row per assessment run. Created (status='in_progress') when the engine
-- hands a plan to the UI; closed on submit. `config` is the unvalidated request
-- blob (question_count, difficulty, question_types, time_limit_minutes,
-- negative_marking, preset) — same "jsonb passthrough" choice as
-- qpaper_templates.structure (§19): mode-specific keys can be added in CP-Q2
-- without a migration.
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mode          text NOT NULL CHECK (mode IN ('quick','mastery','exam_sim')),

  -- Scope. subject_ids is always populated; module_ids is NULL for exam_sim
  -- (whole subject) and set when quick/mastery scope down to chosen modules.
  subject_ids   uuid[] NOT NULL,
  module_ids    uuid[],

  config        jsonb NOT NULL DEFAULT '{}'::jsonb,

  status        text NOT NULL DEFAULT 'in_progress'
                CHECK (status IN ('in_progress','completed','abandoned')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  score         numeric,
  total_marks   numeric
);

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_student
  ON quiz_sessions(student_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_status
  ON quiz_sessions(student_id, status);

ALTER TABLE quiz_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quiz_sessions_select_own" ON quiz_sessions;
CREATE POLICY "quiz_sessions_select_own" ON quiz_sessions
  FOR SELECT USING (student_id = auth.uid());

DROP POLICY IF EXISTS "quiz_sessions_insert_own" ON quiz_sessions;
CREATE POLICY "quiz_sessions_insert_own" ON quiz_sessions
  FOR INSERT WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "quiz_sessions_update_own" ON quiz_sessions;
CREATE POLICY "quiz_sessions_update_own" ON quiz_sessions
  FOR UPDATE USING (student_id = auth.uid());

DROP POLICY IF EXISTS "quiz_sessions_delete_own" ON quiz_sessions;
CREATE POLICY "quiz_sessions_delete_own" ON quiz_sessions
  FOR DELETE USING (student_id = auth.uid());

DROP POLICY IF EXISTS "quiz_sessions_all_superadmin" ON quiz_sessions;
CREATE POLICY "quiz_sessions_all_superadmin" ON quiz_sessions
  FOR ALL USING (get_my_role() = 'superadmin');


-- ─── 2. student_question_attempts ───────────────────────────────────────────
-- The generalisation of placement_question_attempts. Two things make it
-- different from its placement ancestor, and both are load-bearing:
--
--   * question_id is NULLABLE and paired with `source`. A bank-served question
--     points at faculty_question_bank; an 'ai_fresh' question that was never
--     persisted to the bank (e.g. no faculty owns the subject yet, so there is
--     no faculty_id to attribute it to) has question_id NULL. Recording the
--     attempt must never depend on the bank write succeeding.
--   * question_text / question_type are DENORMALISED onto the row. A bank
--     question can be edited or deleted by its owning faculty; a student's
--     history must still say what they actually answered. This is the same
--     reasoning as qpaper_history storing the full snapshot rather than a
--     pointer (§12).
--
-- The 30-day exclusion query in bankFill.ts reads (student_id, created_at) —
-- see idx_sqa_student_created.
CREATE TABLE IF NOT EXISTS student_question_attempts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Set only for source='bank'. ON DELETE SET NULL: losing the bank row must
  -- not delete the student's attempt history.
  question_id        uuid REFERENCES faculty_question_bank(id) ON DELETE SET NULL,

  subject_id         uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  -- Nullable: a question may legitimately span modules (exam_sim mixed items).
  module_id          uuid REFERENCES modules(id) ON DELETE SET NULL,

  question_text      text NOT NULL,
  question_type      text NOT NULL,

  student_answer     text,
  is_correct         boolean,
  time_taken_seconds integer,

  source             text NOT NULL CHECK (source IN ('bank','ai_fresh')),
  session_id         uuid REFERENCES quiz_sessions(id) ON DELETE CASCADE,

  created_at         timestamptz NOT NULL DEFAULT now()
);

-- idx_sqa_student_created: the 30-day recency exclusion (bank-first serving).
CREATE INDEX IF NOT EXISTS idx_sqa_student_created
  ON student_question_attempts(student_id, created_at DESC);
-- idx_sqa_session: loading / grading one session's attempts.
CREATE INDEX IF NOT EXISTS idx_sqa_session
  ON student_question_attempts(session_id);
-- Supporting index for the mastery recompute (per student per subject/module).
CREATE INDEX IF NOT EXISTS idx_sqa_student_subject_module
  ON student_question_attempts(student_id, subject_id, module_id);

ALTER TABLE student_question_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sqa_select_own" ON student_question_attempts;
CREATE POLICY "sqa_select_own" ON student_question_attempts
  FOR SELECT USING (student_id = auth.uid());

DROP POLICY IF EXISTS "sqa_insert_own" ON student_question_attempts;
CREATE POLICY "sqa_insert_own" ON student_question_attempts
  FOR INSERT WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "sqa_update_own" ON student_question_attempts;
CREATE POLICY "sqa_update_own" ON student_question_attempts
  FOR UPDATE USING (student_id = auth.uid());

-- Faculty read their assigned subjects; dean/hod/superadmin read everything
-- (the established oversight shape — §4: ownership checks test 'faculty'
-- literally and the higher tiers fall into the superadmin-like branch).
DROP POLICY IF EXISTS "sqa_select_faculty_assigned" ON student_question_attempts;
CREATE POLICY "sqa_select_faculty_assigned" ON student_question_attempts
  FOR SELECT USING (
    get_my_role() IN ('superadmin','dean','hod')
    OR (
      get_my_role() = 'faculty'
      AND EXISTS (
        SELECT 1 FROM faculty_assignments fa
        WHERE fa.subject_id = student_question_attempts.subject_id
          AND fa.faculty_id = auth.uid()
      )
    )
  );


-- ─── 3. student_topic_mastery ───────────────────────────────────────────────
-- The generalisation of placement_topic_mastery. Same columns and same adaptive
-- semantics (§16: promote at ≥70% accuracy with ≥10 attempts and ≥2 sessions;
-- demote below 40% with ≥5 attempts) — the ONLY change is the topic identity:
-- placement's (track, topic) text pair becomes the real syllabus coordinate
-- (subject_id, module_id).
--
-- module_id is NOT NULL here (unlike on the attempts table): a mastery row is
-- by definition per-module, and 'adaptive' difficulty lookup in engine.ts keys
-- on (student_id, subject_id, module_id). Attempts that span modules simply do
-- not contribute to a mastery row.
CREATE TABLE IF NOT EXISTS student_topic_mastery (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject_id         uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  module_id          uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,

  attempts_count     integer NOT NULL DEFAULT 0,
  correct_count      integer NOT NULL DEFAULT 0,
  sessions_count     integer NOT NULL DEFAULT 0,
  -- 0..1, rolling accuracy over the recent window (same field placement calls
  -- recent_accuracy; named `accuracy` here per the CP-Q1 spec).
  accuracy           numeric,

  current_difficulty text NOT NULL DEFAULT 'easy'
                     CHECK (current_difficulty IN ('easy','medium','hard')),

  last_practiced_at  timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- One mastery row per student per module — the upsert target for CP-Q2's
  -- post-submit adaptive update.
  UNIQUE (student_id, subject_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_stm_student_subject
  ON student_topic_mastery(student_id, subject_id);

DROP TRIGGER IF EXISTS student_topic_mastery_updated_at ON student_topic_mastery;
CREATE TRIGGER student_topic_mastery_updated_at BEFORE UPDATE ON student_topic_mastery
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE student_topic_mastery ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stm_select_own" ON student_topic_mastery;
CREATE POLICY "stm_select_own" ON student_topic_mastery
  FOR SELECT USING (student_id = auth.uid());

-- Writes go through the service role (server routes recompute mastery after a
-- submit). Own-row write policies exist as defence in depth for any future
-- direct-from-browser path, mirroring the placement tables.
DROP POLICY IF EXISTS "stm_insert_own" ON student_topic_mastery;
CREATE POLICY "stm_insert_own" ON student_topic_mastery
  FOR INSERT WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "stm_update_own" ON student_topic_mastery;
CREATE POLICY "stm_update_own" ON student_topic_mastery
  FOR UPDATE USING (student_id = auth.uid());

DROP POLICY IF EXISTS "stm_select_faculty_assigned" ON student_topic_mastery;
CREATE POLICY "stm_select_faculty_assigned" ON student_topic_mastery
  FOR SELECT USING (
    get_my_role() IN ('superadmin','dean','hod')
    OR (
      get_my_role() = 'faculty'
      AND EXISTS (
        SELECT 1 FROM faculty_assignments fa
        WHERE fa.subject_id = student_topic_mastery.subject_id
          AND fa.faculty_id = auth.uid()
      )
    )
  );
