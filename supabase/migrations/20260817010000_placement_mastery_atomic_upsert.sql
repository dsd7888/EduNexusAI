-- CP-05: atomic upsert for placement_topic_mastery.
--
-- api/placement/prep/submit/route.ts Step 3 previously did a plain SELECT,
-- computed attempts_count/correct_count/sessions_count/recent_accuracy in JS,
-- then UPDATE/INSERT the result back. Two honest concurrent submits for the
-- same (student_id, track, topic) both read the same pre-image and each
-- write their own delta on top of it, silently dropping one submission's
-- contribution (a lost update, not a duplicate — the audit trail in
-- placement_question_attempts still gets both inserts).
--
-- This function replaces that read-then-write with a single atomic unit:
-- a transaction-scoped advisory lock serializes concurrent calls for the
-- same key (closing both the update-vs-update race and the insert-vs-insert
-- race for a brand-new topic), then replicates the route's exact math and
-- four-branch difficulty ladder inside the same transaction.
--
-- placement_topic_mastery itself is a pre-existing table (not created by a
-- tracked migration in this repo) — this migration only adds the function.

CREATE OR REPLACE FUNCTION upsert_placement_topic_mastery(
  p_student_id uuid,
  p_track text,
  p_topic text,
  p_session_attempted integer,
  p_session_correct integer,
  p_session_accuracy numeric,
  OUT mastery placement_topic_mastery,
  OUT prev_difficulty text
)
RETURNS record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing placement_topic_mastery%ROWTYPE;
  v_new_attempts integer;
  v_new_correct integer;
  v_new_sessions integer;
  v_new_accuracy numeric;
  v_weight_existing numeric;
  v_weight_new numeric;
  v_current_diff text;
  v_new_diff text;
BEGIN
  -- Transaction-scoped: releases automatically even if the calling request
  -- is aborted mid-flight (network drop, timeout) — no stuck-lock risk.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_student_id::text || '|' || p_track || '|' || p_topic, 0)
  );

  SELECT * INTO v_existing
  FROM placement_topic_mastery
  WHERE student_id = p_student_id AND track = p_track AND topic = p_topic;

  IF NOT FOUND THEN
    prev_difficulty := NULL;

    INSERT INTO placement_topic_mastery (
      student_id, track, topic, attempts_count, correct_count, sessions_count,
      recent_accuracy, current_difficulty, last_practiced_at
    ) VALUES (
      p_student_id, p_track, p_topic,
      p_session_attempted, p_session_correct, 1,
      round(p_session_accuracy, 2), 'easy', now()
    )
    RETURNING * INTO mastery;

    RETURN;
  END IF;

  v_current_diff := COALESCE(v_existing.current_difficulty, 'easy');
  prev_difficulty := v_current_diff;

  v_new_attempts := COALESCE(v_existing.attempts_count, 0) + p_session_attempted;
  v_new_correct := COALESCE(v_existing.correct_count, 0) + p_session_correct;
  v_new_sessions := COALESCE(v_existing.sessions_count, 0) + 1;

  -- Weighted accuracy: existing history capped at 20 attempts of weight,
  -- this session weighted by its own attempt count — matches the JS route's
  -- Math.min(prevAttempts, 20) / sessionAttempted weighting exactly.
  v_weight_existing := LEAST(COALESCE(v_existing.attempts_count, 0), 20);
  v_weight_new := p_session_attempted;
  v_new_accuracy := (
    COALESCE(v_existing.recent_accuracy, 0) * v_weight_existing
    + p_session_accuracy * v_weight_new
  ) / GREATEST(v_weight_existing + v_weight_new, 1);

  -- Four-branch promote/demote ladder, identical thresholds/order to the
  -- JS route being replaced.
  v_new_diff := v_current_diff;
  IF v_new_accuracy >= 70 AND v_new_attempts >= 10
     AND v_current_diff = 'easy' AND v_new_sessions >= 2 THEN
    v_new_diff := 'medium';
  ELSIF v_new_accuracy >= 70 AND v_new_attempts >= 10
        AND v_current_diff = 'medium' AND v_new_sessions >= 2 THEN
    v_new_diff := 'hard';
  ELSIF v_new_accuracy < 40 AND v_new_attempts >= 5
        AND v_current_diff = 'hard' THEN
    v_new_diff := 'medium';
  ELSIF v_new_accuracy < 40 AND v_new_attempts >= 5
        AND v_current_diff = 'medium' THEN
    v_new_diff := 'easy';
  END IF;

  UPDATE placement_topic_mastery
  SET
    attempts_count = v_new_attempts,
    correct_count = v_new_correct,
    sessions_count = v_new_sessions,
    recent_accuracy = round(v_new_accuracy, 2),
    current_difficulty = v_new_diff,
    last_practiced_at = now()
  WHERE student_id = p_student_id AND track = p_track AND topic = p_topic
  RETURNING * INTO mastery;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_placement_topic_mastery(
  uuid, text, text, integer, integer, numeric
) TO service_role;
