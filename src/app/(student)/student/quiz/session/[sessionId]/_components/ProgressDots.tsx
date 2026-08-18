"use client";

/**
 * Slim progress indicator, top-center: "N of M answered".
 *
 * NO COLOURED RED FOR SKIPPED (§16). An unanswered question is muted — it is
 * absence, not error. There is also NO RUNNING SCORE here, and there must not
 * be one: correctness feedback per question is the mechanic; a live score
 * reintroduces the exam anxiety the immediate-feedback flow exists to remove.
 * The bar counts ANSWERED, never CORRECT.
 *
 * Above ~24 questions the dots become a bar — 60 dots is not a glanceable
 * indicator, it is a texture.
 */

import { cn } from "@/lib/utils";

const DOTS_MAX = 24;

export default function ProgressDots({
  total,
  answeredSlots,
  currentIndex,
  onJump,
}: {
  total: number;
  /** Indices that carry an answer. */
  answeredSlots: Set<number>;
  currentIndex: number;
  onJump?: (index: number) => void;
}) {
  const answered = answeredSlots.size;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="tabular-nums">
          {answered} of {total} answered
        </span>
      </div>

      {total <= DOTS_MAX ? (
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: total }).map((_, i) => {
            const isAnswered = answeredSlots.has(i);
            const isCurrent = i === currentIndex;
            return (
              <button
                key={i}
                type="button"
                aria-label={`Question ${i + 1}${isAnswered ? ", answered" : ""}`}
                aria-current={isCurrent}
                disabled={!onJump}
                onClick={() => onJump?.(i)}
                className={cn(
                  "h-1.5 flex-1 min-w-[10px] rounded-full transition-colors",
                  isAnswered ? "bg-primary/70" : "bg-muted",
                  isCurrent && "ring-2 ring-primary/40 ring-offset-1",
                  onJump ? "cursor-pointer" : "cursor-default"
                )}
              />
            );
          })}
        </div>
      ) : (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary/70 transition-[width] duration-300"
            style={{ width: `${total > 0 ? (answered / total) * 100 : 0}%` }}
          />
        </div>
      )}
    </div>
  );
}
