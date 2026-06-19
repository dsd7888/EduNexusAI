"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/db/supabase-browser";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  company: {
    name: string;
    logo_url: string | null;
    company_type: string;
  } | null;
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
  const month = now.getMonth(); // 0-indexed; June=5, July=6
  if (month >= 6) {
    return `${year}-${String(year + 1).slice(2)}`;
  }
  return `${year - 1}-${String(year).slice(2)}`;
}

function scoreColor(score: number): string {
  if (score >= 75) return "text-emerald-600";
  if (score >= 50) return "text-amber-600";
  if (score > 0) return "text-slate-500";
  return "text-gray-300";
}

function barColor(score: number): string {
  if (score >= 75) return "bg-emerald-400";
  if (score >= 50) return "bg-amber-400";
  return "bg-slate-300";
}

function getStatusBadge(s: StudentRow): { label: string; className: string } {
  if (s.readiness_overall >= 75)
    return { label: "Drive Ready", className: "bg-emerald-50 text-emerald-700" };
  if (s.readiness_overall >= 50)
    return { label: "Developing", className: "bg-blue-50 text-blue-700" };
  if (s.readiness_overall > 0)
    return { label: "Early Stage", className: "bg-amber-50 text-amber-700" };
  if (!s.setup_complete)
    return { label: "Not Set Up", className: "bg-gray-100 text-gray-500" };
  return { label: "Not Started", className: "bg-gray-100 text-gray-400" };
}

function getStatus(s: StudentRow): string {
  return getStatusBadge(s).label;
}

function formatDriveDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysUntilDrive(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const drive = new Date(dateStr);
  drive.setHours(0, 0, 0, 0);
  return Math.round((drive.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function LastActiveCell({ date }: { date: string | null }) {
  if (!date) {
    return <span className="text-xs text-gray-300">Never</span>;
  }
  const daysSince =
    (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince <= 7) {
    return (
      <span className="rounded-full bg-emerald-50 px-2 text-xs text-emerald-700">
        Active
      </span>
    );
  }
  const days = Math.floor(daysSince);
  if (daysSince <= 30) {
    return <span className="text-xs text-gray-500">{days} days ago</span>;
  }
  return <span className="text-xs text-slate-400">{days} days ago</span>;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PlacementDashboardPage() {
  const router = useRouter();

  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [drives, setDrives] = useState<DriveRow[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [selectedSemester, setSelectedSemester] = useState("");
  const [filterOptions, setFilterOptions] = useState<{
    branches: string[];
    semesters: number[];
  }>({ branches: [], semesters: [] });
  const [sortCol, setSortCol] = useState<SortCol>("readiness_overall");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const initialOptionsLoaded = useRef(false);
  const academicYear = useMemo(() => getAcademicYear(), []);

  const sortedStudents = useMemo(() => {
    return [...students].sort((a, b) => {
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
  }, [students, sortCol, sortDir]);

  async function fetchData(branch = "", semester = "") {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (branch) params.set("branch", branch);
      if (semester) params.set("semester", semester);
      const qs = params.toString();
      const res = await fetch(
        `/api/placement/tpo/dashboard${qs ? `?${qs}` : ""}`
      );
      if (!res.ok) throw new Error("fetch failed");
      const result = (await res.json()) as {
        students: StudentRow[];
        stats: DashboardStats;
        drives: DriveRow[];
      };
      setStudents(result.students);
      setStats(result.stats);
      setDrives(result.drives);

      if (!initialOptionsLoaded.current) {
        initialOptionsLoaded.current = true;
        const branches = [
          ...new Set(
            result.students
              .map((s) => s.branch)
              .filter((b): b is string => Boolean(b))
          ),
        ].sort();
        const semesters = [
          ...new Set(
            result.students
              .map((s) => s.semester)
              .filter((s): s is number => s !== null)
          ),
        ].sort((a, b) => a - b);
        setFilterOptions({ branches, semesters });
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

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (cancelled) return;

      const role = (profile as { role?: string } | null)?.role ?? "";
      if (!["superadmin", "dean", "hod"].includes(role)) {
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (col !== sortCol) return <span className="ml-1 text-gray-300">↕</span>;
    return (
      <span className="ml-1 text-blue-500">
        {sortDir === "asc" ? "↑" : "↓"}
      </span>
    );
  }

  function exportCSV() {
    const headers = [
      "Name",
      "Branch",
      "Semester",
      "CGPA",
      "Overall",
      "Aptitude",
      "Verbal",
      "Domain",
      "Resume %",
      "Last Active",
      "Status",
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
      getStatus(s),
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

  // Show skeleton while not yet authorized or on first load
  if (!authorized || (loading && students.length === 0)) {
    return (
      <div className="min-h-screen bg-white p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="h-10 w-72 animate-pulse rounded-lg bg-gray-100" />
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-xl bg-gray-100"
              />
            ))}
          </div>
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded bg-gray-100"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className={`mx-auto max-w-7xl p-6 transition-opacity ${loading ? "opacity-60 pointer-events-none" : ""}`}>

        {/* ── Header ── */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Placement Readiness Dashboard
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Batch overview · {academicYear}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <select
              value={selectedBranch}
              onChange={(e) => handleBranchChange(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-400 focus:outline-none"
            >
              <option value="">All Branches</option>
              {filterOptions.branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <select
              value={selectedSemester}
              onChange={(e) => handleSemesterChange(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-400 focus:outline-none"
            >
              <option value="">All Semesters</option>
              {filterOptions.semesters.map((s) => (
                <option key={s} value={String(s)}>
                  Semester {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {stats && (
          <>
            {/* ── Row 1: Stat cards ── */}
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-3xl font-bold text-emerald-600">
                  {stats.ready}
                </p>
                <p className="mt-1 text-sm text-gray-500">Drive Ready</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  of {stats.total_students} students (≥75 readiness)
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-3xl font-bold text-amber-500">
                  {stats.developing}
                </p>
                <p className="mt-1 text-sm text-gray-500">Developing</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  50–74 readiness score
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-3xl font-bold text-slate-400">
                  {stats.not_started}
                </p>
                <p className="mt-1 text-sm text-gray-500">Not Started</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  0 readiness — not practiced yet
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-3xl font-bold text-blue-600">
                  {stats.active_this_week}
                </p>
                <p className="mt-1 text-sm text-gray-500">Active This Week</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  practiced in last 7 days
                </p>
              </div>
            </div>

            {/* ── Row 2: Skill breakdown + Drives ── */}
            <div className="mb-6 grid gap-4 lg:grid-cols-3">
              {/* Left: Skill breakdown */}
              <div className="rounded-xl border border-gray-200 bg-white p-5 lg:col-span-2">
                <h2 className="mb-4 text-sm font-semibold text-gray-900">
                  Batch Skill Breakdown
                </h2>
                <div className="space-y-3">
                  {SKILL_BARS.map(({ label, key }) => {
                    const score = stats[key] as number;
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <span className="w-32 shrink-0 text-sm text-gray-700">
                          {label}
                        </span>
                        <div className="h-3 flex-1 rounded-full bg-gray-100">
                          <div
                            className={`h-3 rounded-full transition-all ${barColor(score)}`}
                            style={{ width: `${Math.min(score, 100)}%` }}
                          />
                        </div>
                        <span className="w-10 text-right text-sm font-medium text-gray-600">
                          {score}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {stats.weakest_dimension && (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-sm text-gray-700">
                      ⚠ Weakest area:{" "}
                      <span className="font-medium">
                        {WEAKEST_LABEL[stats.weakest_dimension] ??
                          stats.weakest_dimension}
                      </span>
                      . Consider organizing a focused session.
                    </p>
                  </div>
                )}
              </div>

              {/* Right: Upcoming drives */}
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h2 className="mb-4 text-sm font-semibold text-gray-900">
                  Upcoming Drives
                </h2>
                {drives.length === 0 ? (
                  <p className="text-sm text-gray-400">No drives scheduled</p>
                ) : (
                  <div className="space-y-4">
                    {drives.map((drive) => {
                      const days = daysUntilDrive(drive.drive_date);
                      return (
                        <div key={drive.id} className="border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                          <p className="font-medium text-gray-900 text-sm">
                            {drive.company?.name ?? "Unknown Company"}
                          </p>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {formatDriveDate(drive.drive_date)}
                          </p>
                          <p
                            className={`mt-0.5 text-xs ${
                              days <= 7
                                ? "font-medium text-amber-600"
                                : "text-gray-500"
                            }`}
                          >
                            {days <= 7
                              ? `${days} days`
                              : `${days} days away`}
                          </p>
                          {drive.eligible_branches &&
                            drive.eligible_branches.length > 0 && (
                              <p className="mt-0.5 text-xs text-gray-400">
                                {drive.eligible_branches.join(", ")}
                              </p>
                            )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ── Row 3: Student table ── */}
            <div className="rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                <h2 className="text-sm font-semibold text-gray-900">
                  Student Readiness Details
                </h2>
                <button
                  type="button"
                  onClick={exportCSV}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-50"
                >
                  Export CSV
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-gray-50">
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
                          className={`px-4 py-3 text-xs font-medium text-gray-500 ${
                            col ? "cursor-pointer select-none hover:text-gray-700" : ""
                          }`}
                          onClick={col ? () => handleSort(col) : undefined}
                        >
                          {label}
                          {col && <SortIndicator col={col} />}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortedStudents.length === 0 && (
                      <tr>
                        <td
                          colSpan={11}
                          className="px-4 py-8 text-center text-sm text-gray-400"
                        >
                          No students found for this filter.
                        </td>
                      </tr>
                    )}
                    {sortedStudents.map((s) => {
                      const badge = getStatusBadge(s);
                      return (
                        <tr key={s.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {s.full_name ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {s.branch ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {s.semester ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {s.cgpa != null ? s.cgpa.toFixed(2) : "—"}
                          </td>
                          {/* Score cells */}
                          {(
                            [
                              s.readiness_overall,
                              s.readiness_aptitude,
                              s.readiness_verbal,
                              s.readiness_domain,
                            ] as number[]
                          ).map((score, i) => (
                            <td key={i} className="px-4 py-3 text-sm">
                              {score === 0 ? (
                                <span className="text-gray-300">—</span>
                              ) : (
                                <span className={scoreColor(score)}>{score}</span>
                              )}
                            </td>
                          ))}
                          {/* Resume */}
                          <td className="px-4 py-3 text-sm">
                            {s.resume_completeness === 0 ? (
                              <span className="text-gray-300">—</span>
                            ) : (
                              <span className={scoreColor(s.resume_completeness)}>
                                {s.resume_completeness}%
                              </span>
                            )}
                          </td>
                          {/* Last active */}
                          <td className="px-4 py-3">
                            <LastActiveCell date={s.last_active_date} />
                          </td>
                          {/* Status */}
                          <td className="px-4 py-3">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
