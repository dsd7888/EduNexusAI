-- Rich placement attempt storage for history / export
ALTER TABLE placement_attempts
  ADD COLUMN IF NOT EXISTS subcategory_scores jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS questions jsonb,
  ADD COLUMN IF NOT EXISTS answers jsonb,
  ADD COLUMN IF NOT EXISTS subcategory_gaps jsonb,
  ADD COLUMN IF NOT EXISTS top_strengths jsonb,
  ADD COLUMN IF NOT EXISTS weaknesses jsonb;
