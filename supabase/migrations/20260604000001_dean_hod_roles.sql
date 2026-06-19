-- ============================================================================
-- Add dean / hod as first-class roles
--
-- profiles.role was constrained to ('superadmin','dept_admin','faculty','student')
-- by the inline CHECK in initial_schema.sql (auto-named profiles_role_check).
-- dean and hod are faculty-tier institutional roles that can create and manage
-- animated explainers, so we widen the constraint to allow them. App-layer role
-- types (helpers.ts AllowedRole, db/types.ts + proxy.ts UserRole) and the
-- explainer route checks are updated to match.
-- ============================================================================

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('superadmin', 'dept_admin', 'faculty', 'student', 'dean', 'hod'));

-- Keep the explainers INSERT policy in sync: dean/hod may create explainers.
DROP POLICY IF EXISTS "explainers_insert_faculty" ON explainers;
CREATE POLICY "explainers_insert_faculty"
  ON explainers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('faculty', 'superadmin', 'dept_admin', 'dean', 'hod')
    )
  );
