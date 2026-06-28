-- ============================================================================
-- qpaper_templates: snapshot flag, preset split, and fine-grained RLS
--
-- is_snapshot  — true only for the throwaway Draft rows the generator POSTs
--               before each generation request; never shown in any template UI.
-- is_preset    — true for the 3 built-in starters (PPSU_ESE, CE_QUIZ, CUSTOM).
--               Derived from structure->>'preset_key' being non-null.
--               Replaces the dual meaning of is_default ("built-in" vs
--               "my chosen default"), which is_default alone could not express.
-- ============================================================================

ALTER TABLE qpaper_templates ADD COLUMN IF NOT EXISTS is_snapshot boolean NOT NULL DEFAULT false;
ALTER TABLE qpaper_templates ADD COLUMN IF NOT EXISTS is_preset   boolean NOT NULL DEFAULT false;

-- Back-fill: any row whose stored structure carries a preset_key is a built-in.
UPDATE qpaper_templates SET is_preset = true WHERE structure->>'preset_key' IS NOT NULL;

-- ── RLS ─────────────────────────────────────────────────────────────────────

-- Drop old policies (they had no ownership check and missed dean/hod roles).
DROP POLICY IF EXISTS "Faculty and admins can read qpaper_templates"   ON qpaper_templates;
DROP POLICY IF EXISTS "Faculty and admins can manage qpaper_templates" ON qpaper_templates;

-- SELECT: superadmin/dept_admin see everything; others see own rows or school-scoped rows.
CREATE POLICY "Read own or shared qpaper_templates"
  ON qpaper_templates FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('superadmin', 'dept_admin')
    )
    OR created_by = auth.uid()
    OR scope IN ('school', 'department')
  );

-- INSERT: only the row owner, and only eligible roles (dean + hod added).
CREATE POLICY "Insert own qpaper_templates"
  ON qpaper_templates FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('superadmin', 'dept_admin', 'faculty', 'dean', 'hod')
    )
  );

-- UPDATE: own rows, or superadmin/dept_admin.
CREATE POLICY "Modify own qpaper_templates"
  ON qpaper_templates FOR UPDATE USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('superadmin', 'dept_admin')
    )
  );

-- DELETE: own rows, or superadmin/dept_admin.
CREATE POLICY "Delete own qpaper_templates"
  ON qpaper_templates FOR DELETE USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('superadmin', 'dept_admin')
    )
  );
