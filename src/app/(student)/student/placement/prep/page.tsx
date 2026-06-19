"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  TRACKS,
  TRACK_META,
  TRACK_SECTIONS,
  type Track,
} from "@/lib/placement/tracks";
import type { PlacementTopicMastery } from "@/types/placement";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function accuracyPillClass(acc: number): string {
  if (acc >= 70) return "bg-emerald-50 text-emerald-700";
  if (acc >= 40) return "bg-amber-50 text-amber-700";
  return "bg-red-50 text-red-600";
}

function difficultyBadgeClass(diff: "easy" | "medium" | "hard"): string {
  if (diff === "hard") return "border-purple-200 bg-purple-50 text-purple-600";
  if (diff === "medium") return "border-blue-200 bg-blue-50 text-blue-600";
  return "border-gray-200 bg-gray-50 text-gray-500";
}

interface TrackSummary {
  topicsPracticed: number;
  avgAccuracy: number;
  dominantDifficulty: "easy" | "medium" | "hard";
  hasData: boolean;
}

function summarize(rows: PlacementTopicMastery[]): TrackSummary {
  if (rows.length === 0) {
    return {
      topicsPracticed: 0,
      avgAccuracy: 0,
      dominantDifficulty: "easy",
      hasData: false,
    };
  }
  const avg = rows.reduce((s, m) => s + m.recent_accuracy, 0) / rows.length;
  const counts: Record<"easy" | "medium" | "hard", number> = {
    easy: 0,
    medium: 0,
    hard: 0,
  };
  rows.forEach((m) => {
    counts[m.current_difficulty] += 1;
  });
  let dominant: "easy" | "medium" | "hard" = "easy";
  let best = -1;
  (["hard", "medium", "easy"] as const).forEach((d) => {
    if (counts[d] > best) {
      best = counts[d];
      dominant = d;
    }
  });
  return {
    topicsPracticed: rows.length,
    avgAccuracy: avg,
    dominantDifficulty: dominant,
    hasData: true,
  };
}

// ─── Inner (uses useSearchParams) ──────────────────────────────────────────────

function PrepHubInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const companySlug = searchParams.get("company");

  const [mastery, setMastery] = useState<PlacementTopicMastery[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/placement/prep/mastery")
      .then((r) => (r.ok ? r.json() : { mastery: [] }))
      .then((d) => {
        if (!cancelled) setMastery((d.mastery ?? []) as PlacementTopicMastery[]);
      })
      .catch(() => {
        if (!cancelled) setMastery([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Mastery grouped by track, then keyed by topic.
  const byTrack = useMemo(() => {
    const map: Record<Track, Record<string, PlacementTopicMastery>> = {
      aptitude: {},
      verbal: {},
      domain: {},
      communication: {},
    };
    mastery.forEach((m) => {
      if (m.track in map) map[m.track as Track][m.topic] = m;
    });
    return map;
  }, [mastery]);

  const summaries = useMemo(() => {
    const out = {} as Record<Track, TrackSummary>;
    TRACKS.forEach((t) => {
      out[t] = summarize(Object.values(byTrack[t]));
    });
    return out;
  }, [byTrack]);

  // Lowest-mastery track = focus. Untouched tracks (no data) count as 0 → surfaced first.
  const focusTrack = useMemo<Track | null>(() => {
    if (loading) return null;
    let pick: Track | null = null;
    let lowest = Infinity;
    TRACKS.forEach((t) => {
      const s = summaries[t];
      const score = s.hasData ? s.avgAccuracy : 0;
      if (score < lowest) {
        lowest = score;
        pick = t;
      }
    });
    return pick;
  }, [summaries, loading]);

  function trackHref(track: Track): string {
    return companySlug
      ? `/student/placement/prep/${track}?company=${encodeURIComponent(companySlug)}`
      : `/student/placement/prep/${track}`;
  }

  function practiceHref(track: Track, topic: string): string {
    const qs = new URLSearchParams({ topic });
    if (companySlug) qs.set("company", companySlug);
    return `/student/placement/prep/${track}/practice?${qs.toString()}`;
  }

  return (
    <div className="max-w-5xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Placement Prep</h1>
        <p className="mt-1 text-sm text-gray-500">
          Adaptive practice across aptitude, verbal, core domain, and communication.
        </p>
      </div>

      {/* Quick Practice */}
      <div>
        <p className="mb-3 text-sm font-medium text-gray-700">Quick Practice</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TRACKS.map((track) => {
            const isFocus = focusTrack === track;
            return (
              <button
                key={track}
                type="button"
                onClick={() => router.push(trackHref(track))}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors",
                  isFocus
                    ? "border-amber-300 bg-amber-50 hover:border-amber-400"
                    : "border-gray-200 hover:border-blue-300"
                )}
              >
                <span className="text-sm font-semibold text-gray-900">
                  {TRACK_META[track].title}
                </span>
                {isFocus && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                    Focus this session
                  </span>
                )}
                <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-600">
                  Practice <ArrowRight className="size-3" />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Track sections */}
      <div className="space-y-6">
        {TRACKS.map((track) => {
          const meta = TRACK_META[track];
          const sections = TRACK_SECTIONS[track];
          const summary = summaries[track];
          const isFocus = focusTrack === track;
          const topicMap = byTrack[track];

          return (
            <section
              key={track}
              className={cn(
                "rounded-xl border p-5",
                isFocus ? "border-amber-300 bg-amber-50/40" : "border-gray-200"
              )}
            >
              {/* Track header */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-gray-900">
                      {meta.title}
                    </h2>
                    {isFocus && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                        Focus this session
                      </span>
                    )}
                  </div>
                  <p className="mt-1 max-w-prose text-sm text-gray-500">
                    {meta.description}
                  </p>
                </div>
                <Link
                  href={trackHref(track)}
                  className="shrink-0 text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  Open track →
                </Link>
              </div>

              {/* Mastery summary */}
              {loading ? (
                <Skeleton className="mt-3 h-9 w-full rounded-lg" />
              ) : summary.hasData ? (
                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                  <div>
                    <span className="text-gray-500">Topics practiced: </span>
                    <span className="font-semibold text-gray-800">
                      {summary.topicsPracticed}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Avg accuracy: </span>
                    <span
                      className={cn(
                        "font-semibold",
                        summary.avgAccuracy >= 70
                          ? "text-emerald-600"
                          : summary.avgAccuracy >= 40
                          ? "text-amber-600"
                          : "text-red-500"
                      )}
                    >
                      {summary.avgAccuracy.toFixed(0)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Current level: </span>
                    <span className="font-semibold text-gray-800">
                      {summary.dominantDifficulty.charAt(0).toUpperCase() +
                        summary.dominantDifficulty.slice(1)}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-gray-400">
                  Not practiced yet — start any topic below to build mastery.
                </p>
              )}

              {/* Topics */}
              <div className="mt-4 space-y-4">
                {sections.map((sec) => (
                  <div key={sec.title}>
                    <h3 className="mb-2 text-sm font-semibold text-gray-700">
                      {sec.title}
                    </h3>
                    <div className="space-y-2">
                      {sec.topics.map((topic) => {
                        const m = topicMap[topic];
                        return (
                          <Link
                            key={topic}
                            href={practiceHref(track, topic)}
                            className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 py-3 transition-colors hover:border-blue-300"
                          >
                            <span className="min-w-0 truncate text-sm text-gray-700">
                              {topic}
                            </span>
                            {loading ? (
                              <div className="h-4 w-20 shrink-0 animate-pulse rounded bg-gray-100" />
                            ) : m ? (
                              <div className="flex shrink-0 items-center gap-3">
                                <span
                                  className={cn(
                                    "rounded-full px-2 py-0.5 text-xs font-medium",
                                    accuracyPillClass(m.recent_accuracy)
                                  )}
                                >
                                  {m.recent_accuracy.toFixed(0)}%
                                </span>
                                <span
                                  className={cn(
                                    "rounded border px-2 py-0.5 text-xs font-medium",
                                    difficultyBadgeClass(m.current_difficulty)
                                  )}
                                >
                                  {m.current_difficulty.charAt(0).toUpperCase() +
                                    m.current_difficulty.slice(1)}
                                </span>
                                <span className="text-sm text-blue-600">→</span>
                              </div>
                            ) : (
                              <span className="shrink-0 text-sm text-blue-600">
                                Practice →
                              </span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ─── Page (Suspense for useSearchParams) ──────────────────────────────────────

export default function PrepHubPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-5xl space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      }
    >
      <PrepHubInner />
    </Suspense>
  );
}
