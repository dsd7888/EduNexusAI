/**
 * Nightly placement-cohort snapshot sweep (CP-G2). Writes one
 * `placement_cohort_snapshots` row per branch-with-activity + one
 * institution-wide `'ALL'` row, so the TPO dashboard's readiness-lift-over-
 * time chart (CP-G1's migration; this checkpoint's read path) has a fresh
 * point to plot each day.
 *
 * AUTH + GET/POST pattern copied verbatim from
 * `api/cron/refresh-analytics-snapshots` — see that route's header for the
 * full reasoning (Vercel cron issues GET; CRON_SECRET fails closed in
 * production when unset, open in dev so a local harness can drive it without
 * a secret in `.env.local`).
 *
 * Runs inside `after()` so the route returns immediately — this is one full
 * scan of `profiles`+`student_placement_profiles`, not per-subject work, so
 * unlike the assessment-analytics sweep there is nothing to parallelize or
 * rate-limit here; it is a single compute + a single upsert batch.
 */

import { after } from "next/server";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/db/supabase-server";
import {
  computePlacementCohortSnapshotRows,
  upsertPlacementCohortSnapshotRows,
  type SnapshotSourceStudent,
} from "@/lib/analytics/placementCohortSnapshot";

interface StudentProfileRow {
  branch: string | null;
  student_placement_profiles:
    | {
        readiness_overall: number;
        readiness_aptitude: number;
        readiness_verbal: number;
        readiness_domain: number;
        readiness_coding: number;
        readiness_communication: number;
      }
    | Array<{
        readiness_overall: number;
        readiness_aptitude: number;
        readiness_verbal: number;
        readiness_domain: number;
        readiness_coding: number;
        readiness_communication: number;
      }>
    | null;
}

export async function GET(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const auth = request.headers.get("authorization");
      if (auth !== `Bearer ${secret}`) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
    } else if (process.env.NODE_ENV === "production") {
      console.error(
        "[cron/refresh-placement-cohort-snapshots] CRON_SECRET is not set in production — refusing"
      );
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await adminClient
      .from("profiles")
      .select(
        `
        branch,
        student_placement_profiles!inner(
          readiness_overall,
          readiness_aptitude,
          readiness_verbal,
          readiness_domain,
          readiness_coding,
          readiness_communication
        )
      `
      )
      .eq("role", "student");

    if (error) {
      console.error("[cron/refresh-placement-cohort-snapshots] query error:", error);
      return Response.json({ error: "Failed to load students" }, { status: 500 });
    }

    const students: SnapshotSourceStudent[] = ((data ?? []) as unknown as StudentProfileRow[]).map(
      (row) => {
        const sppRaw = row.student_placement_profiles;
        const spp = Array.isArray(sppRaw) ? sppRaw[0] : sppRaw;
        return {
          branch: row.branch,
          readiness_overall: spp?.readiness_overall ?? 0,
          readiness_aptitude: spp?.readiness_aptitude ?? 0,
          readiness_verbal: spp?.readiness_verbal ?? 0,
          readiness_domain: spp?.readiness_domain ?? 0,
          readiness_coding: spp?.readiness_coding ?? 0,
          readiness_communication: spp?.readiness_communication ?? 0,
        };
      }
    );

    const rows = computePlacementCohortSnapshotRows(students, today);

    after(async () => {
      const result = await upsertPlacementCohortSnapshotRows(adminClient, rows);
      console.log(
        `[cron/refresh-placement-cohort-snapshots] upserted ${result.ok} row(s), ${result.failed} failed`
      );
    });

    return Response.json({ ok: true, scheduled: rows.length, date: today });
  } catch (err) {
    console.error("[cron/refresh-placement-cohort-snapshots] error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Spec-compatible alias. See the header on why GET is the real handler. */
export async function POST(request: NextRequest) {
  return GET(request);
}
