import RichQuestionText from "@/components/RichQuestionText";
import { Badge } from "@/components/ui/badge";
import { scoreBarClass, scoreTextClass, scoreState } from "@/lib/ui/score";
import { cn } from "@/lib/utils";
import type { MasteryModule } from "./types";

const TIER_STYLE: Record<MasteryModule["currentDifficulty"], string> = {
  easy: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700",
  medium:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900",
  hard: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-400 dark:border-violet-900",
};

export default function ModuleRow({ module: m }: { module: MasteryModule }) {
  const state = scoreState(m.accuracy);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">
            <RichQuestionText text={m.moduleName} />
          </span>
          <Badge variant="outline" className={cn("shrink-0 text-[10px] capitalize", TIER_STYLE[m.currentDifficulty])}>
            {m.currentDifficulty}
          </Badge>
        </div>
        <span className={cn("shrink-0 text-sm font-semibold tabular-nums", scoreTextClass[state])}>
          {m.accuracy}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", scoreBarClass[state])}
          style={{ width: `${Math.max(0, Math.min(100, m.accuracy))}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {m.attemptsCount} attempt{m.attemptsCount === 1 ? "" : "s"}
        {m.promotionProgress ? (
          <span className="ml-1.5 font-medium text-amber-600 dark:text-amber-500">
            · {m.promotionProgress.correctNeeded} more correct at {m.currentDifficulty} to reach{" "}
            {m.promotionProgress.targetTier}
          </span>
        ) : null}
      </p>
    </div>
  );
}
