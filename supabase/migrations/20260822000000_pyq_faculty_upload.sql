-- ============================================================================
-- Faculty-facing PYQ upload (CP-P1)
--
-- Two changes, both additive:
--
--  1. documents.exam_type — a paper's exam type matters MORE than its year for
--     style mirroring: a mid-sem and an end-sem paper for the same subject have
--     completely different question shapes, marks ladders and section counts.
--     Year alone (the existing column) cannot express that. Nullable so every
--     pre-existing row stays valid.
--
--  2. pyq_questions.co normalization — the extractor stored the CO "as printed"
--     ("03", "CO-3", "co3"). Every consumer joins it against
--     module_co_mapping.co_code, which is canonical ("CO3"):
--       - src/lib/notes/pyq-frequency.ts  .in("co", allCoCodes)
--       - the qpaper CO-aware picker
--       - the Past Papers coverage read
--     An exact-match join between "03" and "CO3" silently returns nothing, so
--     the whole PYQ frequency signal would read as "no signal" the moment real
--     papers landed. Canonicalize on write (src/lib/pyq/co.ts) and backfill the
--     existing rows here so both sides of the join speak one dialect.
-- ============================================================================

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS exam_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_exam_type_check'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_exam_type_check
      CHECK (exam_type IS NULL OR exam_type IN ('mid_sem', 'end_sem', 'internal', 'other'));
  END IF;
END $$;

-- The Past Papers list and the coverage read are both
-- "documents WHERE subject_id = ? AND type = 'pyq'".
CREATE INDEX IF NOT EXISTS idx_documents_subject_type
  ON documents(subject_id, type);

-- ── CO backfill ─────────────────────────────────────────────────────────────
-- Mirrors normalizeCoCode() in src/lib/pyq/co.ts: take the first run of digits,
-- drop leading zeros, re-prefix with "CO". Rows carrying no digits at all (a
-- garbled extraction) are set to NULL rather than left as junk that can never
-- match anything.
UPDATE pyq_questions
SET co = 'CO' || LTRIM(SUBSTRING(co FROM '[0-9]+'), '0')
WHERE co IS NOT NULL
  AND SUBSTRING(co FROM '[0-9]+') IS NOT NULL
  AND LTRIM(SUBSTRING(co FROM '[0-9]+'), '0') <> ''
  AND co <> 'CO' || LTRIM(SUBSTRING(co FROM '[0-9]+'), '0');

UPDATE pyq_questions
SET co = NULL
WHERE co IS NOT NULL
  AND (SUBSTRING(co FROM '[0-9]+') IS NULL
       OR LTRIM(SUBSTRING(co FROM '[0-9]+'), '0') = '');
