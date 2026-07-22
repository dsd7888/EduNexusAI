-- ============================================================================
-- Docs-only: add `syllabus_audit` to the ai_call_logs.feature bucket list.
--
-- The feature column is a free-text analytics bucket (no CHECK constraint), so
-- the new `syllabus_audit` writes (logContext.feature in the suggest route)
-- already land fine — this only refreshes the column comment so the schema
-- stays self-describing. Same docs-only style as
-- 20260716000000_ai_call_logs_lab_manual_feature.sql.
--
-- NOTE the existing `syllabus` bucket is a different thing: that is the
-- PDF-extraction pipeline (syllabus_extract). `syllabus_audit` is the health
-- audit's suggestion call. Both touch a syllabus; only one writes one.
-- ============================================================================

COMMENT ON COLUMN ai_call_logs.feature IS
  'higher-level bucket for the analytics page: ppt_generation | ppt_refine | '
  'qpaper | answer_key | qbank | chat | quiz | placement | placement_practice | '
  'lesson_plan | lab_manual | syllabus_audit | explainer | syllabus | '
  'pyq_extraction | admin_classification | refine';
