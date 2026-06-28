-- ============================================================================
-- Module ↔ CO mapping
--
-- Records which Course Outcomes each module plausibly teaches toward. Until now
-- course_outcomes was subject-level only, so question slots could only fall back
-- to the subject's full CO list. This per-module mapping (AI-inferred, optionally
-- superadmin-verified) is what later enables honest per-CO allocation.
-- ============================================================================

CREATE TABLE IF NOT EXISTS module_co_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  co_code text NOT NULL,
  confidence text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high','medium','low')),
  source text NOT NULL DEFAULT 'ai_inferred' CHECK (source IN ('ai_inferred','superadmin_verified')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (module_id, co_code)
);
CREATE INDEX IF NOT EXISTS idx_module_co_mapping_module ON module_co_mapping(module_id);

ALTER TABLE module_co_mapping ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read module_co_mapping" ON module_co_mapping;
CREATE POLICY "Anyone can read module_co_mapping" ON module_co_mapping FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins manage module_co_mapping" ON module_co_mapping;
CREATE POLICY "Admins manage module_co_mapping" ON module_co_mapping FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);
