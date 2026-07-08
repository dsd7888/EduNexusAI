CREATE TABLE ai_call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Who — nullable + snapshot fields so historical cost survives account deletion.
  -- ON DELETE SET NULL (not CASCADE) is deliberate: audit found usage_analytics.user_id
  -- and generated_content.generated_by both CASCADE, which destroys historical spend
  -- the moment a faculty profile is deleted. This table must not repeat that mistake.
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  user_email_snapshot TEXT,   -- captured at write time, survives user_id going null
  user_role_snapshot TEXT,    -- captured at write time (faculty/student/superadmin/etc.)

  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  subject_code_snapshot TEXT, -- captured at write time, survives subject_id going null

  -- What
  task TEXT NOT NULL,          -- matches TASK_TO_MODEL keys (chat, qpaper_gen, etc.)
  feature TEXT NOT NULL,       -- higher-level bucket for the analytics page:
                                -- ppt_generation | ppt_refine | qpaper | answer_key |
                                -- qbank | chat | quiz | placement | placement_practice |
                                -- explainer | syllabus | pyq_extraction |
                                -- admin_classification | refine
  model TEXT NOT NULL,         -- 'flash' | 'pro' | 'imagen'
  provider TEXT NOT NULL DEFAULT 'gemini',

  -- Cost inputs — token calls use input/output/thinking; image calls use image_count.
  -- unit_type disambiguates which fields are meaningful for a given row.
  unit_type TEXT NOT NULL DEFAULT 'tokens' CHECK (unit_type IN ('tokens', 'images')),
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  thinking_tokens INTEGER NOT NULL DEFAULT 0,
  image_count INTEGER NOT NULL DEFAULT 0,

  -- Cost outputs — fx_rate is a SNAPSHOT of the rate used at write time. If the rate
  -- is ever changed in pricing.ts later, historical rows must not silently recompute
  -- to a different value — this column is what makes old rows immutable-correct.
  cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  cost_inr NUMERIC(12, 4) NOT NULL DEFAULT 0,
  fx_rate NUMERIC(10, 4) NOT NULL,

  -- Outcome — every attempt gets a row, not just successes (audit found only
  -- successful routeAI returns are currently visible anywhere, even in console logs
  -- effectively, since failures throw before the log line).
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error', 'rate_limited')),
  error_message TEXT,
  latency_ms INTEGER,
  attempt_number INTEGER NOT NULL DEFAULT 1,

  -- Grouping — job_id ties every call belonging to one logical user action together
  -- (e.g. all 6 answer-key calls for one paper, all section calls for one Q paper,
  -- the outline+batch+diagram calls for one PPT). related_content_id links the group
  -- to the final generated_content (or equivalent) row once it exists, enabling the
  -- per-artifact drill-down ("this PPT: N Flash calls, M Pro calls, K Imagen images").
  job_id UUID NOT NULL,
  related_content_id UUID,

  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_ai_call_logs_created_at ON ai_call_logs(created_at);
CREATE INDEX idx_ai_call_logs_user ON ai_call_logs(user_id);
CREATE INDEX idx_ai_call_logs_task ON ai_call_logs(task);
CREATE INDEX idx_ai_call_logs_feature ON ai_call_logs(feature);
CREATE INDEX idx_ai_call_logs_job ON ai_call_logs(job_id);
CREATE INDEX idx_ai_call_logs_related_content ON ai_call_logs(related_content_id);
CREATE INDEX idx_ai_call_logs_status ON ai_call_logs(status);

ALTER TABLE ai_call_logs ENABLE ROW LEVEL SECURITY;

-- Superadmin-only read, matching the DB-level intent already established for
-- generated_content/usage_analytics ("Admins see all..." policies use
-- role IN ('superadmin','dept_admin') — no dean/hod, no faculty self-read).
-- This table is MORE sensitive than those (raw per-call cost), so it gets the
-- SAME restriction, deliberately not looser. If Dhruv wants dean/hod to see cost
-- later, that is a separate explicit decision — do not default to permissive.
CREATE POLICY "Admins see all ai_call_logs" ON ai_call_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);

-- No INSERT/UPDATE/DELETE policy for authenticated users at all — every write goes
-- through createAdminClient() (service role), which bypasses RLS. Add the explicit
-- service_role policy for clarity/consistency with the semantic_cache table's pattern:
CREATE POLICY "Service role full access ai_call_logs" ON ai_call_logs FOR ALL TO service_role USING (true);

-- Fix: audit found placement_gen inserts usage_analytics with subject_id: null, but
-- usage_analytics.subject_id is NOT NULL, so those inserts fail silently in a catch
-- block. Placement tests are legitimately not subject-scoped. Make it nullable:
ALTER TABLE usage_analytics ALTER COLUMN subject_id DROP NOT NULL;
