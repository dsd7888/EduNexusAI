-- Add question_type and code_context to placement_question_bank for fill_code questions
ALTER TABLE placement_question_bank
  ADD COLUMN IF NOT EXISTS question_type text NOT NULL DEFAULT 'mcq',
  ADD COLUMN IF NOT EXISTS code_context jsonb;
