"use client";

/**
 * Exam-sim question navigator: a status grid, grouped by section.
 *
 * THREE STATES, NO RED (§16):
 *   answered  → primary fill
 *   marked    → amber ring (marked-for-review; may also be answered)
 *   unanswered→ muted outline. Absence, not error.
 *
 * "Section" is derived from `subjectId` — CP-Q2's exam_sim is the only
 * multi-subject mode, and a GATE mock's sections ARE its subjects. When a
 * session is single-subject the grouping collapses to one unlabelled block
 * rather than showing a section header with nothing to distinguish.
 */

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AnswerState, SessionQuestion } from "./types";

export interface GridSection {
  subjectId: string;
  label: string;
  indices: number[];
}

/** Group question indices into sections, preserving paper order. */
export function buildSections(
  questions: SessionQuestion[],
  subjectNames: Record<string, string>
): GridSection[] {
  const out: GridSection[] = [];
  questions.forEach((q, i) => {
    const last = out[out.length - 1];
    if (last && last.subjectId === q.subjectId) {
      last.indices.push(i);
      return;
    }
    out.push({
      subjectId: q.subjectId,
      label: subjectNames[q.subjectId] ?? "Section",
      indices: [i],
    });
  });
  return out;
}

export default function QuestionGrid({
  questions,
  answers,
  sections,
  currentIndex,
  onJump,
}: {
  questions: SessionQuestion[];
  answers: Record<string, AnswerState>;
  sections: GridSection[];
  currentIndex: number;
  onJump: (index: number) => void;
}) {
  const counts = questions.reduce(
    (acc, q) => {
      const a = answers[q.slotId];
      if (a?.value) acc.answered += 1;
      else acc.unanswered += 1;
      if (a?.markedForReview) acc.marked += 1;
      return acc;
    },
    { answered: 0, unanswered: 0, marked: 0 }
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <Badge variant="secondary" className="font-normal tabular-nums">
          {counts.answered} answered
        </Badge>
        <Badge variant="outline" className="font-normal tabular-nums">
          {counts.unanswered} unanswered
        </Badge>
        {counts.marked > 0 ? (
          <Badge
            variant="outline"
            className="border-amber-300 font-normal tabular-nums text-amber-700 dark:border-amber-800 dark:text-amber-300"
          >
            {counts.marked} marked
          </Badge>
        ) : null}
      </div>

      {sections.map((section, si) => (
        <div key={`${section.subjectId}-${si}`} className="space-y-1.5">
          {sections.length > 1 ? (
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {section.label}
            </p>
          ) : null}
          <div className="grid grid-cols-6 gap-1.5">
            {section.indices.map((i) => {
              const q = questions[i];
              const a = answers[q.slotId];
              const answered = Boolean(a?.value);
              const marked = Boolean(a?.markedForReview);
              return (
                <button
                  key={q.slotId}
                  type="button"
                  onClick={() => onJump(i)}
                  aria-label={`Question ${i + 1}${answered ? ", answered" : ", unanswered"}${
                    marked ? ", marked for review" : ""
                  }`}
                  aria-current={i === currentIndex}
                  className={cn(
                    "flex h-8 items-center justify-center rounded-md border text-xs font-medium tabular-nums transition-colors",
                    answered
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted",
                    marked && "ring-2 ring-amber-400 ring-offset-1",
                    i === currentIndex && "outline outline-2 outline-primary/50"
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
