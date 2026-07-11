"use client";

/**
 * GeneratingStage — full-area takeover while a section is generated. The single
 * /generate request produces the whole section server-side (per-module Flash
 * calls, concurrency 4), so real per-call completion isn't streamed back. This
 * checklist animates optimistically (one row "done" every couple of seconds,
 * capped at N-1) and snaps all rows to done when the request resolves — the same
 * "engagement copy, not backend truth" convention the PPT/Q-paper GeneratingView
 * uses. Kept simple: generation is ≤120s, no cancel, no popstate hacks.
 */

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

interface GeneratingStageProps {
  subjectLabel: string;
  sectionLabel: string; // "Theory" | "Practical"
  items: string[]; // module names (theory) or a single "Practicals" row
  done: boolean; // request resolved — flip all rows done
}

const STEP_MS = 2200;

export function GeneratingStage({
  subjectLabel,
  sectionLabel,
  items,
  done,
}: GeneratingStageProps) {
  // Optimistic progress: tick advances on a timer (state set inside a timer
  // callback, never synchronously in the effect body), capped at N-1 until the
  // request resolves — then `done` snaps the derived count to N.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (done) return;
    const id = setInterval(() => setTick((t) => t + 1), STEP_MS);
    return () => clearInterval(id);
  }, [done]);

  const doneCount = done
    ? items.length
    : Math.min(tick, Math.max(0, items.length - 1));

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-8">
      <div className="rounded-lg border bg-card p-4">
        <p className="text-sm font-medium">{subjectLabel}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Generating {sectionLabel.toLowerCase()} lesson plan…
        </p>
      </div>

      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <Loader2 className="size-10 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          Writing pedagogical content for each {sectionLabel === "Theory" ? "module" : "practical"}.
        </p>
      </div>

      <ul className="rounded-lg border divide-y">
        {items.map((label, i) => {
          const isDone = i < doneCount;
          const isActive = i === doneCount && !done;
          return (
            <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              {isDone ? (
                <Check className="size-4 text-emerald-600 shrink-0" />
              ) : isActive ? (
                <Loader2 className="size-4 animate-spin text-primary shrink-0" />
              ) : (
                <span className="size-4 rounded-full border shrink-0" />
              )}
              <span
                className={
                  isDone
                    ? "text-foreground"
                    : isActive
                      ? "text-foreground"
                      : "text-muted-foreground"
                }
              >
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
