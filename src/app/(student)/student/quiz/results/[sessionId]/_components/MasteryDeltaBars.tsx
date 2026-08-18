/**
 * Before→after mastery movement, one row per module practiced this session
 * (CP-Q3 Part 5A). This is the emotional payoff of a mastery session — it
 * gets its own full-width section with real breathing room, not a compressed
 * sidebar widget.
 *
 * Design language borrowed from Sparkline.tsx: fixed 0–100 domain (never
 * autoscaled — a 6-point move should look like 6 points, not a cliff),
 * amber/emerald from the shared score system, never red for a demotion —a
 * demotion is informational ("this needs more practice"), not a failure
 * grade.
 */

import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { scoreState } from "@/lib/ui/score";
import { cn } from "@/lib/utils";
import type { MasteryDelta } from "./types";

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: "easy",
  medium: "medium",
  hard: "hard",
};

const BAR_COLOR: Record<ReturnType<typeof scoreState>, string> = {
  empty: "bg-slate-400 dark:bg-slate-500",
  progress: "bg-amber-500 dark:bg-amber-400",
  good: "bg-emerald-500 dark:bg-emerald-400",
};

function Bar({ beforePct, afterPct }: { beforePct: number; afterPct: number }) {
  const state = scoreState(afterPct);
  return (
    <div className="relative h-3 w-full overflow-visible rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full transition-all", BAR_COLOR[state])}
        style={{ width: `${Math.max(0, Math.min(100, afterPct))}%` }}
      />
      {/* "Before" marker — a thin tick at the prior accuracy, so the move is
          visible against the bar rather than only stated in text. */}
      <div
        className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 bg-foreground/60"
        style={{ left: `${Math.max(0, Math.min(100, beforePct))}%` }}
        aria-hidden
      />
    </div>
  );
}

export default function MasteryDeltaBars({ deltas }: { deltas: MasteryDelta[] }) {
  if (deltas.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Your mastery, before → after</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {deltas.map((d) => {
          const beforePct = d.accuracyBefore != null ? Math.round(d.accuracyBefore * 100) : 0;
          const afterPct = Math.round(d.accuracyAfter * 100);
          return (
            <div key={d.moduleId} className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{d.moduleName ?? "Module"}</span>
                <div className="flex items-center gap-1.5 text-sm tabular-nums">
                  <span className="text-muted-foreground">
                    {d.accuracyBefore != null ? `${beforePct}%` : "new"}
                  </span>
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                  <span className="font-semibold">{afterPct}%</span>
                </div>
              </div>
              <Bar beforePct={beforePct} afterPct={afterPct} />
              {(d.promoted || d.demoted) && (
                <p
                  className={cn(
                    "flex items-center gap-1 text-xs font-medium",
                    // amber-700, not the score.ts anchor's amber-600: at this
                    // text-xs/medium size (not WCAG "large text"), amber-600
                    // on bg-card measures 3.2:1 — below the 4.5:1 AA floor.
                    // amber-700 clears it (5.02:1), matching QuestionGrid's
                    // own already-passing amber-700 badge text.
                    d.promoted
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-amber-700 dark:text-amber-500"
                  )}
                >
                  {d.promoted ? (
                    <TrendingUp className="size-3.5" />
                  ) : (
                    <TrendingDown className="size-3.5" />
                  )}
                  {DIFFICULTY_LABEL[d.difficultyBefore]} → {DIFFICULTY_LABEL[d.difficultyAfter]}{" "}
                  {d.promoted ? "PROMOTED" : "moved back for more practice"}
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
