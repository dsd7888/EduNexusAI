-- ============================================================================
-- documents.type: allow 'reference_material'
--
-- documents.type is a constrained enum — the inline CHECK in initial_schema.sql
-- (auto-named documents_type_check) allowed only ('syllabus','notes','pyq').
-- Per the brief, reference material reuses the existing documents table rather
-- than a duplicate table, so we widen the CHECK to add 'reference_material'.
--
-- The separate documents_year_pyq constraint (year required when type='pyq') is
-- untouched and still applies. App-code wiring (db/types.ts DocumentType, upload
-- UI, etc.) is a later part.
-- ============================================================================

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_type_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_type_check
  CHECK (type IN ('syllabus', 'notes', 'pyq', 'reference_material'));
