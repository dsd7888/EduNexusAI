-- ============================================================================
-- Backfill: get_my_role()
--
-- get_my_role() exists live in the database but was never checkpointed into a
-- migration. A from-scratch rebuild (new/staging env, disaster recovery) would
-- silently lack it, breaking every RLS policy that calls it. CREATE OR REPLACE
-- makes this safe to run against the live DB — it won't disturb the existing
-- function.
--
-- ⚠ ORDERING: if you ever apply migrations from scratch in FILENAME order
-- (e.g. `supabase db push`), this file (…0003) sorts AFTER 20260620000000_qpaper_drafts.sql,
-- whose policies call get_my_role(). On a fresh DB where the function does not
-- already exist, that migration would fail. For rebuild safety, rename this file
-- to sort BEFORE the qpaper_drafts migration (e.g. 20260619000000_backfill_get_my_role.sql).
-- Not an issue for the manual SQL-editor run below, where you run this before
-- migration 1 and the function already exists live anyway.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;
