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
-- Additive and backward-compatible: no existing row changes, and nothing is
-- required to write 'custom'.

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
      'custom'
    )
  );
