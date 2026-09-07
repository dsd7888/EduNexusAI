-- CP-06: atomic per-student reservation cap for interview/mock/follow-up.
--
-- The route previously read a count of matching ai_call_logs rows, checked
-- it against the cap, and only then called the AI — a check-then-act race
-- made worse than usual because ai_call_logs rows are written by routeAI's
-- deferred after() hook, which runs strictly after the response is sent.
-- Under a concurrent burst, every in-flight request reads the same
-- pre-burst count (none of its siblings has landed a log row yet), giving a
-- 100% bypass rather than a marginal overrun — confirmed live at 8/8
-- through against a cap of 5.
--
-- interview_followup_reservations is a dedicated gating table, deliberately
-- decoupled from ai_call_logs (telemetry vs. gating are different concerns).
-- reserve_interview_followup() serializes concurrent calls for the same
-- student on a transaction-scoped advisory lock, counts existing
-- reservations in the window *after* acquiring the lock, and only inserts
-- a new reservation if under cap — count-check-and-reserve as one atomic
-- unit.

CREATE TABLE IF NOT EXISTS interview_followup_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS interview_followup_reservations_user_created_idx
  ON interview_followup_reservations (user_id, created_at);

-- Default-deny direct PostgREST access — server-only, always reached via
-- the service-role admin client, same posture as other server-only counters.
ALTER TABLE interview_followup_reservations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION reserve_interview_followup(
  p_user_id uuid,
  p_window_start timestamptz,
  p_cap integer,
  OUT reservation_id uuid,
  OUT calls_used integer
)
RETURNS record
LANGUAGE plpgsql
AS $$
BEGIN
  -- Transaction-scoped: releases automatically on an aborted/dropped
  -- request, same guarantee as CP-05's advisory lock.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT count(*) INTO calls_used
  FROM interview_followup_reservations
  WHERE user_id = p_user_id AND created_at >= p_window_start;

  IF calls_used >= p_cap THEN
    reservation_id := NULL;
    RETURN;
  END IF;

  INSERT INTO interview_followup_reservations (user_id)
  VALUES (p_user_id)
  RETURNING id INTO reservation_id;

  calls_used := calls_used + 1;
END;
$$;

-- Not SECURITY DEFINER — this route always calls via the service-role admin
-- client, which already bypasses RLS; explicit grants kept for clarity.
GRANT SELECT, INSERT, DELETE ON interview_followup_reservations TO service_role;
GRANT EXECUTE ON FUNCTION reserve_interview_followup(
  uuid, timestamptz, integer
) TO service_role;
