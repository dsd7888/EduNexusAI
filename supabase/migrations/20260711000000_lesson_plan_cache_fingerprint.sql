-- ============================================================================
-- Cache invalidation on syllabus edit (review item B)
--
-- lesson_plan_cache is keyed only on (subject_id, section). If the subject's
-- modules/practicals are edited after a cache row is written, later faculty
-- would otherwise be served stale AI content pointing at removed/renamed topics.
--
-- We store a syllabus fingerprint (sha256 of the section-relevant syllabus
-- inputs — see computeSyllabusFingerprint in src/lib/lessonplan/generator.ts)
-- on the cache row. The generate route treats a fingerprint mismatch as a cache
-- miss and regenerates, so an edited syllabus self-invalidates its cache.
-- Nullable: pre-existing rows have no fingerprint and are treated as a miss.
-- ============================================================================

ALTER TABLE lesson_plan_cache
  ADD COLUMN IF NOT EXISTS syllabus_fingerprint text;
