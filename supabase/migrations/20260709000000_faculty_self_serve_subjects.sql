-- Faculty self-serve syllabus upload + forced password change.
--
-- PART A of the pre-pilot UI change: faculty add their own subjects (up to 5) by
-- uploading a syllabus PDF. This migration adds the provenance column, an admin-only
-- audit log of faculty subject changes, and the forced-password-change flag.

-- ── subjects.created_by ───────────────────────────────────────────────────────
-- Nullable: existing superadmin-seeded subjects legitimately have this NULL. Only
-- rows a faculty creates via the self-serve upload get stamped with their id.
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- ── subject_change_log ────────────────────────────────────────────────────────
-- Admin-visible history of faculty subject changes. SET NULL + snapshot columns,
-- same pattern as ai_call_logs/user_sessions: deactivating a faculty account (or
-- deleting a subject) later must not erase this history, so we snapshot the human
-- identifiers at write time.
CREATE TABLE subject_change_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  faculty_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  faculty_email_snapshot TEXT NOT NULL,

  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  subject_code_snapshot TEXT NOT NULL,
  subject_name_snapshot TEXT NOT NULL,

  action TEXT NOT NULL CHECK (action IN ('added_new', 'assigned_existing', 'removed')),
  -- 'added_new'        : faculty uploaded a syllabus that created a brand-new subject.
  -- 'assigned_existing': faculty picked/typed a code that already existed; they were
  --                      attached directly, no new subject/extraction happened.
  -- 'removed'          : faculty removed their OWN assignment. NEVER deletes the
  --                      underlying subject/modules/CO data, only their link to it.

  metadata JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX idx_subject_change_log_faculty ON subject_change_log(faculty_id);
CREATE INDEX idx_subject_change_log_subject ON subject_change_log(subject_id);
CREATE INDEX idx_subject_change_log_created_at ON subject_change_log(created_at);

ALTER TABLE subject_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins see subject change log" ON subject_change_log FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);
CREATE POLICY "Service role full access subject change log" ON subject_change_log FOR ALL TO service_role USING (true);
-- No faculty-facing read/write policy: every write goes through adminClient in the
-- faculty routes, which sets faculty_id/faculty_email_snapshot explicitly.

-- ── profiles.must_change_password ─────────────────────────────────────────────
-- Set true when faculty accounts are bulk-created (that script is separate). The
-- proxy gate redirects such users to /auth/change-password until they clear it.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
