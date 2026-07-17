-- Faculty ↔ offering many-to-many.
--
-- faculty_assignments links a faculty to a subject's CONTENT (syllabus/modules/COs
-- are subject-level, so content access stays keyed by subject_id — unchanged). But a
-- faculty teaches specific OFFERINGS: the same subject can be taught in CSE-3 and
-- IT-3, and different faculty can teach different offerings of one subject. That
-- faculty↔offering relationship has no home in faculty_assignments (which is UNIQUE
-- per faculty+subject), so record it explicitly here.

CREATE TABLE faculty_offerings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject_offering_id UUID NOT NULL REFERENCES subject_offerings(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(faculty_id, subject_offering_id)
);

CREATE INDEX idx_faculty_offerings_faculty ON faculty_offerings(faculty_id);
CREATE INDEX idx_faculty_offerings_offering ON faculty_offerings(subject_offering_id);

-- RLS mirrors faculty_assignments: faculty read their own rows, admins manage,
-- service role (adminClient — every write path) has full access.
ALTER TABLE faculty_offerings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Faculty see own offerings" ON faculty_offerings;
CREATE POLICY "Faculty see own offerings" ON faculty_offerings
  FOR SELECT USING (faculty_id = auth.uid());

DROP POLICY IF EXISTS "Admins manage faculty_offerings" ON faculty_offerings;
CREATE POLICY "Admins manage faculty_offerings" ON faculty_offerings FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);

DROP POLICY IF EXISTS "Service role full access faculty_offerings" ON faculty_offerings;
CREATE POLICY "Service role full access faculty_offerings" ON faculty_offerings
  FOR ALL TO service_role USING (true);

-- Backfill: link every existing faculty_assignment to that subject's offering(s).
-- Today each subject has exactly one offering (see subject_offerings backfill), so
-- this is unambiguous — one faculty_offerings row per existing assignment.
INSERT INTO faculty_offerings (faculty_id, subject_offering_id, assigned_by)
SELECT fa.faculty_id, so.id, fa.assigned_by
FROM faculty_assignments fa
JOIN subject_offerings so ON so.subject_id = fa.subject_id
ON CONFLICT (faculty_id, subject_offering_id) DO NOTHING;
