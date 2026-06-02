-- ============================================================================
-- Answer key columns on generated_content
--
-- Faculty generates the question paper first and then, on demand, generates a
-- model answer key for evaluators. The answer key is a separate PDF stored in
-- Supabase Storage; we keep its path + generation timestamp alongside the
-- question paper row so the UI can show "already generated" state and avoid
-- redundant Pro calls.
-- ============================================================================

ALTER TABLE generated_content
  ADD COLUMN IF NOT EXISTS answer_key_path text,
  ADD COLUMN IF NOT EXISTS answer_key_generated_at timestamptz;
