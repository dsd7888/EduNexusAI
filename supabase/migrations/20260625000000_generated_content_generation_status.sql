-- ============================================================================
-- Extend generated_content.status vocabulary for PPT checkpoint/resume.
--
-- The original constraint only allowed ('pending','completed','failed'). The
-- PPT generation pipeline now persists a row the moment the outline succeeds
-- and advances its status as each batch completes, so an interrupted run
-- (tab close, refresh, network drop) leaves a resumable record instead of
-- losing all AI spend silently.
--
-- New non-terminal states:
--   outline_done        — outline persisted, no content batches run yet
--   generating_content  — content batches in progress
--   generating_diagrams — diagram batches in progress
--   building            — assembling/uploading the .pptx
-- New terminal state:
--   abandoned           — marked by the stale-job cron (no progress for 20m)
--
-- 'pending' is retained for backward compatibility with any pre-existing rows.
-- Terminal set for resume/cron logic is ('completed','failed','abandoned').
-- ============================================================================

ALTER TABLE generated_content
  DROP CONSTRAINT IF EXISTS generated_content_status_check;

ALTER TABLE generated_content
  ADD CONSTRAINT generated_content_status_check
  CHECK (status IN (
    'pending',
    'outline_done',
    'generating_content',
    'generating_diagrams',
    'building',
    'completed',
    'failed',
    'abandoned'
  ));

-- Speeds up the resume lookup (most-recent non-terminal row per user) and the
-- cron's stale-row scan (status + updated_at).
CREATE INDEX IF NOT EXISTS idx_generated_content_by_user_status_updated
  ON generated_content (generated_by, status, updated_at DESC);
