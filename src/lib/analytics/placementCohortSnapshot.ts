/**
 * Compute + upsert one `placement_cohort_snapshots` row per (branch, today)
 * — plus one institution-wide `branch = 'ALL'` row — per CP-G1's migration
 * header. Same split as `src/lib/analytics/aggregates.ts`: a pure compute
 * function (`computePlacementCohortSnapshotRows`, data in → rows out, no
 * Supabase) and one impure function that persists them
 * (`upsertPlacementCohortSnapshotRows`). Shared by the nightly cron
 * (`api/cron/refresh-placement-cohort-snapshots`) and CP-G2's one-off
 * backfill so both write through the exact same computation.
 *
 * ZERO AI CALLS — pure DB aggregation, same class of problem as
 * `aggregates.ts`'s own "ZERO AI CALLS" precedent.
 */

import type { createAdminClient } from "@/lib/db/supabase-server";

type AdminClient = ReturnType<typeof createAdminClient>;

export const INSTITUTION_WIDE_BRANCH = "ALL";

export interface SnapshotSourceStudent {
  branch: string | null;
  readiness_overall: number;
  readiness_aptitude: number;
  readiness_verbal: number;
  readiness_domain: number;
  readiness_coding: number;
  readiness_communication: number;
}

export interface PlacementCohortSnapshotRow {
  branch: string;
  snapshot_date: string; // YYYY-MM-DD
  student_count: number;
  avg_aptitude: number | null;
  avg_verbal: number | null;
  avg_domain: number | null;
  avg_coding: number | null;
  avg_communication: number | null;
  avg_overall: number | null;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

function rowFor(branch: string, date: string, cohort: SnapshotSourceStudent[]): PlacementCohortSnapshotRow {
  return {
    branch,
    snapshot_date: date,
    student_count: cohort.length,
    avg_aptitude: avg(cohort.map((s) => s.readiness_aptitude)),
    avg_verbal: avg(cohort.map((s) => s.readiness_verbal)),
    avg_domain: avg(cohort.map((s) => s.readiness_domain)),
    avg_coding: avg(cohort.map((s) => s.readiness_coding)),
    avg_communication: avg(cohort.map((s) => s.readiness_communication)),
    avg_overall: avg(cohort.map((s) => s.readiness_overall)),
  };
}

/**
 * Pure: every branch with at least one "started" student (readiness_overall
 * > 0 — the same population the TPO dashboard and CP-G1's migration both
 * average over), plus one institution-wide `'ALL'` row pooling every started
 * student. Branches with zero started students are skipped — nothing to
 * plot, and a 0-cohort row would need `student_count: 0` with null averages
 * for no benefit over simply not writing that day.
 */
export function computePlacementCohortSnapshotRows(
  students: SnapshotSourceStudent[],
  date: string
): PlacementCohortSnapshotRow[] {
  const started = students.filter((s) => s.readiness_overall > 0);
  if (started.length === 0) return [];

  const byBranch = new Map<string, SnapshotSourceStudent[]>();
  for (const s of started) {
    const key = s.branch ?? "Unknown";
    const bucket = byBranch.get(key) ?? [];
    bucket.push(s);
    byBranch.set(key, bucket);
  }

  const rows = [...byBranch.entries()].map(([branch, cohort]) => rowFor(branch, date, cohort));
  rows.push(rowFor(INSTITUTION_WIDE_BRANCH, date, started));
  return rows;
}

/**
 * Impure: the only function in this module that touches the database.
 * Upserts on (branch, snapshot_date) — a same-day rerun overwrites that
 * day's row rather than creating a duplicate point on the lift chart.
 */
export async function upsertPlacementCohortSnapshotRows(
  admin: AdminClient,
  rows: PlacementCohortSnapshotRow[]
): Promise<{ ok: number; failed: number }> {
  if (rows.length === 0) return { ok: 0, failed: 0 };

  const { error } = await admin
    .from("placement_cohort_snapshots")
    .upsert(rows, { onConflict: "branch,snapshot_date" });

  if (error) {
    console.error("[placementCohortSnapshot] upsert failed:", error);
    return { ok: 0, failed: rows.length };
  }
  return { ok: rows.length, failed: 0 };
}
