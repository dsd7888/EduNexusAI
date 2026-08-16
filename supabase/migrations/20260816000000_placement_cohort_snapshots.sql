-- ============================================================================
-- CP-G1 — placement_cohort_snapshots
--
-- WHAT THIS IS: one row PER COHORT PER CALENDAR DAY, holding the cohort's
-- average placement-readiness dimensions at that point in time. This is the
-- ONLY table in the placement module that is append-only-by-day rather than
-- upserted-in-place — it exists specifically so a "readiness lift over time"
-- chart on the TPO dashboard has history to draw a line through. Every other
-- placement table (student_placement_profiles etc.) only ever holds current
-- state; this one is the deliberate exception, and its only job.
--
-- WHY A NEW TABLE AND NOT faculty_analytics_snapshots (CP-Q4):
--   That table is a single latest-row-per-subject cache (subject_id UNIQUE,
--   upserted in place) for ASSESSMENT analytics (quiz attempts, CO
--   attainment). It intentionally throws away history — see its own header,
--   "one refresh serves many faculty views". Placement's cohort trend needs
--   the opposite property: every day's row must be RETAINED, not overwritten,
--   or there is nothing to compute a lift from. Reusing that table (or its
--   column shape) would mean either losing history or repurposing a table
--   another feature owns; a dedicated table keeps the two domains (assessment
--   vs. placement) and their two very different retention needs separate, per
--   CLAUDE_CONTEXT's existing scoping ("Analytics is scoped to assessment...
--   cross-feature aggregation is an explicit non-goal").
--
-- COHORT GRANULARITY — branch, plus one institution-wide row per day:
--   branch = one of the codes in src/lib/constants/branches.ts (CSE, IT, ...),
--   OR the sentinel 'ALL' for the whole institution. 'ALL' is NOT the same
--   concept as archetypes.ts's 'ANY' branch (a branch-agnostic archetype
--   fallback) — this is "every branch pooled together", a different meaning
--   in a different domain, spelled differently on purpose so nobody conflates
--   the two.  branch is NOT NULL with a sentinel (rather than NULL meaning
--   "all") specifically so a plain UNIQUE(branch, snapshot_date) constraint
--   works, and so PostgREST's upsert(..., {onConflict:"branch,snapshot_date"})
--   has a real column-list constraint to target — a NULL-inclusive expression
--   index would not be upsertable through PostgREST.
--
-- WHAT COUNTS AS "THE COHORT" FOR AN AVERAGE — mirrors the existing TPO
-- dashboard's own definition (src/app/api/placement/tpo/dashboard/route.ts:
-- `students.filter(s => s.readiness_overall > 0)`, called "started" there):
-- only students who have begun placement prep (readiness_overall > 0)
-- contribute to the dimension averages. student_count on this row records
-- that same "started" count, and is what the privacy floor
-- (MIN_COHORT_FOR_AGGREGATE, src/lib/analytics/privacy.ts) is checked against
-- at read time, in the response layer — never at write time — matching
-- CP-Q4's suppressAggregates() precedent: the stored row stays truthful for
-- cron/debugging and a cohort that crosses the floor becomes visible on its
-- next read without a recompute.
--
-- WRITE PATH (not built in this checkpoint — HALT before code per SPEC §9,
-- this migration is the whole of CP-G1): a future extension of
-- api/cron/refresh-analytics-snapshots (or a sibling nightly route) computes
-- one row per branch with any "started" students, plus one 'ALL' row, and
-- upserts on (branch, snapshot_date) so a same-day rerun does not create a
-- duplicate day.
--
-- Apply manually (Supabase SQL editor). Safe to re-run: CREATE TABLE IF NOT
-- EXISTS, DROP POLICY IF EXISTS → CREATE, DROP CONSTRAINT IF EXISTS → ADD
-- (§19 idempotency rule).
-- ============================================================================


-- ─── 1. The table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS placement_cohort_snapshots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One of src/lib/constants/branches.ts's BRANCHES codes, or 'ALL' for the
  -- whole institution pooled. No CHECK against the branch list: branches.ts
  -- is deliberately the single source of truth and is edited in code with no
  -- DB-backed lookup table (see that file's own header comment) — the same
  -- "kept minimal" choice `profiles.branch` and `subjects.branch` already
  -- made, extended here rather than re-litigated.
  branch             text NOT NULL,

  -- Calendar day this snapshot represents (not a timestamp) — the lift chart
  -- plots one point per day, not per refresh. If the nightly cron runs
  -- multiple times for the same day (a retry, a manual re-trigger), the
  -- UNIQUE constraint below plus an upsert overwrites that day's row rather
  -- than creating a second point for it.
  snapshot_date      date NOT NULL,
  computed_at        timestamptz NOT NULL DEFAULT now(),

  -- Students in this cohort with readiness_overall > 0 ("started" placement
  -- prep) at compute time — the same population the averages below are drawn
  -- from, and what the MIN_COHORT_FOR_AGGREGATE floor is checked against when
  -- the dashboard reads this row. NOT every enrolled student in the branch;
  -- analytics can only speak about students who generated data (same
  -- rationale as faculty_analytics_snapshots.student_count).
  student_count      integer NOT NULL DEFAULT 0,

  -- Cohort averages, 0..100, matching student_placement_profiles.readiness_*'s
  -- own scale. NULL (never 0) when student_count = 0 — 0 would read as "this
  -- cohort scored zero", which is a different fact from "no one has started".
  avg_aptitude       numeric,
  avg_verbal         numeric,
  avg_domain         numeric,
  avg_coding         numeric,
  avg_communication  numeric,
  avg_overall        numeric,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE placement_cohort_snapshots IS
  'One row per (branch, calendar day) — or branch = ALL for the whole '
  'institution — holding that cohort''s average placement-readiness '
  'dimensions on that day. Append-only-by-day (upserted only within the same '
  'day) so the TPO dashboard''s readiness-lift-over-time chart has real '
  'history to draw a line through. See 20260816000000_placement_cohort_snapshots.sql.';

-- One row per cohort per day. Named constraint so a future upsert can target
-- it by name and so this migration stays re-runnable per §19.
ALTER TABLE placement_cohort_snapshots
  DROP CONSTRAINT IF EXISTS placement_cohort_snapshots_branch_date_key;
ALTER TABLE placement_cohort_snapshots
  ADD CONSTRAINT placement_cohort_snapshots_branch_date_key UNIQUE (branch, snapshot_date);

-- The lift chart reads "last N days for this branch, oldest first" — this is
-- the query that index serves. UNIQUE above already covers (branch,
-- snapshot_date) lookups; this covers "every branch's row for a day range".
CREATE INDEX IF NOT EXISTS idx_pcs_snapshot_date
  ON placement_cohort_snapshots(snapshot_date);

DROP TRIGGER IF EXISTS placement_cohort_snapshots_updated_at
  ON placement_cohort_snapshots;
CREATE TRIGGER placement_cohort_snapshots_updated_at
  BEFORE UPDATE ON placement_cohort_snapshots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─── 2. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE placement_cohort_snapshots ENABLE ROW LEVEL SECURITY;

-- Mirrors the existing TPO dashboard's own access model exactly
-- (src/app/api/placement/tpo/dashboard/route.ts: requireRole(["superadmin",
-- "dean", "hod"]), unscoped by branch/school — that route lets any of the
-- three roles pass a `branch` query param freely today). This table's RLS
-- matches that real access model rather than inventing a stricter
-- role_scope-based scoping the live dashboard doesn't itself enforce; adding
-- that scoping would be a product decision for a future checkpoint, not a
-- schema-migration concern to smuggle in here.
--
-- In practice the dashboard route reads through requireRole()'s adminClient
-- (service role, bypasses RLS) with the role check already done in the app
-- layer — same as every other adminClient route per CLAUDE.md. This policy
-- is the defense-in-depth backstop for any direct/future client-side read,
-- consistent with every other table in this codebase carrying RLS regardless
-- of whether today's only reader happens to be a service-role route.
DROP POLICY IF EXISTS "pcs_select_tpo_roles" ON placement_cohort_snapshots;
CREATE POLICY "pcs_select_tpo_roles" ON placement_cohort_snapshots
  FOR SELECT USING (get_my_role() IN ('superadmin', 'dean', 'hod'));

-- Superadmin: full access, including writes for a superadmin browser session
-- (the cron itself runs under the service role, which bypasses RLS).
DROP POLICY IF EXISTS "pcs_all_superadmin" ON placement_cohort_snapshots;
CREATE POLICY "pcs_all_superadmin" ON placement_cohort_snapshots
  FOR ALL USING (get_my_role() = 'superadmin');

-- No student or faculty policy of any kind. A student/faculty SELECT returns
-- [] with no error (PostgREST's behaviour when no policy matches — §14).
-- Cohort-level placement readiness is a TPO/management surface only; no
-- student-facing surface in this build reads cross-student placement data.
