-- ============================================================================
-- Allow 'answer_key' as a generated_content.type
--
-- The answer-key route inserts a fresh generated_content row tagged
-- "answer_key" when it isn't patching an existing qpaper row (the frontend
-- currently always takes this insert path). The original type check constraint
-- only permitted ('ppt','visual_notes','refined_notes','qpaper'), so every such
-- insert silently failed its constraint and the answer-key row never persisted
-- — the PDF uploaded fine but nothing was attributable in analytics or history.
--
-- 'answer_key' is a meaningful, distinct content type (it has its own
-- answer_key_path / answer_key_generated_at columns), so we extend the
-- vocabulary rather than reusing 'qpaper'.
-- ============================================================================

ALTER TABLE generated_content
  DROP CONSTRAINT IF EXISTS generated_content_type_check;

ALTER TABLE generated_content
  ADD CONSTRAINT generated_content_type_check
  CHECK (type IN ('ppt', 'visual_notes', 'refined_notes', 'qpaper', 'answer_key'));
