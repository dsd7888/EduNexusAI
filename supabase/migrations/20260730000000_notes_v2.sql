-- ============================================================================
-- CP-N1 Part 1 — study_notes (Notes v2)
--
-- WHAT THIS IS: versioned, typed study material for one module (CP-N1) or one
-- subject (CP-N2). `blocks` holds an array of discriminated-union NoteBlocks —
-- concept / formula / comparison — not markdown. See src/lib/notes/types.ts;
-- the TypeScript union, the Gemini responseSchema and the generation prompt all
-- describe the same shape, deliberately (§19 narrow-schema rule).
--
-- WHY A DEDICATED TABLE AND NOT semantic_cache (what v1 did):
--   v1 wrote quick notes into semantic_cache keyed 'QUICK_NOTES_SUBJECT_<id>'.
--   semantic_cache is a QUERY cache: rows are keyed by an embedded question,
--   scored by cosine similarity, and evicted on hit_count/last_used_at. Study
--   material is none of those things — it is durable, versioned, regenerable
--   content whose identity is (subject, module, scope), not a similarity match.
--   Storing it there gave it no version, no staleness signal, no regenerate
--   path, and made its spend indistinguishable from chat spend in ai_call_logs.
--
-- WHY NOT generated_content:
--   Considered and rejected. generated_content is file-artefact oriented
--   (file_path, answer_key_path, a build status machine) and its `type` enum
--   already carries 'visual_notes'/'refined_notes' residue from earlier design
--   iterations. Notes v2 stores structured JSON with hash-based invalidation
--   and its own versioning — a different lifecycle, so a different table.
--
-- WHY content_hash AND is_stale BOTH EXIST (they are not redundant):
--   content_hash is the SOURCE OF TRUTH for freshness: a cached row may only be
--   served when its hash equals the hash of the current syllabus source. is_stale
--   is a human/faculty-driven override — a faculty member can flag notes as poor
--   quality and force regeneration even though the syllabus never changed. A row
--   is servable only when is_stale = false AND the hash matches. Never treat
--   is_stale = false alone as "fresh" (see generateModuleNotes step 3).
--
-- Apply manually (Supabase SQL editor). Safe to re-run: CREATE TABLE IF NOT
-- EXISTS, DROP POLICY IF EXISTS → CREATE, DROP CONSTRAINT IF EXISTS → ADD
-- (§19 idempotency rule).
-- ============================================================================


-- ─── 1. The table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS study_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id      uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,

  -- NULL for scope='subject' (CP-N2). The CHECK below ties the two together so
  -- a module-scope row without a module — or a subject-scope row with one — is
  -- unrepresentable rather than merely discouraged.
  module_id       uuid REFERENCES modules(id) ON DELETE CASCADE,
  scope           text NOT NULL,

  -- Monotonic per (subject, module, scope). Regeneration inserts version = max+1
  -- and never updates in place: an old version stays readable while the new one
  -- generates, and a bad regeneration can be rolled back by flipping is_stale.
  version         integer NOT NULL DEFAULT 1,

  -- Hash of the stable serialisation of the syllabus source these blocks were
  -- generated from (module_number + name + description + the subject_content
  -- section). Cached reads are contingent on this matching.
  content_hash    text NOT NULL,

  -- NoteBlock[] — see src/lib/notes/types.ts. Text only: no image or diagram
  -- fields. Visuals come from CP4's Visualize pipeline on demand (CP-N4 puts a
  -- chip on each block); baking them in here would make every regeneration pay
  -- image cost for visuals most students never open.
  blocks          jsonb NOT NULL,

  -- {syllabusVersion, generatedAt, model, batchIds}
  source_metadata jsonb,

  is_stale        boolean NOT NULL DEFAULT false,

  generated_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  tokens_used     integer,
  cost_inr        numeric,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE study_notes IS
  'Notes v2: versioned typed content blocks (concept/formula/comparison) per '
  'module or subject. Replaces the v1 quick-notes path that stored markdown in '
  'semantic_cache. A row is servable only when is_stale = false AND '
  'content_hash matches the current source hash. See CP_N1_NOTES_ENGINE.md.';

COMMENT ON COLUMN study_notes.blocks IS
  'NoteBlock[] discriminated union, validated against src/lib/notes/types.ts '
  'before insert. Text only — no image/diagram fields by design.';


-- ─── 2. Constraints ─────────────────────────────────────────────────────────

-- Named, DROP-then-ADD, so this migration is re-runnable (§19 / §17).
ALTER TABLE study_notes DROP CONSTRAINT IF EXISTS study_notes_scope_check;
ALTER TABLE study_notes
  ADD CONSTRAINT study_notes_scope_check CHECK (scope IN ('module', 'subject'));

-- The scope/module_id invariant. Without this, a 'module' row with a NULL
-- module_id would silently behave like a subject-scope row and collide with
-- CP-N2's rows in every lookup.
ALTER TABLE study_notes DROP CONSTRAINT IF EXISTS study_notes_scope_module_check;
ALTER TABLE study_notes
  ADD CONSTRAINT study_notes_scope_module_check CHECK (
    (scope = 'module'  AND module_id IS NOT NULL) OR
    (scope = 'subject' AND module_id IS NULL)
  );

ALTER TABLE study_notes DROP CONSTRAINT IF EXISTS study_notes_version_check;
ALTER TABLE study_notes
  ADD CONSTRAINT study_notes_version_check CHECK (version >= 1);

-- UNIQUE(subject_id, module_id, scope, version) — but expressed as TWO PARTIAL
-- UNIQUE INDEXES rather than one table constraint, deliberately.
--
-- A plain UNIQUE over those four columns does NOT constrain subject-scope rows:
-- SQL treats NULLs as distinct in unique constraints, so every scope='subject'
-- row (module_id NULL) would be trivially unique and CP-N2 could insert version
-- 1 twice with nothing complaining. Postgres 15 added UNIQUE NULLS NOT DISTINCT
-- to fix exactly this, but the deployed PG major version is not pinned anywhere
-- in this repo, so these two partial indexes get the same guarantee on any
-- version.
DROP INDEX IF EXISTS study_notes_module_version_key;
CREATE UNIQUE INDEX study_notes_module_version_key
  ON study_notes (subject_id, module_id, scope, version)
  WHERE module_id IS NOT NULL;

DROP INDEX IF EXISTS study_notes_subject_version_key;
CREATE UNIQUE INDEX study_notes_subject_version_key
  ON study_notes (subject_id, scope, version)
  WHERE module_id IS NULL;


-- ─── 3. Indexes ─────────────────────────────────────────────────────────────

-- The read path: "current notes for this module at this scope".
CREATE INDEX IF NOT EXISTS idx_study_notes_subject_module_scope
  ON study_notes (subject_id, module_id, scope);

-- Partial: the stale set is the regeneration worklist and is expected to stay
-- small, so indexing only the true rows keeps this cheap to maintain.
CREATE INDEX IF NOT EXISTS idx_study_notes_stale
  ON study_notes (is_stale) WHERE is_stale = true;


-- ─── 4. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE study_notes ENABLE ROW LEVEL SECURITY;

-- Superadmin: full access (§14, as everywhere).
DROP POLICY IF EXISTS "study_notes_all_superadmin" ON study_notes;
CREATE POLICY "study_notes_all_superadmin" ON study_notes
  FOR ALL USING (get_my_role() = 'superadmin');

-- Students: read notes for any subject OFFERED TO THEIR BRANCH.
--
-- NOTE, because this diverges from a literal reading of the CP-N1 spec: the
-- spec described joining profiles.branch/semester against subjects.branch/
-- semester. subjects still carries those columns, but they are legacy — since
-- 20260717000000_subject_offerings.sql the authoritative student→subject path
-- is subject_offerings, precisely so one syllabus can be reused across branches.
-- Reading subjects.branch here would give the wrong answer for any reused
-- subject.
--
-- Branch only, NOT branch+semester: useStudentSubjects filters offerings by
-- branch alone (semester is a readiness gate there, not a filter) and the
-- subjects page has always shown every semester of the student's branch. Adding
-- a semester predicate here would make notes unreadable for subjects whose cards
-- the student can already see — RLS stricter than the UI is a 403 with no
-- explanation.
DROP POLICY IF EXISTS "study_notes_select_student_branch" ON study_notes;
CREATE POLICY "study_notes_select_student_branch" ON study_notes
  FOR SELECT USING (
    get_my_role() = 'student'
    AND EXISTS (
      SELECT 1
      FROM subject_offerings so
      WHERE so.subject_id = study_notes.subject_id
        AND so.branch = (SELECT p.branch FROM profiles p WHERE p.id = auth.uid())
    )
  );

-- Faculty: read for subjects they are actually assigned to. faculty_assignments
-- ONLY — not school, not branch, not department (§4).
DROP POLICY IF EXISTS "study_notes_select_faculty_assigned" ON study_notes;
CREATE POLICY "study_notes_select_faculty_assigned" ON study_notes
  FOR SELECT USING (
    get_my_role() = 'faculty'
    AND EXISTS (
      SELECT 1 FROM faculty_assignments fa
      WHERE fa.subject_id = study_notes.subject_id
        AND fa.faculty_id = auth.uid()
    )
  );

-- Dean/HOD: read scoped through role_scope → subjects, mirroring CP-Q4's
-- fas_select_oversight_scoped. They are faculty-tier for routing (§4) but
-- typically hold no faculty_assignments rows, so folding them into the policy
-- above would silently give them nothing.
DROP POLICY IF EXISTS "study_notes_select_oversight_scoped" ON study_notes;
CREATE POLICY "study_notes_select_oversight_scoped" ON study_notes
  FOR SELECT USING (
    get_my_role() IN ('dean', 'hod')
    AND EXISTS (
      SELECT 1
      FROM role_scope rs
      JOIN subjects s ON s.id = study_notes.subject_id
      WHERE rs.user_id = auth.uid()
        AND rs.school = s.school
        AND (rs.department IS NULL OR rs.department = s.department)
    )
  );

-- Faculty tier: UPDATE, to flag notes for regeneration (CP-N2's flow).
--
-- RLS chooses WHICH ROWS are updatable; it cannot restrict WHICH COLUMNS —
-- an UPDATE policy's WITH CHECK sees only the new row and cannot compare it to
-- the old one, so "only is_stale may change" is not expressible as a policy.
-- Column-level GRANTs are the mechanism that actually enforces that, and both
-- layers are required: the GRANT below without the policy would let any faculty
-- flag any subject's notes.
DROP POLICY IF EXISTS "study_notes_update_faculty_stale" ON study_notes;
CREATE POLICY "study_notes_update_faculty_stale" ON study_notes
  FOR UPDATE USING (
    (
      get_my_role() = 'faculty'
      AND EXISTS (
        SELECT 1 FROM faculty_assignments fa
        WHERE fa.subject_id = study_notes.subject_id
          AND fa.faculty_id = auth.uid()
      )
    )
    OR (
      get_my_role() IN ('dean', 'hod')
      AND EXISTS (
        SELECT 1
        FROM role_scope rs
        JOIN subjects s ON s.id = study_notes.subject_id
        WHERE rs.user_id = auth.uid()
          AND rs.school = s.school
          AND (rs.department IS NULL OR rs.department = s.department)
      )
    )
  )
  WITH CHECK (true);

-- Supabase grants table-wide privileges to `authenticated` by default and
-- relies on RLS as the gate. Narrow UPDATE to the single column faculty are
-- allowed to touch, so a faculty session cannot rewrite `blocks` directly and
-- bypass generation. INSERT/DELETE are not granted at all: every write goes
-- through the generator on an adminClient (service role bypasses RLS).
REVOKE UPDATE ON study_notes FROM authenticated;
GRANT  UPDATE (is_stale) ON study_notes TO authenticated;
GRANT  SELECT ON study_notes TO authenticated;

-- No anon policy of any kind. An anon SELECT returns [] with no error
-- (PostgREST's behaviour when no policy matches — §14).


-- ═══ 5. DATA CLEANUP — retire the v1 quick-notes cache rows ═════════════════
--
-- The v1 path (deleted in CP-N1 Part 0) wrote generated markdown into
-- semantic_cache under 'QUICK_NOTES_SUBJECT_<id>' / 'QUICK_NOTES_MODULE_<id>'.
-- Those rows are now unreachable — nothing reads that key prefix — and they
-- pollute the cache's hit-rate statistics, so remove them.
--
-- Measured 0 matching rows on the dev database at time of writing (9 rows total,
-- all genuine chat cache). The v1 insert sat inside a log-only try/catch and
-- appears to have been failing silently since it shipped. Kept anyway: this
-- migration also has to run against prod, where the count may differ.
DO $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM semantic_cache WHERE query_text LIKE 'QUICK_NOTES_%';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RAISE NOTICE 'Notes v2 cleanup: deleted % semantic_cache row(s) with a QUICK_NOTES_ prefix.', deleted_count;
END $$;
