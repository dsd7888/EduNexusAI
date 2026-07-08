"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, Loader2, Plus, ChevronDown, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageSkeleton } from "@/components/layout/PageSkeleton";

// Model-split palette (flash / pro / imagen), consistent across every chart.
const MODEL_COLORS = { flash: "#2563eb", pro: "#7c3aed", imagen: "#0d9488" };
const FUNNEL_COLORS = ["#2563eb", "#7c3aed", "#0d9488", "#16a34a"];

// ── Response types (mirror the API routes) ───────────────────────────────────
interface Overview {
  funnel: { invited: number; activated: number; adopted: number; retained: number };
  hours: { totalFacultyHours: number; thisWeekFacultyHours: number };
  artifacts: {
    byType: Record<string, number>;
    thisWeekByType: Record<string, number>;
    totalToDate: number;
    totalThisWeek: number;
  };
  spend: { toDateInr: number; thisWeekInr: number };
  rechargeBudgetInr: number | null;
  hoursSaved: {
    isEstimate: true;
    totalHours: number;
    byFeature: Record<string, { artifacts: number; hoursSaved: number }>;
  };
}
interface FacultyJob {
  jobId: string;
  feature: string;
  createdAt: string;
  costInr: number;
  models: {
    flash: { calls: number; costInr: number };
    pro: { calls: number; costInr: number };
    imagen: { images: number; costInr: number };
  };
}
interface FacultyRow {
  userId: string | null;
  name: string;
  email: string;
  deleted: boolean;
  subjects: string[];
  lastLoginAt: string | null;
  hoursUsed: number;
  generationCounts: Record<string, number>;
  totalCostInr: number;
  failureCount: number;
  recentJobs: FacultyJob[];
}
interface CostPoint {
  date: string;
  totalCostInr: number;
  flashCostInr: number;
  proCostInr: number;
  imagenCostInr: number;
  flashTokens: number;
  proTokens: number;
  imagenImages: number;
}
interface FeatureRow {
  feature: string;
  adoptedPct: number;
  usersUsed: number;
  successfulCalls: number;
  totalCalls: number;
  totalCostInr: number;
  failureRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  sampleCount: number;
  lowVolume: boolean;
}
interface SystemHealth {
  latest: { capturedAt: string; dbSizeBytes: number; storageSizeBytes: number } | null;
  limits: { dbBytes: number; storageBytes: number };
  dbPct: number | null;
  storagePct: number | null;
  projection: {
    dbDaysToLimit: number | null;
    storageDaysToLimit: number | null;
    reason: string | null;
  };
  snapshotCount: number;
}
interface Incident {
  id: string;
  occurred_at: string;
  duration_minutes: number | null;
  cause: string | null;
  created_at: string;
}

// ── Formatting helpers ───────────────────────────────────────────────────────
const inr = (n: number) => `₹${n.toFixed(2)}`;
const mb = (b: number) => `${(b / (1024 * 1024)).toFixed(1)} MB`;
const hrs = (n: number) => `${n.toFixed(1)} h`;
const dt = (s: string | null) => (s ? new Date(s).toLocaleString("en-IN") : "—");

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type ExportSection =
  | "overview"
  | "per-faculty"
  | "cost-trend"
  | "feature-adoption"
  | "system-health"
  | "incidents"
  | "all";

function ExportMenu({ section }: { section: ExportSection }) {
  const [busy, setBusy] = useState(false);
  const run = async (format: "csv" | "xlsx" | "pdf") => {
    setBusy(true);
    try {
      const res = await fetch("/api/pilot-analysis/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, format }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disp = res.headers.get("Content-Disposition") ?? "";
      a.download = /filename="([^"]+)"/.exec(disp)?.[1] ?? `${section}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-1">
      {busy ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <Download className="size-4 text-muted-foreground" />
      )}
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => run("csv")}>
        CSV
      </Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => run("xlsx")}>
        Excel
      </Button>
      {(section === "overview" || section === "all") && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => run("pdf")}>
          PDF
        </Button>
      )}
    </div>
  );
}

const EstimateBadge = () => (
  <Badge variant="outline" className="ml-2 text-[10px] uppercase tracking-wide">
    Estimate
  </Badge>
);

export default function PilotAnalysisPage() {
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [faculty, setFaculty] = useState<FacultyRow[]>([]);
  const [costTrend, setCostTrend] = useState<CostPoint[]>([]);
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);

  const [facultySort, setFacultySort] = useState("cost");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [modelSplit, setModelSplit] = useState(true);

  const [budgetInput, setBudgetInput] = useState("");
  const [savingBudget, setSavingBudget] = useState(false);

  const [incOccurred, setIncOccurred] = useState("");
  const [incDuration, setIncDuration] = useState("");
  const [incCause, setIncCause] = useState("");
  const [savingInc, setSavingInc] = useState(false);

  const loadFaculty = useCallback(async (sort: string) => {
    const data = await getJson<{ faculty: FacultyRow[] }>(
      `/api/pilot-analysis/per-faculty?sort=${sort}`
    );
    setFaculty(data?.faculty ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      const [o, ct, fa, sh, inc] = await Promise.all([
        getJson<Overview>("/api/pilot-analysis/overview"),
        getJson<{ points: CostPoint[] }>("/api/pilot-analysis/cost-trend?days=30"),
        getJson<{ features: FeatureRow[] }>("/api/pilot-analysis/feature-adoption"),
        getJson<SystemHealth>("/api/pilot-analysis/system-health"),
        getJson<{ incidents: Incident[] }>("/api/pilot-analysis/incidents"),
      ]);
      setOverview(o);
      setCostTrend(ct?.points ?? []);
      setFeatures(fa?.features ?? []);
      setHealth(sh);
      setIncidents(inc?.incidents ?? []);
      if (o?.rechargeBudgetInr != null) setBudgetInput(String(o.rechargeBudgetInr));
      await loadFaculty("cost");
      setLoading(false);
    })();
  }, [loadFaculty]);

  const onSortChange = async (v: string) => {
    setFacultySort(v);
    await loadFaculty(v);
  };

  const saveBudget = async () => {
    setSavingBudget(true);
    try {
      const res = await fetch("/api/pilot-analysis/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rechargeBudgetInr: budgetInput === "" ? null : Number(budgetInput) }),
      });
      if (res.ok) {
        const data = (await res.json()) as { rechargeBudgetInr: number | null };
        setOverview((o) => (o ? { ...o, rechargeBudgetInr: data.rechargeBudgetInr } : o));
      }
    } finally {
      setSavingBudget(false);
    }
  };

  const addIncident = async () => {
    if (!incOccurred) return;
    setSavingInc(true);
    try {
      const res = await fetch("/api/pilot-analysis/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          occurred_at: new Date(incOccurred).toISOString(),
          duration_minutes: incDuration === "" ? null : Number(incDuration),
          cause: incCause || null,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { incident: Incident };
        setIncidents((prev) => [data.incident, ...prev]);
        setIncOccurred("");
        setIncDuration("");
        setIncCause("");
      }
    } finally {
      setSavingInc(false);
    }
  };

  const funnelData = useMemo(() => {
    if (!overview) return [];
    const f = overview.funnel;
    return [
      { stage: "Invited", value: f.invited },
      { stage: "Activated", value: f.activated },
      { stage: "Adopted", value: f.adopted },
      { stage: "Retained", value: f.retained },
    ];
  }, [overview]);

  const budgetRemaining =
    overview?.rechargeBudgetInr != null
      ? overview.rechargeBudgetInr - overview.spend.toDateInr
      : null;

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pilot Analysis</h1>
          <p className="text-sm text-muted-foreground">
            Adoption, cost, and value metrics for the PPSU pilot. Cost/token data from
            per-call logs; hours from session tracking.
          </p>
        </div>
        <ExportMenu section="all" />
      </div>

      {/* 1. KPI strip */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Faculty adopted" value={`${overview?.funnel.adopted ?? 0} / ${overview?.funnel.invited ?? 0}`} sub="≥1 successful AI call" />
        <Kpi label="Hours this week" value={hrs(overview?.hours.thisWeekFacultyHours ?? 0)} sub={`${hrs(overview?.hours.totalFacultyHours ?? 0)} total`} />
        <Kpi label="Artifacts to date" value={String(overview?.artifacts.totalToDate ?? 0)} sub={`${overview?.artifacts.totalThisWeek ?? 0} this week`} />
        <Kpi label="Spend this week" value={inr(overview?.spend.thisWeekInr ?? 0)} sub={`${inr(overview?.spend.toDateInr ?? 0)} to date`} />
      </div>

      {/* Recharge budget + hours saved */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gemini recharge budget</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Budget (₹)</label>
                <Input
                  type="number"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                  placeholder="e.g. 5000"
                />
              </div>
              <Button onClick={saveBudget} disabled={savingBudget}>
                {savingBudget ? <Loader2 className="size-4 animate-spin" /> : "Save"}
              </Button>
            </div>
            {overview?.rechargeBudgetInr != null && (
              <p className="text-sm">
                <span className="font-semibold">{inr(overview.spend.toDateInr)}</span> of{" "}
                <span className="font-semibold">{inr(overview.rechargeBudgetInr)}</span> used
                {budgetRemaining != null && (
                  <span className="text-muted-foreground"> · {inr(budgetRemaining)} remaining</span>
                )}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Estimated hours saved <EstimateBadge />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{hrs(overview?.hoursSaved.totalHours ?? 0)}</p>
            <p className="text-xs text-muted-foreground">
              From configured per-artifact assumptions — not measured data.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 2. Adoption funnel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Adoption funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={funnelData} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="stage" width={80} />
              <Tooltip />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {funnelData.map((_, i) => (
                  <Cell key={i} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* 3. Cost & usage trend */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Cost trend (30 days, IST)</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant={modelSplit ? "default" : "outline"}
              size="sm"
              onClick={() => setModelSplit((v) => !v)}
            >
              {modelSplit ? "Model split" : "Total"}
            </Button>
            <ExportMenu section="cost-trend" />
          </div>
        </CardHeader>
        <CardContent>
          {costTrend.every((p) => p.totalCostInr === 0) ? (
            <EmptyState text="No spend recorded in this window yet." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={costTrend} margin={{ left: 4, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => inr(Number(v ?? 0))} />
                {modelSplit ? (
                  <>
                    <Area type="monotone" dataKey="flashCostInr" name="Flash" stackId="1" stroke={MODEL_COLORS.flash} fill={MODEL_COLORS.flash} fillOpacity={0.5} />
                    <Area type="monotone" dataKey="proCostInr" name="Pro" stackId="1" stroke={MODEL_COLORS.pro} fill={MODEL_COLORS.pro} fillOpacity={0.5} />
                    <Area type="monotone" dataKey="imagenCostInr" name="Imagen" stackId="1" stroke={MODEL_COLORS.imagen} fill={MODEL_COLORS.imagen} fillOpacity={0.5} />
                  </>
                ) : (
                  <Area type="monotone" dataKey="totalCostInr" name="Total" stroke={MODEL_COLORS.flash} fill={MODEL_COLORS.flash} fillOpacity={0.4} />
                )}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* 4. Feature adoption */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Feature adoption</CardTitle>
          <ExportMenu section="feature-adoption" />
        </CardHeader>
        <CardContent>
          {features.length === 0 ? (
            <EmptyState text="No feature usage recorded yet." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Feature</TableHead>
                    <TableHead className="text-right">Adopted %</TableHead>
                    <TableHead className="text-right">Users</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Failure %</TableHead>
                    <TableHead className="text-right">p50 / p95</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {features.map((f) => (
                    <TableRow key={f.feature}>
                      <TableCell className="font-medium">{f.feature}</TableCell>
                      <TableCell className="text-right">{f.adoptedPct.toFixed(0)}%</TableCell>
                      <TableCell className="text-right">{f.usersUsed}</TableCell>
                      <TableCell className="text-right">{f.successfulCalls}/{f.totalCalls}</TableCell>
                      <TableCell className="text-right">{inr(f.totalCostInr)}</TableCell>
                      <TableCell className="text-right">{f.failureRate.toFixed(0)}%</TableCell>
                      <TableCell className="text-right">
                        {f.p50Ms != null ? `${Math.round(f.p50Ms)} / ${Math.round(f.p95Ms ?? 0)} ms` : "—"}
                        {f.lowVolume && (
                          <span className="ml-1 text-[10px] text-muted-foreground">(low n)</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 5. Per-faculty */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Per-faculty usage</CardTitle>
            <p className="text-xs text-muted-foreground">
              Hours sum across a faculty&apos;s open tabs/sessions (an accepted pilot
              approximation). Deleted accounts appear by historical email snapshot.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={facultySort} onValueChange={onSortChange}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cost">Sort: Cost</SelectItem>
                <SelectItem value="hours">Sort: Hours</SelectItem>
                <SelectItem value="failures">Sort: Failures</SelectItem>
                <SelectItem value="name">Sort: Name</SelectItem>
              </SelectContent>
            </Select>
            <ExportMenu section="per-faculty" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Faculty</TableHead>
                  <TableHead>Subjects</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Failures</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {faculty.map((f) => {
                  const key = f.userId ?? `email:${f.email}`;
                  const open = expanded === key;
                  return (
                    <Fragment key={key}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setExpanded(open ? null : key)}
                      >
                        <TableCell>
                          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{f.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {f.email}
                            {f.deleted && (
                              <Badge variant="outline" className="ml-2 text-[10px]">
                                deleted
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">{f.subjects.join(", ") || "—"}</TableCell>
                        <TableCell className="text-xs">{dt(f.lastLoginAt)}</TableCell>
                        <TableCell className="text-right">{f.hoursUsed.toFixed(1)}</TableCell>
                        <TableCell className="text-right">{inr(f.totalCostInr)}</TableCell>
                        <TableCell className="text-right">
                          {f.failureCount > 0 ? (
                            <Badge variant="destructive">{f.failureCount}</Badge>
                          ) : (
                            0
                          )}
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-muted/40">
                            <FacultyDetail faculty={f} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 6. System health */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">System health</CardTitle>
          <ExportMenu section="system-health" />
        </CardHeader>
        <CardContent className="space-y-6">
          {health?.latest ? (
            <div className="grid gap-4 md:grid-cols-2">
              <TierBar label="Database" pct={health.dbPct ?? 0} used={mb(health.latest.dbSizeBytes)} limit={mb(health.limits.dbBytes)} days={health.projection.dbDaysToLimit} />
              <TierBar label="Storage" pct={health.storagePct ?? 0} used={mb(health.latest.storageSizeBytes)} limit={mb(health.limits.storageBytes)} days={health.projection.storageDaysToLimit} />
            </div>
          ) : (
            <EmptyState text="No storage snapshots yet — the daily cron populates this." />
          )}
          {health?.projection.reason && (
            <p className="text-xs text-muted-foreground">
              Projection: {health.projection.reason}. Captured {health.snapshotCount} snapshot(s) so far.
            </p>
          )}

          {/* Incident log */}
          <div>
            <h3 className="mb-2 text-sm font-semibold">Incident log</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              Manually maintained. Actual uptime % comes from an external monitor, not this app.
            </p>
            <div className="mb-3 grid gap-2 md:grid-cols-[1fr_120px_1fr_auto]">
              <Input type="datetime-local" value={incOccurred} onChange={(e) => setIncOccurred(e.target.value)} />
              <Input type="number" placeholder="Mins" value={incDuration} onChange={(e) => setIncDuration(e.target.value)} />
              <Input placeholder="Cause" value={incCause} onChange={(e) => setIncCause(e.target.value)} />
              <Button onClick={addIncident} disabled={savingInc || !incOccurred}>
                {savingInc ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Add
              </Button>
            </div>
            {incidents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No incidents logged.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Occurred</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead>Cause</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incidents.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="text-xs">{dt(i.occurred_at)}</TableCell>
                      <TableCell className="text-right text-xs">
                        {i.duration_minutes != null ? `${i.duration_minutes} min` : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{i.cause ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 7. Content output / time saved — pitch block */}
      <Card className="border-primary/40">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">
            Content output &amp; time saved <EstimateBadge />
          </CardTitle>
          <ExportMenu section="overview" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {overview &&
              Object.entries(overview.hoursSaved.byFeature).map(([feature, v]) => (
                <div key={feature} className="rounded-lg border p-3">
                  <div className="text-sm font-semibold capitalize">{feature.replace(/_/g, " ")}</div>
                  <div className="text-2xl font-bold">{v.artifacts}</div>
                  <div className="text-xs text-muted-foreground">
                    produced · ~{hrs(v.hoursSaved)} saved
                  </div>
                </div>
              ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Time-saved figures are estimates derived from configured per-artifact
            assumptions (manual vs. AI minutes), not measured observations.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Small presentational components ──────────────────────────────────────────
function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function TierBar({
  label,
  pct,
  used,
  limit,
  days,
}: {
  label: string;
  pct: number;
  used: string;
  limit: string;
  days: number | null;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  const color = clamped > 85 ? "bg-red-500" : clamped > 60 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {used} / {limit} ({clamped.toFixed(0)}%)
        </span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color}`} style={{ width: `${clamped}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {days != null ? `~${Math.round(days)} days to tier limit` : "Projection: insufficient data"}
      </p>
    </div>
  );
}

function FacultyDetail({ faculty }: { faculty: FacultyRow }) {
  const gen = Object.entries(faculty.generationCounts).filter(([, n]) => n > 0);
  return (
    <div className="space-y-3 py-2">
      <div className="flex flex-wrap gap-2">
        {gen.length === 0 ? (
          <span className="text-xs text-muted-foreground">No artifacts produced.</span>
        ) : (
          gen.map(([type, n]) => (
            <Badge key={type} variant="secondary">
              {type.replace(/_/g, " ")}: {n}
            </Badge>
          ))
        )}
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold text-muted-foreground">
          Recent jobs — per-model cost split
        </div>
        {faculty.recentJobs.length === 0 ? (
          <span className="text-xs text-muted-foreground">No AI calls recorded.</span>
        ) : (
          <div className="space-y-1">
            {faculty.recentJobs.map((j) => (
              <div key={j.jobId} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">{j.feature}</span>
                <span className="text-muted-foreground">{dt(j.createdAt)}</span>
                {j.models.flash.calls > 0 && (
                  <Badge variant="outline">flash ×{j.models.flash.calls} · {inr(j.models.flash.costInr)}</Badge>
                )}
                {j.models.pro.calls > 0 && (
                  <Badge variant="outline">pro ×{j.models.pro.calls} · {inr(j.models.pro.costInr)}</Badge>
                )}
                {j.models.imagen.images > 0 && (
                  <Badge variant="outline">imagen ×{j.models.imagen.images} · {inr(j.models.imagen.costInr)}</Badge>
                )}
                <span className="font-semibold">= {inr(j.costInr)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
