-- ============================================================================
-- Syllabus Health Audit
--
-- ONE table + ONE bucket. Deliberately smaller than lesson_plans/lab_manuals,
-- because the audit itself is not a persisted artifact:
--
--   * Layer 1 (the deterministic checks) is computed from the live syllabus on
--     every request. Caching it would be strictly worse than recomputing it —
--     it is sub-millisecond, and a stale finding about a mapping the faculty
--     just fixed is exactly the trust-destroying bug this feature exists to
--     prevent.
--
--   * Layer 2 (the Flash suggestion call) IS worth caching: it costs money and
--     latency, and its input is the same syllabus. So only the AI proposals are
--     stored here, keyed on subject with a syllabus_fingerprint — the same
--     fingerprint-mismatch-is-a-miss pattern as lesson_plan_cache
--     (20260711000000). Edit the syllabus, the fingerprint changes, the next
--     suggest call regenerates rather than proposing fixes to a syllabus that
--     no longer exists.
--
-- UNIQUE (subject_id): unlike lab_manual_cache there is no per-practical or
-- per-difficulty axis — one subject has exactly one current set of proposals.
-- ============================================================================

CREATE TABLE IF NOT EXISTS syllabus_audit_cache (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id           uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  payload              jsonb NOT NULL,   -- validated Proposal[] + the AI findings
  syllabus_fingerprint text,             -- sha256 slice; NULL = always a miss
  generated_by         uuid REFERENCES profiles(id),
  model_used           text,
  created_at           timestamptz DEFAULT now(),
  UNIQUE (subject_id)
);

CREATE INDEX IF NOT EXISTS idx_syllabus_audit_cache_subject
  ON syllabus_audit_cache(subject_id);

-- ─── Row Level Security ─────────────────────────────────────────────────────
-- Same shape as lesson_plan_cache: faculty-tier read AND write, because any
-- assigned faculty may re-run suggestions for a subject they teach. Students
-- never touch this table — proposals describe gaps in the syllabus, which is
-- internal curriculum-quality data, not course content.
--
-- Server routes use the admin client and bypass these entirely; they are
-- defence-in-depth against a future direct-from-browser path.
ALTER TABLE syllabus_audit_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "syllabus_audit_cache_select_faculty_tier" ON syllabus_audit_cache;
CREATE POLICY "syllabus_audit_cache_select_faculty_tier" ON syllabus_audit_cache
  FOR SELECT USING (
    get_my_role() IN ('superadmin', 'dean', 'hod', 'faculty')
  );

DROP POLICY IF EXISTS "syllabus_audit_cache_write_faculty_tier" ON syllabus_audit_cache;
CREATE POLICY "syllabus_audit_cache_write_faculty_tier" ON syllabus_audit_cache
  FOR ALL USING (
    get_my_role() IN ('superadmin', 'dean', 'hod', 'faculty')
  );

-- ─── Private Storage bucket for the compliance report PDF ───────────────────
-- No review gate on this artifact (unlike the lab manual's instructor/solution
-- variants): a compliance report is a point-in-time snapshot of public-to-the-
-- department facts, not a controlled document. It is private only because it is
-- internal quality data, not because it contains answers.
INSERT INTO storage.buckets (id, name, public)
VALUES ('syllabus-audits', 'syllabus-audits', false)
ON CONFLICT (id) DO NOTHING;

-- Objects are keyed {faculty_id}/{...} — first path segment must match the
-- caller's auth.uid(), the same convention as lesson-plans and lab-manuals.
DROP POLICY IF EXISTS "syllabus_audits_storage_insert" ON storage.objects;
CREATE POLICY "syllabus_audits_storage_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'syllabus-audits'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "syllabus_audits_storage_select" ON storage.objects;
CREATE POLICY "syllabus_audits_storage_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'syllabus-audits'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "syllabus_audits_storage_delete" ON storage.objects;
CREATE POLICY "syllabus_audits_storage_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'syllabus-audits'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
