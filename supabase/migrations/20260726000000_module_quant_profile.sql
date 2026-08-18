-- ============================================================================
-- Module quantitative profile (CP-Q1.5) — gate 1 of NAT integrity
--
-- WHY THIS IS NOT A KEYWORD HEURISTIC (the finding that produced this table):
-- `modules.description` is a TOPIC list, not a TASK list. "Ohm's Law,
-- Kirchhoff's Current Law, Impedance and Power Factor" never contains the word
-- "calculate", because a syllabus states what is covered, not what a student
-- does with it. Probing the obvious verb/operator heuristic over 20 real seeded
-- modules classified exactly ONE as quantitative — and marked "Mathematical
-- Logic and Proofs" quantitative off the word "Proof" while missing an entire
-- AC-circuits module. A per-module judgement is required, so it is stored.
--
-- The lifecycle mirrors module_co_mapping exactly (20260628000000): an AI pass
-- writes source='ai_classified', a human edit writes source='faculty_verified',
-- and re-running the classifier NEVER overwrites a faculty row. The faculty
-- edit surface itself is CP-Q4; the columns exist now so the classifier's
-- skip-faculty-rows contract is enforceable from day one rather than retrofitted.
--
-- Columns live ON `modules` rather than in a side table because this is a
-- single-valued attribute of a module (unlike module↔CO, which is many-to-many).
--
-- Apply manually. Safe to re-run: ADD COLUMN IF NOT EXISTS throughout, and each
-- CHECK is dropped before being added.
-- ============================================================================

ALTER TABLE modules
  ADD COLUMN IF NOT EXISTS quant_profile       text,
  ADD COLUMN IF NOT EXISTS quant_confidence    text,
  ADD COLUMN IF NOT EXISTS quant_source        text,
  ADD COLUMN IF NOT EXISTS quant_classified_at timestamptz;

-- Constraints added separately from the columns so this file stays re-runnable:
-- ADD COLUMN IF NOT EXISTS skips an existing column INCLUDING its inline CHECK,
-- so an inline constraint would silently never appear on a second apply.
-- NULL is explicitly legal on all three: NULL = "not yet classified", which the
-- engine treats as NAT-ALLOWED (gate 2 in CP-Q2 is the backstop). Blocking NAT
-- on unclassified modules would silently disable GATE mode for every subject
-- until a backfill ran.
ALTER TABLE modules DROP CONSTRAINT IF EXISTS modules_quant_profile_check;
ALTER TABLE modules ADD CONSTRAINT modules_quant_profile_check
  CHECK (quant_profile IS NULL OR quant_profile IN ('quantitative','conceptual'));

ALTER TABLE modules DROP CONSTRAINT IF EXISTS modules_quant_confidence_check;
ALTER TABLE modules ADD CONSTRAINT modules_quant_confidence_check
  CHECK (quant_confidence IS NULL OR quant_confidence IN ('low','medium','high'));

ALTER TABLE modules DROP CONSTRAINT IF EXISTS modules_quant_source_check;
ALTER TABLE modules ADD CONSTRAINT modules_quant_source_check
  CHECK (quant_source IS NULL OR quant_source IN ('ai_classified','faculty_verified'));

-- planAssessment filters NAT-eligible modules per subject on every plan, so the
-- lookup is (subject_id, quant_profile). Partial index: only classified rows are
-- ever filtered on, and NULL is the common case until the backfill completes.
CREATE INDEX IF NOT EXISTS idx_modules_subject_quant
  ON modules(subject_id, quant_profile)
  WHERE quant_profile IS NOT NULL;

COMMENT ON COLUMN modules.quant_profile IS
  'quantitative = a NAT (numerical answer type) question can be posed from this module''s content; conceptual = it cannot. NULL = unclassified, treated as NAT-allowed. Set by src/lib/assessment/quantClassifier.ts or by faculty (CP-Q4).';
