-- Semantic cache: partition entries by query mode so an exam_prep-style
-- one-liner can never be served for a problem_solving/conceptual query (and
-- vice versa). mode stores the detectQueryMode() classification of the cached
-- query, NOT the request tier — default 'conceptual' matches detectQueryMode's
-- own default so pre-existing rows read back as conceptual.
ALTER TABLE semantic_cache
  ADD COLUMN mode text NOT NULL DEFAULT 'conceptual';

-- Cache reads filter by (subject_id, mode); index both together.
CREATE INDEX IF NOT EXISTS idx_semantic_cache_subject_mode
  ON semantic_cache(subject_id, mode);
