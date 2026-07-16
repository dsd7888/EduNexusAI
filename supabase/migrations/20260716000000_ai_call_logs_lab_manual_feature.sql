-- ============================================================================
-- Docs-only: add `lab_manual` to the ai_call_logs.feature bucket list.
--
-- The feature column is a free-text analytics bucket (no CHECK constraint), so
-- the new `lab_manual` writes (logContext.feature in the lab-manual generator)
-- already land fine — this only refreshes the column comment so the schema
-- stays self-describing. Same docs-only style as
-- 20260711000001_ai_call_logs_feature_comment.sql.
-- ============================================================================

COMMENT ON COLUMN ai_call_logs.feature IS
  'higher-level bucket for the analytics page: ppt_generation | ppt_refine | '
  'qpaper | answer_key | qbank | chat | quiz | placement | placement_practice | '
  'lesson_plan | lab_manual | explainer | syllabus | pyq_extraction | '
  'admin_classification | refine';
