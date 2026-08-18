"use client";

/**
 * An 8-point score sparkline for the Quick Check card.
 *
 * FORM: one series, ordered, ≤8 points, read for shape not value — a sparkline
 * is the correct form and a full chart would be wrong here (axes and gridlines
 * on 8 points is decoration). Single series, so no legend: the card title names
 * it. Hand-rolled SVG rather than recharts — recharts is available (placement
 * uses it) but a ResponsiveContainer plus axis config for a 100×28 glyph ships
 * a chart engine to draw eleven line segments.
 *
 * COLOR: no new palette. The line takes its state from the project's semantic
 * score system (src/lib/ui/score.ts) applied to the LATEST point — slate when
 * untried, amber in progress, emerald on target. Red is never used for a score
 * (§16), so a downward trend is amber, never red: the trend is information, not
 * an accusation. Text stays in text tokens; only the mark carries colour.
 *
 * DARK MODE: the stroke uses currentColor driven by Tailwind's dark: variants
 * on the score classes, so the dark treatment is a chosen step from the same
 * ramp, not an automatic inversion of the light one.
 */

import { scoreState } from "@/lib/ui/score";
import { cn } from "@/lib/utils";
import type { QuickTrendPoint } from "@/lib/assessment/landingSignals";

const W = 104;
const H = 28;
const PAD = 3; // keeps the 2px stroke and the end dot inside the viewBox

/** Stroke colour per score state — chosen per mode, not flipped. */
const STROKE: Record<ReturnType<typeof scoreState>, string> = {
  empty: "text-slate-400 dark:text-slate-500",
  progress: "text-amber-500 dark:text-amber-400",
  good: "text-emerald-500 dark:text-emerald-400",
};

export default function Sparkline({
  points,
  className,
}: {
  points: QuickTrendPoint[];
  className?: string;
}) {
  if (points.length === 0) return null;

  const latest = points[points.length - 1].score;
  const state = scoreState(latest);

  // A single point has no line to draw — render the dot alone rather than a
  // degenerate zero-length path.
  const xs = points.map((_, i) =>
    points.length === 1
      ? W / 2
      : PAD + (i * (W - PAD * 2)) / (points.length - 1)
  );
  // Fixed 0–100 domain, not min/max autoscaling. Autoscaling makes a wobble
  // between 62% and 68% look like a cliff, which is exactly the kind of
  // false alarm this product's score framing exists to avoid.
  const ys = points.map((p) => PAD + ((100 - p.score) * (H - PAD * 2)) / 100);

  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x} ${ys[i]}`).join(" ");
  const lastX = xs[xs.length - 1];
  const lastY = ys[ys.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className={cn("overflow-visible", STROKE[state], className)}
      role="img"
      aria-label={`Last ${points.length} Quick Check scores, most recent ${latest} percent`}
    >
      {/* Recessive 50% reference line — orients the eye without an axis. */}
      <line
        x1={0}
        x2={W}
        y1={H / 2}
        y2={H / 2}
        className="stroke-border"
        strokeWidth={1}
        strokeDasharray="2 3"
      />
      {points.length > 1 ? (
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {/* Only the most recent point is marked — a dot on every point turns a
          trend glyph into a scatter plot at this size. 2px surface ring so the
          dot separates from the line underneath it. */}
      <circle
        cx={lastX}
        cy={lastY}
        r={3}
        fill="currentColor"
        className="stroke-background"
        strokeWidth={2}
      />
    </svg>
  );
}
