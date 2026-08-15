"use client";

/**
 * "Continue where you left off" — one row per in_progress quiz_sessions row.
 *
 * Renders nothing at all when there is nothing to resume. An empty-state card
 * saying "no sessions in progress" would be noise on the page a student sees
 * most often; absence is the correct empty state here.
 *
 * Tapping a row goes straight to the session URL — the session route reads the
 * stored student-safe questions back (CP-Q2 §4), so resuming costs no
 * generation and burns no bank questions.
 */

import Link from "next/link";
import { ChevronRight, Clock } from "lucide-react";

import { MonoTag } from "@/components/ui/mono-tag";
import type { LandingSignals } from "@/lib/assessment/landingSignals";

const MODE_LABEL: Record<string, string> = {
  quick: "Quick Check",
  mastery: "Module Mastery",
  exam_sim: "Exam Simulation",
};

/** "3 hours ago" without pulling in a date library. */
function relative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

export default function ContinueStrip({
  sessions,
}: {
  sessions: LandingSignals["inProgress"];
}) {
  if (sessions.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">
        Continue where you left off
      </h2>
      <div className="divide-y overflow-hidden rounded-lg border">
        {sessions.map((s) => (
          <Link
            key={s.sessionId}
            href={`/student/quiz/session/${s.sessionId}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
          >
            <Clock className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {MODE_LABEL[s.mode] ?? s.mode}
                </span>
                {s.preset ? (
                  // Structural label, same pattern as Phase 1's CO-code migration.
                  <MonoTag variant="default" className="uppercase">
                    {s.preset}
                  </MonoTag>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {s.questionCount ? `${s.questionCount} questions · ` : ""}
                started {relative(s.startedAt)}
                {s.timeLimitMinutes ? ` · ${s.timeLimitMinutes} min limit` : ""}
              </p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </section>
  );
}
