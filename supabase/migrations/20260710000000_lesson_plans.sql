-- ============================================================================
-- Lesson Plan / Course File Generator
--
-- Faculty generate a session-wise lesson plan (the mandatory AICTE/NBA
-- course-file document) for an assigned subject. Two tables:
--
--   lesson_plan_cache — per-subject AI generation cache (cost control: the
--     first faculty to generate a subject/section pays; colleagues reuse the
--     cached payload instead of re-paying for the same Flash calls). One row
--     per (subject_id, section).
--
--   lesson_plans — per-faculty personal editable document (the LessonPlanDoc
--     jsonb). One row per (subject_id, faculty_id). Artifact columns store
--     Storage *paths* (not URLs) in the private `lesson-plans` bucket — signed
--     on demand, mirroring qpaper_history's confidential-answer-key convention.
--
-- RLS mirrors qpaper_history exactly (own OR superadmin/dean/hod oversight for
-- reads on lesson_plans). lesson_plan_cache is readable/writable by any
-- faculty-tier role: any assigned faculty may regenerate. get_my_role() is the
-- same SECURITY DEFINER helper used across the codebase (checkpointed in
-- 20260620000003_backfill_get_my_role.sql).
-- ============================================================================

-- ─── Per-subject AI generation cache ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lesson_plan_cache (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id   uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  section      text NOT NULL CHECK (section IN ('theory', 'practical')),
  payload      jsonb NOT NULL,
  generated_by uuid REFERENCES profiles(id),
  model_used   text,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (subject_id, section)
);

CREATE INDEX IF NOT EXISTS idx_lesson_plan_cache_subject ON lesson_plan_cache(subject_id);

-- ─── Per-faculty personal plan (the editable document) ──────────────────────
CREATE TABLE IF NOT EXISTS lesson_plans (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  faculty_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan       jsonb NOT NULL,
  status     text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  docx_path  text,
  pdf_path   text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (subject_id, faculty_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_plans_faculty ON lesson_plans(faculty_id);
CREATE INDEX IF NOT EXISTS idx_lesson_plans_subject ON lesson_plans(subject_id);

-- keep updated_at fresh on every write (same trigger fn used elsewhere)
DROP TRIGGER IF EXISTS lesson_plans_set_updated_at ON lesson_plans;
CREATE TRIGGER lesson_plans_set_updated_at
  BEFORE UPDATE ON lesson_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Row Level Security: lesson_plans ───────────────────────────────────────
-- Mirrors qpaper_history: read = own OR oversight; write = own only.
ALTER TABLE lesson_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lesson_plans_select_own_or_oversight" ON lesson_plans
  FOR SELECT USING (
    faculty_id = auth.uid()
    OR get_my_role() IN ('superadmin', 'dean', 'hod')
  );

CREATE POLICY "lesson_plans_insert_own" ON lesson_plans
  FOR INSERT WITH CHECK (faculty_id = auth.uid());

CREATE POLICY "lesson_plans_update_own" ON lesson_plans
  FOR UPDATE USING (faculty_id = auth.uid());

CREATE POLICY "lesson_plans_delete_own" ON lesson_plans
  FOR DELETE USING (faculty_id = auth.uid());

-- ─── Row Level Security: lesson_plan_cache ──────────────────────────────────
-- Read for all faculty-tier roles; write for faculty-tier (any assigned
-- faculty may regenerate). Server routes use the admin client and bypass these;
-- these are belt-and-suspenders for any future direct-client path.
ALTER TABLE lesson_plan_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lesson_plan_cache_select_faculty_tier" ON lesson_plan_cache
  FOR SELECT USING (
    get_my_role() IN ('superadmin', 'dean', 'hod', 'faculty')
  );

CREATE POLICY "lesson_plan_cache_write_faculty_tier" ON lesson_plan_cache
  FOR ALL USING (
    get_my_role() IN ('superadmin', 'dean', 'hod', 'faculty')
  );

-- ─── Private Storage bucket for exported artifacts ──────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('lesson-plans', 'lesson-plans', false)
ON CONFLICT (id) DO NOTHING;

-- All server-side artifact access goes through the service role (admin client)
-- and bypasses these checks; they are defence-in-depth against direct browser
-- storage calls. Objects are keyed {faculty_id}/{...} — first path segment must
-- match the caller's auth.uid() (same convention as question-images).
DROP POLICY IF EXISTS "lesson_plans_storage_insert" ON storage.objects;
CREATE POLICY "lesson_plans_storage_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lesson-plans'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "lesson_plans_storage_select" ON storage.objects;
CREATE POLICY "lesson_plans_storage_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'lesson-plans'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "lesson_plans_storage_delete" ON storage.objects;
CREATE POLICY "lesson_plans_storage_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'lesson-plans'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
