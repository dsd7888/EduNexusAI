-- app_error_logs — runtime error visibility for the student pilot.
--
-- The platform had no error monitoring of any kind: no Sentry, no PostHog, no
-- log drain. `ai_call_logs` records what was SPENT but not what BROKE, and
-- Vercel's own runtime logs are only useful if someone is already looking. With
-- 50 pilot students the first signal that a route is 500ing would have been a
-- student mentioning it — if they bothered.
--
-- Deliberately modelled on ai_call_logs (same posture, same instincts):
--   * service-role writes only, no client ever inserts here;
--   * RLS on with no permissive policy, so a leaked anon key reads nothing;
--   * snapshot columns (user_email_snapshot) so a deleted user's errors stay
--     readable, matching ai_call_logs' rationale;
--   * bounded text — a raw upstream HTML error body once got dumped into logs
--     unbounded (AU-QUIZ / AU-PLACE-CORE S3, fixed in CP-24), so message and
--     stack are capped by the writer AND the DB has no reason to hold more.
--
-- NOT a general log sink. Only handled 5xx paths and genuinely unhandled request
-- errors write here. Do not add debug/info rows — the value of this table during
-- a pilot is that every row in it is something that went wrong.

CREATE TABLE IF NOT EXISTS app_error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Where. `scope` matches the string already passed to logCappedError
  -- (e.g. "[placement-prep] Unexpected handler error:"), `route` is the
  -- request path when one is resolvable.
  scope TEXT NOT NULL,
  route TEXT,
  http_method TEXT,

  -- Who. Nullable: unauthenticated and pre-auth failures are exactly the ones
  -- worth seeing, so this must never be required.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email_snapshot TEXT,
  user_role_snapshot TEXT,

  -- What. Both capped by the writer (src/lib/api/helpers.ts).
  message TEXT NOT NULL,
  stack TEXT,

  -- How it was caught: 'handled' = a route's own catch block; 'unhandled' =
  -- Next.js instrumentation onRequestError, i.e. nothing caught it at all.
  origin TEXT NOT NULL DEFAULT 'handled'
    CHECK (origin IN ('handled', 'unhandled')),

  metadata JSONB DEFAULT '{}'::jsonb
);

-- Newest-first is the only read pattern the dashboard has.
CREATE INDEX IF NOT EXISTS idx_app_error_logs_created_at
  ON app_error_logs(created_at DESC);

-- "What is this one student hitting?" during a pilot triage conversation.
CREATE INDEX IF NOT EXISTS idx_app_error_logs_user
  ON app_error_logs(user_id, created_at DESC);

-- "Is one route responsible for most of today's errors?"
CREATE INDEX IF NOT EXISTS idx_app_error_logs_scope
  ON app_error_logs(scope, created_at DESC);

-- RLS: enabled with NO permissive policy. Every write goes through the service
-- role (createAdminClient), every read goes through a superadmin-gated API
-- route that also uses the service role. Same posture as CP-05/CP-06's tables.
ALTER TABLE app_error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access app_error_logs" ON app_error_logs;
CREATE POLICY "Service role full access app_error_logs"
  ON app_error_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE app_error_logs IS
  'Runtime errors from student-facing API routes + unhandled request errors. Service-role only. Pilot-scale error visibility; not a general log sink.';
