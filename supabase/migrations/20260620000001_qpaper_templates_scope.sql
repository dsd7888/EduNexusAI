-- ============================================================================
-- qpaper_templates: cross-subject scope
--
-- Lets a template apply beyond a single subject. `scope` says how broadly the
-- template is offered:
--   'personal'   — only its creator (default; preserves existing behaviour)
--   'school'     — shared across the school
--   'department' — shared across the department
-- subject_id stays the optional "pinned subject" hint; when a template is
-- school/department scoped it can be left NULL so it is not tied to one subject.
--
-- subject_id is ALREADY nullable in 20260523000000_qpaper_templates.sql (no
-- NOT NULL on the column). The DROP NOT NULL below is a harmless idempotent
-- no-op kept to satisfy the "make nullable if not already" requirement.
-- ============================================================================

ALTER TABLE qpaper_templates ALTER COLUMN subject_id DROP NOT NULL;

ALTER TABLE qpaper_templates
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'personal'
    CHECK (scope IN ('personal', 'school', 'department'));

CREATE INDEX IF NOT EXISTS idx_qpaper_templates_scope ON qpaper_templates(scope);
