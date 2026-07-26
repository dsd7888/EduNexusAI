"use client";

/**
 * The streak indicator. Used in the /student/quiz landing header and the
 * mastery hub header (Part 5) — one component, so the two can't drift.
 *
 * All copy comes from `streakCopy()` in lib/assessment/streak.ts. Do not write
 * streak strings here: keeping them in one pure function is what makes the
 * no-guilt rule auditable (see that file's header for the banned framings).
 *
 * Deliberately small and quiet. A student who doesn't care about streaks
 * should be able to not notice this.
 */

import { Flame } from "lucide-react";

import { streakCopy, type StreakResult } from "@/lib/assessment/streak";
import { cn } from "@/lib/utils";

export default function StreakBadge({
  streak,
  className,
}: {
  streak: StreakResult | null;
  className?: string;
}) {
  if (!streak) return null;
  const { headline, sub } = streakCopy(streak);
  const active = streak.weeks > 0;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full border px-3 py-1.5",
        active
          ? "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30"
          : "border-border bg-muted/40",
        className
      )}
    >
      <Flame
        className={cn(
          "size-4 shrink-0",
          active
            ? "text-amber-500 dark:text-amber-400"
            : "text-muted-foreground"
        )}
        // The flame is decorative — the text beside it carries the meaning, so
        // identity is never colour- or icon-alone.
        aria-hidden
      />
      <div className="leading-tight">
        <span
          className={cn(
            "text-xs font-medium",
            active ? "text-amber-900 dark:text-amber-200" : "text-foreground"
          )}
        >
          {headline}
        </span>
        {sub ? (
          <span className="ml-1.5 text-xs text-muted-foreground">{sub}</span>
        ) : null}
      </div>
    </div>
  );
}
