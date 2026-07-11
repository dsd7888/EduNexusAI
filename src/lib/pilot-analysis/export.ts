import type { createAdminClient } from "@/lib/db/supabase-server";
import {
  getOverview,
  getPerFaculty,
  getCostTrend,
  getFeatureAdoption,
  getSystemHealth,
} from "./queries";

type AdminClient = ReturnType<typeof createAdminClient>;

export type ExportSection =
  | "overview"
  | "per-faculty"
  | "cost-trend"
  | "feature-adoption"
  | "system-health"
  | "incidents"
  | "all";

export interface SectionTable {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

const bytesToMb = (b: number) => +(b / (1024 * 1024)).toFixed(2);
const round2 = (n: number) => +n.toFixed(2);
const round4 = (n: number) => +n.toFixed(4);

// Fixed generation-count columns for the per-faculty export (stable header order).
const GEN_COLUMNS: { key: string; label: string }[] = [
  { key: "ppt", label: "PPTs" },
  { key: "qpaper", label: "Q Papers" },
  { key: "answer_key", label: "Answer Keys" },
  { key: "visual_notes", label: "Visual Notes" },
  { key: "refined_notes", label: "Refined Notes" },
  { key: "qbank_question", label: "Q Bank Qs" },
];

async function overviewTable(admin: AdminClient): Promise<SectionTable> {
  const o = await getOverview(admin);
  const rows: (string | number)[][] = [
    ["Faculty invited", o.funnel.invited],
    ["Faculty activated", o.funnel.activated],
    ["Faculty adopted", o.funnel.adopted],
    ["Faculty retained (≥2 weeks)", o.funnel.retained],
    ["Total faculty hours (to date)", round2(o.hours.totalFacultyHours)],
    ["Faculty hours (this week)", round2(o.hours.thisWeekFacultyHours)],
    ["Artifacts (to date)", o.artifacts.totalToDate],
    ["Artifacts (this week)", o.artifacts.totalThisWeek],
    ["AI spend to date (₹)", round4(o.spend.toDateInr)],
    ["AI spend this week (₹)", round4(o.spend.thisWeekInr)],
    ["Recharge budget (₹)", o.rechargeBudgetInr ?? "—"],
    ["Est. hours saved to date (ESTIMATE)", round2(o.hoursSaved.totalHours)],
  ];
  for (const [type, count] of Object.entries(o.artifacts.byType)) {
    rows.push([`Artifacts · ${type}`, count]);
  }
  for (const [feature, v] of Object.entries(o.hoursSaved.byFeature)) {
    rows.push([`Hours saved · ${feature} (ESTIMATE)`, round2(v.hoursSaved)]);
  }
  return { title: "Overview", columns: ["Metric", "Value"], rows };
}

async function perFacultyTable(admin: AdminClient): Promise<SectionTable> {
  const faculty = await getPerFaculty(admin);
  const columns = [
    "Name",
    "Email",
    "Status",
    "Subjects",
    "Last Login",
    "Hours Used",
    "Total Cost (₹)",
    "Failures",
    ...GEN_COLUMNS.map((g) => g.label),
  ];
  const rows = faculty.map((f) => [
    f.name,
    f.email,
    f.deleted ? "Deleted (historical)" : "Active",
    f.subjects.join(", "),
    f.lastLoginAt ?? "—",
    round2(f.hoursUsed),
    round4(f.totalCostInr),
    f.failureCount,
    ...GEN_COLUMNS.map((g) => f.generationCounts[g.key] ?? 0),
  ]);
  return { title: "Per-Faculty", columns, rows };
}

async function costTrendTable(admin: AdminClient, days = 30): Promise<SectionTable> {
  const points = await getCostTrend(admin, days);
  const columns = [
    "Date (IST)",
    "Total (₹)",
    "Flash (₹)",
    "Pro (₹)",
    "Imagen (₹)",
    "Flash Tokens",
    "Pro Tokens",
    "Imagen Images",
  ];
  const rows = points.map((p) => [
    p.date,
    round4(p.totalCostInr),
    round4(p.flashCostInr),
    round4(p.proCostInr),
    round4(p.imagenCostInr),
    p.flashTokens,
    p.proTokens,
    p.imagenImages,
  ]);
  return { title: "Cost Trend", columns, rows };
}

async function featureAdoptionTable(admin: AdminClient): Promise<SectionTable> {
  const features = await getFeatureAdoption(admin);
  const columns = [
    "Feature",
    "Adopted %",
    "Users",
    "Successful Calls",
    "Total Calls",
    "Cost (₹)",
    "Failure %",
    "p50 (ms)",
    "p95 (ms)",
    "Samples",
  ];
  const rows = features.map((f) => [
    f.feature,
    round2(f.adoptedPct),
    f.usersUsed,
    f.successfulCalls,
    f.totalCalls,
    round4(f.totalCostInr),
    round2(f.failureRate),
    f.p50Ms != null ? Math.round(f.p50Ms) : "—",
    f.p95Ms != null ? Math.round(f.p95Ms) : "—",
    f.sampleCount,
  ]);
  return { title: "Feature Adoption", columns, rows };
}

async function systemHealthTable(admin: AdminClient): Promise<SectionTable> {
  const h = await getSystemHealth(admin);
  const rows: (string | number)[][] = [
    ["Snapshots collected", h.snapshotCount],
    ["Captured at", h.latest?.capturedAt ?? "—"],
    ["DB size (MB)", h.latest ? bytesToMb(h.latest.dbSizeBytes) : "—"],
    ["DB tier used %", h.dbPct != null ? round2(h.dbPct) : "—"],
    ["Storage size (MB)", h.latest ? bytesToMb(h.latest.storageSizeBytes) : "—"],
    ["Storage tier used %", h.storagePct != null ? round2(h.storagePct) : "—"],
    [
      "DB days to limit",
      h.projection.dbDaysToLimit != null ? Math.round(h.projection.dbDaysToLimit) : "—",
    ],
    [
      "Storage days to limit",
      h.projection.storageDaysToLimit != null
        ? Math.round(h.projection.storageDaysToLimit)
        : "—",
    ],
    ["Projection note", h.projection.reason ?? "OK"],
  ];
  return { title: "System Health", columns: ["Metric", "Value"], rows };
}

async function incidentsTable(admin: AdminClient): Promise<SectionTable> {
  const { data } = await admin
    .from("system_incidents")
    .select("occurred_at, duration_minutes, cause, created_at")
    .order("occurred_at", { ascending: false });
  const rows = ((data ?? []) as {
    occurred_at: string;
    duration_minutes: number | null;
    cause: string | null;
    created_at: string;
  }[]).map((i) => [
    i.occurred_at,
    i.duration_minutes ?? "—",
    i.cause ?? "—",
    i.created_at,
  ]);
  return {
    title: "Incidents",
    columns: ["Occurred At", "Duration (min)", "Cause", "Logged At"],
    rows,
  };
}

export async function getSectionTable(
  admin: AdminClient,
  section: Exclude<ExportSection, "all">
): Promise<SectionTable> {
  switch (section) {
    case "overview":
      return overviewTable(admin);
    case "per-faculty":
      return perFacultyTable(admin);
    case "cost-trend":
      return costTrendTable(admin);
    case "feature-adoption":
      return featureAdoptionTable(admin);
    case "system-health":
      return systemHealthTable(admin);
    case "incidents":
      return incidentsTable(admin);
  }
}

export async function getAllTables(admin: AdminClient): Promise<SectionTable[]> {
  return Promise.all(
    (
      [
        "overview",
        "per-faculty",
        "cost-trend",
        "feature-adoption",
        "system-health",
        "incidents",
      ] as Exclude<ExportSection, "all">[]
    ).map((s) => getSectionTable(admin, s))
  );
}
