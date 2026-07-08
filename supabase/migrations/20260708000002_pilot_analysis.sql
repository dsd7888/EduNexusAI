-- Checkpoint 4: Pilot Analysis page support.
--
-- Two small tables (storage snapshots, manual incident log) + a few SECURITY DEFINER
-- functions for things not expressible via plain table queries (DB/storage size,
-- per-feature latency percentiles). Everything else (per-faculty joins, cost/hours
-- aggregation) is done in TypeScript at pilot scale — see src/lib/pilot-analysis/.

-- ── Storage / DB size snapshots ──────────────────────────────────────────────
CREATE TABLE storage_usage_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  db_size_bytes BIGINT NOT NULL,
  storage_size_bytes BIGINT NOT NULL
);
CREATE INDEX idx_storage_snapshots_captured_at ON storage_usage_snapshots(captured_at);
ALTER TABLE storage_usage_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins see storage snapshots" ON storage_usage_snapshots FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);
CREATE POLICY "Service role full access storage snapshots" ON storage_usage_snapshots FOR ALL TO service_role USING (true);

-- ── Manually-maintained incident / downtime log ──────────────────────────────
-- NOT automated uptime monitoring (an app can't reliably log its own downtime).
-- Real uptime % comes from an external monitor (UptimeRobot/Better Stack) Dhruv sets
-- up separately. This table is a presentable, human-curated incident record.
CREATE TABLE system_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER,
  cause TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_system_incidents_occurred_at ON system_incidents(occurred_at);
ALTER TABLE system_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins see system incidents" ON system_incidents FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);
CREATE POLICY "Service role full access system incidents" ON system_incidents FOR ALL TO service_role USING (true);

-- ── Pilot-analysis settings (single-row key/value; e.g. Gemini recharge budget) ─
CREATE TABLE pilot_analysis_settings (
  key TEXT PRIMARY KEY,
  value NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);
ALTER TABLE pilot_analysis_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins see pilot settings" ON pilot_analysis_settings FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);
CREATE POLICY "Service role full access pilot settings" ON pilot_analysis_settings FOR ALL TO service_role USING (true);

-- ── SECURITY DEFINER helpers (callable via supabase.rpc() with the service role) ─

CREATE OR REPLACE FUNCTION get_db_size_bytes()
RETURNS BIGINT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT pg_database_size(current_database());
$$;

-- storage.objects.metadata is JSONB with a numeric 'size' key in current Supabase.
-- If a future Supabase version changes this shape, adjust here (see report note).
CREATE OR REPLACE FUNCTION get_storage_size_bytes()
RETURNS BIGINT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(SUM((metadata->>'size')::bigint), 0) FROM storage.objects;
$$;

-- Per-feature latency percentiles over ai_call_logs. Uses percentile_cont (proper
-- continuous percentile) rather than a JS approximation. `since_ts` NULL = all time.
CREATE OR REPLACE FUNCTION get_feature_latency_percentiles(since_ts TIMESTAMPTZ DEFAULT NULL)
RETURNS TABLE(feature TEXT, sample_count BIGINT, p50_ms DOUBLE PRECISION, p95_ms DOUBLE PRECISION)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    l.feature,
    COUNT(*)::bigint AS sample_count,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY l.latency_ms) AS p50_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY l.latency_ms) AS p95_ms
  FROM ai_call_logs l
  WHERE l.latency_ms IS NOT NULL
    AND (since_ts IS NULL OR l.created_at >= since_ts)
  GROUP BY l.feature;
$$;
