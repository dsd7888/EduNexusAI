-- ============================================================================
-- Resume state on student_question_attempts — what the student was ALREADY TOLD
--
-- THE BUG THIS CLOSES:
--
--   A student starts a Quick Check / Module Mastery session, answers 3 of 10,
--   navigates away, and resumes via the landing page's "Continue where you left
--   off" strip (ContinueStrip.tsx, CP-Q3 Part 3). They land back on Question 1
--   with 0 answered. Their answers are NOT gone from the database —
--   student_question_attempts has every row — they are gone from the UI,
--   because nothing ever reads them back.
--
--   GET /api/assessment/session/[id] returns only session.config.questions (the
--   static served set) and the clock. PracticeRunner/ExamRunner therefore
--   initialise `index = 0` and every slot to emptyAnswer(), because there is
--   nothing in the payload to initialise them from.
--
--   The resume route's own doc comment already prescribes the fix and has since
--   CP-Q3 Part 1: "if resume ever needs to show already-revealed answers
--   (immediate-feedback modes), read them from student_question_attempts — the
--   record of what the student was already told — never from the key."
--
-- WHY THAT PRESCRIPTION NEEDS A SCHEMA CHANGE TO BE FOLLOWABLE:
--
--   The table does not currently carry what a student was told. It carries what
--   they SUBMITTED (student_answer) and whether it was right (is_correct) — not
--   the correct answer they were shown, and not the explanation they read. The
--   only other copy of those lives in quiz_session_keys, and the resume route is
--   FORBIDDEN from reading that table (CP-Q3 Part 1's invariant: the session is
--   still in progress, and being wrong even once about which slots are already
--   answered would leak upcoming answers to a student mid-session). So the
--   revealed text has to be persisted at reveal time, by the route that already
--   revealed it.
--
-- THE THREE COLUMNS:
--
--   slot_id          the session-local slot identity. Not answer-key data —
--                    it is the same identifier the client already sends to
--                    /api/assessment/answer in its request body. Written for
--                    EVERY mode (see below).
--   correct_answer   what /answer already returned to this student for this
--                    question.
--   explanation      likewise.
--
--   correct_answer / explanation are written ONLY for immediate-feedback modes
--   (MODE_CONFIG[mode].immediateFeedback). exam_sim's 30-second autosave calls
--   the same route with silent:true purely to persist progress; it must never
--   deposit correctness or explanations into the attempts table for an
--   in-progress exam, even latently. The guard lives in the route, not in a
--   CHECK constraint, because the mode is not a column on this table.
--
--   slot_id is deliberately NOT gated that way. It is not answer-key data, and
--   exam_sim is the mode that most needs it: it is the only mode where a student
--   can re-answer, so it is the only mode that produces multiple rows per slot,
--   and resolving "latest answer per slot" is exactly what slot_id is for.
--
-- WHY slot_id AT ALL, when results/[sessionId] matches attempts to slots by
-- (subject_id, module_id, question_text):
--
--   That match is a heuristic. Two questions with identical stem text in one
--   session (a repeated bank question served across two modules is the realistic
--   case) collide, and the map silently keeps one. On the results page that
--   misattributes a row after the fact; on RESUME it would show a student the
--   wrong feedback for the question in front of them, mid-session. A real
--   identifier removes the ambiguity rather than narrowing it.
--
-- ALL THREE ARE NULLABLE, WITH NO BACKFILL. Rows written before this migration
-- genuinely do not have this information — correct_answer and explanation were
-- never recorded anywhere recoverable per-row, and inventing them from the
-- session key is precisely the read this design forbids. A pre-migration session
-- therefore resumes exactly as it does today (at question 1), which is the
-- current behaviour, not a new regression. Same "legacy rows just don't have the
-- field" precedent as masterySnapshot's warnings:["no_snapshot"] (CP-Q3 Part 5).
--
-- NO NEW INDEX. The resume read is `WHERE session_id = $1 AND student_id = $2`,
-- already served by idx_sqa_session, and returns at most one session's rows (65
-- in the largest preset, GATE exam_sim). Latest-per-slot is resolved in JS over
-- that set. An index on (session_id, slot_id) would earn nothing at this size.
--
-- Apply manually. Safe to re-run: ADD COLUMN IF NOT EXISTS throughout, no data
-- movement, no constraint changes, no RLS changes (the existing sqa_* policies
-- cover these columns — RLS is row-level, and no policy enumerates columns).
-- ============================================================================

ALTER TABLE student_question_attempts
  ADD COLUMN IF NOT EXISTS slot_id        text,
  ADD COLUMN IF NOT EXISTS correct_answer text,
  ADD COLUMN IF NOT EXISTS explanation    text;

COMMENT ON COLUMN student_question_attempts.slot_id IS
  'Session-local slot identity (quiz_sessions.config.questions[].slotId). Written for every mode. Nullable: rows predating 20260813000000 have none.';

COMMENT ON COLUMN student_question_attempts.correct_answer IS
  'The correct answer THIS STUDENT WAS ALREADY SHOWN for this question. Written only when MODE_CONFIG[mode].immediateFeedback — never for exam_sim, whose silent autosave uses the same route. Read back on resume so the route never has to touch quiz_session_keys.';

COMMENT ON COLUMN student_question_attempts.explanation IS
  'The explanation THIS STUDENT WAS ALREADY SHOWN. Same immediate-feedback-only rule as correct_answer.';
