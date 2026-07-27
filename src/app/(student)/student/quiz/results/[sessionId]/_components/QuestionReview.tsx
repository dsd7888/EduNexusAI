"use client";

/**
 * Per-question review (CP-Q3 Part 5A). Wrong questions expanded by default,
 * correct ones collapsed — a student's attention should land on what they got
 * wrong, not scroll past N correct cards to find it.
 *
 * "Ask AI why" reuses Part 4's chatHandoff.ts token pattern exactly — same
 * sessionStorage handoff, same destructive read on the chat side.
 */

import { useRouter } from "next/navigation";
import { Check, MessageCircleQuestion, X } from "lucide-react";

import RichQuestionText from "@/components/RichQuestionText";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { peerStatLabel } from "@/lib/assessment/peerStat";
import { writeQuizPrefill } from "@/lib/assessment/chatHandoff";
import { cn } from "@/lib/utils";
import type { PerQuestionResult } from "./types";

export default function QuestionReview({
  sessionId,
  results,
}: {
  sessionId: string;
  results: PerQuestionResult[];
}) {
  const router = useRouter();
  const defaultOpen = results
    .filter((r) => !r.isCorrect)
    .map((r) => `q-${r.questionIndex}`);

  const askAi = (r: PerQuestionResult) => {
    const token = writeQuizPrefill({
      sessionId,
      slotId: `results-${r.questionIndex}`,
      subjectId: r.subjectId,
      question: r.stem,
      studentAnswer: r.studentAnswer,
      correctAnswer: r.correctAnswer,
      explanation: r.explanation,
    });
    router.push(
      token
        ? `/student/chat/${r.subjectId}?prefill=${encodeURIComponent(token)}`
        : `/student/chat/${r.subjectId}`
    );
  };

  return (
    <div className="space-y-2">
      <h2 className="text-base font-semibold">Question by question</h2>
      <Accordion type="multiple" defaultValue={defaultOpen} className="rounded-lg border">
        {results.map((r) => (
          <AccordionItem key={r.questionIndex} value={`q-${r.questionIndex}`} className="px-4 last:border-b-0">
            <AccordionTrigger className="gap-3 py-3 hover:no-underline">
              <div className="flex flex-1 items-center gap-3 text-left">
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full",
                    r.isCorrect
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                  )}
                >
                  {r.isCorrect ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                </span>
                <span className="line-clamp-1 text-sm font-medium">
                  Q{r.questionIndex + 1}. <RichQuestionText text={r.stem} />
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 pl-9">
                <div className="text-sm leading-relaxed">
                  <RichQuestionText text={r.stem} />
                </div>
                {r.options ? (
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {r.options.map((opt, i) => (
                      <li key={i}>
                        {String.fromCharCode(65 + i)}. <RichQuestionText text={opt} />
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="space-y-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">Your answer: </span>
                    <span className="font-medium">
                      {r.studentAnswer ? <RichQuestionText text={r.studentAnswer} /> : "— not answered —"}
                    </span>
                  </p>
                  {!r.isCorrect ? (
                    <p>
                      <span className="text-muted-foreground">Correct answer: </span>
                      <span className="font-medium">
                        <RichQuestionText text={r.correctAnswer} />
                      </span>
                    </p>
                  ) : null}
                  {r.peerStat != null ? (
                    <p className="text-xs text-muted-foreground">{peerStatLabel(r.peerStat)}</p>
                  ) : null}
                </div>

                {r.explanation ? (
                  <div className="text-sm leading-relaxed text-foreground/90">
                    <RichQuestionText text={r.explanation} />
                  </div>
                ) : null}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => askAi(r)}
                >
                  <MessageCircleQuestion className="size-3.5" />
                  Ask AI why
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
