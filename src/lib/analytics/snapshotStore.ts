/**
 * Snapshot read-through cache + the cohort privacy floor (CP-Q4 Parts 1 & 3).
 *
 * THE FRESHNESS MODEL, in one place:
 *
 *   read → snapshot missing or computed_at older than SNAPSHOT_STALE_AFTER_MS
 *        → recompute inline, return fresh, report refreshedInline: true
 *   read → snapshot within the window
 *        → return it as stored, report refreshedInline: false
 *   cron → every subject with activity in the last 24h, recomputed nightly
 *
 * NO RECOMPUTE ON EVERY ROUTE HIT. The aggregates are a full scan of a
 * subject's attempt history with a point-biserial per bank question; at pilot
 * cohort size one refresh serves many faculty views of the same subject.
 * Recomputing per request would make the dashboard's cost scale with how
 * often faculty look at it, which is exactly backwards.
 *
 * The 2-hour window is a judgement about what faculty analytics is FOR. It is
 * not a live scoreboard — nobody makes a teaching decision on the strength of
 * the last twenty minutes of quiz activity. Two hours is short enough that a
 * faculty member who runs a class exercise and checks the dashboard afterwards
 * sees it, and long enough that a page refresh does not trigger a full
 * recompute.
 */

import type { createAdminClient } from "@/lib/db/supabase-server";
import {
  refreshSnapshot,
  SNAPSHOT_STALE_AFTER_MS,
  type SnapshotAggregates,
} from "./aggregates";
import { MIN_COHORT_FOR_AGGREGATE } from "./privacy";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface SnapshotEnvelope {
  snapshot: SnapshotAggregates & { subject_id: string; computed_at: string };
  /** When the returned snapshot stops being fresh. */
  staleAt: string;
  /** True when this request paid for a recompute. */
  refreshedInline: boolean;
  /**
   * True when the cohort is below MIN_COHORT_FOR_AGGREGATE and the aggregate
   * fields have been suppressed. The UI states the floor rather than rendering
   * an empty panel with no explanation.
   */
  cohortBelowFloor: boolean;
}

/**
 * Load a subject's snapshot, recomputing inline if missing or stale.
 *
 * DOES NOT check access — the caller must have passed `assertAnalyticsAccess`.
 */
export async function loadOrRefreshSnapshot(
  admin: AdminClient,
  subjectId: string,
  now: Date = new Date(),
  opts: { force?: boolean } = {}
): Promise<SnapshotEnvelope> {
  const { data } = await admin
    .from("faculty_analytics_snapshots")
    .select(
      "subject_id, computed_at, student_count, session_count, attempt_count, aggregate_accuracy, per_module, per_question, co_attainment, engagement"
    )
    .eq("subject_id", subjectId)
    .maybeSingle();

  const existing = data as
    | (SnapshotAggregates & { subject_id: string; computed_at: string })
    | null;

  const fresh =
    existing != null &&
    now.getTime() - new Date(existing.computed_at).getTime() <
      SNAPSHOT_STALE_AFTER_MS;

  if (existing && fresh && !opts.force) {
    return envelope(existing, existing.computed_at, false);
  }

  const aggregates = await refreshSnapshot(admin, subjectId, now);
  const computedAt = now.toISOString();
  return envelope(
    { ...aggregates, subject_id: subjectId, computed_at: computedAt },
    computedAt,
    true
  );
}

function envelope(
  snapshot: SnapshotAggregates & { subject_id: string; computed_at: string },
  computedAt: string,
  refreshedInline: boolean
): SnapshotEnvelope {
  const belowFloor = snapshot.student_count < MIN_COHORT_FOR_AGGREGATE;

  // Normalise computed_at to ISO-8601 with a `Z`.
  //
  // Postgres returns `2026-07-28T05:55:22.839+00:00` while a freshly computed
  // snapshot carries JS's `2026-07-28T05:55:22.839Z`. Same instant, two
  // strings — so the SAME field serialised differently depending on whether
  // the request hit the cache or recomputed. Any client comparing the value as
  // a string (a React key, a "has this changed?" check, a cache buster) would
  // see a phantom change on every cache transition. Caught by
  // _cp_q4_verify/snapshot_freshness.ts.
  const normalised = new Date(computedAt).toISOString();

  const shaped = belowFloor ? suppressAggregates(snapshot) : snapshot;

  return {
    snapshot: { ...shaped, computed_at: normalised },
    staleAt: new Date(
      new Date(computedAt).getTime() + SNAPSHOT_STALE_AFTER_MS
    ).toISOString(),
    refreshedInline,
    cohortBelowFloor: belowFloor,
  };
}

/**
 * Blank the aggregate fields for a cohort below the floor.
 *
 * Applied at the RESPONSE layer, never at compute or storage time. Three
 * reasons, and the third is the one that matters:
 *   1. The stored snapshot stays truthful for cron, debugging and any future
 *      institution-level rollup that legitimately pools several thin cohorts.
 *   2. A cohort that grows past the floor becomes visible on the next read
 *      without needing a recompute.
 *   3. Suppression logic that lives in the compute layer eventually gets
 *      "optimised" by someone who sees a function returning nulls and traces
 *      it back to a filter they don't recognise. At the response boundary it
 *      reads as what it is: a disclosure decision.
 *
 * Counts SURVIVE suppression — `student_count` of 3 is not itself a privacy
 * problem, and hiding it would leave faculty unable to tell "no data" from
 * "not enough data". It is the derived per-module / per-question / per-CO
 * breakdowns that could resolve to an individual in a cohort that small.
 */
function suppressAggregates(
  s: SnapshotAggregates & { subject_id: string; computed_at: string }
): SnapshotAggregates & { subject_id: string; computed_at: string } {
  return {
    ...s,
    aggregate_accuracy: null,
    per_module: [],
    per_question: [],
    co_attainment: [],
    engagement: {
      weekly_active_students: [],
      streak_distribution: { "0": 0, "1-2": 0, "3-4": 0, "5+": 0 },
      practice_frequency_median: null,
    },
  };
}
