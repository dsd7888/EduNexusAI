import type { NextRequest } from "next/server";
import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { decidePlacementAccess, effectiveBranchFilter } from "@/lib/placement/access";
import {
  computeDimensionGaps,
  computeAtRisk,
  computeDriveFunnel,
  computeActivity,
  computeTargetDistribution,
  shapeLiftSeries,
  type CohortStudent,
  type CohortDrive,
  type RawCohortSnapshotRow,
} from "@/lib/placement/cohortAnalytics";
import { MIN_COHORT_FOR_AGGREGATE } from "@/lib/analytics/privacy";
import { INSTITUTION_WIDE_BRANCH } from "@/lib/analytics/placementCohortSnapshot";
import type { PlacementTarget } from "@/types/placement";

export const maxDuration = 30;

// ─── Types ────────────────────────────────────────────────────────────────────

interface SppFields {
  cgpa: number | null;
  primary_target: PlacementTarget | null;
  dream_companies: string[] | null;
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

interface RawProfileRow {
  id: string;
  full_name: string | null;
  branch: string | null;
  semester: number | null;
  email: string | null;
  student_placement_profiles: SppFields | SppFields[] | null;
}

export interface StudentRow {
  id: string;
  full_name: string | null;
  branch: string | null;
  semester: number | null;
  email: string | null;
  cgpa: number | null;
  primary_target: string | null;
  dream_companies: string[];
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function toCohortStudent(s: StudentRow): CohortStudent {
  return {
    id: s.id,
    full_name: s.full_name,
    branch: s.branch,
    cgpa: s.cgpa,
    primary_target: (s.primary_target ?? "service_it") as PlacementTarget,
    readiness_aptitude: s.readiness_aptitude,
    readiness_verbal: s.readiness_verbal,
    readiness_domain: s.readiness_domain,
    readiness_coding: s.readiness_coding,
    readiness_communication: s.readiness_communication,
    readiness_overall: s.readiness_overall,
    setup_complete: s.setup_complete,
    last_active_date: s.last_active_date,
    prep_streak_days: s.prep_streak_days,
  };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    // CP-G2: widened from ["superadmin","dean","hod"] to include dept_admin —
    // the access policy (src/lib/placement/access.ts) treats dept_admin as
    // management (aggregate-only), same as dean, per SPEC's explicit ask.
    const authResult = await requireRole(["superadmin", "dean", "hod", "dept_admin"]);
    if (authResult instanceof Response) return authResult;

    const { adminClient, profile } = authResult;
    const { searchParams } = new URL(request.url);
    const requestedBranch = searchParams.get("branch") ?? null;
    const semesterFilter = searchParams.get("semester") ?? null;

    // ── Derive the caller's OWN branch server-side (never trust a client- ──
    // supplied value for this). requireRole()'s profile select is
    // `id, role` only — it deliberately does not carry branch — so this is
    // an explicit second lookup, only needed for hod.
    let callerBranch: string | null = null;
    if (profile.role === "hod") {
      const { data: callerProfile, error: callerErr } = await adminClient
        .from("profiles")
        .select("branch")
        .eq("id", profile.id)
        .single();
      if (callerErr) {
        console.error("[tpo/dashboard] caller branch lookup failed:", callerErr);
        return apiError("Failed to load your profile.", 500);
      }
      callerBranch = (callerProfile as { branch: string | null } | null)?.branch ?? null;
    }

    const decision = decidePlacementAccess(profile.role, callerBranch);

    if (decision.blocked) {
      // Graceful empty state (e.g. hod with no branch set) — 200, not an
      // error, per DESIGN.md's "degrade to a plain-language empty state".
      return apiSuccess({
        access: { role: profile.role, branch: null, warning: decision.warning },
        stats: null,
        drives: [],
        insights: null,
        filters: { branch: requestedBranch, semester: semesterFilter },
      });
    }

    // The literal tamper-proof enforcement point: a pinned (hod) caller's
    // branch always wins — `requestedBranch` is never even consulted for
    // them, so `?branch=<other>` cannot smuggle a different branch's data.
    const effectiveBranch = effectiveBranchFilter(decision, requestedBranch);

    // ── Step 1: Fetch students with placement profiles ─────────────────────────
    let query = adminClient
      .from("profiles")
      .select(
        `
        id,
        full_name,
        branch,
        semester,
        email,
        student_placement_profiles!inner(
          cgpa,
          primary_target,
          dream_companies,
          readiness_overall,
          readiness_aptitude,
          readiness_verbal,
          readiness_domain,
          readiness_coding,
          readiness_communication,
          resume_completeness,
          setup_complete,
          last_active_date,
          prep_streak_days
        )
      `
      )
      .eq("role", "student");

    if (effectiveBranch) query = query.eq("branch", effectiveBranch);
    if (semesterFilter) query = query.eq("semester", parseInt(semesterFilter, 10));

    const { data: profileRows, error: profileError } = await query;

    if (profileError) {
      console.error("[tpo/dashboard] profiles fetch failed:", profileError);
      return apiError("Failed to fetch student data.", 500);
    }

    const students: StudentRow[] = ((profileRows ?? []) as unknown as RawProfileRow[]).map((row) => {
      const sppRaw = row.student_placement_profiles;
      const spp = Array.isArray(sppRaw) ? sppRaw[0] : sppRaw;
      return {
        id: row.id,
        full_name: row.full_name,
        branch: row.branch,
        semester: row.semester,
        email: row.email,
        cgpa: spp?.cgpa ?? null,
        primary_target: spp?.primary_target ?? null,
        dream_companies: spp?.dream_companies ?? [],
        readiness_overall: spp?.readiness_overall ?? 0,
        readiness_aptitude: spp?.readiness_aptitude ?? 0,
        readiness_verbal: spp?.readiness_verbal ?? 0,
        readiness_domain: spp?.readiness_domain ?? 0,
        readiness_coding: spp?.readiness_coding ?? 0,
        readiness_communication: spp?.readiness_communication ?? 0,
        resume_completeness: spp?.resume_completeness ?? 0,
        setup_complete: spp?.setup_complete ?? false,
        last_active_date: spp?.last_active_date ?? null,
        prep_streak_days: spp?.prep_streak_days ?? 0,
      };
    });

    // ── Step 2: Fetch upcoming drives ──────────────────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const { data: driveRows, error: drivesError } = await adminClient
      .from("placement_drives")
      .select("*, company:placement_company_profiles(*)")
      .gte("drive_date", today)
      .order("drive_date", { ascending: true });

    if (drivesError) {
      console.error("[tpo/dashboard] drives fetch failed:", drivesError);
    }

    const drives = driveRows ?? [];
    const cohortDrives: CohortDrive[] = (
      drives as Array<{
        id: string;
        drive_date: string;
        eligible_min_cgpa: number | null;
        eligible_branches: string[] | null;
        company: { name: string; company_type: PlacementTarget } | null;
      }>
    )
      .filter((d) => d.company != null)
      .map((d) => ({
        id: d.id,
        company_name: d.company!.name,
        company_type: d.company!.company_type,
        drive_date: d.drive_date,
        eligible_min_cgpa: d.eligible_min_cgpa,
        eligible_branches: d.eligible_branches,
      }));

    // ── Step 3: Pre-CP-G2 roster-summary stats. Pure counts/averages, no ───────
    // names — safe to ship to every authorized role including dean/dept_admin,
    // same as `insights` below. Only `students` (Step 6) is named-row gated.
    const started = students.filter((s) => s.readiness_overall > 0);
    const dimAvgs = {
      aptitude: avg(started.map((s) => s.readiness_aptitude)),
      verbal: avg(started.map((s) => s.readiness_verbal)),
      domain: avg(started.map((s) => s.readiness_domain)),
      coding: avg(started.map((s) => s.readiness_coding)),
      communication: avg(started.map((s) => s.readiness_communication)),
    };
    const weakestEntry =
      started.length > 0 ? Object.entries(dimAvgs).sort(([, a], [, b]) => a - b)[0] : null;

    const stats = {
      total_students: students.length,
      setup_complete: students.filter((s) => s.setup_complete).length,
      ready: students.filter((s) => s.readiness_overall >= 75).length,
      developing: students.filter((s) => s.readiness_overall >= 50 && s.readiness_overall < 75).length,
      early: students.filter((s) => s.readiness_overall > 0 && s.readiness_overall < 50).length,
      not_started: students.filter((s) => s.readiness_overall === 0).length,
      avg_aptitude: dimAvgs.aptitude,
      avg_verbal: dimAvgs.verbal,
      avg_domain: dimAvgs.domain,
      avg_coding: dimAvgs.coding,
      avg_communication: dimAvgs.communication,
      avg_overall: avg(started.map((s) => s.readiness_overall)),
      weakest_dimension: weakestEntry ? weakestEntry[0] : null,
      avg_resume_completeness: avg(students.map((s) => s.resume_completeness)),
      resumes_complete: students.filter((s) => s.resume_completeness >= 80).length,
      active_this_week: students.filter((s) => {
        if (!s.last_active_date) return false;
        const daysSince = (Date.now() - new Date(s.last_active_date).getTime()) / (1000 * 60 * 60 * 24);
        return daysSince <= 7;
      }).length,
    };

    // ── Step 4: CP-G2 insights, computed identically for every authorized ──────
    // role; disclosure (named vs. count-only) is shaped below per `decision`.
    const cohortStudents = students.map(toCohortStudent);
    const now = new Date();

    const dimensionGaps = computeDimensionGaps(cohortStudents);
    const driveFunnel = computeDriveFunnel(cohortStudents, cohortDrives, now);
    const activity = computeActivity(cohortStudents, now);
    const targetDistribution = computeTargetDistribution(cohortStudents);

    const atRiskEntries = computeAtRisk(cohortStudents, cohortDrives, now);
    const atRisk = decision.includeNamedRows
      ? { count: atRiskEntries.length, named: atRiskEntries }
      : {
          // Aggregate reading for management roles: the floor applies to the
          // COUNT too, the same as every other aggregate here — a bare
          // number over a thin cohort can still de-anonymize.
          count: started.length < MIN_COHORT_FOR_AGGREGATE ? null : atRiskEntries.length,
          named: undefined,
        };

    // ── Step 5: Readiness-lift-over-time (CP-G1's snapshot table). ─────────────
    const snapshotBranch = effectiveBranch ?? INSTITUTION_WIDE_BRANCH;
    const LIFT_LOOKBACK_DAYS = 30;
    const { data: snapshotRows, error: snapshotError } = await adminClient
      .from("placement_cohort_snapshots")
      .select("snapshot_date, student_count, avg_aptitude, avg_verbal, avg_domain, avg_coding, avg_communication, avg_overall")
      .eq("branch", snapshotBranch)
      .order("snapshot_date", { ascending: true })
      .limit(LIFT_LOOKBACK_DAYS);

    if (snapshotError) {
      console.error("[tpo/dashboard] snapshot fetch failed:", snapshotError);
    }
    const readinessLift = shapeLiftSeries((snapshotRows ?? []) as RawCohortSnapshotRow[]);

    const insights = {
      readiness_lift: { branch: snapshotBranch, points: readinessLift },
      at_risk: atRisk,
      dimension_gaps: dimensionGaps,
      drive_funnel: driveFunnel,
      activity,
      target_distribution: targetDistribution,
    };

    // ── Step 6: Shape the final response — named rows are only EVER set on ─────
    // the object for roles the access decision allows; there is no
    // client-side hiding to bypass. `stats` is gated the SAME way as
    // `students`, not just `insights`: unlike `insights` (which applies
    // MIN_COHORT_FOR_AGGREGATE per-figure), `stats` is a straight recompute
    // over whatever `students` array the request scoped to — for a
    // dean-scoped `?branch=` on a below-floor branch that would leak a raw
    // n=2 average with no suppression at all. `stats` is legacy/roster-
    // adjacent (it was designed to sit directly above the named table), so
    // tying its visibility to `includeNamedRows` is the correct fix, not a
    // workaround: dean/dept_admin get their cohort figures exclusively
    // through `insights`, which floors every number it returns.
    const payload: {
      access: { role: string; branch: string | null; warning: string | null };
      stats: typeof stats | null;
      drives: typeof drives;
      insights: typeof insights;
      filters: { branch: string | null; semester: string | null };
      students?: StudentRow[];
    } = {
      access: { role: profile.role, branch: effectiveBranch, warning: null },
      stats: decision.includeNamedRows ? stats : null,
      drives,
      insights,
      filters: { branch: requestedBranch, semester: semesterFilter },
    };
    if (decision.includeNamedRows) {
      payload.students = students;
    }

    return apiSuccess(payload);
  } catch (error) {
    console.error("[tpo/dashboard] Error:", error instanceof Error ? error.message : error);
    return apiError("Failed to load dashboard.", 500);
  }
}
