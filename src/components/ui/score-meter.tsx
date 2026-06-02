import { cn } from "@/lib/utils";
import {
  DEFAULT_TARGET,
  scoreLabel,
  scoreState,
  scoreBarClass,
  scoreTextClass,
} from "@/lib/ui/score";

interface ScoreMeterProps {
  /** Score 0-100. null/undefined → not-started treatment. */
  score: number | null | undefined;
  target?: number;
  /** Force not-started even when score reads 0 (e.g. category never attempted). */
  attempted?: boolean;
  /** Optional label shown on the left of the top row (e.g. "Quantitative"). */
  label?: string;
  /** Show the "Target: N%" caption under the bar. Default true. */
  showTarget?: boolean;
  className?: string;
}

/**
 * Lightweight score meter: a labelled value row, a semantic-coloured bar, and an
 * optional target caption. Pure presentational — no state, no deps beyond cn and
 * the score helpers. Reused on the dashboard and placement screens so the
 * journey framing ("10% on the way to 65%") looks identical everywhere.
 */
export function ScoreMeter({
  score,
  target = DEFAULT_TARGET,
  attempted,
  label,
  showTarget = true,
  className,
}: ScoreMeterProps) {
  const state = scoreState(score, { attempted, target });
  const pct = Math.max(0, Math.min(100, Math.round(score ?? 0)));
  const started = state !== "empty";

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        {label ? (
          <span className="text-sm font-medium text-foreground">{label}</span>
        ) : (
          <span />
        )}
        <span className="flex items-baseline gap-1">
          <span className={cn("text-sm font-semibold tabular-nums", scoreTextClass[state])}>
            {started ? `${pct}%` : "—"}
          </span>
          {!started && (
            <span className="text-xs text-slate-400">{scoreLabel(state)}</span>
          )}
        </span>
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuenow={started ? pct : 0}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-full rounded-full transition-all", scoreBarClass[state])}
          style={{ width: `${started ? Math.max(pct, 3) : 0}%` }}
        />
      </div>

      {showTarget && (
        <p className="text-xs text-muted-foreground">
          {started ? (
            <>
              {pct}% <span className="text-slate-400">→</span> Target {target}%
            </>
          ) : (
            <>Not attempted yet · Target {target}%</>
          )}
        </p>
      )}
    </div>
  );
}
