-- ============================================================================
-- Faculty CO mapping edit
--
-- Lets faculty view their subject's full syllabus alongside the AI-inferred
-- module -> CO mappings and correct any mapping they disagree with. Adds
-- 'faculty_verified' as a source value and a policy allowing faculty to
-- write module_co_mapping rows for their assigned subjects.
-- ============================================================================

-- Allow 'faculty_verified' as a source value
ALTER TABLE module_co_mapping
  DROP CONSTRAINT IF EXISTS module_co_mapping_source_check;
ALTER TABLE module_co_mapping
  ADD CONSTRAINT module_co_mapping_source_check
  CHECK (source IN ('ai_inferred', 'faculty_verified', 'superadmin_verified'));

-- Allow faculty to write module_co_mapping for their assigned subjects
-- (goes through the API route which uses admin client — this policy is
-- belt-and-suspenders for any future direct-client path)
CREATE POLICY "Faculty edit module_co_mapping for assigned subjects"
  ON module_co_mapping FOR ALL USING (
    EXISTS (
      SELECT 1 FROM faculty_assignments fa
      JOIN modules m ON m.id = module_co_mapping.module_id
      WHERE fa.faculty_id = auth.uid()
        AND fa.subject_id = m.subject_id
    )
  );
