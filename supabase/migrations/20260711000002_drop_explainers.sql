-- ============================================================================
-- Drop the retired Animated Explainers feature (review item E)
--
-- The explainer app code (pages, API routes, lib, /e/[code]) was removed, but
-- the DB artifacts from 20260604000000_explainers.sql were left live: the
-- `explainers` table and the private `explainers` Storage bucket. With no code
-- referencing them they are dead schema. This migration removes them.
--
-- Only the table is dropped here. Supabase blocks direct DELETE on
-- storage.objects / storage.buckets (storage.protect_delete() trigger), so the
-- private `explainers` bucket must be removed via the Storage API instead —
-- done out-of-band with scripts/drop-explainers-bucket.ts (emptyBucket +
-- deleteBucket), or via the dashboard (Storage → explainers → empty → delete).
-- ============================================================================

DROP TABLE IF EXISTS explainers CASCADE;
