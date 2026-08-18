/**
 * GET /api/faculty/analytics/subject/[subjectId]
 *
 * The main faculty analytics dashboard payload: one subject's whole snapshot
 * in one round trip. Recomputes inline when the snapshot is missing or older
 * than two hours, so the page never renders a spinner waiting on a background
 * job — the same one-round-trip shape as CP-Q3's `/api/assessment/landing`.
 *
 * ACCESS: assertAnalyticsAccess before any read. Faculty → faculty_assignments;
 * dean/hod → role_scope; superadmin → all.
 *
 * Read-mostly. The only write is the snapshot upsert inside refreshSnapshot,
 * which is a cache fill, not user data. No AI, no rate limit.
 */

import { apiSuccess, requireRole } from "@/lib/api/helpers";
import {
  analyticsAccessResponse,
  assertAnalyticsAccess,
} from "@/lib/analytics/access";
import { loadOrRefreshSnapshot } from "@/lib/analytics/snapshotStore";
import { MIN_COHORT_FOR_AGGREGATE } from "@/lib/analytics/privacy";

/**
 * Manual-refresh floor. A forced refresh is refused if the snapshot is younger
 * than this, and the response says when the next one is allowed.
 *
 * PER SUBJECT, not per faculty — a deliberate reading of the spec's "once per
 * 15 min per faculty per subject". The snapshot IS per subject, so two faculty
 * on the same subject pressing refresh would trigger two full recomputes that
 * produce the same row. Limiting per subject makes the cost match the work.
 * Server-enforced: a client-side countdown alone is a suggestion.
 */
const MANUAL_REFRESH_FLOOR_MS = 15 * 60 * 1000;

export async function GET(
  request: Request,
  context: { params: Promise<{ subjectId: string }> }
) {
  try {
    const authResult = await requireRole([
      "faculty",
      "dean",
      "hod",
      "superadmin",
    ]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const { subjectId } = await context.params;

    let subject;
    try {
      subject = await assertAnalyticsAccess(
        adminClient,
        user.id,
        profile.role,
        subjectId
      );
    } catch (err) {
      const denied = analyticsAccessResponse(err);
      if (denied) return denied;
      throw err;
    }

    const force = new URL(request.url).searchParams.get("force") === "1";

    let refreshRejectedUntil: string | null = null;
    if (force) {
      const { data: existing } = await adminClient
        .from("faculty_analytics_snapshots")
        .select("computed_at")
        .eq("subject_id", subjectId)
        .maybeSingle();
      const computedAt = (existing as { computed_at: string } | null)?.computed_at;
      if (computedAt) {
        const age = Date.now() - new Date(computedAt).getTime();
        if (age < MANUAL_REFRESH_FLOOR_MS) {
          refreshRejectedUntil = new Date(
            new Date(computedAt).getTime() + MANUAL_REFRESH_FLOOR_MS
          ).toISOString();
        }
      }
    }

    const envelope = await loadOrRefreshSnapshot(
      adminClient,
      subjectId,
      new Date(),
      { force: force && refreshRejectedUntil === null }
    );

    return apiSuccess({
      subject: {
        id: subject.id,
        name: subject.name,
        code: subject.code,
        branch: subject.branch,
        semester: subject.semester,
      },
      ...envelope,
      cohortFloor: MIN_COHORT_FOR_AGGREGATE,
      refreshRejectedUntil,
    });
  } catch (err) {
    console.error("[faculty/analytics/subject] error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
