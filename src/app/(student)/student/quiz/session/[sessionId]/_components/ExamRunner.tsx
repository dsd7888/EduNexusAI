"use client";

/**
 * Exam Simulation — timed, sectioned, DEFERRED feedback.
 *
 * No correctness is shown, ever, until submit. The server enforces this
 * (/api/assessment/answer withholds feedback for a non-immediateFeedback mode),
 * so this component is not the last line of defence — but it must not ask, and
 * it doesn't: every persist call sets `silent: true`.
 *
 * PERSISTENCE: answers flush to the server every 30 seconds and on navigation,
 * so a mid-exam crash loses at most 30 seconds of work. The flush is
 * dirty-tracked (only changed answers are sent) and serialised, so a slow
 * network cannot stack overlapping flushes.
 *
 * TIMER EXPIRY: a 3-second warning, then a hard submit that cannot be
 * cancelled. Deliberately not a "your time is up, click OK" dialog — that turns
 * a fixed-duration exam into an unbounded one for whoever leaves the tab open.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Flag, Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import AnswerInput from "./AnswerInput";
import ExamTimer, { EXPIRY_WARNING_SECONDS } from "./ExamTimer";
import QuestionCard from "./QuestionCard";
import QuestionGrid, { buildSections } from "./QuestionGrid";
import {
  emptyAnswer,
  firstUnansweredIndex,
  hydrateAnswers,
  type AnswerState,
  type SessionPayload,
} from "./types";

const AUTOSAVE_MS = 30_000;

export default function ExamRunner({
  session,
  subjectNames,
  onSubmitted,
}: {
  session: SessionPayload;
  subjectNames: Record<string, string>;
  onSubmitted: (sessionId: string) => void;
}) {
  const questions = session.questions;

  // ── resume ────────────────────────────────────────────────────────────────
  // The autosave below flushes every 30 seconds precisely so that a crash costs
  // at most 30 seconds of work. That promise was only half-kept until this
  // hydration existed: the answers were being written and then discarded on
  // reload, while the server-side clock kept running — so a crash 40 minutes
  // into a 180-minute paper resumed with 140 minutes and an empty answer sheet.
  //
  // `hydrateFeedback: false`, permanently. A resumed exam is still an exam:
  // nothing about correctness may be restored, and the route does not send it
  // for this mode either (see AnsweredSlot). Two gates, deliberately.
  const [answers, setAnswers] = useState<Record<string, AnswerState>>(() =>
    hydrateAnswers(questions, session.answeredSlots, false)
  );
  // Open on the first unanswered question — a returning student continues where
  // they stopped rather than paging back through work they already did.
  const [index, setIndex] = useState(() => firstUnansweredIndex(questions, answers));
  const [navOpen, setNavOpen] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [expiring, setExpiring] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const mounted = useRef(true);
  const flushingRef = useRef(false);
  const submittedRef = useRef(false);
  // Answers live in a ref as well as state, so the autosave interval and the
  // unload handler read the CURRENT values without re-subscribing every keypress.
  const answersRef = useRef(answers);
  answersRef.current = answers;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const question = questions[index];
  const current = answers[question?.slotId ?? ""] ?? emptyAnswer();
  const sections = useMemo(
    () => buildSections(questions, subjectNames),
    [questions, subjectNames]
  );
  const unansweredCount = questions.filter((q) => !answers[q.slotId]?.value).length;

  const enteredAt = useRef(Date.now());
  useEffect(() => {
    enteredAt.current = Date.now();
  }, [index]);

  const setValue = useCallback((slotId: string, value: string | null) => {
    setAnswers((prev) => ({
      ...prev,
      // saved:false marks it dirty for the next flush.
      [slotId]: { ...(prev[slotId] ?? emptyAnswer()), value, saved: false },
    }));
  }, []);

  const toggleMark = useCallback(() => {
    const q = questions[index];
    if (!q) return;
    setAnswers((prev) => ({
      ...prev,
      [q.slotId]: {
        ...(prev[q.slotId] ?? emptyAnswer()),
        markedForReview: !prev[q.slotId]?.markedForReview,
      },
    }));
  }, [index, questions]);

  // ── flush dirty answers ───────────────────────────────────────────────────
  const flush = useCallback(async () => {
    if (flushingRef.current || submittedRef.current) return;
    const dirty = questions.filter((q) => {
      const a = answersRef.current[q.slotId];
      return a?.value != null && !a.saved;
    });
    if (dirty.length === 0) return;

    flushingRef.current = true;
    try {
      // Sequential, not Promise.all: 100 parallel writes from 60 students at
      // the same 30-second boundary is a self-inflicted thundering herd.
      for (const q of dirty) {
        const a = answersRef.current[q.slotId];
        if (!a?.value) continue;
        const res = await fetch("/api/assessment/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: session.sessionId,
            slotId: q.slotId,
            studentAnswer: a.value,
            timeTakenSeconds: a.timeSpent || null,
            // Deferred-feedback mode: persist only. Never request grading.
            silent: true,
          }),
        });
        if (!res.ok) {
          // Leave it dirty so the next flush retries it. A 409 (time up /
          // already submitted) is terminal for the whole flush, though.
          if (res.status === 409) break;
          continue;
        }
        if (!mounted.current) return;
        setAnswers((prev) => ({
          ...prev,
          [q.slotId]: { ...(prev[q.slotId] ?? emptyAnswer()), saved: true },
        }));
      }
      if (mounted.current) setLastSavedAt(Date.now());
    } catch {
      // Silent: an autosave failure must not interrupt an exam. The answers
      // stay dirty and the next tick retries.
    } finally {
      flushingRef.current = false;
    }
  }, [questions, session.sessionId]);

  useEffect(() => {
    const id = setInterval(() => void flush(), AUTOSAVE_MS);
    return () => clearInterval(id);
  }, [flush]);

  // Flush on navigation too — cheap, and it means the 30s window is a
  // worst case for an idle student rather than the norm.
  const jump = useCallback(
    (i: number) => {
      const q = questions[index];
      if (q) {
        const spent = Math.round((Date.now() - enteredAt.current) / 1000);
        setAnswers((prev) => ({
          ...prev,
          [q.slotId]: {
            ...(prev[q.slotId] ?? emptyAnswer()),
            timeSpent: (prev[q.slotId]?.timeSpent ?? 0) + spent,
          },
        }));
      }
      setIndex(Math.max(0, Math.min(i, questions.length - 1)));
      void flush();
    },
    [flush, index, questions]
  );

  // ── submit ────────────────────────────────────────────────────────────────
  const doSubmit = useCallback(
    async (reason: "manual" | "expiry") => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      setError(null);
      try {
        // Best-effort final flush, but never block the submit on it: submit
        // carries every answer in its own payload, so a failed flush costs
        // nothing.
        await flush().catch(() => {});
        const payload = questions.map((q, i) => ({
          questionIndex: i,
          slotId: q.slotId,
          studentAnswer: answersRef.current[q.slotId]?.value ?? null,
          timeTakenSeconds: answersRef.current[q.slotId]?.timeSpent ?? null,
        }));
        const res = await fetch("/api/assessment/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.sessionId, answers: payload }),
        });
        if (!res.ok && res.status !== 409) {
          const json = await res.json().catch(() => null);
          if (mounted.current) {
            setError(
              json?.error ??
                (reason === "expiry"
                  ? "Time is up, but submitting failed. Retrying is safe — your answers were saved."
                  : "Could not submit. Your answers were saved — try again.")
            );
            submittedRef.current = false;
            setSubmitting(false);
          }
          return;
        }
        onSubmitted(session.sessionId);
      } catch {
        if (mounted.current) {
          setError("Network problem. Your answers were saved — try again.");
          submittedRef.current = false;
          setSubmitting(false);
        }
      }
    },
    [flush, questions, session.sessionId, onSubmitted]
  );

  // ── expiry: 3-second warning, then hard submit ────────────────────────────
  const onExpire = useCallback(() => {
    if (submittedRef.current) return;
    setExpiring(true);
    setTimeout(() => void doSubmit("expiry"), EXPIRY_WARNING_SECONDS * 1000);
  }, [doSubmit]);

  // Warn on tab close only while there is unsaved work — an unconditional
  // beforeunload prompt on every exam page is the kind of thing students learn
  // to dismiss without reading.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (submittedRef.current) return;
      const dirty = questions.some((q) => {
        const a = answersRef.current[q.slotId];
        return a?.value != null && !a.saved;
      });
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [questions]);

  if (!question) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        This session has no questions.
      </p>
    );
  }

  return (
    <div className="pb-24">
      {/* ── header ─────────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setNavOpen((o) => !o)}
          >
            {navOpen ? "Hide" : "Show"} navigator
          </Button>
          {lastSavedAt ? (
            <span className="text-[11px] text-muted-foreground">
              saved {new Date(lastSavedAt).toLocaleTimeString("en-IN")}
            </span>
          ) : null}
        </div>
        {session.timeLimitMinutes ? (
          <ExamTimer
            startedAt={session.startedAt}
            timeLimitMinutes={session.timeLimitMinutes}
            onExpire={onExpire}
          />
        ) : null}
      </div>

      <div className={cn("gap-6", navOpen ? "lg:flex" : "")}>
        {navOpen ? (
          <aside className="mb-6 w-full shrink-0 lg:mb-0 lg:w-56">
            <div className="rounded-lg border p-3">
              <QuestionGrid
                questions={questions}
                answers={answers}
                sections={sections}
                currentIndex={index}
                onJump={jump}
              />
            </div>
          </aside>
        ) : null}

        <div className="min-w-0 flex-1">
          <QuestionCard question={question} index={index} total={questions.length}>
            <AnswerInput
              question={question}
              value={current.value}
              onChange={(v) => setValue(question.slotId, v)}
              revealed={false}
            />
          </QuestionCard>

          {error ? (
            <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-amber-600 dark:text-amber-500">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      {/* ── bottom bar ─────────────────────────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={index === 0}
              onClick={() => jump(index - 1)}
              className="gap-1"
            >
              <ArrowLeft className="size-4" />
              Prev
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={index === questions.length - 1}
              onClick={() => jump(index + 1)}
              className="gap-1"
            >
              Next
              <ArrowRight className="size-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={current.markedForReview ? "default" : "outline"}
              size="sm"
              onClick={toggleMark}
              className="gap-1.5"
            >
              <Flag className="size-3.5" />
              {current.markedForReview ? "Marked" : "Mark for review"}
            </Button>
            {/* Always enabled — a student must never be trapped in an exam.
                Confirms only when something is unanswered. */}
            <Button
              type="button"
              size="sm"
              disabled={submitting}
              onClick={() => {
                if (unansweredCount > 0) setConfirmOpen(true);
                else void doSubmit("manual");
              }}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                  Submitting
                </>
              ) : (
                "Submit"
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* ── unanswered confirmation ────────────────────────────────────── */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Submit with {unansweredCount} question
              {unansweredCount === 1 ? "" : "s"} unanswered?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {session.negativeMarking
                ? "Unanswered questions score zero — and unlike a wrong answer, they carry no negative marking."
                : "Unanswered questions score zero."}{" "}
              You can go back and use the navigator to find them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep working</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doSubmit("manual")}>
              Submit anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── expiry warning: informational, not cancellable ─────────────── */}
      <AlertDialog open={expiring}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-amber-500" aria-hidden />
              Time is up
            </AlertDialogTitle>
            <AlertDialogDescription>
              Submitting your paper now. Everything you answered has been saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
