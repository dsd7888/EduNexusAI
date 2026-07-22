import type { createAdminClient } from "@/lib/db/supabase-server";
import {
  TIME_SAVED_MINUTES_PER_ARTIFACT,
  STORAGE_TIER_LIMITS,
  RECHARGE_BUDGET_SETTING_KEY,
} from "./constants";
import { istDateKey, istIsoWeekKey, lastNIstDateKeys } from "./ist";

type AdminClient = ReturnType<typeof createAdminClient>;

// ── Row shapes (only the columns we read) ────────────────────────────────────
interface AiCallLogRow {
  id: string;
  created_at: string;
  user_id: string | null;
  user_email_snapshot: string | null;
  user_role_snapshot: string | null;
  task: string;
  feature: string;
  model: string; // 'flash' | 'pro' | 'imagen'
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
  image_count: number;
  cost_inr: number | string;
  status: string; // 'success' | 'error' | 'rate_limited'
  latency_ms: number | null;
  job_id: string;
  related_content_id: string | null;
  metadata: Record<string, unknown> | null;
}

interface SessionRow {
  user_id: string | null;
  user_email_snapshot: string | null;
  user_role_snapshot: string | null;
  started_at: string;
  last_activity_at: string;
  ended_at: string | null;
}

interface GeneratedContentRow {
  type: string;
  generated_by: string | null;
  created_at: string;
}

// ── Paginated fetch (Supabase caps a single select ~1000 rows) ───────────────
async function fetchAll<T>(
  admin: AdminClient,
  table: string,
  columns: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build?: (q: any) => any
): Promise<T[]> {
  const pageSize = 1000;
  let from = 0;
  const out: T[] = [];
  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = admin.from(table).select(columns).range(from, from + pageSize - 1);
    if (build) query = build(query);
    const { data, error } = await query;
    if (error) {
      console.error(`[pilot-analysis] fetch ${table} failed:`, error);
      break;
    }
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

const num = (v: number | string | null | undefined): number =>
  typeof v === "string" ? parseFloat(v) || 0 : (v ?? 0);

function isFailure(status: string): boolean {
  return status === "error" || status === "rate_limited";
}

// ── Session hours (dangling ended_at IS NULL → treat end as last_activity_at) ──
function sessionDurationMs(s: SessionRow): number {
  const end = s.ended_at ?? s.last_activity_at;
  const ms = new Date(end).getTime() - new Date(s.started_at).getTime();
  return ms > 0 ? ms : 0;
}

// ── Shared loaders ───────────────────────────────────────────────────────────
export async function loadAiCallLogs(
  admin: AdminClient,
  sinceISO?: string
): Promise<AiCallLogRow[]> {
  return fetchAll<AiCallLogRow>(
    admin,
    "ai_call_logs",
    "id, created_at, user_id, user_email_snapshot, user_role_snapshot, task, feature, model, input_tokens, output_tokens, thinking_tokens, image_count, cost_inr, status, latency_ms, job_id, related_content_id, metadata",
    sinceISO ? (q) => q.gte("created_at", sinceISO) : undefined
  );
}

export async function loadSessions(admin: AdminClient): Promise<SessionRow[]> {
  return fetchAll<SessionRow>(
    admin,
    "user_sessions",
    "user_id, user_email_snapshot, user_role_snapshot, started_at, last_activity_at, ended_at"
  );
}

// ── Overview / KPI strip + adoption funnel ───────────────────────────────────
export interface OverviewData {
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

export async function getOverview(admin: AdminClient): Promise<OverviewData> {
  const thisWeek = istIsoWeekKey(new Date().toISOString());

  const [facultyProfilesRes, logs, sessions, gc, qbankRes, settingRes] =
    await Promise.all([
      admin.from("profiles").select("id").eq("role", "faculty"),
      loadAiCallLogs(admin),
      loadSessions(admin),
      fetchAll<GeneratedContentRow>(admin, "generated_content", "type, generated_by, created_at"),
      admin.from("faculty_question_bank").select("created_at"),
      admin
        .from("pilot_analysis_settings")
        .select("value")
        .eq("key", RECHARGE_BUDGET_SETTING_KEY)
        .maybeSingle(),
    ]);

  const facultyIds = new Set(
    ((facultyProfilesRes.data ?? []) as { id: string }[]).map((p) => p.id)
  );
  const isFaculty = (userId: string | null, roleSnap: string | null) =>
    (userId != null && facultyIds.has(userId)) || roleSnap === "faculty";

  // Funnel
  const invited = facultyIds.size;

  const activatedSet = new Set<string>();
  for (const s of sessions) {
    if (s.user_id && isFaculty(s.user_id, s.user_role_snapshot)) activatedSet.add(s.user_id);
  }

  const adoptedSet = new Set<string>();
  for (const l of logs) {
    if (l.status === "success" && l.user_id && isFaculty(l.user_id, l.user_role_snapshot)) {
      adoptedSet.add(l.user_id);
    }
  }

  // retained: distinct faculty active (successful log OR session) in ≥2 IST weeks
  const weeksByUser = new Map<string, Set<string>>();
  const addWeek = (userId: string, iso: string) => {
    let set = weeksByUser.get(userId);
    if (!set) weeksByUser.set(userId, (set = new Set()));
    set.add(istIsoWeekKey(iso));
  };
  for (const l of logs) {
    if (l.status === "success" && l.user_id && isFaculty(l.user_id, l.user_role_snapshot)) {
      addWeek(l.user_id, l.created_at);
    }
  }
  for (const s of sessions) {
    if (s.user_id && isFaculty(s.user_id, s.user_role_snapshot)) addWeek(s.user_id, s.started_at);
  }
  let retained = 0;
  for (const set of weeksByUser.values()) if (set.size >= 2) retained++;

  // Faculty hours (dangling fallback), all-time + this IST week
  let totalFacultyHours = 0;
  let thisWeekFacultyHours = 0;
  for (const s of sessions) {
    if (!isFaculty(s.user_id, s.user_role_snapshot)) continue;
    const hrs = sessionDurationMs(s) / 3_600_000;
    totalFacultyHours += hrs;
    if (istIsoWeekKey(s.started_at) === thisWeek) thisWeekFacultyHours += hrs;
  }

  // Artifacts by type (canonical produced artifacts, not raw call rows)
  const byType: Record<string, number> = {};
  const thisWeekByType: Record<string, number> = {};
  const bump = (map: Record<string, number>, key: string) => (map[key] = (map[key] ?? 0) + 1);
  for (const r of gc) {
    bump(byType, r.type);
    if (istIsoWeekKey(r.created_at) === thisWeek) bump(thisWeekByType, r.type);
  }
  const qbank = (qbankRes.data ?? []) as { created_at: string }[];
  for (const q of qbank) {
    bump(byType, "qbank_question");
    if (istIsoWeekKey(q.created_at) === thisWeek) bump(thisWeekByType, "qbank_question");
  }
  const totalToDate = Object.values(byType).reduce((a, b) => a + b, 0);
  const totalThisWeek = Object.values(thisWeekByType).reduce((a, b) => a + b, 0);

  // Spend
  let spendToDate = 0;
  let spendThisWeek = 0;
  for (const l of logs) {
    const c = num(l.cost_inr);
    spendToDate += c;
    if (istIsoWeekKey(l.created_at) === thisWeek) spendThisWeek += c;
  }

  // Hours saved (ESTIMATE). Artifact count per feature bucket.
  const ppt = byType["ppt"] ?? 0;
  const qpaper = byType["qpaper"] ?? 0;
  const answerKey = byType["answer_key"] ?? 0;
  const qbankCount = byType["qbank_question"] ?? 0;
  // Features with no generated_content type are counted from ai_call_logs
  // instead. Two different proxies, because the right unit differs per feature —
  // and the unit MUST match the one its TIME_SAVED_MINUTES_PER_ARTIFACT rate is
  // quoted in, or the hours-saved figure is wrong by whatever the fan-out is:
  //
  //   distinct successful job_id  →  one job = one artifact. Used where the rate
  //     is per DOCUMENT (a lesson plan is 240min for the whole course-file plan,
  //     an audit is 120min for the subject) even though the job fans out into
  //     several AI calls internally.
  //   successful calls of one task →  one call = one artifact. Used for
  //     lab_manual, whose rate is quoted PER PRACTICAL (45min) while a single
  //     generate request covers up to 4 — counting jobs would undercount by 4x.
  //
  // ppt_refine's job-id proxy is the pre-existing one, unchanged; it remains
  // FLAGGED as an open question in the report.
  const jobsByFeature = new Map<string, Set<string>>();
  let labManualSections = 0;
  for (const l of logs) {
    if (l.status !== "success") continue;
    if (l.feature === "ppt_refine" || l.feature === "lesson_plan" || l.feature === "syllabus_audit") {
      const set = jobsByFeature.get(l.feature) ?? new Set<string>();
      set.add(l.job_id);
      jobsByFeature.set(l.feature, set);
    }
    if (l.task === "lab_manual_gen") labManualSections++;
  }
  const artifactCountByFeature: Record<string, number> = {
    ppt_generation: ppt,
    qpaper,
    answer_key: answerKey,
    qbank: qbankCount,
    ppt_refine: jobsByFeature.get("ppt_refine")?.size ?? 0,
    lesson_plan: jobsByFeature.get("lesson_plan")?.size ?? 0,
    lab_manual: labManualSections,
    syllabus_audit: jobsByFeature.get("syllabus_audit")?.size ?? 0,
  };
  const hoursSavedByFeature: Record<string, { artifacts: number; hoursSaved: number }> = {};
  let hoursSavedTotal = 0;
  for (const [feature, rate] of Object.entries(TIME_SAVED_MINUTES_PER_ARTIFACT)) {
    const artifacts = artifactCountByFeature[feature] ?? 0;
    const hoursSaved = (artifacts * (rate.manual - rate.ai)) / 60;
    hoursSavedByFeature[feature] = { artifacts, hoursSaved };
    hoursSavedTotal += hoursSaved;
  }

  const rechargeBudgetInr =
    settingRes.data && (settingRes.data as { value: number | null }).value != null
      ? num((settingRes.data as { value: number }).value)
      : null;

  return {
    funnel: { invited, activated: activatedSet.size, adopted: adoptedSet.size, retained },
    hours: { totalFacultyHours, thisWeekFacultyHours },
    artifacts: { byType, thisWeekByType, totalToDate, totalThisWeek },
    spend: { toDateInr: spendToDate, thisWeekInr: spendThisWeek },
    rechargeBudgetInr,
    hoursSaved: { isEstimate: true, totalHours: hoursSavedTotal, byFeature: hoursSavedByFeature },
  };
}

// ── Per-faculty table ────────────────────────────────────────────────────────
export interface FacultyJobSummary {
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

export interface FacultyRow {
  userId: string | null;
  name: string;
  email: string;
  deleted: boolean; // true = historical rows only (account removed), attributed by email
  subjects: string[];
  lastLoginAt: string | null;
  hoursUsed: number;
  generationCounts: Record<string, number>;
  totalCostInr: number;
  failureCount: number;
  recentJobs: FacultyJobSummary[]; // most recent jobs w/ per-model split (drill-down)
}

export async function getPerFaculty(admin: AdminClient): Promise<FacultyRow[]> {
  const [profilesRes, assignmentsRes, logs, sessions, gc, qbankRes] =
    await Promise.all([
      admin.from("profiles").select("id, email, full_name").eq("role", "faculty"),
      admin.from("faculty_assignments").select("faculty_id, subjects(code)"),
      loadAiCallLogs(admin),
      loadSessions(admin),
      fetchAll<GeneratedContentRow>(admin, "generated_content", "type, generated_by, created_at"),
      admin.from("faculty_question_bank").select("faculty_id"),
    ]);

  const profiles = (profilesRes.data ?? []) as {
    id: string;
    email: string;
    full_name: string | null;
  }[];

  // subjects per faculty
  const subjectsByFaculty = new Map<string, string[]>();
  for (const a of (assignmentsRes.data ?? []) as {
    faculty_id: string;
    subjects: { code: string } | { code: string }[] | null;
  }[]) {
    const code = Array.isArray(a.subjects) ? a.subjects[0]?.code : a.subjects?.code;
    if (!code) continue;
    const arr = subjectsByFaculty.get(a.faculty_id) ?? [];
    arr.push(code);
    subjectsByFaculty.set(a.faculty_id, arr);
  }

  // Build rows keyed by userId for existing faculty, plus synthetic email-keyed rows
  // for deleted faculty that still have historical logs/sessions (user_id NULL).
  interface Acc {
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
    jobs: Map<string, FacultyJobSummary>;
  }
  const byUserId = new Map<string, Acc>();
  const byEmail = new Map<string, Acc>(); // deleted-account bucket

  for (const p of profiles) {
    byUserId.set(p.id, {
      userId: p.id,
      name: p.full_name ?? p.email,
      email: p.email,
      deleted: false,
      subjects: subjectsByFaculty.get(p.id) ?? [],
      lastLoginAt: null,
      hoursUsed: 0,
      generationCounts: {},
      totalCostInr: 0,
      failureCount: 0,
      jobs: new Map(),
    });
  }

  const emailFor = (userId: string | null) =>
    userId ? byUserId.get(userId)?.email ?? null : null;

  // Resolve an accumulator for a (userId, emailSnapshot, roleSnapshot) triple. Existing
  // faculty → their row. Deleted faculty (userId null/unknown, faculty role snapshot) →
  // email-keyed synthetic row. Non-faculty → null (skip).
  const resolveAcc = (
    userId: string | null,
    emailSnap: string | null,
    roleSnap: string | null
  ): Acc | null => {
    if (userId && byUserId.has(userId)) return byUserId.get(userId)!;
    // user_id present but not a current faculty profile → not in faculty table
    if (userId && !byUserId.has(userId)) {
      if (roleSnap !== "faculty") return null;
      // faculty user_id that no longer has a profile row → treat as deleted, key by email
    } else if (roleSnap !== "faculty") {
      return null;
    }
    const key = (emailSnap ?? "unknown").toLowerCase();
    let acc = byEmail.get(key);
    if (!acc) {
      acc = {
        userId: null,
        name: emailSnap ?? "(deleted account)",
        email: emailSnap ?? "(unknown)",
        deleted: true,
        subjects: [],
        lastLoginAt: null,
        hoursUsed: 0,
        generationCounts: {},
        totalCostInr: 0,
        failureCount: 0,
        jobs: new Map(),
      };
      byEmail.set(key, acc);
    }
    return acc;
  };

  // Cost + failures + per-job model split from ai_call_logs
  for (const l of logs) {
    const acc = resolveAcc(l.user_id, l.user_email_snapshot, l.user_role_snapshot);
    if (!acc) continue;
    const cost = num(l.cost_inr);
    acc.totalCostInr += cost;
    if (isFailure(l.status)) acc.failureCount += 1;

    let job = acc.jobs.get(l.job_id);
    if (!job) {
      job = {
        jobId: l.job_id,
        feature: l.feature,
        createdAt: l.created_at,
        costInr: 0,
        models: {
          flash: { calls: 0, costInr: 0 },
          pro: { calls: 0, costInr: 0 },
          imagen: { images: 0, costInr: 0 },
        },
      };
      acc.jobs.set(l.job_id, job);
    }
    job.costInr += cost;
    if (l.created_at > job.createdAt) job.createdAt = l.created_at;
    if (l.model === "flash") {
      job.models.flash.calls += 1;
      job.models.flash.costInr += cost;
    } else if (l.model === "pro") {
      job.models.pro.calls += 1;
      job.models.pro.costInr += cost;
    } else if (l.model === "imagen") {
      job.models.imagen.images += l.image_count ?? 0;
      job.models.imagen.costInr += cost;
    }
  }

  // Hours + last login from sessions
  for (const s of sessions) {
    const acc = resolveAcc(s.user_id, s.user_email_snapshot, s.user_role_snapshot);
    if (!acc) continue;
    acc.hoursUsed += sessionDurationMs(s) / 3_600_000;
    if (!acc.lastLoginAt || s.started_at > acc.lastLoginAt) acc.lastLoginAt = s.started_at;
  }

  // Generation counts (generated_content has no snapshot → only existing faculty).
  for (const r of gc) {
    if (!r.generated_by) continue;
    const acc = byUserId.get(r.generated_by);
    if (!acc) continue;
    acc.generationCounts[r.type] = (acc.generationCounts[r.type] ?? 0) + 1;
  }
  for (const q of (qbankRes.data ?? []) as { faculty_id: string | null }[]) {
    if (!q.faculty_id) continue;
    const acc = byUserId.get(q.faculty_id);
    if (!acc) continue;
    acc.generationCounts["qbank_question"] =
      (acc.generationCounts["qbank_question"] ?? 0) + 1;
  }

  void emailFor;
  const finalize = (acc: Acc): FacultyRow => {
    const recentJobs = [...acc.jobs.values()]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 8);
    const { jobs: _jobs, ...rest } = acc;
    void _jobs;
    return { ...rest, recentJobs };
  };
  return [...byUserId.values(), ...byEmail.values()].map(finalize);
}

// ── Cost / usage trend (daily, IST) ──────────────────────────────────────────
export interface CostTrendPoint {
  date: string;
  totalCostInr: number;
  flashCostInr: number;
  proCostInr: number;
  imagenCostInr: number;
  flashTokens: number;
  proTokens: number;
  imagenImages: number;
}

export async function getCostTrend(admin: AdminClient, days = 30): Promise<CostTrendPoint[]> {
  const dateKeys = lastNIstDateKeys(days);
  const sinceISO = new Date(Date.now() - (days + 1) * 24 * 3600 * 1000).toISOString();
  const logs = await loadAiCallLogs(admin, sinceISO);

  const map = new Map<string, CostTrendPoint>();
  for (const key of dateKeys) {
    map.set(key, {
      date: key,
      totalCostInr: 0,
      flashCostInr: 0,
      proCostInr: 0,
      imagenCostInr: 0,
      flashTokens: 0,
      proTokens: 0,
      imagenImages: 0,
    });
  }
  for (const l of logs) {
    const key = istDateKey(l.created_at);
    const point = map.get(key);
    if (!point) continue; // outside the window (buffer row)
    const cost = num(l.cost_inr);
    point.totalCostInr += cost;
    const tokens = (l.input_tokens ?? 0) + (l.output_tokens ?? 0) + (l.thinking_tokens ?? 0);
    if (l.model === "flash") {
      point.flashCostInr += cost;
      point.flashTokens += tokens;
    } else if (l.model === "pro") {
      point.proCostInr += cost;
      point.proTokens += tokens;
    } else if (l.model === "imagen") {
      point.imagenCostInr += cost;
      point.imagenImages += l.image_count ?? 0;
    }
  }
  return dateKeys.map((k) => map.get(k)!);
}

// ── Feature adoption ─────────────────────────────────────────────────────────
export interface FeatureAdoptionRow {
  feature: string;
  adoptedPct: number; // % of adopted faculty who used this ≥1x
  usersUsed: number;
  successfulCalls: number;
  totalCalls: number;
  totalCostInr: number;
  failureRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  sampleCount: number;
  lowVolume: boolean; // percentiles noisy at pilot scale
}

export async function getFeatureAdoption(admin: AdminClient): Promise<FeatureAdoptionRow[]> {
  const [facultyProfilesRes, logs, percentilesRes] = await Promise.all([
    admin.from("profiles").select("id").eq("role", "faculty"),
    loadAiCallLogs(admin),
    admin.rpc("get_feature_latency_percentiles", { since_ts: null }),
  ]);

  const facultyIds = new Set(
    ((facultyProfilesRes.data ?? []) as { id: string }[]).map((p) => p.id)
  );
  const isFaculty = (userId: string | null, roleSnap: string | null) =>
    (userId != null && facultyIds.has(userId)) || roleSnap === "faculty";

  // denominator: adopted faculty (≥1 successful call)
  const adoptedFaculty = new Set<string>();
  for (const l of logs) {
    if (l.status === "success" && l.user_id && isFaculty(l.user_id, l.user_role_snapshot)) {
      adoptedFaculty.add(l.user_id);
    }
  }
  const denom = adoptedFaculty.size;

  const pctMap = new Map<string, { p50: number | null; p95: number | null; n: number }>();
  for (const r of (percentilesRes.data ?? []) as {
    feature: string;
    sample_count: number;
    p50_ms: number | null;
    p95_ms: number | null;
  }[]) {
    pctMap.set(r.feature, { p50: r.p50_ms, p95: r.p95_ms, n: Number(r.sample_count) });
  }

  interface FAcc {
    usersUsed: Set<string>;
    successfulCalls: number;
    totalCalls: number;
    failures: number;
    cost: number;
  }
  const byFeature = new Map<string, FAcc>();
  const acc = (f: string): FAcc => {
    let a = byFeature.get(f);
    if (!a)
      byFeature.set(
        f,
        (a = { usersUsed: new Set(), successfulCalls: 0, totalCalls: 0, failures: 0, cost: 0 })
      );
    return a;
  };
  for (const l of logs) {
    const a = acc(l.feature);
    a.totalCalls += 1;
    a.cost += num(l.cost_inr);
    if (l.status === "success") a.successfulCalls += 1;
    if (isFailure(l.status)) a.failures += 1;
    if (l.status === "success" && l.user_id && isFaculty(l.user_id, l.user_role_snapshot)) {
      a.usersUsed.add(l.user_id);
    }
  }

  const rows: FeatureAdoptionRow[] = [];
  for (const [feature, a] of byFeature) {
    const pct = pctMap.get(feature);
    rows.push({
      feature,
      adoptedPct: denom > 0 ? (a.usersUsed.size / denom) * 100 : 0,
      usersUsed: a.usersUsed.size,
      successfulCalls: a.successfulCalls,
      totalCalls: a.totalCalls,
      totalCostInr: a.cost,
      failureRate: a.totalCalls > 0 ? (a.failures / a.totalCalls) * 100 : 0,
      p50Ms: pct?.p50 ?? null,
      p95Ms: pct?.p95 ?? null,
      sampleCount: pct?.n ?? 0,
      lowVolume: (pct?.n ?? 0) < 20,
    });
  }
  rows.sort((x, y) => y.totalCalls - x.totalCalls);
  return rows;
}

// ── System health (storage/DB size + projection) ─────────────────────────────
export interface SystemHealthData {
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

export async function getSystemHealth(admin: AdminClient): Promise<SystemHealthData> {
  const { data } = await admin
    .from("storage_usage_snapshots")
    .select("captured_at, db_size_bytes, storage_size_bytes")
    .order("captured_at", { ascending: true });

  const snaps = (data ?? []) as {
    captured_at: string;
    db_size_bytes: number | string;
    storage_size_bytes: number | string;
  }[];

  if (snaps.length === 0) {
    return {
      latest: null,
      limits: STORAGE_TIER_LIMITS,
      dbPct: null,
      storagePct: null,
      projection: { dbDaysToLimit: null, storageDaysToLimit: null, reason: "No snapshots yet" },
      snapshotCount: 0,
    };
  }

  const latest = snaps[snaps.length - 1];
  const dbSize = num(latest.db_size_bytes);
  const storageSize = num(latest.storage_size_bytes);
  const dbPct = (dbSize / STORAGE_TIER_LIMITS.dbBytes) * 100;
  const storagePct = (storageSize / STORAGE_TIER_LIMITS.storageBytes) * 100;

  let projection: SystemHealthData["projection"] = {
    dbDaysToLimit: null,
    storageDaysToLimit: null,
    reason: null,
  };
  if (snaps.length < 3) {
    projection.reason = `Insufficient data (${snaps.length} snapshot${snaps.length === 1 ? "" : "s"}; need ≥3)`;
  } else {
    const first = snaps[0];
    const spanDays =
      (new Date(latest.captured_at).getTime() - new Date(first.captured_at).getTime()) /
      86_400_000;
    if (spanDays <= 0) {
      projection.reason = "Snapshots span < 1 day";
    } else {
      const dbDelta = (dbSize - num(first.db_size_bytes)) / spanDays; // bytes/day
      const stDelta = (storageSize - num(first.storage_size_bytes)) / spanDays;
      projection = {
        dbDaysToLimit:
          dbDelta > 0 ? Math.max(0, (STORAGE_TIER_LIMITS.dbBytes - dbSize) / dbDelta) : null,
        storageDaysToLimit:
          stDelta > 0
            ? Math.max(0, (STORAGE_TIER_LIMITS.storageBytes - storageSize) / stDelta)
            : null,
        reason: null,
      };
    }
  }

  return {
    latest: {
      capturedAt: latest.captured_at,
      dbSizeBytes: dbSize,
      storageSizeBytes: storageSize,
    },
    limits: STORAGE_TIER_LIMITS,
    dbPct,
    storagePct,
    projection,
    snapshotCount: snaps.length,
  };
}

// ── Artifact drill-down (all calls for one job / content id) ──────────────────
export interface ArtifactCallRow {
  id: string;
  createdAt: string;
  task: string;
  feature: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  imageCount: number;
  costInr: number;
  status: string;
  latencyMs: number | null;
  metadata: Record<string, unknown> | null;
}

export async function getArtifactDetail(
  admin: AdminClient,
  idValue: string
): Promise<ArtifactCallRow[]> {
  // Match by job_id OR related_content_id so either identifier drills in.
  const { data, error } = await admin
    .from("ai_call_logs")
    .select(
      "id, created_at, task, feature, model, input_tokens, output_tokens, thinking_tokens, image_count, cost_inr, status, latency_ms, metadata"
    )
    .or(`job_id.eq.${idValue},related_content_id.eq.${idValue}`)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[pilot-analysis] artifact-detail failed:", error);
    return [];
  }
  return ((data ?? []) as AiCallLogRow[]).map((l) => ({
    id: l.id,
    createdAt: l.created_at,
    task: l.task,
    feature: l.feature,
    model: l.model,
    inputTokens: l.input_tokens ?? 0,
    outputTokens: l.output_tokens ?? 0,
    thinkingTokens: l.thinking_tokens ?? 0,
    imageCount: l.image_count ?? 0,
    costInr: num(l.cost_inr),
    status: l.status,
    latencyMs: l.latency_ms,
    metadata: l.metadata,
  }));
}
