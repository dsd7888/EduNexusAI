"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { Skeleton } from "@/components/ui/skeleton";
import { MonoTag } from "@/components/ui/mono-tag";
import { ScoreMeter } from "@/components/ui/score-meter";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/useSupabaseData";
import { computeCompanyFit, readinessLabel } from "@/lib/placement/readiness";
import { computeNextMoves } from "@/lib/placement/nextMove";
import type {
  NextMoveDrive,
  NextMoveState,
  NextMoveTopicMastery,
  RankedMove,
  StageId,
} from "@/lib/placement/nextMove";
import { VALID_TRACKS, type Track } from "@/lib/placement/tracks";
import {
  TARGET_LABELS,
  type StudentPlacementProfile,
  type PlacementCompanyProfile,
  type PlacementDrive,
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

// ─── Stage strip (SPEC §2 — the six-position line) ─────────────────────────────

const STAGE_ORDER: Array<{ id: StageId; label: string; locked: boolean }> = [
  { id: "foundation", label: "Foundation", locked: true },
  { id: "active_prep", label: "Active Prep", locked: false },
  { id: "drive_sprint", label: "Drive Sprint", locked: false },
  { id: "interview", label: "Interview", locked: false },
  { id: "post_outcome", label: "Post-Outcome", locked: true },
  { id: "competitive_exam", label: "Competitive Exam", locked: true },
];

function StageStrip({ current }: { current: StageId }) {
  return (
    <ol className="flex items-center gap-2 overflow-x-auto pb-1">
      {STAGE_ORDER.map((stage, i) => {
        const isCurrent = !stage.locked && stage.id === current;
        return (
          <li key={stage.id} className="flex shrink-0 items-center gap-2">
            {i > 0 && <span aria-hidden className="h-px w-4 shrink-0 bg-ink-100" />}
            <MonoTag variant={isCurrent ? "active" : "default"}>
              {stage.label}
              {stage.locked ? " · Locked" : isCurrent ? " · Now" : ""}
            </MonoTag>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Next Move cards ───────────────────────────────────────────────────────────

function HeroMoveCard({ move }: { move: RankedMove }) {
  return (
    <section className="rounded-12 border border-ink-200 bg-paper p-6 sm:p-8">
      <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">
        Next move
      </p>
      <h2 className="mt-2 font-plex-serif text-display-sm font-semibold leading-snug text-ink">
        {move.title}
      </h2>
      <p className="mt-2 max-w-2xl font-plex-sans text-body text-ink-600">{move.reason}</p>
      {move.tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {move.tags.map((tag) => (
            <MonoTag key={tag}>{tag}</MonoTag>
          ))}
        </div>
      )}
      <Link
        href={move.href}
        className="mt-6 inline-flex h-11 items-center gap-1.5 rounded-8 bg-ink px-5 font-plex-sans text-body font-medium text-paper transition-colors duration-180 ease-out hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2"
      >
        {move.title}
        <ArrowRight className="size-4" />
      </Link>
    </section>
  );
}

function SecondaryMoveCard({ move }: { move: RankedMove }) {
  return (
    <Link
      href={move.href}
      className="group flex flex-col gap-2 rounded-8 border border-ink-200 bg-paper p-4 transition-colors duration-180 ease-out hover:border-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-plex-sans text-body-sm font-medium text-ink-900">{move.title}</p>
        <ArrowRight className="size-4 shrink-0 text-ink-300 transition-transform duration-180 ease-out group-hover:translate-x-0.5" />
      </div>
      <p className="font-plex-sans text-body-sm text-ink-500">{move.reason}</p>
      {move.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {move.tags.map((tag) => (
            <MonoTag key={tag}>{tag}</MonoTag>
          ))}
        </div>
      )}
    </Link>
  );
}

function MoreMovesPanel({ moves }: { moves: RankedMove[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-11 items-center gap-1.5 rounded-4 font-plex-sans text-body-sm font-medium text-ink-600 transition-colors duration-180 ease-out hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
      >
        <ChevronDown
          className={cn(
            "size-4 transition-transform duration-180 ease-out motion-reduce:transition-none",
            open && "rotate-180"
          )}
        />
        {open ? "Show fewer moves" : `${moves.length} more move${moves.length === 1 ? "" : "s"}`}
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-240 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <ul className="mt-2 divide-y divide-ink-100 rounded-8 border border-ink-100">
            {moves.map((m) => (
              <li key={`${m.kind}-${m.href}-${m.title}`}>
                <Link
                  href={m.href}
                  className="flex min-h-11 items-center justify-between gap-2 px-3 py-2.5 font-plex-sans text-body-sm text-ink-700 transition-colors duration-180 ease-out hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
                >
                  <span>{m.title}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-ink-300" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function EmptyMovesCard() {
  return (
    <div className="rounded-12 border border-dashed border-ink-200 bg-paper p-6 text-center">
      <p className="font-plex-sans text-body text-ink-600">
        No urgent moves right now — your readiness is solid and nothing is due soon.
      </p>
      <Link
        href="/student/placement/prep"
        className="mt-3 inline-flex font-plex-sans text-body-sm font-medium text-ink underline-offset-2 hover:underline"
      >
        Browse prep tracks
      </Link>
    </div>
  );
}

// ─── Demoted "Your readiness" section (the old dashboard content) ─────────────

function CompanyFitCard({ fit, overall }: { fit: CompanyFit; overall: number }) {
  return (
    <div className="flex flex-col gap-3 rounded-8 border border-ink-200 bg-paper p-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="font-plex-sans text-body-sm font-semibold leading-tight text-ink-900">
          {fit.company.name}
        </p>
        <p className="font-plex-mono text-body-sm text-ink-600">
          {fit.fit_score}
          <span className="text-ink-500">/100</span>
        </p>
      </div>
      <p className="-mt-1 font-plex-sans text-body-sm text-ink-500">{readinessLabel(fit.fit_score)}</p>

      {!fit.is_eligible ? (
        <MonoTag variant="amber-fill" className="w-fit">
          Not eligible — {fit.ineligibility_reason}
        </MonoTag>
      ) : fit.fit_level !== "ready" ? (
        <div className="flex flex-wrap gap-1.5">
          {overall === 0 ? (
            <MonoTag className="w-fit">Complete practice to see gaps</MonoTag>
          ) : (
            fit.top_gaps.map((gap) => (
              <MonoTag key={gap} variant="amber-fill">
                {gap}
              </MonoTag>
            ))
          )}
        </div>
      ) : null}

      <Link
        href={`/student/placement/prep?company=${fit.company.slug}`}
        className="mt-auto inline-flex h-11 items-center justify-center rounded-8 border border-ink-200 font-plex-sans text-body-sm font-medium text-ink transition-colors duration-180 ease-out hover:border-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
      >
        Prep for {fit.company.name}
      </Link>
    </div>
  );
}

function UpcomingDrivesList({
  drives,
  companies,
}: {
  drives: PlacementDrive[];
  companies: PlacementCompanyProfile[];
}) {
  if (drives.length === 0) {
    return <p className="font-plex-sans text-body-sm text-ink-600">No upcoming drives scheduled.</p>;
  }
  return (
    <ul className="space-y-3">
      {drives.slice(0, 4).map((drive) => {
        const days = daysUntil(drive.drive_date);
        const company = drive.company ?? companies.find((c) => c.id === drive.company_id);
        return (
          <li key={drive.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-plex-sans text-body-sm font-medium text-ink-800">
                {company?.name ?? "Company"}
              </p>
              <MonoTag className="mt-1">{days <= 0 ? "Today" : `${days}d away`}</MonoTag>
            </div>
            {company?.slug && (
              <Link
                href={`/student/placement/companies/${company.slug}`}
                className="shrink-0 font-plex-sans text-body-sm font-medium text-ink underline-offset-2 hover:underline"
              >
                Prepare
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ReadinessDisclosure({
  profile,
  overall,
  companyFits,
  drives,
  companies,
}: {
  profile: StudentPlacementProfile;
  overall: number;
  companyFits: CompanyFit[];
  drives: PlacementDrive[];
  companies: PlacementCompanyProfile[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-12 border border-ink-200 bg-paper">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-12 px-5 py-4 font-plex-sans text-body font-medium text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
      >
        <span>Your readiness</span>
        <ChevronDown
          className={cn(
            "size-4 text-ink-400 transition-transform duration-180 ease-out motion-reduce:transition-none",
            open && "rotate-180"
          )}
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-240 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-6 border-t border-ink-100 px-5 py-5">
            <div className="flex flex-wrap gap-2">
              <MonoTag>
                Overall {overall}/100 · {readinessLabel(overall)}
              </MonoTag>
              <MonoTag>Streak {profile.prep_streak_days}d</MonoTag>
              <MonoTag>Resume {profile.resume_completeness}%</MonoTag>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {DIMENSIONS.map(({ key, label }) => (
                <ScoreMeter key={key} label={label} score={profile[key]} target={70} />
              ))}
            </div>

            {companyFits.length > 0 && (
              <div>
                <p className="mb-3 font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">
                  Company fit
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {companyFits.map((fit) => (
                    <CompanyFitCard key={fit.company.id} fit={fit} overall={overall} />
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="mb-3 font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">
                Upcoming drives
              </p>
              <UpcomingDrivesList drives={drives} companies={companies} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

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
  const [allMastery, setAllMastery] = useState<PlacementTopicMastery[]>([]);
  const [loadingMastery, setLoadingMastery] = useState(true);
  const lastFetchedAt = useRef<number>(0);

  useEffect(() => {
    lastFetchedAt.current = Date.now();
    fetch("/api/placement/profile")
      .then((r) => r.json())
      .then((d) => {
        // No profile row at all — genuine first run, nothing to rank yet.
        if (!d.profile) {
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

  // Mastery across all tracks — powers drift detection in computeNextMoves.
  useEffect(() => {
    fetch("/api/placement/prep/mastery")
      .then((r) => (r.ok ? r.json() : { mastery: [] }))
      .then((d) => setAllMastery((d.mastery ?? []) as PlacementTopicMastery[]))
      .catch(() => setAllMastery([]))
      .finally(() => setLoadingMastery(false));
  }, []);

  const companyFits = useMemo((): CompanyFit[] => {
    if (!placementProfile || companies.length === 0) return [];
    return (placementProfile.dream_companies ?? [])
      .map((slug) => companies.find((c) => c.slug === slug))
      .filter((c): c is PlacementCompanyProfile => Boolean(c))
      .map((c) => computeCompanyFit(placementProfile, c));
  }, [placementProfile, companies]);

  const activeDrives = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return drives.filter((d) => new Date(d.drive_date) >= today);
  }, [drives]);

  const dataReady = !loadingProfile && !userLoading && !loadingCompanies && !loadingMastery;

  const nextMoveState: NextMoveState | null = useMemo(() => {
    if (!dataReady || !placementProfile) return null;

    const mappedDrives: NextMoveDrive[] = activeDrives.map((d) => {
      const company = d.company ?? companies.find((c) => c.id === d.company_id);
      return {
        id: d.id,
        company_name: company?.name ?? "Company",
        company_type: company?.company_type ?? "service_it",
        drive_date: d.drive_date,
        eligible_min_cgpa: d.eligible_min_cgpa,
        eligible_branches: d.eligible_branches,
      };
    });

    const mappedMastery: NextMoveTopicMastery[] = allMastery
      .filter((m) => VALID_TRACKS.has(m.track))
      .map((m) => ({
        track: m.track as Track,
        topic: m.topic,
        recent_accuracy: m.recent_accuracy,
        attempts_count: m.attempts_count,
        last_practiced_at: m.last_practiced_at,
      }));

    return {
      profile: placementProfile,
      studentBranch: userProfile?.branch ?? "",
      drives: mappedDrives,
      topicMastery: mappedMastery,
    };
  }, [dataReady, placementProfile, userProfile?.branch, activeDrives, companies, allMastery]);

  const moves = useMemo(
    () => (nextMoveState ? computeNextMoves(nextMoveState) : []),
    [nextMoveState]
  );

  const hero = moves[0];
  const secondary = moves.slice(1, 3);
  const more = moves.slice(3);
  const isSetupMove = hero?.kind === "setup";
  const currentStage: StageId = hero?.stage ?? "active_prep";

  const firstName = userProfile?.full_name?.split(" ")[0] ?? "Student";
  const branch = userProfile?.branch ?? "—";
  const semester = userProfile?.semester ?? "—";
  const overall = placementProfile?.readiness_overall ?? 0;

  if (!dataReady || !placementProfile) {
    return (
      <div className="max-w-5xl space-y-6">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-48 w-full rounded-12" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-28 rounded-8" />
          <Skeleton className="h-28 rounded-8" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">
          {branch} · Semester {semester} · Targeting {TARGET_LABELS[placementProfile.primary_target]}
        </p>
        <h1 className="mt-1 font-plex-serif text-display-lg font-bold text-ink">
          Welcome back, {firstName}
        </h1>
      </div>

      {/* Stage strip */}
      <StageStrip current={currentStage} />

      {/* Next Move */}
      {hero ? <HeroMoveCard move={hero} /> : <EmptyMovesCard />}

      {!isSetupMove && secondary.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {secondary.map((m) => (
            <SecondaryMoveCard key={`${m.kind}-${m.href}-${m.title}`} move={m} />
          ))}
        </div>
      )}

      {!isSetupMove && more.length > 0 && <MoreMovesPanel moves={more} />}

      {/* Demoted "Your readiness" — the old dashboard, reachable not first */}
      {!isSetupMove && (
        <ReadinessDisclosure
          profile={placementProfile}
          overall={overall}
          companyFits={companyFits}
          drives={activeDrives}
          companies={companies}
        />
      )}
    </div>
  );
}
