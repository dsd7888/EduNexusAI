"use client";

/**
 * Countdown, top-right. Turns AMBER at ≤5 minutes and NEVER RED (§16) — a
 * clock running out is urgency, not failure, and red on a timer during a
 * 3-hour GATE mock is just sustained alarm.
 *
 * THE SERVER OWNS THE CLOCK. This component counts down from a
 * server-computed `remainingSeconds` and re-derives from the session's
 * `startedAt` rather than from its own accumulated ticks, so a suspended tab, a
 * throttled background timer, or a wrong system clock cannot gain a student
 * time. /api/assessment/answer independently rejects post-deadline answers, so
 * this display is a courtesy, not the enforcement.
 */

import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";

import { cn } from "@/lib/utils";

const AMBER_AT_SECONDS = 5 * 60;
/** Warning shown before the hard auto-submit. */
export const EXPIRY_WARNING_SECONDS = 3;

function fmt(total: number): string {
  const s = Math.max(0, total);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function ExamTimer({
  startedAt,
  timeLimitMinutes,
  onExpire,
}: {
  startedAt: string;
  timeLimitMinutes: number;
  /** Fired ONCE when the clock reaches zero. */
  onExpire: () => void;
}) {
  const deadline =
    new Date(startedAt).getTime() + timeLimitMinutes * 60 * 1000;
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.round((deadline - Date.now()) / 1000))
  );
  const firedRef = useRef(false);

  useEffect(() => {
    const tick = () => {
      // Re-derived from the deadline every tick, never `remaining - 1`. A
      // background-throttled interval would otherwise under-count elapsed time
      // and hand the student extra minutes.
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpire();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline, onExpire]);

  const amber = remaining <= AMBER_AT_SECONDS;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 tabular-nums",
        amber
          ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          : "border-border bg-muted/40 text-foreground"
      )}
      role="timer"
      aria-live="off"
    >
      <Clock className="size-3.5 shrink-0" aria-hidden />
      <span className="text-sm font-medium">{fmt(remaining)}</span>
      {amber ? <span className="sr-only">Five minutes or less remaining</span> : null}
    </div>
  );
}
