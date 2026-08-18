/**
 * Nightly analytics snapshot sweep. 0 3 * * * (3am UTC — 8:30am IST, before
 * the pilot region's teaching day, after its night).
 *
 * Refreshes the snapshot for every subject with student_question_attempts in
 * the last 24 hours. Subjects with no activity keep their existing snapshot:
 * recomputing an unchanged aggregate burns the same query budget to produce
 * identical numbers.
 *
 * ── GET *AND* POST, deliberately ────────────────────────────────────────────
 * The CP-Q4 spec says POST. Vercel cron issues **GET**, and the three existing
 * cron routes in this codebase (`abandon-stale-generations`,
 * `abandon-stale-assessments`, `storage-snapshot`) are all GET for that
 * reason. A POST-only route here would be scheduled in vercel.json, appear to
 * be wired up, and never fire — a silent no-op that would surface weeks later
 * as "why is analytics always stale?". So GET is the real handler and POST
 * delegates to it, satisfying both the spec and the platform.
 *
 * ── AUTH, AND WHY IT IS STRICTER THAN THE OTHER CRON ROUTES ─────────────────
 * `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set (what Vercel
 * sends). Unset allows unauthenticated runs IN DEVELOPMENT ONLY — in
 * production a missing secret is a 401, not an open door.
 *
 * The three pre-existing cron routes treat an unset CRON_SECRET as "allow
 * anyone", which is survivable for them: their work is a bounded UPDATE that
 * marks stale rows abandoned. This route is different. It recomputes a full
 * aggregate — every attempt, every module, a point-biserial per bank question
 * — for every subject with recent activity. Left open, it is a one-request
 * amplification any logged-in student could fire in a loop.
 *
 * `_cp_q4_verify/access_invariants.ts` caught exactly this: a seeded student
 * hit the route and got a 200 because CRON_SECRET is unset in local dev.
 * Failing closed in production is the fix; the dev allowance stays so the
 * harness can drive the route without a secret in `.env.local`.
 *
 * ── WHY after() AND WHY SEQUENTIALLY ────────────────────────────────────────
 * The sweep runs inside `after()` so the route returns immediately with the
 * work list rather than holding the connection open for the whole batch.
 * Refreshes run ONE AT A TIME on purpose: each is a full scan of a subject's
 * attempt history, and firing N of them concurrently at the pooler is how a
 * nightly maintenance job turns into a morning outage. Nothing is waiting on
 * this finishing quickly.
 */

import { after } from "next/server";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/db/supabase-server";
import { refreshSnapshot } from "@/lib/analytics/aggregates";

const ACTIVITY_WINDOW_HOURS = 24;

export async function GET(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const auth = request.headers.get("authorization");
      if (auth !== `Bearer ${secret}`) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
    } else if (process.env.NODE_ENV === "production") {
      // Fail closed. An unset secret in production is a misconfiguration, and
      // the safe reading of a misconfiguration on a route this expensive is
      // "nobody", not "everybody".
      console.error(
        "[cron/refresh-analytics-snapshots] CRON_SECRET is not set in production — refusing"
      );
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const cutoff = new Date(
      Date.now() - ACTIVITY_WINDOW_HOURS * 60 * 60 * 1000
    ).toISOString();

    const { data, error } = await adminClient
      .from("student_question_attempts")
      .select("subject_id")
      .gte("created_at", cutoff);

    if (error) {
      console.error("[cron/refresh-analytics-snapshots] query error:", error);
      return Response.json({ error: "Failed to list subjects" }, { status: 500 });
    }

    const subjectIds = [
      ...new Set(
        ((data ?? []) as Array<{ subject_id: string }>).map((r) => r.subject_id)
      ),
    ];

    after(async () => {
      let ok = 0;
      let failed = 0;
      for (const subjectId of subjectIds) {
        try {
          await refreshSnapshot(adminClient, subjectId);
          ok += 1;
        } catch (err) {
          // One bad subject must not abort the sweep for the rest.
          failed += 1;
          console.error(
            `[cron/refresh-analytics-snapshots] subject ${subjectId} failed:`,
            err
          );
        }
      }
      console.log(
        `[cron/refresh-analytics-snapshots] refreshed ${ok} subject(s), ${failed} failed`
      );
    });

    return Response.json({ ok: true, scheduled: subjectIds.length });
  } catch (err) {
    console.error("[cron/refresh-analytics-snapshots] error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Spec-compatible alias. See the header on why GET is the real handler. */
export async function POST(request: NextRequest) {
  return GET(request);
}
