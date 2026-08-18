"use client";

/**
 * The question shell — one question, centered column, max-w-2xl.
 *
 * Shares the chat surface's visual language: soft neutral background, card
 * shell, generous line-height on prose, and the SAME math rendering stack
 * (RichQuestionText → KaTeX + mhchem). Math rendering is imported, never
 * forked — a second LaTeX path would drift from chat's within one checkpoint.
 */

import RichQuestionText from "@/components/RichQuestionText";
import { MonoTag } from "@/components/ui/mono-tag";
import { cn } from "@/lib/utils";
import type { SessionQuestion } from "./types";

const TYPE_LABEL: Record<string, string> = {
  mcq: "Single correct",
  msq: "Multiple correct",
  multiple_correct: "Multiple correct",
  nat: "Numerical",
  true_false: "True / False",
  short: "Short answer",
  match: "Match",
};

export default function QuestionCard({
  question,
  index,
  total,
  children,
  reveal,
  className,
}: {
  question: SessionQuestion;
  index: number;
  total: number;
  /** The answer input. */
  children: React.ReactNode;
  /** The reveal panel, when there is one. */
  reveal?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-2xl", className)}>
      <div className="rounded-lg border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium tabular-nums">
            Question {index + 1} of {total}
          </span>
          <span aria-hidden>·</span>
          <MonoTag variant="default">
            {TYPE_LABEL[question.type] ?? question.type}
          </MonoTag>
          <MonoTag variant="default" className="ml-auto">
            {question.marks} mark{question.marks === 1 ? "" : "s"}
          </MonoTag>
        </div>

        {/* Generous line-height: these stems carry LaTeX and run long. */}
        <div className="mt-4 text-base leading-relaxed">
          <RichQuestionText text={question.question} />
        </div>

        <div className="mt-5">{children}</div>

        {reveal}
      </div>
    </div>
  );
}
