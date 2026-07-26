"use client";

/**
 * The reveal — what appears IN PLACE below a question once it's answered.
 *
 * TRANSITION MECHANICS (the thing that makes this feel like flashcards rather
 * than a test — treated as a requirement, not polish):
 *
 *  1. NO LAYOUT SHIFT ON THE QUESTION. This panel is appended below the
 *     question card's own content; the stem and options never move. The
 *     panel animates its own height in from 0 via a grid-template-rows
 *     transition (`grid-rows-[0fr] → grid-rows-[1fr]`), which is the one
 *     technique that animates to *auto* height without measuring in JS.
 *  2. THE CORRECTNESS INDICATOR ANIMATES IN, it is not a hard swap — a 220ms
 *     scale+fade on the icon. A hard swap at the moment of judgement reads as
 *     a verdict slamming down.
 *  3. THE EXPLANATION FADES IN WITH THE REVEAL, NOT BEFORE — 90ms delay, so
 *     the student registers correct/incorrect first and then reads. Both
 *     arriving simultaneously makes the eye choose, and it chooses the prose,
 *     which is the wrong order for learning.
 *  4. `prefers-reduced-motion` collapses all of it to an instant show. The
 *     mechanic must not depend on motion to be usable.
 *
 * COLOUR: emerald for correct, AMBER for wrong. Never red — §16, and here it
 * matters most, because this is the exact moment a student is most likely to
 * read a colour as a judgement about them.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, MessageCircleQuestion, X } from "lucide-react";

import RichQuestionText from "@/components/RichQuestionText";
import { Button } from "@/components/ui/button";
import { peerStatLabel } from "@/lib/assessment/peerStat";
import { cn } from "@/lib/utils";
import type { AnswerFeedback } from "./types";

export default function RevealPanel({
  feedback,
  onAskAi,
  onNext,
  nextLabel = "Next question",
  isLast,
}: {
  feedback: AnswerFeedback;
  onAskAi: () => void;
  onNext: () => void;
  nextLabel?: string;
  isLast: boolean;
}) {
  // Mount at collapsed height, then expand on the next frame — a CSS
  // transition needs two committed states to animate between.
  //
  // Replaying the animation for the NEXT question is the caller's job, via
  // `key={feedback.slotId}` on this component: remounting is how you reset
  // animation state in React. The obvious alternative — an effect that
  // setState(false)s on a slotId change — is a cascading render and lint
  // correctly rejects it.
  const [shown, setShown] = useState(false);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    raf.current = requestAnimationFrame(() => setShown(true));
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    };
  }, []);

  const correct = feedback.isCorrect;

  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
        shown ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      )}
    >
      {/* min-h-0 + overflow-hidden is what makes the 0fr row actually clip. */}
      <div className="min-h-0 overflow-hidden">
        <div
          className={cn(
            "mt-4 rounded-lg border-2 p-4",
            correct
              ? "border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-950/20"
              : "border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20"
          )}
        >
          {/* ── correctness ─────────────────────────────────────────────── */}
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-7 items-center justify-center rounded-full transition-all duration-200 ease-out motion-reduce:transition-none",
                shown ? "scale-100 opacity-100" : "scale-75 opacity-0",
                correct
                  ? "bg-emerald-600 text-white"
                  : "bg-amber-500 text-white"
              )}
            >
              {correct ? <Check className="size-4" /> : <X className="size-4" />}
            </span>
            <span
              className={cn(
                "text-sm font-semibold",
                correct
                  ? "text-emerald-800 dark:text-emerald-300"
                  : "text-amber-800 dark:text-amber-300"
              )}
            >
              {/* Wrong-answer copy names the gap, never the student. */}
              {correct ? "Correct" : "Not quite"}
            </span>
            {feedback.peerStat != null ? (
              <span className="ml-auto text-[11px] text-muted-foreground">
                {peerStatLabel(feedback.peerStat)}
              </span>
            ) : null}
          </div>

          {/* ── the answer + explanation, one beat later ─────────────────── */}
          <div
            className={cn(
              "transition-opacity duration-200 ease-out delay-[90ms] motion-reduce:transition-none motion-reduce:delay-0",
              shown ? "opacity-100" : "opacity-0"
            )}
          >
            {!correct ? (
              <p className="mt-3 text-sm">
                <span className="text-muted-foreground">Correct answer: </span>
                <span className="font-medium">
                  <RichQuestionText text={feedback.correctAnswer} />
                </span>
              </p>
            ) : null}

            {feedback.explanation ? (
              <div className="mt-3 text-sm leading-relaxed text-foreground/90">
                <RichQuestionText text={feedback.explanation} />
              </div>
            ) : null}

            {/* ── the two chips ─────────────────────────────────────────── */}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onAskAi}
                className="gap-1.5"
              >
                <MessageCircleQuestion className="size-3.5" />
                Ask AI why
              </Button>
              <Button type="button" size="sm" onClick={onNext} className="gap-1.5">
                {isLast ? "Finish" : nextLabel}
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
