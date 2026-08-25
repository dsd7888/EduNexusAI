-- CP-QC5: allow open-format ("custom") questions in the faculty Q Bank.
--
-- The Q-paper builder gained a `custom` block type: an open format whose shape
-- is described by the faculty (the motivating case is a pseudocode listing with
-- the main logic blanked out, which is none of mcq / short_answer / long_answer
-- / numerical / fill_blank).
--
-- Without this, a good custom question can be generated and printed but NOT
-- saved to the bank -- it would fail the question_type CHECK constraint. That
-- reproduces exactly the "generated something great, couldn't keep it" problem
-- the surrounding work exists to fix, so the bank has to accept the type too.
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ TRAP — READ BEFORE EDITING THIS CONSTRAINT AGAIN                         │
-- │                                                                          │
-- │ Postgres cannot extend a CHECK constraint; it can only be dropped and    │
-- │ rebuilt with the FULL list. That makes every such migration a chance to  │
-- │ silently DELETE a value some earlier migration added.                    │
-- │                                                                          │
-- │ This exact mistake was made here on the first attempt: the list was      │
-- │ rebuilt from the original 20260603000000_faculty_question_bank.sql and   │
-- │ dropped 'msq' and 'nat', which 20260725000000_assessment_engine.sql had  │
-- │ added for the engine's write-through path. It failed loudly only because │
-- │ rows using those types already existed. On an empty table it would have  │
-- │ succeeded and broken the assessment engine's next write instead.         │
-- │                                                                          │
-- │ So: the authority for the current list is the LIVE constraint, not any   │
-- │ single migration file. Before editing, run                               │
-- │                                                                          │
-- │   SELECT pg_get_constraintdef(oid) FROM pg_constraint                    │
-- │    WHERE conname = 'faculty_question_bank_question_type_check';          │
-- │                                                                          │
-- │ and start from what that returns. The guard below turns a repeat of this │
-- │ mistake into a message that names the values being dropped, instead of a │
-- │ bare "violated by some row".                                             │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- Constraint history:
--   20260603000000  mcq, short_answer, long_answer, numerical, fill_blank
--   20260725000000  + msq, nat          (assessment engine write-through)
--   this migration  + custom            (open-format Q-paper questions)
--
-- Additive and backward-compatible: no existing row changes, and nothing is
-- required to write 'custom'.

-- ─── Guard: refuse to narrow the constraint ─────────────────────────────────
-- Fails BEFORE the drop, naming any value that would be orphaned. Without this
-- the failure surfaces as "check constraint ... is violated by some row", which
-- says nothing about which value or which migration introduced it.
DO $$
DECLARE
  orphaned text;
BEGIN
  SELECT string_agg(DISTINCT question_type, ', ' ORDER BY question_type)
    INTO orphaned
    FROM faculty_question_bank
   WHERE question_type NOT IN (
     'mcq','short_answer','long_answer','numerical','fill_blank',
     'msq','nat','custom'
   );

  IF orphaned IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to narrow faculty_question_bank.question_type: existing rows use %. Add them to the list in this migration (see the TRAP note above).',
      orphaned;
  END IF;
END $$;

ALTER TABLE faculty_question_bank
  DROP CONSTRAINT IF EXISTS faculty_question_bank_question_type_check;

ALTER TABLE faculty_question_bank
  ADD CONSTRAINT faculty_question_bank_question_type_check
  CHECK (
    question_type IN (
      'mcq',
      'short_answer',
      'long_answer',
      'numerical',
      'fill_blank',
      -- Added 20260725000000 (assessment engine write-through). Dropping these
      -- would break the engine's ability to write back to the shared bank.
      'msq',
      'nat',
      -- Added by this migration.
      'custom'
    )
  );
