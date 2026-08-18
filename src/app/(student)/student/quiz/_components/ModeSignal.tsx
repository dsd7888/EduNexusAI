"use client";

/**
 * The student's own signal on each mode card.
 *
 * One component with a per-mode branch rather than three components, because
 * the three signals must share a footprint: cards of different heights make
 * the modes look ranked, and the three modes are peers.
 *
 * NO RUNNING SCORE, NO POINTS, NO RANK. These signals answer "where am I with
 * this mode", never "how do I compare to anyone". See CP_Q3_STUDENT_UX.md's
 * explicit-rejections list before adding anything here.
 */

import { Skeleton } from "@/components/ui/skeleton";
import { scoreStyles } from "@/lib/ui/score";
import { cn } from "@/lib/utils";
import type { LandingSignals } from "@/lib/assessment/landingSignals";
import Sparkline from "./Sparkline";

type ModeKey = "quick" | "mastery" | "exam_sim";

/** Fixed height so the three cards align whatever their content. */
const SLOT = "min-h-[52px]";

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className={cn(SLOT, "flex items-center text-xs text-muted-foreground")}>
      {children}
    </p>
  );
}

export default function ModeSignal({
  mode,
  signals,
  loading,
}: {
  mode: ModeKey;
  signals: LandingSignals | null;
  loading: boolean;
}) {
  if (loading) return <Skeleton className={cn(SLOT, "w-full")} />;
  if (!signals) return <div className={SLOT} />;

  if (mode === "quick") {
    const { trend } = signals.quick;
    if (trend.length === 0) {
      return <Empty>Your score trend will show up here after your first one.</Empty>;
    }
    const latest = trend[trend.length - 1].score;
    const styles = scoreStyles(latest);
    return (
      <div className={cn(SLOT, "flex items-center justify-between gap-3")}>
        <div className="leading-tight">
          <span className={cn("text-lg font-semibold tabular-nums", styles.text)}>
            {latest}%
          </span>
          <p className="text-[11px] text-muted-foreground">
            last {trend.length} session{trend.length === 1 ? "" : "s"}
          </p>
        </div>
        <Sparkline points={trend} />
      </div>
    );
  }

  if (mode === "mastery") {
    const { aggregatePct, readyToLevelUp, modulesPractised } = signals.mastery;
    if (aggregatePct == null || modulesPractised === 0) {
      return <Empty>Practise a module and your mastery starts tracking here.</Empty>;
    }
    const styles = scoreStyles(aggregatePct);
    return (
      <div className={cn(SLOT, "flex flex-col justify-center gap-0.5")}>
        <div className="flex items-baseline gap-2">
          <span className={cn("text-lg font-semibold tabular-nums", styles.text)}>
            {aggregatePct}%
          </span>
          <span className="text-[11px] text-muted-foreground">
            across {modulesPractised} module{modulesPractised === 1 ? "" : "s"}
          </span>
        </div>
        {readyToLevelUp > 0 ? (
          <p className="text-[11px] font-medium text-amber-600 dark:text-amber-500">
            {readyToLevelUp} module{readyToLevelUp === 1 ? "" : "s"} ready to level
            up
          </p>
        ) : null}
      </div>
    );
  }

  // exam_sim
  const last = signals.examSim;
  if (!last) {
    return (
      <Empty>
        You&apos;ve never taken an exam sim — try one before the next drive?
      </Empty>
    );
  }
  const styles = scoreStyles(last.scorePct);
  return (
    <div className={cn(SLOT, "flex flex-col justify-center gap-0.5")}>
      <div className="flex items-baseline gap-2">
        <span className={cn("text-lg font-semibold tabular-nums", styles.text)}>
          {last.scorePct != null ? `${last.scorePct}%` : "—"}
        </span>
        {last.score != null && last.totalMarks != null ? (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {last.score}/{last.totalMarks} marks
          </span>
        ) : null}
      </div>
      <p className="text-[11px] text-muted-foreground">
        your last {last.preset === "gate" ? "GATE mock" : "exam sim"}
      </p>
    </div>
  );
}
