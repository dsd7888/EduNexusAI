-- ============================================================================
-- CP-Q4 Part 1 — faculty_analytics_snapshots
--
-- WHAT THIS IS: one cached row of computed aggregates PER SUBJECT, refreshed
-- on a schedule (daily cron) and opportunistically on read when stale (>2h).
-- Every number the faculty analytics dashboard renders comes from this row.
--
-- WHY A SNAPSHOT TABLE AND NOT A VIEW / LIVE COMPUTE:
--   The aggregates are a full scan of student_question_attempts for the
--   subject, joined against modules, the question bank and module_co_mapping,
--   with a point-biserial correlation computed per bank question. That is not
--   a per-request cost. The pilot cohort means one refresh serves many faculty
--   views of the same subject, so the compute is amortised rather than paid
--   per page load.
--
-- WHY PER-SUBJECT AND NOT PER-FACULTY (the UNIQUE constraint enforces this):
--   Analytics is a property of the COHORT, not of the viewer. Two faculty
--   assigned to the same subject must see the same numbers — if they didn't,
--   a disagreement between colleagues about "what the data says" would be a
--   caching artefact. subject_id UNIQUE makes per-faculty snapshots
--   unrepresentable rather than merely discouraged.
--
-- RLS SHAPE — three readers, three different reasons:
--   superadmin  — full platform oversight, as everywhere else (§14).
--   faculty     — via faculty_assignments ONLY. Not school, not branch,
--                 not department. §4: "Access follows faculty_assignments
--                 ONLY — not school/branch hierarchy."
--   dean/hod    — via role_scope (§4): dean is scoped to school(s), hod to
--                 department(s) within a school. role_scope.department IS NULL
--                 means "entire school".
--
-- NOTE ON dean/hod, stated here because it diverges from the rest of the app:
--   Elsewhere in this codebase, ownership checks test `role === 'faculty'`
--   literally and dean/hod fall through into the superadmin-like else branch
--   (§4) — i.e. effectively unscoped. Analytics does NOT do that. This table
--   carries per-student performance data at cohort scale, so dean/hod reads
--   are scoped to their actual role_scope rows and FAIL CLOSED when they have
--   none. A dean with no role_scope row reads nothing here, by design. That is
--   the whole reason CP-Q4 has its own assertAnalyticsAccess() instead of
--   reusing assertSubjectAccess() — see src/lib/analytics/access.ts.
--
-- Apply manually (Supabase SQL editor). Safe to re-run: CREATE TABLE IF NOT
-- EXISTS, DROP POLICY IF EXISTS → CREATE, DROP CONSTRAINT IF EXISTS → ADD
-- (§19 idempotency rule).
-- ============================================================================


-- ─── 1. The table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS faculty_analytics_snapshots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id         uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  computed_at        timestamptz NOT NULL DEFAULT now(),

  -- Cohort shape. student_count counts students with >=1 session on this
  -- subject, NOT every enrolled student — analytics can only speak about
  -- students who have generated data.
  student_count      integer NOT NULL DEFAULT 0,
  session_count      integer NOT NULL DEFAULT 0,
  attempt_count      integer NOT NULL DEFAULT 0,

  -- Attempt-weighted across all students, 0..1. NULL when there are no
  -- attempts — distinct from 0, which would read as "the cohort got
  -- everything wrong". Same shared math as the student's own mastery
  -- aggregate (src/lib/assessment/aggregation.ts).
  aggregate_accuracy numeric,

  -- [{module_id, module_name, module_number, accuracy, attempts, students_count}]
  per_module         jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- [{question_id, times_served, times_correct, accuracy, discrimination,
  --   avg_time_seconds}] — BANK questions only (attempts carrying a non-null
  --   question_id). Ad-hoc generated questions have no persistent identity
  --   across sessions, so item analysis on them would be averaging different
  --   questions together. discrimination is null below the 5-attempt floor.
  per_question       jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- [{co_code, weighted_accuracy, attempts, contributing_modules[]}]
  -- The NAAC-facing metric: CO attainment computed from what students actually
  -- scored, not from question-paper coverage.
  co_attainment      jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- {weekly_active_students[8], streak_distribution, practice_frequency_median}
  engagement         jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE faculty_analytics_snapshots IS
  'Per-subject cached analytics aggregates for the faculty dashboard. One row '
  'per subject (subject_id UNIQUE) — analytics is a property of the cohort, '
  'not of the viewer, so there are deliberately no per-faculty snapshots. '
  'Refreshed by POST /api/cron/refresh-analytics-snapshots daily and inline on '
  'read when older than 2h. See 20260728000000_faculty_analytics_snapshots.sql.';

-- One snapshot per subject. Named constraint (not an inline UNIQUE) so the
-- upsert in refreshSnapshot() can target it by name and so this migration is
-- re-runnable per §19.
ALTER TABLE faculty_analytics_snapshots
  DROP CONSTRAINT IF EXISTS faculty_analytics_snapshots_subject_id_key;
ALTER TABLE faculty_analytics_snapshots
  ADD CONSTRAINT faculty_analytics_snapshots_subject_id_key UNIQUE (subject_id);

-- The staleness sweep (cron + inline check) orders by computed_at.
CREATE INDEX IF NOT EXISTS idx_fas_computed_at
  ON faculty_analytics_snapshots(computed_at);

DROP TRIGGER IF EXISTS faculty_analytics_snapshots_updated_at
  ON faculty_analytics_snapshots;
CREATE TRIGGER faculty_analytics_snapshots_updated_at
  BEFORE UPDATE ON faculty_analytics_snapshots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─── 2. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE faculty_analytics_snapshots ENABLE ROW LEVEL SECURITY;

-- Superadmin: full access, including the writes the cron performs when it runs
-- under a service-role client (which bypasses RLS anyway — this policy is for
-- a superadmin browser session).
DROP POLICY IF EXISTS "fas_all_superadmin" ON faculty_analytics_snapshots;
CREATE POLICY "fas_all_superadmin" ON faculty_analytics_snapshots
  FOR ALL USING (get_my_role() = 'superadmin');

-- Faculty: read only, and only for subjects they are actually assigned to.
-- Mirrors stm_select_faculty_assigned on student_topic_mastery, EXCEPT that
-- this one does not fold dean/hod into the same clause — they get their own
-- scoped policy below rather than a blanket pass.
DROP POLICY IF EXISTS "fas_select_faculty_assigned" ON faculty_analytics_snapshots;
CREATE POLICY "fas_select_faculty_assigned" ON faculty_analytics_snapshots
  FOR SELECT USING (
    get_my_role() = 'faculty'
    AND EXISTS (
      SELECT 1 FROM faculty_assignments fa
      WHERE fa.subject_id = faculty_analytics_snapshots.subject_id
        AND fa.faculty_id = auth.uid()
    )
  );

-- Dean/HOD: read only, scoped through role_scope → subjects.
--   role_scope.school     matches subjects.school
--   role_scope.department NULL  → the entire school (dean shape)
--   role_scope.department SET   → that department only (hod shape)
-- No role_scope row → no rows returned. Fail closed, deliberately.
DROP POLICY IF EXISTS "fas_select_oversight_scoped" ON faculty_analytics_snapshots;
CREATE POLICY "fas_select_oversight_scoped" ON faculty_analytics_snapshots
  FOR SELECT USING (
    get_my_role() IN ('dean','hod')
    AND EXISTS (
      SELECT 1
      FROM role_scope rs
      JOIN subjects s ON s.id = faculty_analytics_snapshots.subject_id
      WHERE rs.user_id = auth.uid()
        AND rs.school = s.school
        AND (rs.department IS NULL OR rs.department = s.department)
    )
  );

-- No student policy of any kind. A student SELECT returns [] with no error
-- (PostgREST's behaviour when no policy matches — §14). There is no student
-- read of cohort aggregates: the student-facing peer stat (CP-Q3 Part 4) is a
-- single floored integer computed per question, and is the only cohort-derived
-- number a student is ever shown.
