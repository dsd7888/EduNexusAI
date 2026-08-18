-- CP-01 (fix-pass): profiles.role privilege escalation
--
-- Finding: the "Users can update own profile" RLS policy restricts the ROW
-- (auth.uid() = id) but not the COLUMNS. Any authenticated student/faculty
-- session can `.update({ role: 'superadmin' })` on its own row via the
-- ordinary browser client, and proxy.ts / requireRole() trust that same
-- profiles.role column server-side -- full auth bypass.
--
-- Fix: an allow-list, not a block-list, enforced with a BEFORE UPDATE
-- trigger (a plain RLS WITH CHECK clause can't diff OLD vs NEW column-by-
-- column; a trigger can). Decided (Dhruv, CP-01): the self-service allow-list
-- starts EMPTY -- the profile UI is confirmed read-only today and no live
-- feature depends on a non-admin session writing its own profile columns, so
-- there is nothing to allow-list yet. Adding a future self-service field
-- (e.g. full_name) is a small, separate follow-up once a real profile-editing
-- feature exists.
--
-- Whole-row comparison, not a named-column list: an empty allow-list means
-- "no column may change", so this checks `NEW IS DISTINCT FROM OLD` against
-- the entire row rather than seven named columns -- correct against every
-- column on the table, including ones added later that we'd otherwise forget
-- to add to the list. `updated_at` needs no exclusion: profiles also has a
-- separate `profiles_updated_at` BEFORE UPDATE trigger (update_updated_at()),
-- and Postgres fires same-kind triggers in alphabetical-by-name order, so
-- "profiles_enforce_self_service_allowlist" runs before "profiles_updated_at"
-- -- NEW.updated_at is still whatever the client sent when this trigger
-- evaluates, not yet stamped by the sibling trigger. A genuine no-op write
-- (identical values) therefore produces no exception, since nothing actually
-- differs -- verified against the live schema: profiles has no other
-- trigger-touched column (no last_login or equivalent exists).
--
-- Exemptions (both mirror existing, already-trusted access paths -- this
-- migration does not grant anything new):
--   1. service_role (createAdminClient()) -- already bypasses RLS entirely.
--      Confirmed live user: POST /api/auth/change-password clears the
--      caller's own must_change_password flag via the admin client.
--   2. superadmin / dept_admin sessions -- already governed by the separate
--      "Admins can update all profiles" policy, which performs its own
--      identical role check. Verified against the live schema: dept_admin is
--      a real, live role -- present in the profiles_role_check CHECK
--      constraint, in get_my_role()-gated RLS policies across 20+ migrations
--      through Aug 2026, and in the app-layer UserRole/AllowedRole unions
--      (proxy.ts, helpers.ts, db/types.ts). get_my_role() is likewise real,
--      defined in 20260620000003_backfill_get_my_role.sql and reused by
--      14+ migrations.

CREATE OR REPLACE FUNCTION enforce_profiles_self_service_allowlist()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- service_role bypasses RLS already; stay consistent with that here too.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Admin sessions retain full write access (mirrors the "Admins can update
  -- all profiles" policy's own role check; get_my_role() is the existing
  -- SECURITY DEFINER helper used to avoid RLS self-recursion on profiles).
  IF get_my_role() IN ('superadmin', 'dept_admin') THEN
    RETURN NEW;
  END IF;

  -- Non-admin self-service update via the "Users can update own profile"
  -- policy: the allow-list is deliberately EMPTY today, so no column on the
  -- row may change -- checked against the whole row, not a named subset.
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'profiles: self-service updates cannot change any column (self-service allow-list is empty)'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_enforce_self_service_allowlist ON profiles;

CREATE TRIGGER profiles_enforce_self_service_allowlist
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION enforce_profiles_self_service_allowlist();
