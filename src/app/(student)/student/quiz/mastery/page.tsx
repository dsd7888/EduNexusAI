"use client";

/**
 * /student/quiz/mastery — the mastery hub (CP-Q3 Part 5B).
 *
 * Linked from the landing page footer since Part 3 (which 404'd until this
 * shipped). Two independent reads: /api/assessment/mastery for the per-module
 * breakdown, /api/assessment/landing for the streak — the same StreakBadge
 * instance as the landing header, so the two surfaces can never show two
 * different streaks.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { LandingSignals } from "@/lib/assessment/landingSignals";
import StreakBadge from "../_components/StreakBadge";
import SubjectMasteryCard from "./_components/SubjectMasteryCard";
import type { MasteryHubResponse } from "./_components/types";

export default function MasteryHubPage() {
  const [hub, setHub] = useState<MasteryHubResponse | null>(null);
  const [streak, setStreak] = useState<LandingSignals["streak"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        const [hubRes, landingRes] = await Promise.all([
          fetch("/api/assessment/mastery"),
          fetch("/api/assessment/landing"),
        ]);
        const hubJson = await hubRes.json().catch(() => null);
        const landingJson = await landingRes.json().catch(() => null);
        if (!mounted.current) return;
        if (!hubRes.ok || !hubJson) {
          setError(hubJson?.error ?? "Could not load your mastery.");
          return;
        }
        setHub(hubJson as MasteryHubResponse);
        if (landingRes.ok && landingJson) {
          setStreak((landingJson as LandingSignals).streak);
        }
      } catch {
        if (mounted.current) setError("Network problem loading your mastery.");
      } finally {
        if (mounted.current) setLoading(false);
      }
    };
    void run();
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="size-8">
            <Link href="/student/quiz">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">Your mastery</h1>
        </div>
        <StreakBadge streak={streak} />
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : error ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">{error}</p>
      ) : !hub || hub.subjects.length === 0 ? (
        <div className="space-y-3 rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            You haven&apos;t practiced any subjects yet. Start with a Quick Check to see
            your mastery build here.
          </p>
          <Button asChild size="sm">
            <Link href="/student/quiz">Start practicing</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {hub.subjects.map((s) => (
            <SubjectMasteryCard key={s.subjectId} subject={s} />
          ))}
        </div>
      )}
    </div>
  );
}
