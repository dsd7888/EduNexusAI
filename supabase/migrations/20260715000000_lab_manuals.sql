-- ============================================================================
-- Lab Manual Generator
--
-- Faculty generate a term-work lab manual (the practical-side companion to the
-- lesson plan / course file) for an assigned subject. Two tables, mirroring
-- 20260710000000_lesson_plans.sql:
--
--   lab_manual_cache — per-PRACTICAL AI generation cache (cost control: the
--     first faculty to generate a practical pays; colleagues reuse the payload).
--     Keyed (subject_id, practical_no, difficulty) — the three difficulties of
--     one practical are distinct rows, not evictions of each other, so a faculty
--     switching difficulty doesn't destroy a colleague's cached version.
--
--   lab_manuals — per-faculty personal editable document (the LabManualDoc
--     jsonb). One row per (subject_id, faculty_id). Six artifact columns: the
--     {student,instructor,solutions} × {docx,pdf} matrix. All store Storage
--     *paths* (not URLs) in the private `lab-manuals` bucket — signed on demand,
--     per CLAUDE_CONTEXT §19 ("never store signed URLs in DB").
--
-- WHY THE LEARNING PATH IS NOT CACHED: it lives in lab_manuals.doc, per-faculty.
-- Two faculty may legitimately structure the same lab differently; a shared path
-- cache would let one faculty's pedagogical choices overwrite another's. Only
-- per-practical CONTENT — which is a function of the syllabus, not of teaching
-- style — is shared.
--
-- WHY THE CACHE IS FACULTY-TIER-ONLY: payload contains `solution` and
-- `conductGuide`. A student-readable policy here would leak every model answer
-- in the subject. Students never touch this table.
-- ============================================================================

-- ─── Per-practical AI generation cache ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_manual_cache (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id           uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  practical_no         int NOT NULL,
  difficulty           text NOT NULL DEFAULT 'standard'
                         CHECK (difficulty IN ('guided', 'standard', 'challenge')),
  payload              jsonb NOT NULL,          -- validated PracticalManualSection
  syllabus_fingerprint text,                    -- sha256 slice of (title|hours|language|sortedCOs)
  generated_by         uuid REFERENCES profiles(id),
  model_used           text,
  created_at           timestamptz DEFAULT now(),
  UNIQUE (subject_id, practical_no, difficulty)
);

CREATE INDEX IF NOT EXISTS idx_lab_manual_cache_subject ON lab_manual_cache(subject_id);

-- ─── Per-faculty personal manual (the editable document) ────────────────────
CREATE TABLE IF NOT EXISTS lab_manuals (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id             uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  faculty_id             uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  doc                    jsonb NOT NULL,
  status                 text NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'finalized')),
  student_docx_path      text,
  student_pdf_path       text,
  instructor_docx_path   text,
  instructor_pdf_path    text,
  solutions_docx_path    text,
  solutions_pdf_path     text,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now(),
  UNIQUE (subject_id, faculty_id)
);

CREATE INDEX IF NOT EXISTS idx_lab_manuals_faculty ON lab_manuals(faculty_id);
CREATE INDEX IF NOT EXISTS idx_lab_manuals_subject ON lab_manuals(subject_id);

-- keep updated_at fresh on every write (same trigger fn used elsewhere)
DROP TRIGGER IF EXISTS lab_manuals_set_updated_at ON lab_manuals;
CREATE TRIGGER lab_manuals_set_updated_at
  BEFORE UPDATE ON lab_manuals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Row Level Security: lab_manuals ────────────────────────────────────────
-- Mirrors lesson_plans / qpaper_history: read = own OR oversight; write = own.
ALTER TABLE lab_manuals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lab_manuals_select_own_or_oversight" ON lab_manuals
  FOR SELECT USING (
    faculty_id = auth.uid()
    OR get_my_role() IN ('superadmin', 'dean', 'hod')
  );

CREATE POLICY "lab_manuals_insert_own" ON lab_manuals
  FOR INSERT WITH CHECK (faculty_id = auth.uid());

CREATE POLICY "lab_manuals_update_own" ON lab_manuals
  FOR UPDATE USING (faculty_id = auth.uid());

CREATE POLICY "lab_manuals_delete_own" ON lab_manuals
  FOR DELETE USING (faculty_id = auth.uid());

-- ─── Row Level Security: lab_manual_cache ───────────────────────────────────
-- Faculty-tier only, read AND write: any assigned faculty may regenerate, and
-- the payload carries solutions + conduct guides that students must never read.
-- Server routes use the admin client and bypass these; they are defence-in-depth
-- against any future direct-client path.
ALTER TABLE lab_manual_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lab_manual_cache_select_faculty_tier" ON lab_manual_cache
  FOR SELECT USING (
    get_my_role() IN ('superadmin', 'dean', 'hod', 'faculty')
  );

CREATE POLICY "lab_manual_cache_write_faculty_tier" ON lab_manual_cache
  FOR ALL USING (
    get_my_role() IN ('superadmin', 'dean', 'hod', 'faculty')
  );

-- ─── Private Storage bucket for exported artifacts ──────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('lab-manuals', 'lab-manuals', false)
ON CONFLICT (id) DO NOTHING;

-- All server-side artifact access goes through the service role (admin client)
-- and bypasses these checks; they are defence-in-depth against direct browser
-- storage calls. Objects are keyed {faculty_id}/{...} — first path segment must
-- match the caller's auth.uid() (same convention as lesson-plans).
DROP POLICY IF EXISTS "lab_manuals_storage_insert" ON storage.objects;
CREATE POLICY "lab_manuals_storage_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lab-manuals'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "lab_manuals_storage_select" ON storage.objects;
CREATE POLICY "lab_manuals_storage_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'lab-manuals'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "lab_manuals_storage_delete" ON storage.objects;
CREATE POLICY "lab_manuals_storage_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'lab-manuals'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
