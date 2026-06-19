-- ============================================================================
-- Faculty question bank (Q Bank)
--
-- A per-faculty reusable pool of questions for a subject. Questions arrive
-- from three sources — AI generation, faculty CSV import, or PYQ-inspired
-- generation — and carry academic tagging (CO / BTL / PO / difficulty) that
-- is either supplied by faculty or AI-inferred (see src/lib/qbank/tagger.ts).
-- `is_verified` gates whether a question has been faculty-reviewed; usage
-- counters track how often a question has been pulled into a paper.
-- ============================================================================

CREATE TABLE IF NOT EXISTS faculty_question_bank (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id      uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  faculty_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  module_id       uuid REFERENCES modules(id) ON DELETE SET NULL,

  -- Core question data
  question_text   text NOT NULL,
  question_type   text NOT NULL CHECK (question_type IN
                  ('mcq','short_answer','long_answer','numerical','fill_blank')),
  marks           numeric(4,1) NOT NULL,

  -- Answer data
  model_answer    text,
  options         jsonb,  -- [{label:'A',text:'...',is_correct:bool}] for MCQ

  -- Academic tagging (AI-inferred if not provided by faculty)
  co_code         text,
  btl_level       integer CHECK (btl_level BETWEEN 1 AND 6),
  po_codes        text[],
  difficulty      text CHECK (difficulty IN ('easy','medium','hard')),

  -- Source tracking
  source          text NOT NULL CHECK (source IN
                  ('ai_generated','faculty_imported','pyq_inspired')),
  is_verified     boolean DEFAULT false,
  -- true  = faculty reviewed and approved this question
  -- false = AI-generated or freshly imported, not yet reviewed

  -- Usage tracking
  usage_count     integer DEFAULT 0,
  last_used_at    timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fqb_subject    ON faculty_question_bank(subject_id);
CREATE INDEX IF NOT EXISTS idx_fqb_faculty    ON faculty_question_bank(faculty_id);
CREATE INDEX IF NOT EXISTS idx_fqb_module     ON faculty_question_bank(module_id);
CREATE INDEX IF NOT EXISTS idx_fqb_type_marks ON faculty_question_bank(question_type, marks);
CREATE INDEX IF NOT EXISTS idx_fqb_co         ON faculty_question_bank(co_code);
CREATE INDEX IF NOT EXISTS idx_fqb_btl        ON faculty_question_bank(btl_level);
CREATE INDEX IF NOT EXISTS idx_fqb_source     ON faculty_question_bank(source);

-- Keep updated_at fresh on every UPDATE (shared trigger fn from initial schema).
DROP TRIGGER IF EXISTS faculty_question_bank_updated_at ON faculty_question_bank;
CREATE TRIGGER faculty_question_bank_updated_at BEFORE UPDATE ON faculty_question_bank
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Row Level Security ─────────────────────────────────────────────────────
-- A faculty member owns their own questions; superadmin has full access. This
-- codebase has no get_my_role() helper, so role checks use the established
-- inline EXISTS-against-profiles pattern (see initial_schema.sql).
ALTER TABLE faculty_question_bank ENABLE ROW LEVEL SECURITY;

-- Faculty sees / manages only their own questions
DROP POLICY IF EXISTS "fqb_select_own" ON faculty_question_bank;
CREATE POLICY "fqb_select_own"
  ON faculty_question_bank FOR SELECT
  USING (faculty_id = auth.uid());

DROP POLICY IF EXISTS "fqb_insert_own" ON faculty_question_bank;
CREATE POLICY "fqb_insert_own"
  ON faculty_question_bank FOR INSERT
  WITH CHECK (faculty_id = auth.uid());

DROP POLICY IF EXISTS "fqb_update_own" ON faculty_question_bank;
CREATE POLICY "fqb_update_own"
  ON faculty_question_bank FOR UPDATE
  USING (faculty_id = auth.uid());

DROP POLICY IF EXISTS "fqb_delete_own" ON faculty_question_bank;
CREATE POLICY "fqb_delete_own"
  ON faculty_question_bank FOR DELETE
  USING (faculty_id = auth.uid());

-- Superadmin full access
DROP POLICY IF EXISTS "fqb_all_superadmin" ON faculty_question_bank;
CREATE POLICY "fqb_all_superadmin"
  ON faculty_question_bank FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'superadmin'
    )
  );
