-- Checkpoint 3: session tracking + idle auto-logout.
--
-- One row per (tab) login session. The activity signal that ends a session for
-- security (2h idle -> supabase.auth.signOut()) is the same signal that measures
-- "hours used" for Checkpoint 4's Pilot Analysis page.
--
-- SET NULL + snapshot fields (NOT CASCADE) is deliberate and matches ai_call_logs
-- from Checkpoint 2: deactivating/deleting a faculty account must not erase their
-- historical session data, since it feeds the pilot analysis.
CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  user_email_snapshot TEXT,
  user_role_snapshot TEXT,

  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  end_reason TEXT CHECK (end_reason IN ('idle_timeout', 'manual_logout', 'replaced')),

  device_label TEXT, -- best-effort from User-Agent; NULL is fine, never block on this

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_started_at ON user_sessions(started_at);
CREATE INDEX idx_user_sessions_ended_at ON user_sessions(ended_at);
CREATE INDEX idx_user_sessions_last_activity ON user_sessions(last_activity_at);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins see all user_sessions" ON user_sessions FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);
CREATE POLICY "Service role full access user_sessions" ON user_sessions FOR ALL TO service_role USING (true);
-- No authenticated-user INSERT/UPDATE policy — all writes go through adminClient in
-- the three /api/session routes, which independently verify sessionId ownership in
-- application code (adminClient bypasses RLS).
