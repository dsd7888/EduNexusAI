-- ============================================================================
-- Question paper history (finalized, downloadable papers)
--
-- Unlike `qpaper_drafts` (private in-progress scratch state, deleted on
-- finalize), each `qpaper_history` row is a *finalized* paper a faculty member
-- has generated and downloaded: a permanent, re-downloadable record. Inserted
-- from the builder's onFinalized event, alongside clearing the matching draft.
--
-- Artifact columns store Storage *paths* (not URLs): the bucket is
-- `generated-content`. PDF/DOCX links are minted client-side via getPublicUrl;
-- the answer key (confidential) is re-signed on demand by an API route. Paths
-- are stable, so re-downloads keep working long after any signed URL expires.
--
-- `structure_summary` reuses the builder_state snapshot shape from
-- qpaper_drafts so a future "duplicate this paper" can rehydrate the builder.
--
-- RLS: read = own OR oversight (superadmin/dean/hod) — history is a reviewable
-- artifact, unlike drafts. Write = own only. get_my_role() is the same
-- SECURITY DEFINER helper used elsewhere (checkpointed in
-- 20260620000003_backfill_get_my_role.sql).
-- ============================================================================

CREATE TABLE IF NOT EXISTS qpaper_history (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject_id        uuid REFERENCES subjects(id) ON DELETE SET NULL,
  label             text,
  total_marks       integer,
  structure_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_path          text,
  docx_path         text,
  answer_key_path   text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qpaper_history_faculty ON qpaper_history(faculty_id);
CREATE INDEX IF NOT EXISTS idx_qpaper_history_subject ON qpaper_history(subject_id);
CREATE INDEX IF NOT EXISTS idx_qpaper_history_created ON qpaper_history(created_at DESC);

-- ─── Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE qpaper_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qpaper_history_select_own_or_oversight" ON qpaper_history
  FOR SELECT USING (
    faculty_id = auth.uid()
    OR get_my_role() IN ('superadmin', 'dean', 'hod')
  );

CREATE POLICY "qpaper_history_insert_own" ON qpaper_history
  FOR INSERT WITH CHECK (faculty_id = auth.uid());

CREATE POLICY "qpaper_history_update_own" ON qpaper_history
  FOR UPDATE USING (faculty_id = auth.uid());

CREATE POLICY "qpaper_history_delete_own" ON qpaper_history
  FOR DELETE USING (faculty_id = auth.uid());
