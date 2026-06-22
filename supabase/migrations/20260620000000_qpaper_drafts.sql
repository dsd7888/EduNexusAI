-- ============================================================================
-- Question paper drafts (autosave / builder state)
--
-- Each row is a faculty member's in-progress paper builder session: the
-- `builder_state` jsonb is the full client builder snapshot, autosaved as the
-- user works. `generation_status` tracks an async generation run so the UI can
-- resume/poll. Drafts are private scratch state, not a reviewable artifact:
-- a faculty owns their own drafts; superadmin has an override. No dean/hod read
-- access (intentional — nothing here to oversee yet).
--
-- RLS uses get_my_role() (SELECT role FROM profiles WHERE id = auth.uid()),
-- which exists live; 20260620000003_backfill_get_my_role.sql checkpoints it into
-- migrations so a from-scratch rebuild still has it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS qpaper_drafts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject_id        uuid REFERENCES subjects(id) ON DELETE SET NULL,
  label             text,
  builder_state     jsonb NOT NULL DEFAULT '{}'::jsonb,
  generation_status text NOT NULL DEFAULT 'idle'
                    CHECK (generation_status IN ('idle','generating','complete','failed')),
  last_saved_at     timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qpaper_drafts_faculty ON qpaper_drafts(faculty_id);
CREATE INDEX IF NOT EXISTS idx_qpaper_drafts_subject ON qpaper_drafts(subject_id);

-- ─── Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE qpaper_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qpaper_drafts_select_own_or_admin" ON qpaper_drafts
  FOR SELECT USING (
    faculty_id = auth.uid()
    OR get_my_role() = 'superadmin'
  );

CREATE POLICY "qpaper_drafts_insert_own" ON qpaper_drafts
  FOR INSERT WITH CHECK (faculty_id = auth.uid());

CREATE POLICY "qpaper_drafts_update_own" ON qpaper_drafts
  FOR UPDATE USING (faculty_id = auth.uid());

CREATE POLICY "qpaper_drafts_delete_own_or_admin" ON qpaper_drafts
  FOR DELETE USING (
    faculty_id = auth.uid()
    OR get_my_role() = 'superadmin'
  );
