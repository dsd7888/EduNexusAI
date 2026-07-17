-- Split subject CONTENT (subjects: code, name, syllabus/modules/COs) from subject
-- OFFERING (which branch + semester it's taught in). Faculty self-serve upload
-- previously stamped every subject with fixed pilot constants (department/branch/
-- semester); the student pilot is expanding past single-branch/single-semester CSE,
-- and one faculty teaches multiple branches/semesters, so branch+semester must be
-- selectable per upload. The same syllabus content is often reused across branches
-- (e.g. "CS101" taught to both CSE-3 and IT-3) — subject_offerings lets that reuse
-- happen without re-running extraction/classification for a second branch.

-- ── Normalize existing branch values to short codes ────────────────────────────
-- Today the only value in use is the full name "Computer Science and Engineering"
-- (subjects, profiles, and the FIXED_BRANCH constant in the upload route). Leaving
-- both formats in play would silently break the new offering-based lookups for
-- existing CSE data, so normalize before backfilling offerings.
UPDATE subjects SET branch = 'CSE' WHERE branch = 'Computer Science and Engineering';
UPDATE profiles SET branch = 'CSE' WHERE branch = 'Computer Science and Engineering';

-- ── subject_offerings ────────────────────────────────────────────────────────────
CREATE TABLE subject_offerings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  branch TEXT NOT NULL,
  semester INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(subject_id, branch, semester)
);

CREATE INDEX idx_subject_offerings_branch_semester ON subject_offerings(branch, semester);
CREATE INDEX idx_subject_offerings_subject ON subject_offerings(subject_id);

-- RLS: public read (students resolve their subject list through this table via the
-- browser client), writes restricted to service_role — every write already goes
-- through adminClient in API routes (faculty upload, superadmin subjects/manage).
-- Policies use DROP IF EXISTS + CREATE so this block is safe to re-run.
ALTER TABLE subject_offerings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read subject_offerings" ON subject_offerings;
CREATE POLICY "Anyone can read subject_offerings"
  ON subject_offerings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role full access subject_offerings" ON subject_offerings;
CREATE POLICY "Service role full access subject_offerings"
  ON subject_offerings FOR ALL TO service_role USING (true);

-- ── Backfill: every existing subject becomes its own first offering ─────────────
INSERT INTO subject_offerings (subject_id, branch, semester)
SELECT id, branch, semester FROM subjects;
