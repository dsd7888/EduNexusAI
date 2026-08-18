"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import { MonoTag, type MonoTagVariant } from "@/components/ui/mono-tag";
import { scoreState, DEFAULT_TARGET } from "@/lib/ui/score";
import { cn } from "@/lib/utils";

// ─── Types (mirror src/app/api/placement/tpo/dashboard/route.ts) ──────────────

interface StudentRow {
  id: string;
  full_name: string | null;
  branch: string | null;
  semester: number | null;
  email: string | null;
  cgpa: number | null;
  readiness_overall: number;
  readiness_aptitude: number;
  readiness_verbal: number;
  readiness_domain: number;
  readiness_coding: number;
  readiness_communication: number;
  resume_completeness: number;
  setup_complete: boolean;
  last_active_date: string | null;
  prep_streak_days: number;
}

interface DashboardStats {
  total_students: number;
  setup_complete: number;
  ready: number;
  developing: number;
  early: number;
  not_started: number;
  avg_aptitude: number;
  avg_verbal: number;
  avg_domain: number;
  avg_coding: number;
  avg_communication: number;
  avg_overall: number;
  weakest_dimension: string | null;
  avg_resume_completeness: number;
  resumes_complete: number;
  active_this_week: number;
}

interface DriveRow {
  id: string;
  company_id: string;
  drive_date: string;
  registration_deadline: string | null;
  eligible_branches: string[] | null;
  notes: string | null;
  company: { name: string; logo_url: string | null; company_type: string } | null;
}

interface DimensionAvg {
  dimension: string;
  label: string;
  avg: number;
}

interface BranchDimensionGap {
  branch: string;
  cohortSize: number;
  suppressed: boolean;
  weakest: DimensionAvg | null;
}

interface DimensionGapsResult {
  cohortSize: number;
  suppressed: boolean;
  ranked: DimensionAvg[] | null;
  perBranch: BranchDimensionGap[];
}

interface AtRiskEntry {
  student_id: string;
  full_name: string | null;
  branch: string | null;
  drive_name: string;
  days_remaining: number;
  dimension_label: string;
  score: number;
}

interface AtRiskResult {
  count: number | null;
  named?: AtRiskEntry[];
}

interface DriveFunnelEntry {
  drive_id: string;
  company_name: string;
  drive_date: string;
  days_remaining: number;
  suppressed: boolean;
  eligible_count: number | null;
  ready_count: number | null;
}

interface ActivityResult {
  cohortSize: number;
  suppressed: boolean;
  active_7d: number | null;
  active_14d: number | null;
  active_30d: number | null;
  setup_incomplete: number | null;
  streak_distribution: Record<"0" | "1-2" | "3-6" | "7+", number> | null;
}

interface TargetDistributionResult {
  cohortSize: number;
  suppressed: boolean;
  counts: Array<{ target: string; label: string; count: number }> | null;
}

interface LiftPoint {
  date: string;
  student_count: number;
  suppressed: boolean;
  avg_overall: number | null;
}

interface InsightsResult {
  readiness_lift: { branch: string; points: LiftPoint[] };
  at_risk: AtRiskResult;
  dimension_gaps: DimensionGapsResult;
  drive_funnel: DriveFunnelEntry[];
  activity: ActivityResult;
  target_distribution: TargetDistributionResult;
}

interface DashboardResponse {
  access: { role: string; branch: string | null; warning: string | null };
  stats: DashboardStats | null;
  drives: DriveRow[];
  insights: InsightsResult | null;
  filters: { branch: string | null; semester: string | null };
  students?: StudentRow[];
}

type SortCol =
  | "full_name"
  | "branch"
  | "semester"
  | "cgpa"
  | "readiness_overall"
  | "readiness_aptitude"
  | "readiness_verbal"
  | "readiness_domain"
  | "resume_completeness";

type SortDir = "asc" | "desc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAcademicYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (month >= 6) return `${year}-${String(year + 1).slice(2)}`;
  return `${year - 1}-${String(year).slice(2)}`;
}

function scoreVariant(score: number, attempted = true): MonoTagVariant {
  const state = scoreState(score, { attempted, target: DEFAULT_TARGET });
  if (state === "good") return "mastery-fill";
  if (state === "progress") return "amber-fill";
  return "default";
}

function getStatusLabel(s: StudentRow): { label: string; variant: MonoTagVariant } {
  if (s.readiness_overall >= 75) return { label: "Drive Ready", variant: "mastery-fill" };
  if (s.readiness_overall >= 50) return { label: "Developing", variant: "amber-fill" };
  if (s.readiness_overall > 0) return { label: "Early Stage", variant: "amber-fill" };
  if (!s.setup_complete) return { label: "Not Set Up", variant: "default" };
  return { label: "Not Started", variant: "default" };
}

function formatDriveDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const SKILL_BARS: { label: string; key: keyof DashboardStats }[] = [
  { label: "Aptitude", key: "avg_aptitude" },
  { label: "Verbal", key: "avg_verbal" },
  { label: "Core Domain", key: "avg_domain" },
  { label: "Coding", key: "avg_coding" },
  { label: "Communication", key: "avg_communication" },
];

const WEAKEST_LABEL: Record<string, string> = {
  aptitude: "Aptitude",
  verbal: "Verbal",
  domain: "Core Domain",
  coding: "Coding",
  communication: "Communication",
};

// ─── Small shared building blocks ──────────────────────────────────────────────

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-12 border border-ink-200 bg-paper p-5", className)}>
      {children}
    </div>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">
      {children}
    </p>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-500">{children}</p>;
}

/** Plain helper (not a component) so the current-time read doesn't trip
 * react-hooks' render-purity check — same pattern as ContinueStrip.tsx's
 * `relative()`. */
function lastActiveLabel(date: string | null): { label: string; variant: MonoTagVariant } {
  if (!date) return { label: "Never active", variant: "default" };
  const daysSince = (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince <= 7) return { label: "Active", variant: "mastery-fill" };
  return { label: `${Math.floor(daysSince)}d ago`, variant: "default" };
}

function LastActiveTag({ date }: { date: string | null }) {
  const { label, variant } = lastActiveLabel(date);
  return <MonoTag variant={variant}>{label}</MonoTag>;
}

function LiftSparkline({ points }: { points: LiftPoint[] }) {
  const usable = points.filter((p) => !p.suppressed && p.avg_overall != null);
  if (usable.length < 2) {
    return (
      <EmptyState>
        {points.length === 0
          ? "No daily snapshots recorded yet — the nightly sweep hasn't run twice for this cohort."
          : "Not enough unsuppressed daily snapshots yet to draw a trend."}
      </EmptyState>
    );
  }
  const width = 320;
  const height = 64;
  const pad = 6;
  const values = usable.map((p) => p.avg_overall as number);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const stepX = usable.length > 1 ? (width - pad * 2) / (usable.length - 1) : 0;
  const coords = usable
    .map((p, i) => {
      const x = pad + i * stepX;
      const y = pad + (height - pad * 2) * (1 - ((p.avg_overall as number) - min) / range);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const first = usable[0].avg_overall as number;
  const last = usable[usable.length - 1].avg_overall as number;
  const delta = last - first;

  return (
    <div>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="max-w-full text-ochre"
        role="img"
        aria-label={`Overall readiness trend, ${first} to ${last} over ${usable.length} days`}
      >
        <polyline points={coords} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <p className="mt-1 font-plex-mono text-xs text-ink-500">
        {first} → {last} over {usable.length} day{usable.length === 1 ? "" : "s"} ({delta >= 0 ? "+" : ""}
        {delta})
      </p>
    </div>
  );
}

// ─── Insight sections — role-agnostic, visible to every authorized role ───────

function DimensionGapsCard({ data }: { data: DimensionGapsResult }) {
  return (
    <Card>
      <SectionEyebrow>Dimension gaps</SectionEyebrow>
      {data.suppressed ? (
        <EmptyState>
          Not enough students ({data.cohortSize}) to show a cohort-wide average without risking identifying
          someone.
        </EmptyState>
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.ranked!.map((d) => (
            <MonoTag key={d.dimension} variant={scoreVariant(d.avg)}>
              {d.label} {d.avg}
            </MonoTag>
          ))}
        </div>
      )}
      {data.perBranch.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-ink-100 pt-4">
          <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">
            Per branch
          </p>
          {data.perBranch.map((b) => (
            <div key={b.branch} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-ink-700">{b.branch}</span>
              {b.suppressed ? (
                <MonoTag variant="default">Insufficient data ({b.cohortSize})</MonoTag>
              ) : (
                <MonoTag variant={scoreVariant(b.weakest!.avg)}>
                  Weakest: {b.weakest!.label} {b.weakest!.avg}
                </MonoTag>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function AtRiskCard({ data }: { data: AtRiskResult }) {
  return (
    <Card>
      <SectionEyebrow>At-risk for an upcoming drive</SectionEyebrow>
      {data.count === null ? (
        <EmptyState>Not enough students in this cohort to report a count without risking identifying someone.</EmptyState>
      ) : data.count === 0 ? (
        <EmptyState>No student is both eligible for a drive within 14 days and weak on that drive&apos;s weighted dimension.</EmptyState>
      ) : (
        <>
          <MonoTag variant="amber-fill">{data.count} at risk</MonoTag>
          {data.named && data.named.length > 0 && (
            <ul className="mt-3 space-y-2">
              {data.named.map((e) => (
                <li key={e.student_id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink-900">{e.full_name ?? "—"}</span>
                  <span className="flex items-center gap-2">
                    <MonoTag variant="default">{e.drive_name} · {e.days_remaining}d</MonoTag>
                    <MonoTag variant="amber-fill">
                      {e.dimension_label} {e.score}
                    </MonoTag>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function DriveFunnelCard({ data }: { data: DriveFunnelEntry[] }) {
  return (
    <Card>
      <SectionEyebrow>Drive-readiness funnel</SectionEyebrow>
      {data.length === 0 ? (
        <EmptyState>No upcoming drives scheduled.</EmptyState>
      ) : (
        <div className="space-y-3">
          {data.map((d) => (
            <div key={d.drive_id} className="flex items-center justify-between gap-3 text-sm">
              <div>
                <p className="text-ink-900">{d.company_name}</p>
                <p className="text-xs text-ink-500">{formatDriveDate(d.drive_date)} · {d.days_remaining}d away</p>
              </div>
              {d.suppressed ? (
                <MonoTag variant="default">Insufficient data</MonoTag>
              ) : (
                <span className="flex items-center gap-2">
                  <MonoTag variant="default">{d.eligible_count} eligible</MonoTag>
                  <MonoTag variant="mastery-fill">{d.ready_count} ready</MonoTag>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const STREAK_LABELS: Record<string, string> = { "0": "0 days", "1-2": "1–2 days", "3-6": "3–6 days", "7+": "7+ days" };

function ActivityCard({ data }: { data: ActivityResult }) {
  return (
    <Card>
      <SectionEyebrow>Activity &amp; drop-off</SectionEyebrow>
      {data.suppressed ? (
        <EmptyState>Not enough students ({data.cohortSize}) to report activity without risking identifying someone.</EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <MonoTag variant="default">{data.active_7d} active in 7d</MonoTag>
            <MonoTag variant="default">{data.active_14d} active in 14d</MonoTag>
            <MonoTag variant="default">{data.active_30d} active in 30d</MonoTag>
            <MonoTag variant={data.setup_incomplete! > 0 ? "amber-fill" : "default"}>
              {data.setup_incomplete} setup-incomplete
            </MonoTag>
          </div>
          <div className="mt-4 space-y-1.5 border-t border-ink-100 pt-4">
            <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500">
              Streak spread
            </p>
            {(Object.keys(data.streak_distribution!) as Array<keyof typeof data.streak_distribution>).map((k) => (
              <div key={k} className="flex items-center justify-between text-sm text-ink-700">
                <span>{STREAK_LABELS[k]}</span>
                <span className="font-plex-mono">{data.streak_distribution![k]}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function TargetDistributionCard({ data }: { data: TargetDistributionResult }) {
  return (
    <Card>
      <SectionEyebrow>Target distribution</SectionEyebrow>
      {data.suppressed ? (
        <EmptyState>Not enough students ({data.cohortSize}) to report a distribution without risking identifying someone.</EmptyState>
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.counts!.map((c) => (
            <MonoTag key={c.target} variant="default">
              {c.label} {c.count}
            </MonoTag>
          ))}
        </div>
      )}
    </Card>
  );
}

function ReadinessLiftCard({ data }: { data: InsightsResult["readiness_lift"] }) {
  return (
    <Card>
      <SectionEyebrow>Readiness lift over time · {data.branch}</SectionEyebrow>
      <LiftSparkline points={data.points} />
    </Card>
  );
}

function InsightsGrid({ insights }: { insights: InsightsResult }) {
  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-2">
      <ReadinessLiftCard data={insights.readiness_lift} />
      <AtRiskCard data={insights.at_risk} />
      <DimensionGapsCard data={insights.dimension_gaps} />
      <DriveFunnelCard data={insights.drive_funnel} />
      <ActivityCard data={insights.activity} />
      <TargetDistributionCard data={insights.target_distribution} />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PlacementDashboardPage() {
  const router = useRouter();

  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [response, setResponse] = useState<DashboardResponse | null>(null);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [selectedSemester, setSelectedSemester] = useState("");
  const [filterOptions, setFilterOptions] = useState<{ branches: string[]; semesters: number[] }>({
    branches: [],
    semesters: [],
  });
  const [sortCol, setSortCol] = useState<SortCol>("readiness_overall");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const initialOptionsLoaded = useRef(false);
  const academicYear = useMemo(() => getAcademicYear(), []);

  const isPinnedBranch = response?.access.role === "hod";

  const sortedStudents = useMemo(() => {
    return [...(response?.students ?? [])].sort((a, b) => {
      const aVal = a[sortCol];
      const bVal = b[sortCol];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return sortDir === "asc" ? -1 : 1;
      if (bVal === null) return sortDir === "asc" ? 1 : -1;
      const as = String(aVal).toLowerCase();
      const bs = String(bVal).toLowerCase();
      return sortDir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
    });
  }, [response?.students, sortCol, sortDir]);

  async function fetchData(branch = "", semester = "") {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (branch) params.set("branch", branch);
      if (semester) params.set("semester", semester);
      const qs = params.toString();
      const res = await fetch(`/api/placement/tpo/dashboard${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("fetch failed");
      const result = (await res.json()) as DashboardResponse;
      setResponse(result);

      if (!initialOptionsLoaded.current) {
        initialOptionsLoaded.current = true;
        const branchSet = new Set<string>();
        for (const s of result.students ?? []) if (s.branch) branchSet.add(s.branch);
        for (const b of result.insights?.dimension_gaps.perBranch ?? []) branchSet.add(b.branch);
        const semesterSet = new Set<number>();
        for (const s of result.students ?? []) if (s.semester !== null) semesterSet.add(s.semester);
        setFilterOptions({ branches: [...branchSet].sort(), semesters: [...semesterSet].sort((a, b) => a - b) });
      }
    } catch (err) {
      console.error("[placement-dashboard] fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (cancelled) return;
      if (!user) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

      if (cancelled) return;

      const role = (profile as { role?: string } | null)?.role ?? "";
      if (!["superadmin", "dean", "hod", "dept_admin"].includes(role)) {
        router.push("/faculty/dashboard");
        return;
      }

      setAuthorized(true);
      await fetchData();
    }

    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleBranchChange(value: string) {
    setSelectedBranch(value);
    fetchData(value, selectedSemester);
  }

  function handleSemesterChange(value: string) {
    setSelectedSemester(value);
    fetchData(selectedBranch, value);
  }

  function handleSort(col: SortCol) {
    if (col === sortCol) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  }

  function SortIndicator({ col }: { col: SortCol }) {
    if (col !== sortCol) return <span className="ml-1 text-ink-300">↕</span>;
    return <span className="ml-1 text-ochre">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  function exportCSV() {
    const headers = [
      "Name", "Branch", "Semester", "CGPA", "Overall", "Aptitude", "Verbal", "Domain", "Resume %", "Last Active", "Status",
    ];
    const rows = sortedStudents.map((s) => [
      s.full_name ?? "",
      s.branch ?? "",
      s.semester ?? "",
      s.cgpa ?? "",
      s.readiness_overall,
      s.readiness_aptitude,
      s.readiness_verbal,
      s.readiness_domain,
      s.resume_completeness,
      s.last_active_date ?? "Never",
      getStatusLabel(s).label,
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `placement_readiness_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!authorized || (loading && !response)) {
    return (
      <div className="min-h-screen bg-paper p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="h-10 w-72 animate-pulse rounded-8 bg-ink-100" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-12 bg-ink-100" />
            ))}
          </div>
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-8 bg-ink-100" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const selectClass =
    "h-11 rounded-8 border border-ink-200 bg-paper px-3 font-plex-sans text-sm text-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2";

  return (
    <div className="min-h-screen bg-paper">
      <div className={cn("mx-auto max-w-7xl p-6 transition-opacity", loading ? "opacity-60 pointer-events-none" : "")}>
        {/* ── Header ── */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-plex-serif text-display-sm font-semibold text-ink-900">Placement Readiness Dashboard</h1>
            <p className="mt-1 text-sm text-ink-500">
              Batch overview · {academicYear}
              {response && (
                <>
                  {" · "}
                  <MonoTag variant="active" className="align-middle">
                    {response.access.role === "hod" ? "Your branch, named" : response.access.role === "superadmin" ? "All branches, named" : "Aggregate view"}
                  </MonoTag>
                </>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {isPinnedBranch ? (
              <MonoTag variant="active">{response?.access.branch ?? "—"}</MonoTag>
            ) : (
              <select value={selectedBranch} onChange={(e) => handleBranchChange(e.target.value)} className={selectClass}>
                <option value="">All Branches</option>
                {filterOptions.branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            )}
            <select value={selectedSemester} onChange={(e) => handleSemesterChange(e.target.value)} className={selectClass}>
              <option value="">All Semesters</option>
              {filterOptions.semesters.map((s) => (
                <option key={s} value={String(s)}>
                  Semester {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Warning / blocked state ── */}
        {response?.access.warning && (
          <Card className="mb-6 border-ochre">
            <p className="text-sm text-ink-900">{response.access.warning}</p>
          </Card>
        )}

        {response && !response.access.warning && response.insights && (
          <>
            {/* ── Named-role stat cards + skill breakdown + drives (hod/superadmin only) ── */}
            {response.stats && (
              <>
                <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <Card>
                    <p className="font-plex-mono text-3xl font-medium text-mastery-green">{response.stats.ready}</p>
                    <p className="mt-1 text-sm text-ink-500">Drive Ready</p>
                    <p className="mt-0.5 text-xs text-ink-400">of {response.stats.total_students} students (≥75 readiness)</p>
                  </Card>
                  <Card>
                    <p className="font-plex-mono text-3xl font-medium text-amber">{response.stats.developing}</p>
                    <p className="mt-1 text-sm text-ink-500">Developing</p>
                    <p className="mt-0.5 text-xs text-ink-400">50–74 readiness score</p>
                  </Card>
                  <Card>
                    <p className="font-plex-mono text-3xl font-medium text-ink-400">{response.stats.not_started}</p>
                    <p className="mt-1 text-sm text-ink-500">Not Started</p>
                    <p className="mt-0.5 text-xs text-ink-400">0 readiness — not practiced yet</p>
                  </Card>
                  <Card>
                    <p className="font-plex-mono text-3xl font-medium text-ink-900">{response.stats.active_this_week}</p>
                    <p className="mt-1 text-sm text-ink-500">Active This Week</p>
                    <p className="mt-0.5 text-xs text-ink-400">practiced in last 7 days</p>
                  </Card>
                </div>

                <div className="mb-6 grid gap-4 lg:grid-cols-3">
                  <Card className="lg:col-span-2">
                    <h2 className="mb-4 font-plex-sans text-sm font-semibold text-ink-900">Batch Skill Breakdown</h2>
                    <div className="space-y-3">
                      {SKILL_BARS.map(({ label, key }) => {
                        const score = response.stats![key] as number;
                        return (
                          <div key={key} className="flex items-center gap-3">
                            <span className="w-32 shrink-0 text-sm text-ink-700">{label}</span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all",
                                  scoreState(score, { target: DEFAULT_TARGET }) === "good"
                                    ? "bg-mastery-green"
                                    : scoreState(score, { target: DEFAULT_TARGET }) === "progress"
                                      ? "bg-amber"
                                      : "bg-ink-300"
                                )}
                                style={{ width: `${Math.max(score, 3)}%` }}
                              />
                            </div>
                            <span className="w-10 text-right font-plex-mono text-sm text-ink-700">{score}</span>
                          </div>
                        );
                      })}
                    </div>
                    {response.stats.weakest_dimension && (
                      <div className="mt-4 rounded-8 border border-ink-200 bg-ink-50 p-3">
                        <p className="text-sm text-ink-700">
                          Weakest area:{" "}
                          <span className="font-medium text-ink-900">
                            {WEAKEST_LABEL[response.stats.weakest_dimension] ?? response.stats.weakest_dimension}
                          </span>
                          . Consider organizing a focused session.
                        </p>
                      </div>
                    )}
                  </Card>

                  <Card>
                    <h2 className="mb-4 font-plex-sans text-sm font-semibold text-ink-900">Upcoming Drives</h2>
                    {response.drives.length === 0 ? (
                      <EmptyState>No drives scheduled</EmptyState>
                    ) : (
                      <div className="space-y-4">
                        {response.drives.map((drive) => (
                          <div key={drive.id} className="border-b border-ink-100 pb-3 last:border-0 last:pb-0">
                            <p className="text-sm font-medium text-ink-900">{drive.company?.name ?? "Unknown Company"}</p>
                            <p className="mt-0.5 text-xs text-ink-500">{formatDriveDate(drive.drive_date)}</p>
                            {drive.eligible_branches && drive.eligible_branches.length > 0 && (
                              <p className="mt-0.5 text-xs text-ink-400">{drive.eligible_branches.join(", ")}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </div>
              </>
            )}

            {/* ── Insights (every authorized role) ── */}
            <InsightsGrid insights={response.insights} />

            {/* ── Named roster table (hod/superadmin only) ── */}
            {response.students && (
              <div className="rounded-12 border border-ink-200 bg-paper">
                <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
                  <h2 className="font-plex-sans text-sm font-semibold text-ink-900">Student Readiness Details</h2>
                  <button
                    type="button"
                    onClick={exportCSV}
                    className="h-11 rounded-8 border border-ink-200 px-3 text-xs text-ink-700 transition-colors duration-180 hover:bg-ink-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2"
                  >
                    Export CSV
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-ink-50">
                      <tr>
                        {(
                          [
                            { label: "Name", col: "full_name" as SortCol },
                            { label: "Branch", col: "branch" as SortCol },
                            { label: "Sem", col: "semester" as SortCol },
                            { label: "CGPA", col: "cgpa" as SortCol },
                            { label: "Overall", col: "readiness_overall" as SortCol },
                            { label: "Aptitude", col: "readiness_aptitude" as SortCol },
                            { label: "Verbal", col: "readiness_verbal" as SortCol },
                            { label: "Domain", col: "readiness_domain" as SortCol },
                            { label: "Resume", col: "resume_completeness" as SortCol },
                            { label: "Last Active", col: null },
                            { label: "Status", col: null },
                          ] as { label: string; col: SortCol | null }[]
                        ).map(({ label, col }) => (
                          <th
                            key={label}
                            className={cn(
                              "px-4 py-3 font-plex-sans text-xs font-medium text-ink-500",
                              col && "cursor-pointer select-none hover:text-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
                            )}
                            onClick={col ? () => handleSort(col) : undefined}
                            tabIndex={col ? 0 : undefined}
                            onKeyDown={
                              col
                                ? (e) => {
                                    if (e.key === "Enter" || e.key === " ") handleSort(col);
                                  }
                                : undefined
                            }
                          >
                            {label}
                            {col && <SortIndicator col={col} />}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {sortedStudents.length === 0 && (
                        <tr>
                          <td colSpan={11} className="px-4 py-8 text-center text-sm text-ink-400">
                            No students found for this filter.
                          </td>
                        </tr>
                      )}
                      {sortedStudents.map((s) => {
                        const status = getStatusLabel(s);
                        return (
                          <tr key={s.id} className="hover:bg-ink-50">
                            <td className="px-4 py-3 text-sm font-medium text-ink-900">{s.full_name ?? "—"}</td>
                            <td className="px-4 py-3 text-xs text-ink-500">{s.branch ?? "—"}</td>
                            <td className="px-4 py-3 text-xs text-ink-500">{s.semester ?? "—"}</td>
                            <td className="px-4 py-3 text-sm text-ink-700">{s.cgpa != null ? s.cgpa.toFixed(2) : "—"}</td>
                            {([s.readiness_overall, s.readiness_aptitude, s.readiness_verbal, s.readiness_domain] as number[]).map(
                              (score, i) => (
                                <td key={i} className="px-4 py-3 text-sm">
                                  {score === 0 ? (
                                    <span className="text-ink-300">—</span>
                                  ) : (
                                    <MonoTag variant={scoreVariant(score)}>{score}</MonoTag>
                                  )}
                                </td>
                              )
                            )}
                            <td className="px-4 py-3 text-sm">
                              {s.resume_completeness === 0 ? (
                                <span className="text-ink-300">—</span>
                              ) : (
                                <MonoTag variant={scoreVariant(s.resume_completeness)}>{s.resume_completeness}%</MonoTag>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <LastActiveTag date={s.last_active_date} />
                            </td>
                            <td className="px-4 py-3">
                              <MonoTag variant={status.variant}>{status.label}</MonoTag>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
