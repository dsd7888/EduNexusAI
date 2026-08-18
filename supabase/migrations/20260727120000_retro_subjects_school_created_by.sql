-- ============================================================================
-- RETROACTIVE — document live schema that no migration ever created
--
-- READ THIS FIRST: this migration does not CREATE anything on the live pilot
-- database. `subjects.school` and `subjects.created_by` are ALREADY THERE.
-- They were added directly through the Supabase SQL editor at some point and
-- never written down. This file's job is to make a fresh environment (a new
-- Supabase project, a local `supabase start`, a restored branch) match the
-- live one, and to make the columns findable by someone grepping migrations
-- for where they came from.
--
-- WHY IT MATTERS NOW: CP-Q4's dean/hod analytics RLS policy joins
-- `subjects.school` against `role_scope.school`. As of this migration that is
-- a load-bearing dependency on a column with no recorded origin. If a fresh
-- environment were built from the migration history alone, the CP-Q4 migration
-- would fail on a missing column and the failure would look like a CP-Q4 bug
-- rather than a five-month-old undocumented ALTER.
--
-- This is the schema-drift class §14 warns about, from the other direction:
-- §14 covers RLS policies invisible in migration files ("check pg_policies,
-- not migration files, to verify live RLS state"). Same root cause — the SQL
-- editor runs as postgres and leaves no artefact in the repo — but columns
-- rather than policies.
--
-- Deliberately its own migration, NOT folded into
-- 20260728000000_faculty_analytics_snapshots.sql: that file creates new
-- structure and this one records existing structure. Merging them would leave
-- a future reader unable to tell which columns CP-Q4 introduced and which it
-- merely started depending on.
--
-- Fully idempotent and a strict no-op against the live database. Safe to run
-- anywhere, any number of times.
-- ============================================================================


-- `school` — the institution's top-level org unit. NULLABLE on purpose: it is
-- nullable live, and backfilling/NOT NULL-ing it is a data decision, not a
-- schema-documentation one. Every live row currently reads
-- 'School of Engineering' (single-school pilot), but the dean/hod scope check
-- is written for the general case.
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS school text;

-- `created_by` — who created the subject. Nullable because seeded subjects
-- have no creating user, the same reason subject_content.created_by is
-- nullable (§19).
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES profiles(id);

COMMENT ON COLUMN subjects.school IS
  'Top-level org unit. Joined against role_scope.school by the dean/hod '
  'analytics RLS policy (CP-Q4). Added live via SQL editor before any '
  'migration existed; recorded retroactively in '
  '20260727120000_retro_subjects_school_created_by.sql.';

CREATE INDEX IF NOT EXISTS idx_subjects_school ON subjects(school);
