-- ============================================================================
-- Structured PYQ extraction
--
-- One row per question (or sub-question) parsed from an uploaded PYQ paper.
-- Replaces raw chunk storage for PYQs by giving the generator high-signal
-- examples (per-question text + CO/BTL/PO/marks) instead of arbitrary text
-- windows. Falls back to document_chunks if extraction failed for a doc.
-- ============================================================================

CREATE TABLE IF NOT EXISTS pyq_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  section_name text,           -- "Section I", "Section II", "Section A"
  q_number text,               -- "Q-1", "Q-2", "Q-3(a)"
  question_text text NOT NULL,
  question_type text,          -- "mcq" | "numerical" | "descriptive" | "short" | "fill_blank"
  marks integer,
  co text,                     -- as printed, e.g. "03"
  btl integer,                 -- 1-6
  po text,                     -- as printed, e.g. "04"
  options jsonb,               -- MCQ only: {"a":..,"b":..,"c":..,"d":..}
  year integer,                -- parsed from document title/metadata
  is_or_alternative boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pyq_questions_subject
  ON pyq_questions(subject_id);
CREATE INDEX IF NOT EXISTS idx_pyq_questions_document
  ON pyq_questions(document_id);
CREATE INDEX IF NOT EXISTS idx_pyq_questions_subject_year
  ON pyq_questions(subject_id, year DESC);

ALTER TABLE pyq_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read pyq_questions" ON pyq_questions;
CREATE POLICY "Anyone can read pyq_questions"
  ON pyq_questions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins manage pyq_questions" ON pyq_questions;
CREATE POLICY "Admins manage pyq_questions"
  ON pyq_questions FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('superadmin', 'dept_admin')
    )
  );
