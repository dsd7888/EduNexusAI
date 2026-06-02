-- ============================================================================
-- Question paper templates
--
-- Stores reusable paper structures per subject (e.g. PPSU ESE standard).
-- The `structure` jsonb captures sections, question types, marks, attempt
-- logic and module ranges so the generator can produce questions that
-- match the institution's exact paper format.
-- ============================================================================

CREATE TABLE IF NOT EXISTS qpaper_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid REFERENCES subjects(id) ON DELETE CASCADE,
  created_by uuid REFERENCES profiles(id),
  name text NOT NULL,
  is_default boolean DEFAULT false,
  university_name text DEFAULT 'P P Savani University',
  exam_title text,
  duration_minutes integer DEFAULT 150,
  total_marks integer DEFAULT 60,
  instructions text[],
  structure jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qpaper_templates_subject ON qpaper_templates(subject_id);
CREATE INDEX IF NOT EXISTS idx_qpaper_templates_default ON qpaper_templates(subject_id, is_default);

ALTER TABLE qpaper_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Faculty and admins can read qpaper_templates" ON qpaper_templates;
CREATE POLICY "Faculty and admins can read qpaper_templates"
  ON qpaper_templates FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('superadmin', 'dept_admin', 'faculty')
    )
  );

DROP POLICY IF EXISTS "Faculty and admins can manage qpaper_templates" ON qpaper_templates;
CREATE POLICY "Faculty and admins can manage qpaper_templates"
  ON qpaper_templates FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('superadmin', 'dept_admin', 'faculty')
    )
  );
