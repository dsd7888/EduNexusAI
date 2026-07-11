-- ============================================================================
-- Docs-only: refresh ai_call_logs.feature bucket list (review item G)
--
-- The feature column is a free-text analytics bucket (no CHECK constraint), so
-- the new `lesson_plan` writes already land fine — but the column comment from
-- 20260708000000_ai_call_logs.sql predates the feature and no longer lists it.
-- This migration only refreshes that comment so the schema stays self-describing.
-- 'explainer' is retained in the list for historical rows even though the
-- feature has been removed from the app.
-- ============================================================================

COMMENT ON COLUMN ai_call_logs.feature IS
  'higher-level bucket for the analytics page: ppt_generation | ppt_refine | '
  'qpaper | answer_key | qbank | chat | quiz | placement | placement_practice | '
  'lesson_plan | explainer | syllabus | pyq_extraction | admin_classification | refine';
