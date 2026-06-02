-- ============================================================================
-- Structured syllabus management
--
-- Adds CO/PO/PSO mapping, BTL levels, exam scheme, and per-module
-- weightage/hours so a single syllabus page can be the source of truth.
-- ============================================================================

-- ─── Modules: per-module structural metadata ────────────────────────────────
ALTER TABLE modules ADD COLUMN IF NOT EXISTS hours integer;
ALTER TABLE modules ADD COLUMN IF NOT EXISTS weightage_percent numeric(5,2);
ALTER TABLE modules ADD COLUMN IF NOT EXISTS section_number integer;  -- 1 = Section I, 2 = Section II, ...
ALTER TABLE modules ADD COLUMN IF NOT EXISTS btl_levels text[];        -- e.g. ARRAY['Remember','Understand','Apply']

-- ─── Course outcomes ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS course_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid REFERENCES subjects(id) ON DELETE CASCADE,
  co_code text NOT NULL,
  description text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_course_outcomes_subject ON course_outcomes(subject_id);

ALTER TABLE course_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read course_outcomes" ON course_outcomes;
CREATE POLICY "Anyone can read course_outcomes" ON course_outcomes FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins manage course_outcomes" ON course_outcomes;
CREATE POLICY "Admins manage course_outcomes" ON course_outcomes FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);

-- ─── CO ↔ PO mapping ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS co_po_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid REFERENCES subjects(id) ON DELETE CASCADE,
  co_code text NOT NULL,
  po_code text NOT NULL,
  strength integer CHECK (strength IN (1,2,3))
);
CREATE INDEX IF NOT EXISTS idx_co_po_mapping_subject ON co_po_mapping(subject_id);

ALTER TABLE co_po_mapping ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read co_po_mapping" ON co_po_mapping;
CREATE POLICY "Anyone can read co_po_mapping" ON co_po_mapping FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins manage co_po_mapping" ON co_po_mapping;
CREATE POLICY "Admins manage co_po_mapping" ON co_po_mapping FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);

-- ─── CO ↔ PSO mapping ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS co_pso_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid REFERENCES subjects(id) ON DELETE CASCADE,
  co_code text NOT NULL,
  pso_code text NOT NULL,
  strength integer CHECK (strength IN (1,2,3))
);
CREATE INDEX IF NOT EXISTS idx_co_pso_mapping_subject ON co_pso_mapping(subject_id);

ALTER TABLE co_pso_mapping ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read co_pso_mapping" ON co_pso_mapping;
CREATE POLICY "Anyone can read co_pso_mapping" ON co_pso_mapping FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins manage co_pso_mapping" ON co_pso_mapping;
CREATE POLICY "Admins manage co_pso_mapping" ON co_pso_mapping FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);

-- ─── Exam scheme (one row per subject) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS exam_scheme (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid REFERENCES subjects(id) ON DELETE CASCADE UNIQUE,
  theory_ce integer,
  theory_ese integer,
  practical_ce integer,
  practical_ese integer,
  tutorial_marks integer,
  total_marks integer,
  credits integer
);
CREATE INDEX IF NOT EXISTS idx_exam_scheme_subject ON exam_scheme(subject_id);

ALTER TABLE exam_scheme ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read exam_scheme" ON exam_scheme;
CREATE POLICY "Anyone can read exam_scheme" ON exam_scheme FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins manage exam_scheme" ON exam_scheme;
CREATE POLICY "Admins manage exam_scheme" ON exam_scheme FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);

-- ─── subject_content: add practicals as structured array ────────────────────
-- Stores array of { sr_no, name, hours }
ALTER TABLE subject_content
  ADD COLUMN IF NOT EXISTS practicals jsonb DEFAULT '[]'::jsonb;
