-- ============================================================================
-- Animated explainers
--
-- Faculty-generated animated explainer "videos" — each is a self-contained HTML
-- player (see src/lib/explainer/renderer.ts) produced from an AI script
-- (scriptGenerator.ts) plus optional TTS narration. The HTML is stored in the
-- `explainers` Storage bucket; this table holds the metadata and the canonical
-- `script` jsonb. Students open an explainer via the public /e/[short_code]
-- route, which streams the stored HTML directly.
-- ============================================================================

CREATE TABLE IF NOT EXISTS explainers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code       text UNIQUE NOT NULL,
  subject_id       uuid REFERENCES subjects(id) ON DELETE SET NULL,
  module_id        uuid REFERENCES modules(id) ON DELETE SET NULL,
  topic            text NOT NULL,
  script           jsonb NOT NULL,
  storage_path     text NOT NULL,
  has_audio        boolean DEFAULT false,
  duration_seconds numeric(6,1),
  created_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_explainers_subject    ON explainers(subject_id);
CREATE INDEX IF NOT EXISTS idx_explainers_short_code ON explainers(short_code);
CREATE INDEX IF NOT EXISTS idx_explainers_created_by ON explainers(created_by);

-- ─── Storage bucket ─────────────────────────────────────────────────────────
-- Private bucket; the server (service role) uploads and streams the HTML, so no
-- public access or storage RLS policies are needed.
INSERT INTO storage.buckets (id, name, public)
VALUES ('explainers', 'explainers', false)
ON CONFLICT (id) DO NOTHING;

-- ─── Row Level Security ─────────────────────────────────────────────────────
-- NOTE: the spec's RLS used get_my_role() and dean/hod roles. This codebase has
-- neither — there is no get_my_role() helper and profiles.role is constrained to
-- ('superadmin','dept_admin','faculty','student') (see initial_schema.sql). So we
-- use the established inline EXISTS-against-profiles pattern with the real roles;
-- dept_admin is the institutional-admin role that stands in for dean/hod.
ALTER TABLE explainers ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can view (students reach an explainer via /e/[code]).
DROP POLICY IF EXISTS "explainers_select_authenticated" ON explainers;
CREATE POLICY "explainers_select_authenticated"
  ON explainers FOR SELECT
  USING (auth.role() = 'authenticated');

-- Faculty / dept_admin / superadmin create.
DROP POLICY IF EXISTS "explainers_insert_faculty" ON explainers;
CREATE POLICY "explainers_insert_faculty"
  ON explainers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('faculty', 'superadmin', 'dept_admin')
    )
  );

-- Creator (or superadmin) can delete.
DROP POLICY IF EXISTS "explainers_delete_own" ON explainers;
CREATE POLICY "explainers_delete_own"
  ON explainers FOR DELETE
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'superadmin'
    )
  );
