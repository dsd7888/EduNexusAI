/**
 * Pure cohort-aggregation functions for the TPO/management placement
 * dashboard (CP-G2). Mirrors `src/lib/analytics/aggregates.ts`'s own split:
 * a data pull (in the route) feeds pure compute functions here — a plain
 * array in, a value out, no Supabase, no clock except an injectable `now`.
 * That is what lets `_cp_g2_verify/pure.ts` assert these against hand-built
 * fixtures without a database.
 *
 * ZERO AI CALLS — this entire checkpoint is DB aggregation over already-
 * persisted readiness/drive data, same as CP-G1's snapshot table and CP-Q4's
 * assessment aggregates.
 *
 * THE PRIVACY FLOOR: every function that returns a genuine AGGREGATE (not a
 * named roster) suppresses itself when the cohort it aggregates over is
 * below `MIN_COHORT_FOR_AGGREGATE`, returning `null`/`suppressed: true`
 * rather than a number — never 0, which would read as a real measured
 * value. This module does not decide who is ALLOWED to see named rows at
 * all (that is `access.ts`'s job, enforced in the route); it only decides
 * when a cohort is too thin to aggregate over, which applies identically
 * regardless of role.
 */

import {
  PlacementTarget,
  READINESS_WEIGHTS,
  TARGET_LABELS,
  FIT_THRESHOLDS,
  computeOverallReadiness,
} from "@/types/placement";
import {
  DIMENSIONS,
  DIMENSION_LABELS,
  Dimension,
  ReadinessOnlyProfile,
  weightedWeakestDimensions,
} from "@/lib/placement/nextMove";
import { isDriveEligible } from "@/lib/placement/readiness";
import { MIN_COHORT_FOR_AGGREGATE } from "@/lib/analytics/privacy";

// ─── Shared shapes ──────────────────────────────────────────────────────────

export interface CohortStudent extends ReadinessOnlyProfile {
  id: string;
  full_name: string | null;
  branch: string | null;
  cgpa: number | null;
  primary_target: PlacementTarget;
  readiness_overall: number;
  setup_complete: boolean;
  last_active_date: string | null;
  prep_streak_days: number;
}

export interface CohortDrive {
  id: string;
  company_name: string;
  company_type: PlacementTarget;
  drive_date: string; // ISO date
  eligible_min_cgpa: number | null;
  eligible_branches: string[] | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(earlier: Date, later: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / MS_PER_DAY);
}

function startedOnly(students: CohortStudent[]): CohortStudent[] {
  // "Started placement prep" — the same population the pre-CP-G2 dashboard
  // route and CP-G1's migration both use as the averaging denominator.
  return students.filter((s) => s.readiness_overall > 0);
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

// ─── 1. Dimension-level cohort gaps (weakest dimension, cohort-wide + per branch) ──

export interface DimensionAvg {
  dimension: Dimension;
  label: string;
  avg: number;
}

export interface BranchDimensionGap {
  branch: string;
  cohortSize: number;
  suppressed: boolean;
  weakest: DimensionAvg | null;
}

export interface DimensionGapsResult {
  cohortSize: number;
  suppressed: boolean;
  /** All 5 dimension averages, weakest first. Null when suppressed. */
  ranked: DimensionAvg[] | null;
  perBranch: BranchDimensionGap[];
}

function rankDimensions(students: CohortStudent[]): DimensionAvg[] {
  return DIMENSIONS.map((dim) => ({
    dimension: dim,
    label: DIMENSION_LABELS[dim],
    avg: avg(students.map((s) => dimensionValue(s, dim))),
  })).sort((a, b) => a.avg - b.avg);
}

function dimensionValue(s: CohortStudent, dim: Dimension): number {
  const map: Record<Dimension, number> = {
    aptitude: s.readiness_aptitude,
    verbal: s.readiness_verbal,
    domain: s.readiness_domain,
    coding: s.readiness_coding,
    communication: s.readiness_communication,
  };
  return map[dim];
}

export function computeDimensionGaps(students: CohortStudent[]): DimensionGapsResult {
  const started = startedOnly(students);
  const suppressed = started.length < MIN_COHORT_FOR_AGGREGATE;

  const byBranch = new Map<string, CohortStudent[]>();
  for (const s of started) {
    const key = s.branch ?? "Unknown";
    const bucket = byBranch.get(key) ?? [];
    bucket.push(s);
    byBranch.set(key, bucket);
  }
  const perBranch: BranchDimensionGap[] = [...byBranch.entries()]
    .map(([branch, rows]) => {
      const branchSuppressed = rows.length < MIN_COHORT_FOR_AGGREGATE;
      return {
        branch,
        cohortSize: rows.length,
        suppressed: branchSuppressed,
        weakest: branchSuppressed ? null : rankDimensions(rows)[0],
      };
    })
    .sort((a, b) => a.branch.localeCompare(b.branch));

  return {
    cohortSize: started.length,
    suppressed,
    ranked: suppressed ? null : rankDimensions(started),
    perBranch,
  };
}

// ─── 2. At-risk students (drive within 14 days, weighted-weakest dim < 60) ──

export interface AtRiskEntry {
  student_id: string;
  full_name: string | null;
  branch: string | null;
  drive_id: string;
  drive_name: string;
  days_remaining: number;
  dimension: Dimension;
  dimension_label: string;
  score: number;
}

const AT_RISK_WINDOW_DAYS = 14;
const AT_RISK_SCORE_THRESHOLD = 60;

/**
 * Named at-risk entries — always computed, regardless of caller role. The
 * ROUTE decides whether to ship this array or collapse it to a bare count,
 * per `access.ts`'s `includeNamedRows` (mirrors CP-Q4's "suppression is a
 * response-layer decision" precedent: this function stays truthful, the
 * route shapes disclosure).
 */
export function computeAtRisk(
  students: CohortStudent[],
  drives: CohortDrive[],
  now: Date = new Date()
): AtRiskEntry[] {
  const entries: AtRiskEntry[] = [];

  for (const s of students) {
    if (!s.branch) continue;
    let best: AtRiskEntry | null = null;

    for (const d of drives) {
      const elig = isDriveEligible({ cgpa: s.cgpa }, d, s.branch);
      if (!elig.eligible) continue;

      const daysRemaining = daysBetween(now, new Date(d.drive_date));
      if (daysRemaining < 0 || daysRemaining > AT_RISK_WINDOW_DAYS) continue;

      const weakest = weightedWeakestDimensions(s, d.company_type)[0];
      if (!weakest) continue;
      const score = dimensionValue(s, weakest);
      if (score >= AT_RISK_SCORE_THRESHOLD) continue;

      if (!best || daysRemaining < best.days_remaining) {
        best = {
          student_id: s.id,
          full_name: s.full_name,
          branch: s.branch,
          drive_id: d.id,
          drive_name: d.company_name,
          days_remaining: daysRemaining,
          dimension: weakest,
          dimension_label: DIMENSION_LABELS[weakest],
          score,
        };
      }
    }

    if (best) entries.push(best);
  }

  return entries.sort((a, b) => a.days_remaining - b.days_remaining);
}

// ─── 3. Drive-readiness funnel (per upcoming drive: eligible vs ready) ─────

export interface DriveFunnelEntry {
  drive_id: string;
  company_name: string;
  drive_date: string;
  days_remaining: number;
  cohortSize: number;
  suppressed: boolean;
  eligible_count: number | null;
  ready_count: number | null;
}

export function computeDriveFunnel(
  students: CohortStudent[],
  drives: CohortDrive[],
  now: Date = new Date()
): DriveFunnelEntry[] {
  return drives.map((d) => {
    const eligible = students.filter(
      (s) => s.branch && isDriveEligible({ cgpa: s.cgpa }, d, s.branch).eligible
    );
    const suppressed = eligible.length < MIN_COHORT_FOR_AGGREGATE;
    const ready = eligible.filter((s) => {
      const score = computeOverallReadiness(
        {
          aptitude: s.readiness_aptitude,
          verbal: s.readiness_verbal,
          domain: s.readiness_domain,
          coding: s.readiness_coding,
          communication: s.readiness_communication,
        },
        d.company_type
      );
      return score >= FIT_THRESHOLDS.ready;
    });

    return {
      drive_id: d.id,
      company_name: d.company_name,
      drive_date: d.drive_date,
      days_remaining: daysBetween(now, new Date(d.drive_date)),
      cohortSize: eligible.length,
      suppressed,
      eligible_count: suppressed ? null : eligible.length,
      ready_count: suppressed ? null : ready.length,
    };
  });
}

// ─── 4. Activity / drop-off ─────────────────────────────────────────────────

export type StreakBucket = "0" | "1-2" | "3-6" | "7+";

export interface ActivityResult {
  cohortSize: number;
  suppressed: boolean;
  active_7d: number | null;
  active_14d: number | null;
  active_30d: number | null;
  setup_incomplete: number | null;
  streak_distribution: Record<StreakBucket, number> | null;
}

export function computeActivity(students: CohortStudent[], now: Date = new Date()): ActivityResult {
  const cohortSize = students.length;
  const suppressed = cohortSize < MIN_COHORT_FOR_AGGREGATE;
  if (suppressed) {
    return {
      cohortSize,
      suppressed,
      active_7d: null,
      active_14d: null,
      active_30d: null,
      setup_incomplete: null,
      streak_distribution: null,
    };
  }

  const activeWithin = (days: number) =>
    students.filter((s) => s.last_active_date && daysBetween(new Date(s.last_active_date), now) <= days)
      .length;

  const streak_distribution: Record<StreakBucket, number> = { "0": 0, "1-2": 0, "3-6": 0, "7+": 0 };
  for (const s of students) {
    const streak = s.prep_streak_days;
    if (streak <= 0) streak_distribution["0"] += 1;
    else if (streak <= 2) streak_distribution["1-2"] += 1;
    else if (streak <= 6) streak_distribution["3-6"] += 1;
    else streak_distribution["7+"] += 1;
  }

  return {
    cohortSize,
    suppressed,
    active_7d: activeWithin(7),
    active_14d: activeWithin(14),
    active_30d: activeWithin(30),
    setup_incomplete: students.filter((s) => !s.setup_complete).length,
    streak_distribution,
  };
}

// ─── 5. Target distribution ─────────────────────────────────────────────────

export interface TargetDistributionResult {
  cohortSize: number;
  suppressed: boolean;
  counts: Array<{ target: PlacementTarget; label: string; count: number }> | null;
}

export function computeTargetDistribution(students: CohortStudent[]): TargetDistributionResult {
  const cohortSize = students.length;
  const suppressed = cohortSize < MIN_COHORT_FOR_AGGREGATE;
  if (suppressed) return { cohortSize, suppressed, counts: null };

  const tally = new Map<PlacementTarget, number>();
  for (const target of Object.keys(READINESS_WEIGHTS) as PlacementTarget[]) tally.set(target, 0);
  for (const s of students) tally.set(s.primary_target, (tally.get(s.primary_target) ?? 0) + 1);

  const counts = [...tally.entries()].map(([target, count]) => ({
    target,
    label: TARGET_LABELS[target],
    count,
  }));

  return { cohortSize, suppressed, counts };
}

// ─── 6. Readiness-lift-over-time shaping (raw snapshot rows → response shape) ──

export interface RawCohortSnapshotRow {
  snapshot_date: string;
  student_count: number;
  avg_aptitude: number | null;
  avg_verbal: number | null;
  avg_domain: number | null;
  avg_coding: number | null;
  avg_communication: number | null;
  avg_overall: number | null;
}

export interface LiftPoint {
  date: string;
  student_count: number;
  suppressed: boolean;
  avg_aptitude: number | null;
  avg_verbal: number | null;
  avg_domain: number | null;
  avg_coding: number | null;
  avg_communication: number | null;
  avg_overall: number | null;
}

/**
 * Shape stored snapshot rows into the lift-chart response, applying the
 * privacy floor per point (a branch can cross the floor mid-series; each
 * day is suppressed independently rather than all-or-nothing for the whole
 * series — matches CP-Q4's "a cohort that grows past the floor becomes
 * visible on the next read" precedent, extended per-point here since this
 * is a series rather than a single snapshot).
 */
export function shapeLiftSeries(rows: RawCohortSnapshotRow[]): LiftPoint[] {
  return rows.map((r) => {
    const suppressed = r.student_count < MIN_COHORT_FOR_AGGREGATE;
    return {
      date: r.snapshot_date,
      student_count: r.student_count,
      suppressed,
      avg_aptitude: suppressed ? null : r.avg_aptitude,
      avg_verbal: suppressed ? null : r.avg_verbal,
      avg_domain: suppressed ? null : r.avg_domain,
      avg_coding: suppressed ? null : r.avg_coding,
      avg_communication: suppressed ? null : r.avg_communication,
      avg_overall: suppressed ? null : r.avg_overall,
    };
  });
}
