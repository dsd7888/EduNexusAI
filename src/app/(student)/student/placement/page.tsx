"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/useSupabaseData";
import {
  computeCompanyFit,
  readinessLabel,
} from "@/lib/placement/readiness";
import {
  TARGET_LABELS,
  type StudentPlacementProfile,
  type PlacementCompanyProfile,
  type PlacementDrive,
  type PlacementTarget,
  type CompanyFit,
  type PlacementTopicMastery,
} from "@/types/placement";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t = new Date(dateStr);
  t.setHours(0, 0, 0, 0);
  return Math.ceil((t.getTime() - today.getTime()) / 86_400_000);
}

function barColorClass(score: number): string {
  if (score >= 75) return "bg-emerald-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-amber-400";
}

function ringStroke(score: number): string {
  if (score >= 75) return "#10b981";
  if (score >= 50) return "#f59e0b";
  return "#9ca3af";
}

function fitScoreColorClass(score: number): string {
  if (score >= 75) return "text-emerald-600";
  if (score >= 50) return "text-amber-600";
  return "text-gray-400";
}

// ─── Today's Queue config ─────────────────────────────────────────────────────

interface QueueTask {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

function getTodaysTasks(target: PlacementTarget): QueueTask[] {
  const aptitude: QueueTask = {
    id: "apt",
    title: "Aptitude Drill",
    subtitle: "20 questions · Quant & Logical",
    href: "/student/placement/prep/aptitude",
  };
  const verbal: QueueTask = {
    id: "verb",
    title: "Verbal Practice",
    subtitle: "15 questions · RC & Grammar",
    href: "/student/placement/prep/verbal",
  };
  if (target === "service_it") {
    return [
      aptitude,
      verbal,
      {
        id: "oa",
        title: "OA Pattern Review",
        subtitle: "TCS NQT pattern analysis",
        href: "/student/placement/companies/tcs",
      },
    ];
  }
  if (target === "product") {
    return [
      aptitude,
      verbal,
      {
        id: "dsa",
        title: "DSA Concepts",
        subtitle: "Data structures & algorithms",
        href: "/student/placement/prep/coding",
      },
    ];
  }
  return [
    aptitude,
    verbal,
    {
      id: "domain",
      title: "Core Domain Review",
      subtitle: "Technical subject concepts",
      href: "/student/placement/prep/domain",
    },
  ];
}

// ─── Dimension keys ───────────────────────────────────────────────────────────

const DIMENSIONS: Array<{
  key: keyof Pick<
    StudentPlacementProfile,
    | "readiness_aptitude"
    | "readiness_verbal"
    | "readiness_domain"
    | "readiness_coding"
    | "readiness_communication"
  >;
  label: string;
}> = [
  { key: "readiness_aptitude", label: "Aptitude" },
  { key: "readiness_verbal", label: "Verbal" },
  { key: "readiness_domain", label: "Core Domain" },
  { key: "readiness_coding", label: "Coding" },
  { key: "readiness_communication", label: "Communication" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PlacementDashboardPage() {
  const router = useRouter();
  const { profile: userProfile, isLoading: userLoading } = useCurrentUser();

  const [placementProfile, setPlacementProfile] =
    useState<StudentPlacementProfile | null>(null);
  const [companies, setCompanies] = useState<PlacementCompanyProfile[]>([]);
  const [drives, setDrives] = useState<PlacementDrive[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [completedTasks, setCompletedTasks] = useState<Set<string>>(new Set());
  const [allMastery, setAllMastery] = useState<PlacementTopicMastery[]>([]);
  const lastFetchedAt = useRef<number>(0);

  useEffect(() => {
    lastFetchedAt.current = Date.now();
    fetch("/api/placement/profile")
      .then((r) => r.json())
      .then((d) => {
        if (!d.profile || !d.profile.setup_complete) {
          router.replace("/student/placement/setup");
          return;
        }
        setPlacementProfile(d.profile as StudentPlacementProfile);
        lastFetchedAt.current = Date.now();
      })
      .catch(() => toast.error("Failed to load placement profile"))
      .finally(() => setLoadingProfile(false));
  }, [router]);

  // Refresh profile when the tab regains focus, if data is older than 60s.
  // After a drill, scores update in the DB — this picks them up without a reload.
  useEffect(() => {
    const onFocus = async () => {
      if (Date.now() - lastFetchedAt.current <= 60_000) return;
      try {
        const res = await fetch("/api/placement/profile");
        if (!res.ok) return;
        const data = await res.json();
        if (data.profile) {
          setPlacementProfile(data.profile as StudentPlacementProfile);
          lastFetchedAt.current = Date.now();
        }
      } catch {
        /* ignore refresh failure */
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    fetch("/api/placement/companies")
      .then((r) => r.json())
      .then((d) => {
        setCompanies((d.companies ?? []) as PlacementCompanyProfile[]);
        setDrives((d.drives ?? []) as PlacementDrive[]);
      })
      .catch(() => toast.error("Failed to load companies"))
      .finally(() => setLoadingCompanies(false));
  }, []);

  // Mastery across all tracks — powers Focus Zones. Non-fatal (empty fallback).
  useEffect(() => {
    fetch("/api/placement/prep/mastery")
      .then((r) => (r.ok ? r.json() : { mastery: [] }))
      .then((d) => setAllMastery((d.mastery ?? []) as PlacementTopicMastery[]))
      .catch(() => setAllMastery([]));
  }, []);

  const companyFits = useMemo((): CompanyFit[] => {
    if (!placementProfile || companies.length === 0) return [];
    return (placementProfile.dream_companies ?? [])
      .map((slug) => companies.find((c) => c.slug === slug))
      .filter((c): c is PlacementCompanyProfile => Boolean(c))
      .map((c) => computeCompanyFit(placementProfile, c));
  }, [placementProfile, companies]);

  const todaysTasks = useMemo(
    () => getTodaysTasks(placementProfile?.primary_target ?? "service_it"),
    [placementProfile?.primary_target]
  );

  const focusZones = useMemo(
    () =>
      allMastery
        .filter((m) => m.attempts_count >= 5 && m.recent_accuracy < 50)
        .sort((a, b) => a.recent_accuracy - b.recent_accuracy)
        .slice(0, 3),
    [allMastery]
  );

  const activeDrives = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return drives.filter((d) => new Date(d.drive_date) >= today);
  }, [drives]);

  function toggleTask(id: string) {
    setCompletedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const firstName = userProfile?.full_name?.split(" ")[0] ?? "Student";
  const branch = userProfile?.branch ?? "—";
  const semester = userProfile?.semester ?? "—";
  const overall = placementProfile?.readiness_overall ?? 0;
  const loading = loadingProfile || userLoading;
  const profile = placementProfile;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* ── Header ── */}
      <div className="flex items-center gap-5 p-5 bg-white border border-gray-100 rounded-2xl shadow-sm mb-5">
        {/* Ring — 72×72 */}
        <div className="shrink-0">
          {loading ? (
            <Skeleton className="w-[72px] h-[72px] rounded-full" />
          ) : (
            <div className="flex flex-col items-center gap-1">
              <svg width="72" height="72" viewBox="0 0 72 72">
                <circle cx="36" cy="36" r="30" fill="none" stroke="#e5e7eb" strokeWidth="6" />
                <circle
                  cx="36" cy="36" r="30" fill="none"
                  stroke={overall >= 75 ? "#10b981" : overall >= 50 ? "#f59e0b" : "#9ca3af"}
                  strokeWidth="6"
                  strokeDasharray={`${(overall / 100) * 188.5} 188.5`}
                  strokeLinecap="round"
                  transform="rotate(-90 36 36)"
                />
                <text x="36" y="34" textAnchor="middle" fontSize="16" fontWeight="700" fill="#111827">{overall}</text>
                <text x="36" y="46" textAnchor="middle" fontSize="8" fill="#6b7280">/100</text>
              </svg>
              <span className="text-xs text-gray-500">{readinessLabel(overall)}</span>
            </div>
          )}
        </div>
        {/* Title block */}
        <div>
          {loading ? (
            <>
              <Skeleton className="h-8 w-48 mb-2" />
              <Skeleton className="h-4 w-64" />
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-gray-900">Welcome back, {firstName}</h1>
              <p className="text-sm text-gray-500 mt-1">
                {branch} · Semester {semester} · Targeting {TARGET_LABELS[profile?.primary_target ?? 'service_it']}
              </p>
              <div>
                <Link
                  href="/student/placement/prep"
                  className="mt-3 inline-flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg"
                >
                  Start practicing →
                </Link>
                <Link
                  href="/student/placement/setup?edit=true"
                  className="mt-3 ml-2 inline-flex items-center gap-1.5 px-4 py-1.5 border border-gray-200 text-gray-600 text-sm rounded-lg"
                >
                  Update profile
                </Link>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Main Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left col */}
        <div className="lg:col-span-2 space-y-6">
          {/* Readiness Breakdown */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
            <p className="text-base font-semibold text-gray-900 mb-4">
              Readiness Breakdown
            </p>
            <div className="space-y-4">
              {loadingProfile ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full bg-gray-100" />
                ))
              ) : overall === 0 ? (
                <p className="text-sm text-gray-500 py-6 text-center">
                  Start practicing to build your score
                </p>
              ) : (
                DIMENSIONS.map(({ key, label }) => {
                  const score = placementProfile?.[key] ?? 0;
                  return (
                    <div key={key} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-700 w-28">{label}</span>
                          {score < 40 && (
                            <span className="flex items-center gap-1 text-xs text-amber-600">
                              <span className="inline-block size-1.5 rounded-full bg-amber-500" />
                              Focus area
                            </span>
                          )}
                        </div>
                        <span className="text-sm text-gray-500 tabular-nums">
                          {score}/100
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${barColorClass(score)}`}
                          style={{ width: `${score}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Company Fit */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Your Company Fit
              </h2>
              <p className="text-sm text-gray-500">
                Based on your readiness scores and eligibility
              </p>
            </div>

            {loadingProfile || loadingCompanies ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-44 rounded-xl bg-gray-100" />
                ))}
              </div>
            ) : companyFits.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center space-y-2">
                  <p className="text-sm text-gray-500">No companies selected.</p>
                  <Link
                    href="/student/placement/setup"
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Update your profile
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {companyFits.map((fit) => (
                  <CompanyFitCard key={fit.company.id} fit={fit} overall={overall} />
                ))}
              </div>
            )}
          </div>

          {/* Focus Zones */}
          {focusZones.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">
                    Focus Zones
                  </h2>
                  <p className="text-sm text-gray-500">
                    Topics needing attention based on your practice history
                  </p>
                </div>
              </div>

              {focusZones.map((zone) => (
                <div
                  key={`${zone.track}-${zone.topic}`}
                  className="flex items-center justify-between p-3 bg-amber-50/40 border border-amber-100 rounded-xl mb-2"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-gray-900">
                        {zone.topic}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        {zone.recent_accuracy.toFixed(0)}% accuracy
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">
                      {zone.sessions_count}
                      {zone.sessions_count === 1 ? " session" : " sessions"} ·{" "}
                      {zone.attempts_count} questions attempted ·{" "}
                      {zone.track.charAt(0).toUpperCase() + zone.track.slice(1)}
                    </p>
                  </div>

                  <Link
                    href={`/student/placement/prep/${zone.track}/practice?topic=${encodeURIComponent(zone.topic)}`}
                    className="text-sm font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap ml-4"
                  >
                    Practice now →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right col */}
        <div className="space-y-4">
          {/* Quick Stats */}
          {loadingProfile ? (
            <Skeleton className="h-20 rounded-xl bg-gray-100" />
          ) : (
            <QuickStats profile={placementProfile} />
          )}

          {/* Today's Focus */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-medium text-gray-800 mb-3">
              Today&apos;s Focus
            </p>
            <div>
              {loadingProfile ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full bg-gray-100" />
                ))
              ) : (
                todaysTasks.map((task, idx) => {
                  const done = completedTasks.has(task.id);
                  return (
                    <div key={task.id} className={cn("flex items-center gap-3 py-2.5", idx < todaysTasks.length - 1 && "border-b border-gray-50")}>
                      <button
                        type="button"
                        onClick={() => toggleTask(task.id)}
                        className="shrink-0 text-gray-400 hover:text-emerald-500 transition-colors"
                        aria-label={done ? "Mark incomplete" : "Mark complete"}
                      >
                        {done ? (
                          <CheckCircle2 className="size-5 text-emerald-500" />
                        ) : (
                          <Circle className="size-5" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-medium truncate ${
                            done
                              ? "line-through text-gray-400"
                              : "text-gray-800"
                          }`}
                        >
                          {task.title}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {task.subtitle}
                        </p>
                      </div>
                      <Link href={task.href} aria-label={`Open ${task.title}`}>
                        <ArrowRight className="size-4 text-gray-400 hover:text-gray-600 transition-colors shrink-0" />
                      </Link>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Upcoming Drives */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-gray-900">
                Upcoming Drives
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingCompanies ? (
                Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-lg bg-gray-100" />
                ))
              ) : activeDrives.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">
                  No upcoming drives scheduled
                </p>
              ) : (
                activeDrives.slice(0, 4).map((drive) => {
                  const days = daysUntil(drive.drive_date);
                  const company = companies.find((c) => c.id === drive.company_id);
                  const slug = company?.slug ?? "";
                  const companyName =
                    (drive as PlacementDrive & { company?: PlacementCompanyProfile })
                      .company?.name ??
                    company?.name ??
                    "Company";
                  const daysLabel =
                    days <= 7
                      ? `${days} days left`
                      : days <= 14
                      ? `${days} days left`
                      : `${days} days away`;
                  const daysClass =
                    days <= 7
                      ? "text-amber-600 font-bold"
                      : days <= 14
                      ? "text-amber-600"
                      : "text-gray-600";
                  return (
                    <div
                      key={drive.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {companyName}
                        </p>
                        <p className={`text-xs ${daysClass}`}>{daysLabel}</p>
                      </div>
                      {slug && (
                        <Link href={`/student/placement/companies/${slug}`}>
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0 text-xs"
                          >
                            Prepare Now
                          </Button>
                        </Link>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── Company Fit Card ─────────────────────────────────────────────────────────

function CompanyFitCard({ fit, overall }: { fit: CompanyFit; overall: number }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3.5 border border-gray-100 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900 leading-tight">
          {fit.company.name}
        </p>
        <div className="text-right shrink-0">
          <span className="text-2xl font-medium text-gray-400">
            {fit.fit_score}
          </span>
          <span className="text-xs text-gray-400">/100</span>
        </div>
      </div>

      <p className="text-xs text-gray-500 -mt-1">
        {readinessLabel(fit.fit_score)}
      </p>

      {!fit.is_eligible ? (
        <div className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
          Not eligible — {fit.ineligibility_reason}
        </div>
      ) : fit.fit_level !== "ready" ? (
        <div className="flex flex-wrap gap-1.5">
          {overall === 0 ? (
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
              Complete practice to see gaps
            </span>
          ) : (
            fit.top_gaps.map((gap) => (
              <span
                key={gap}
                className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded"
              >
                {gap
                  .replace("Aptitude", "Apt")
                  .replace("Verbal Ability", "Verbal")
                  .replace("Core Domain", "Domain")
                  .replace("Communication", "Comm")
                  .replace("/100", "")}
              </span>
            ))
          )}
        </div>
      ) : null}

      <div className="mt-auto pt-2">
        <Link
          href={`/student/placement/prep?company=${fit.company.slug}`}
        >
          <Button variant="outline" size="sm" className="w-full text-xs">
            Prep for {fit.company.name}
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ─── Quick Stats ──────────────────────────────────────────────────────────────

function QuickStats({ profile }: { profile: StudentPlacementProfile | null }) {
  const stats: Array<{ label: string; value: string; href: string | null }> = [
    {
      label: "Prep Streak",
      value: `${profile?.prep_streak_days ?? 0} days`,
      href: null,
    },
    {
      label: "Tests Taken",
      value: "0",
      href: null,
    },
    {
      label: "Resume",
      value: `${profile?.resume_completeness ?? 0}%`,
      href: "/student/placement/resume",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {stats.map((stat) => {
        const card = (
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-xl font-medium text-gray-800">
              {stat.value}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {stat.label}
            </p>
          </div>
        );
        return stat.href ? (
          <Link key={stat.label} href={stat.href}>
            {card}
          </Link>
        ) : (
          <div key={stat.label}>{card}</div>
        );
      })}
    </div>
  );
}
