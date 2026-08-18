"use client";

/**
 * /student/quiz — the assessment landing (CP-Q3 Parts 2, 3 and 6).
 *
 * Three mode cards, each carrying the student's own signal for that mode; the
 * resumable-sessions strip; the streak in the header. Subject selection is the
 * shared SubjectSearchPicker (Part 2), in multi mode.
 *
 * All per-student data comes from ONE request to /api/assessment/landing —
 * see that route for why it isn't four client queries.
 *
 * The previous 1,766-line quiz page lived at /student/quiz/legacy as the
 * one-week pilot fallback. The pilot window closed and the route was deleted
 * in CP-N4 Part 0 — this landing is now the only quiz entry point.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Gauge, Timer, Zap } from "lucide-react";

import SubjectSearchPicker, {
  MAX_MULTI_SUBJECTS,
} from "@/components/SubjectSearchPicker";
import type { SubjectRow } from "@/hooks/useSupabaseData";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { LandingSignals } from "@/lib/assessment/landingSignals";
import { cn } from "@/lib/utils";
import ContinueStrip from "./_components/ContinueStrip";
import ModeSignal from "./_components/ModeSignal";
import StreakBadge from "./_components/StreakBadge";

type ModeKey = "quick" | "mastery" | "exam_sim";

interface ModeCard {
  key: ModeKey;
  label: string;
  icon: typeof Zap;
  range: string;
  pitch: string;
  bullets: string[];
  /** Distinct accent per card — the three modes must not read as one list. */
  accent: string;
  /** exam_sim is the only multi-subject mode (CP-Q2 §2). */
  multiSubject: boolean;
}

const MODES: ModeCard[] = [
  {
    key: "quick",
    label: "Quick Check",
    icon: Zap,
    range: "5–20 questions",
    pitch: "Great for a 2-minute confidence check.",
    bullets: ["One subject or module", "Immediate feedback per question"],
    accent: "border-sky-500/40 hover:border-sky-500/70",
    multiSubject: false,
  },
  {
    key: "mastery",
    label: "Module Mastery",
    icon: Gauge,
    range: "10–30 questions",
    pitch: "Tracks your progress across sessions.",
    bullets: [
      "One subject, adaptive difficulty",
      "Immediate feedback per question",
    ],
    accent: "border-violet-500/40 hover:border-violet-500/70",
    multiSubject: false,
  },
  {
    key: "exam_sim",
    label: "Exam Simulation",
    icon: Timer,
    range: "up to 100 questions",
    pitch: "Timed and sectioned, like the real thing.",
    bullets: ["Multi-subject, GATE preset available", "Feedback at the end"],
    accent: "border-amber-500/40 hover:border-amber-500/70",
    multiSubject: true,
  },
];

function AssessmentLanding() {
  const searchParams = useSearchParams();

  // Deep links that used to land on the old setup page (`?subjectId=` from the
  // chat struggle nudge and the /student/subjects Quiz button) still work: the
  // subject arrives preselected instead of dead-ending on the legacy route.
  const presetSubjectId = searchParams.get("subjectId");
  const initialSelected = useMemo(
    () => (presetSubjectId ? [presetSubjectId] : []),
    [presetSubjectId]
  );
  // `?mode=` preselects a card's accent — used by the results page's "Try
  // another" CTA (Part 5) to bring the student back to the mode they just ran.
  const presetMode = searchParams.get("mode") as ModeKey | null;
  // `?modules=` (mastery mode only) — the results page's "Practice your weak
  // areas" CTA. Passed straight through to /student/quiz/start's moduleIds,
  // which already scopes mastery-session generation to specific modules
  // (CP-Q2) — no module-picker UI is needed for this handoff, the CTA already
  // knows exactly which modules it wants.
  const presetModules = (searchParams.get("modules") ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  const [selected, setSelected] = useState<SubjectRow[]>([]);
  const [signals, setSignals] = useState<LandingSignals | null>(null);
  const [loadingSignals, setLoadingSignals] = useState(true);
  const [signalsError, setSignalsError] = useState<string | null>(null);

  const handleChange = useCallback((subjects: SubjectRow[]) => {
    setSelected(subjects);
  }, []);

  // ── landing signals ───────────────────────────────────────────────────────
  // Guarded with a mounted flag: this page is a common back-navigation target,
  // and a response landing after unmount would set state on a dead component.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/api/assessment/landing");
        // apiSuccess() returns the payload directly (no {success,data}
        // envelope); apiError() returns {error}. Same contract as every other
        // route in this codebase — see lib/api/helpers.ts.
        const json = await res.json().catch(() => null);
        if (!mounted.current) return;
        if (!res.ok || !json) {
          setSignalsError(json?.error ?? "Could not load your progress");
          return;
        }
        setSignals(json as LandingSignals);
        setSignalsError(null);
      } catch {
        if (mounted.current) setSignalsError("Could not load your progress");
      } finally {
        if (mounted.current) setLoadingSignals(false);
      }
    };
    void run();
  }, []);

  const startHref = (mode: ModeCard) => {
    const ids = mode.multiSubject
      ? selected.map((s) => s.id)
      : selected.slice(0, 1).map((s) => s.id);
    const params = new URLSearchParams({ mode: mode.key });
    if (ids.length > 0) params.set("subjectIds", ids.join(","));
    if (mode.key === "mastery" && presetModules.length > 0) {
      params.set("moduleIds", presetModules.join(","));
    }
    return `/student/quiz/start?${params.toString()}`;
  };

  const canStart = selected.length > 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Practice</h1>
          <p className="text-sm text-muted-foreground">
            Pick your subjects, then choose how you want to be tested.
          </p>
        </div>
        <StreakBadge streak={signals?.streak ?? null} />
      </div>

      {/* Resume first — a student with an unfinished session almost always
          came back for it, so it should not sit below three cards. */}
      {signals ? <ContinueStrip sessions={signals.inProgress} /> : null}

      {/* ── subject selection ────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Subjects</CardTitle>
          <CardDescription>
            Quick Check and Module Mastery use the first subject you pick. Exam
            Simulation can span up to {MAX_MULTI_SUBJECTS}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* filterByBranch={false}: the pilot cohort includes cross-semester
              electives, and a student practising for a backlog paper needs a
              subject from a semester they are no longer in. */}
          <SubjectSearchPicker
            multi
            filterByBranch={false}
            initialSelected={initialSelected}
            onSelect={() => {}}
            onChange={handleChange}
            placeholder="Search subjects to practise…"
          />
        </CardContent>
      </Card>

      {/* ── mode cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {MODES.map((mode) => {
          const Icon = mode.icon;
          return (
            <Card
              key={mode.key}
              className={cn(
                "flex flex-col border-2 transition-colors",
                mode.accent,
                presetMode === mode.key && "ring-2 ring-primary/30"
              )}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Icon className="size-5" />
                  <CardTitle className="text-base">{mode.label}</CardTitle>
                </div>
                <Badge variant="secondary" className="w-fit text-[11px] font-normal">
                  {mode.range}
                </Badge>
                <CardDescription className="pt-1">{mode.pitch}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-4">
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {mode.bullets.map((b) => (
                    <li key={b}>· {b}</li>
                  ))}
                </ul>

                <div className="rounded-md border bg-muted/30 px-3 py-2">
                  <ModeSignal
                    mode={mode.key}
                    signals={signals}
                    loading={loadingSignals}
                  />
                </div>

                <Button asChild={canStart} disabled={!canStart} className="w-full">
                  {canStart ? (
                    <Link href={startHref(mode)}>Start</Link>
                  ) : (
                    <span>Pick a subject first</span>
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {signalsError ? (
        // Amber, never red (§16). The page is fully usable without signals —
        // this is a missing nicety, not a broken page, and it should read that
        // way.
        <p className="text-xs text-amber-600 dark:text-amber-500">
          {signalsError}. You can still start a session.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <Link
          href="/student/quiz/mastery"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Your mastery by module
        </Link>
      </div>
    </div>
  );
}

export default function StudentQuizLandingPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <AssessmentLanding />
    </Suspense>
  );
}
