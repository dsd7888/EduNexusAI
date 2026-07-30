-- ============================================================================
-- Docs-only: add `notes` to the ai_call_logs.feature bucket list.
--
-- The feature column is a free-text analytics bucket (no CHECK constraint), so
-- the new `notes` writes (NOTES_FEATURE in src/lib/notes/generator.ts) already
-- land fine — this only refreshes the column comment so the schema stays
-- self-describing. Same docs-only style as
-- 20260722000001_ai_call_logs_syllabus_audit_feature.sql.
--
-- WHY THIS BUCKET DID NOT EXIST BEFORE: the retired v1 quick-notes path logged
-- its generation as feature='chat' (see CP-N1 Part 0), so notes spend has been
-- indistinguishable from chat spend in the analytics page for the whole life of
-- that feature. Any historical cost attribution that treats `chat` as
-- chat-only is overstated by however much quick-notes generation ran.
-- ============================================================================

COMMENT ON COLUMN ai_call_logs.feature IS
  'higher-level bucket for the analytics page: ppt_generation | ppt_refine | '
  'qpaper | answer_key | qbank | chat | quiz | placement | placement_practice | '
  'lesson_plan | lab_manual | syllabus_audit | notes | explainer | syllabus | '
  'pyq_extraction | admin_classification | refine';
