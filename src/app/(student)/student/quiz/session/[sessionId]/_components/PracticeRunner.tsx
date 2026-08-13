"use client";

/**
 * Quick Check / Module Mastery — the immediate-feedback flow.
 *
 * THE MECHANIC: answer → the card transitions IN PLACE to a reveal state →
 * "Ask AI why" or "Next question". No navigation, no page change, no score.
 *
 * NO RUNNING SCORE MID-SESSION. Correctness per question is the mechanic; a
 * live tally is not, and adding one reintroduces exactly the exam anxiety this
 * flow exists to remove. The score exists once, at the end.
 *
 * CONCURRENCY: every handler that mutates state after an `await` is guarded.
 * `submittingRef` serialises answer submission (double-Enter, double-click),
 * and the in-flight slot is captured so a slow response for question 3 cannot
 * land on question 4 after the student advanced. This is the §17 rule learned
 * from the Syllabus Health Audit stale-audit race — a handler that setStates
 * after an await needs a staleness guard, no exceptions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { writeQuizPrefill } from "@/lib/assessment/chatHandoff";
import { cn } from "@/lib/utils";
import AnswerInput from "./AnswerInput";
import ProgressDots from "./ProgressDots";
import QuestionCard from "./QuestionCard";
import RevealPanel from "./RevealPanel";
import {
  emptyAnswer,
  firstUnansweredIndex,
  hydrateAnswers,
  type AnswerFeedback,
  type AnswerState,
  type SessionPayload,
} from "./types";

export default function PracticeRunner({
  session,
  onSubmitted,
}: {
  session: SessionPayload;
  onSubmitted: (sessionId: string) => void;
}) {
  const router = useRouter();
  const questions = session.questions;

  // ── resume ────────────────────────────────────────────────────────────────
  // Both of these are useState INITIALISERS, not effects. An effect that
  // setStates to correct a derived value fires after paint and cascades a
  // second render (§19 — "derive corrective state during render"); it would
  // also mean a resumed student sees question 1 flash before being moved to
  // question 4. `session` is fetched before this component mounts and never
  // changes identity underneath it, so the initialiser sees the real payload.
  const [answers, setAnswers] = useState<Record<string, AnswerState>>(() =>
    hydrateAnswers(questions, session.answeredSlots, true)
  );
  // Reads the hydrated map above — on the first render `answers` IS that map,
  // and this initialiser only ever runs then.
  const [index, setIndex] = useState(() => firstUnansweredIndex(questions, answers));
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submittingRef = useRef(false);
  const finishingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const question = questions[index];
  const current = answers[question?.slotId ?? ""] ?? emptyAnswer();
  const revealed = current.feedback != null;
  const isLast = index === questions.length - 1;

  // Time on question — accumulated per slot, reset on navigation.
  const enteredAt = useRef(Date.now());
  useEffect(() => {
    enteredAt.current = Date.now();
  }, [index]);

  const answeredIndices = useMemo(() => {
    const s = new Set<number>();
    questions.forEach((q, i) => {
      if (answers[q.slotId]?.feedback != null) s.add(i);
    });
    return s;
  }, [questions, answers]);

  const setValue = useCallback(
    (slotId: string, value: string | null) => {
      setAnswers((prev) => ({
        ...prev,
        [slotId]: { ...(prev[slotId] ?? emptyAnswer()), value },
      }));
    },
    []
  );

  // ── check one answer ──────────────────────────────────────────────────────
  const checkAnswer = useCallback(async () => {
    if (submittingRef.current) return;
    const q = questions[index];
    if (!q) return;
    const state = answers[q.slotId];
    if (!state?.value || state.feedback) return;

    submittingRef.current = true;
    setChecking(true);
    setError(null);
    // Captured so a late response cannot be applied to a different question.
    const slotId = q.slotId;
    const timeTakenSeconds = Math.round((Date.now() - enteredAt.current) / 1000);

    try {
      const res = await fetch("/api/assessment/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          slotId,
          studentAnswer: state.value,
          timeTakenSeconds,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!mounted.current) return;
      if (!res.ok || !json) {
        setError(json?.error ?? "Could not check that answer. Try again.");
        return;
      }
      const feedback: AnswerFeedback = {
        slotId,
        isCorrect: Boolean(json.isCorrect),
        correctAnswer: String(json.correctAnswer ?? ""),
        explanation: json.explanation ?? null,
        ...(typeof json.peerStat === "number" ? { peerStat: json.peerStat } : {}),
      };
      // Keyed write, so this lands on the right slot even if the student
      // navigated while the request was in flight.
      setAnswers((prev) => ({
        ...prev,
        [slotId]: {
          ...(prev[slotId] ?? emptyAnswer()),
          feedback,
          timeSpent: timeTakenSeconds,
          saved: true,
        },
      }));
    } catch {
      if (mounted.current) setError("Network problem — your answer wasn't recorded.");
    } finally {
      submittingRef.current = false;
      if (mounted.current) setChecking(false);
    }
  }, [answers, index, questions, session.sessionId]);

  // ── finish ────────────────────────────────────────────────────────────────
  // Submit re-grades server-side from the stored key and closes the session.
  // The per-question route already wrote the attempt rows; submit is what
  // computes the final score and moves mastery.
  const finish = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const payload = questions.map((q, i) => ({
        questionIndex: i,
        slotId: q.slotId,
        studentAnswer: answers[q.slotId]?.value ?? null,
        timeTakenSeconds: answers[q.slotId]?.timeSpent ?? null,
      }));
      const res = await fetch("/api/assessment/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.sessionId, answers: payload }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        // A 409 means it is already submitted — the results page is still the
        // right destination, so treat it as success rather than trapping the
        // student on a finished quiz.
        if (res.status === 409) {
          onSubmitted(session.sessionId);
          return;
        }
        if (mounted.current) {
          setError(json?.error ?? "Could not submit. Your answers are saved — try again.");
          finishingRef.current = false;
        }
        return;
      }
      onSubmitted(session.sessionId);
    } catch {
      if (mounted.current) {
        setError("Network problem — your answers are saved. Try submitting again.");
        finishingRef.current = false;
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }, [answers, questions, session.sessionId, onSubmitted]);

  const goNext = useCallback(() => {
    if (isLast) {
      void finish();
      return;
    }
    setIndex((i) => Math.min(i + 1, questions.length - 1));
  }, [isLast, finish, questions.length]);

  // ── Enter = check, then Enter = next ──────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      // Enter inside a button would double-fire with the click handler.
      if (target?.tagName === "BUTTON") return;
      e.preventDefault();
      if (revealed) goNext();
      else if (current.value && !checking) void checkAnswer();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [revealed, current.value, checking, checkAnswer, goNext]);

  // ── Ask AI why ────────────────────────────────────────────────────────────
  // sessionStorage + a short token, never the payload in the query string —
  // see lib/assessment/chatHandoff.ts for why.
  const askAi = useCallback(() => {
    const q = questions[index];
    const fb = answers[q.slotId]?.feedback;
    if (!q || !fb) return;
    const payload = {
      sessionId: session.sessionId,
      slotId: q.slotId,
      subjectId: q.subjectId,
      question: q.question,
      studentAnswer: answers[q.slotId]?.value ?? null,
      correctAnswer: fb.correctAnswer,
      explanation: fb.explanation,
    };
    const token = writeQuizPrefill(payload);
    // If storage is unavailable the prefill is dropped rather than stuffed into
    // the URL — the student still lands in the right subject's chat, just with
    // an empty composer, which is a degraded outcome and not a broken one.
    router.push(
      token
        ? `/student/chat/${q.subjectId}?prefill=${encodeURIComponent(token)}`
        : `/student/chat/${q.subjectId}`
    );
  }, [answers, index, questions, router, session.sessionId]);

  if (!question) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        This session has no questions.
      </p>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      <ProgressDots
        total={questions.length}
        answeredSlots={answeredIndices}
        currentIndex={index}
        onJump={(i) => setIndex(i)}
      />

      <QuestionCard
        question={question}
        index={index}
        total={questions.length}
        reveal={
          current.feedback ? (
            <RevealPanel
              // Remount per slot so the reveal animation replays on the next
              // question instead of the panel appearing already-expanded.
              key={current.feedback.slotId}
              feedback={current.feedback}
              onAskAi={askAi}
              onNext={goNext}
              isLast={isLast}
            />
          ) : undefined
        }
      >
        <AnswerInput
          question={question}
          value={current.value}
          onChange={(v) => setValue(question.slotId, v)}
          revealed={revealed}
          correctAnswer={current.feedback?.correctAnswer}
          disabled={checking}
        />
      </QuestionCard>

      {error ? (
        // Amber, never red (§16).
        <p className="mx-auto max-w-2xl text-center text-sm text-amber-600 dark:text-amber-500">
          {error}
        </p>
      ) : null}

      {/* ── bottom-right controls ──────────────────────────────────────────
          Fixed rather than in-flow so the reveal expanding never pushes the
          buttons under the fold mid-interaction. */}
      <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={index === 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            className="gap-1"
          >
            <ArrowLeft className="size-4" />
            Prev
          </Button>

          <div className="flex items-center gap-2">
            {!revealed ? (
              <Button
                type="button"
                size="sm"
                disabled={!current.value || checking}
                onClick={() => void checkAnswer()}
                className={cn("gap-1", checking && "opacity-80")}
              >
                {checking ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Checking
                  </>
                ) : (
                  "Check answer"
                )}
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={goNext} className="gap-1">
                {isLast ? "Finish" : "Next"}
                <ArrowRight className="size-4" />
              </Button>
            )}
            {/* Always available: a student may leave questions unanswered and
                still want their result. Confirms nothing here because there is
                no negative marking in the practice modes — an unanswered
                question simply scores zero, and nothing is lost by finishing. */}
            {!isLast ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={submitting}
                onClick={() => void finish()}
              >
                {submitting ? "Submitting…" : "Finish now"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
