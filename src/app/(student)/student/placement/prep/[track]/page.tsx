"use client";

import { useEffect, useState, Suspense } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { readinessColorClass } from "@/lib/placement/readiness";
import {
  TRACK_META,
  TRACK_SECTIONS,
  VALID_TRACKS,
  type Track,
} from "@/lib/placement/tracks";
import type {
  StudentPlacementProfile,
  PlacementCompanyProfile,
  PlacementTopicMastery,
} from "@/types/placement";

// ─── External resources ───────────────────────────────────────────────────────

const EXTERNAL_RESOURCES: Record<Track, { label: string; url: string }[]> = {
  aptitude: [
    {
      label: "IndiaBIX Aptitude",
      url: "https://www.indiabix.com/aptitude/questions-and-answers/",
    },
    { label: "PrepInsta Formulas", url: "https://prepinsta.com/aptitude/" },
    {
      label: "GeeksforGeeks Aptitude",
      url: "https://www.geeksforgeeks.org/aptitude-for-placements/",
    },
  ],
  verbal: [
    {
      label: "IndiaBIX Verbal",
      url: "https://www.indiabix.com/verbal-ability/questions-and-answers/",
    },
    { label: "Magoosh Vocabulary", url: "https://magoosh.com/gre/gre-vocabulary/" },
    { label: "PrepInsta Verbal", url: "https://prepinsta.com/verbal-ability/" },
  ],
  domain: [
    {
      label: "GeeksforGeeks GATE CS",
      url: "https://www.geeksforgeeks.org/gate-cs-notes-gq/",
    },
    {
      label: "InterviewBit CS Fundamentals",
      url: "https://www.interviewbit.com/courses/programming/",
    },
    { label: "JavaTpoint OS Notes", url: "https://www.javatpoint.com/os-tutorial" },
  ],
  communication: [
    {
      label: "HR Interview Questions - IndiaBIX",
      url: "https://www.indiabix.com/hr-interview/questions-and-answers/",
    },
    {
      label: "Speak English Professionally (Coursera)",
      url: "https://www.coursera.org/learn/speakenglish",
    },
    {
      label: "Technical Interview Tips - GeeksforGeeks",
      url: "https://www.geeksforgeeks.org/tips-to-crack-technical-interview/",
    },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TRACK_KEYWORDS: Record<Track, string[]> = {
  aptitude:      ["numerical", "quantitative", "mathematical"],
  verbal:        ["verbal"],
  domain:        ["technical", "domain", "programming"],
  communication: ["communication", "verbal"],
};

function getTrackWeight(company: PlacementCompanyProfile, track: Track): number | null {
  const sections = company.oa_pattern?.sections;
  if (!sections?.length) return null;
  const matching = sections.filter((s) =>
    TRACK_KEYWORDS[track].some((k) => s.name.toLowerCase().includes(k))
  );
  if (!matching.length) return null;
  return Math.max(...matching.map((s) => s.weight_percent));
}

function getTrackScore(profile: StudentPlacementProfile, track: Track): number {
  switch (track) {
    case "aptitude":      return profile.readiness_aptitude;
    case "verbal":        return profile.readiness_verbal;
    case "domain":        return profile.readiness_domain;
    case "communication": return profile.readiness_communication;
  }
}

function scoreRingClass(score: number): string {
  if (score >= 75) return "border-emerald-200 bg-emerald-50";
  if (score >= 50) return "border-amber-200 bg-amber-50";
  return "border-gray-200 bg-gray-50";
}

// ─── Inner page (needs useSearchParams) ───────────────────────────────────────

function PrepTrackInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const rawTrack = params.track as string;
  const companySlug = searchParams.get("company");

  const [profile, setProfile] = useState<StudentPlacementProfile | null>(null);
  const [company, setCompany] = useState<PlacementCompanyProfile | null>(null);
  const [masteryMap, setMasteryMap] = useState<Record<string, PlacementTopicMastery>>({});
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingCompany, setLoadingCompany] = useState(!!companySlug);
  const [isLoadingMastery, setIsLoadingMastery] = useState(true);

  useEffect(() => {
    if (!VALID_TRACKS.has(rawTrack)) {
      router.replace("/student/placement");
    }
  }, [rawTrack, router]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [profileRes, masteryRes] = await Promise.all([
          fetch("/api/placement/profile"),
          fetch(`/api/placement/prep/mastery?track=${rawTrack}`),
        ]);

        // Profile (drives setup redirect)
        try {
          const data = await profileRes.json();
          if (!cancelled) {
            if (data.profile?.setup_complete) setProfile(data.profile);
            else router.replace("/student/placement/setup");
          }
        } catch {
          /* ignore — profile parse failure */
        } finally {
          if (!cancelled) setLoadingProfile(false);
        }

        // Mastery (non-fatal — continue with empty map on failure)
        try {
          if (masteryRes.ok) {
            const masteryData = await masteryRes.json();
            const map: Record<string, PlacementTopicMastery> = {};
            (masteryData.mastery ?? []).forEach((m: PlacementTopicMastery) => {
              map[m.topic] = m;
            });
            if (!cancelled) setMasteryMap(map);
          }
        } catch (err) {
          console.error("[prep-track] Failed to load mastery:", err);
        } finally {
          if (!cancelled) setIsLoadingMastery(false);
        }
      } catch (err) {
        // Network-level failure of either fetch — both non-fatal.
        console.error("[prep-track] Failed to load track data:", err);
        if (!cancelled) {
          setLoadingProfile(false);
          setIsLoadingMastery(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [router, rawTrack]);

  useEffect(() => {
    if (!companySlug) return;
    fetch(`/api/placement/companies/${companySlug}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.company) setCompany(data.company);
      })
      .catch(() => {})
      .finally(() => setLoadingCompany(false));
  }, [companySlug]);

  if (!VALID_TRACKS.has(rawTrack)) return null;

  const track = rawTrack as Track;
  const meta = TRACK_META[track];
  const sections = TRACK_SECTIONS[track];
  const resources = EXTERNAL_RESOURCES[track];
  const trackScore = profile ? getTrackScore(profile, track) : null;
  const companyWeight = company ? getTrackWeight(company, track) : null;

  // Track-level mastery summary
  const masteryRows = Object.values(masteryMap);
  const topicsWithMastery = Object.keys(masteryMap);
  const avgAccuracy =
    masteryRows.length > 0
      ? masteryRows.reduce((s, m) => s + m.recent_accuracy, 0) / masteryRows.length
      : 0;
  const diffCounts: Record<"easy" | "medium" | "hard", number> = {
    easy: 0,
    medium: 0,
    hard: 0,
  };
  masteryRows.forEach((m) => {
    diffCounts[m.current_difficulty] += 1;
  });
  // Most common difficulty; ties resolve to the harder level.
  let dominant: "easy" | "medium" | "hard" = "easy";
  let dominantCount = -1;
  (["hard", "medium", "easy"] as const).forEach((d) => {
    if (diffCounts[d] > dominantCount) {
      dominantCount = diffCounts[d];
      dominant = d;
    }
  });
  const dominantDifficulty = dominant.charAt(0).toUpperCase() + dominant.slice(1);

  function handleTopicClick(topic: string) {
    const qs = new URLSearchParams({ topic });
    if (companySlug) qs.set("company", companySlug);
    router.push(`/student/placement/prep/${track}/practice?${qs.toString()}`);
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/student/placement"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ChevronLeft className="size-4" />
        Placement
      </Link>

      {/* Company context banner */}
      {companySlug && (
        loadingCompany ? (
          <Skeleton className="h-11 rounded-lg" />
        ) : company && companyWeight !== null ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            Preparing for{" "}
            <span className="font-semibold">{company.name}</span>
            {" · "}
            {meta.title} is{" "}
            <span className="font-semibold">{companyWeight}%</span> of their OA
          </div>
        ) : company ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            Preparing for <span className="font-semibold">{company.name}</span>
          </div>
        ) : null
      )}

      {/* Track header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-gray-900">{meta.title}</h1>
          <p className="mt-1 max-w-prose text-sm text-gray-500">{meta.description}</p>
        </div>

        {loadingProfile ? (
          <Skeleton className="h-7 w-32 rounded-full" />
        ) : trackScore !== null ? (
          <span
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-sm font-medium",
              readinessColorClass(trackScore),
              scoreRingClass(trackScore)
            )}
          >
            Your level: {trackScore}/100
          </span>
        ) : null}
      </div>

      {/* Track-level mastery summary */}
      {topicsWithMastery.length > 0 && (
        <div className="mb-4 flex items-center gap-6 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          <div>
            <span className="text-gray-500">Topics practiced: </span>
            <span className="font-semibold text-gray-800">
              {topicsWithMastery.length}
            </span>
          </div>

          <div>
            <span className="text-gray-500">Avg accuracy: </span>
            <span
              className={cn(
                "font-semibold",
                avgAccuracy >= 70
                  ? "text-emerald-600"
                  : avgAccuracy >= 40
                  ? "text-amber-600"
                  : "text-red-500"
              )}
            >
              {avgAccuracy.toFixed(0)}%
            </span>
          </div>

          <div>
            <span className="text-gray-500">Current level: </span>
            <span className="font-semibold text-gray-800">{dominantDifficulty}</span>
          </div>
        </div>
      )}

      {/* Recommended order banner (service_it + aptitude only) */}
      {profile?.primary_target === "service_it" && track === "aptitude" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          💡 For IT Services companies, start with Quantitative Ability and Logical Reasoning
          — they make up 60%+ of most OA papers.
        </div>
      )}

      {/* Topic sections */}
      <div className="space-y-6">
        {sections.map((section) => (
          <div key={section.title}>
            <h2 className="mb-2 text-base font-semibold text-gray-800">{section.title}</h2>
            <div className="space-y-2">
              {section.topics.map((topic) => {
                const mastery = masteryMap[topic];
                return (
                  <button
                    key={topic}
                    type="button"
                    onClick={() => handleTopicClick(topic)}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 py-3 text-left transition-colors hover:border-blue-300"
                  >
                    <span className="text-sm text-gray-700">{topic}</span>

                    {isLoadingMastery ? (
                      <div className="h-4 w-24 shrink-0 animate-pulse rounded bg-gray-100" />
                    ) : mastery ? (
                      <div className="flex shrink-0 items-center gap-3">
                        {/* Accuracy pill */}
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-medium",
                            mastery.recent_accuracy >= 70
                              ? "bg-emerald-50 text-emerald-700"
                              : mastery.recent_accuracy >= 40
                              ? "bg-amber-50 text-amber-700"
                              : "bg-red-50 text-red-600"
                          )}
                        >
                          {mastery.recent_accuracy.toFixed(0)}%
                        </span>

                        {/* Sessions count */}
                        <span className="text-xs text-gray-400">
                          {mastery.sessions_count}
                          {mastery.sessions_count === 1 ? " session" : " sessions"}
                        </span>

                        {/* Difficulty badge */}
                        <span
                          className={cn(
                            "rounded border px-2 py-0.5 text-xs font-medium",
                            mastery.current_difficulty === "hard"
                              ? "border-purple-200 bg-purple-50 text-purple-600"
                              : mastery.current_difficulty === "medium"
                              ? "border-blue-200 bg-blue-50 text-blue-600"
                              : "border-gray-200 bg-gray-50 text-gray-500"
                          )}
                        >
                          {mastery.current_difficulty.charAt(0).toUpperCase() +
                            mastery.current_difficulty.slice(1)}
                        </span>

                        {/* Practice arrow */}
                        <span className="text-sm text-blue-600">→</span>
                      </div>
                    ) : (
                      <span className="shrink-0 text-sm text-blue-600">Practice →</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* External resources */}
      <div className="border-t border-gray-100 pt-4">
        <p className="mb-2 text-sm font-medium text-gray-500">External Resources</p>
        <div className="flex flex-col gap-2">
          {resources.map((resource) => (
            <a
              key={resource.label}
              href={resource.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
            >
              <ExternalLink className="size-3.5 shrink-0" />
              {resource.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Page (Suspense wrapper for useSearchParams) ───────────────────────────────

export default function PrepTrackPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        </div>
      }
    >
      <PrepTrackInner />
    </Suspense>
  );
}
