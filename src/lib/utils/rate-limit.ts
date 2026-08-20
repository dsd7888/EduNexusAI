import { createAdminClient } from "@/lib/db/supabase-server";

export const RATE_LIMITS = {
  chat: 50,
  quiz: 20,
  // Exam simulations are the most expensive student-triggered action in the
  // product: up to 100 questions of batched generation PLUS one verifier call
  // per NAT item (~₹5 for a full GATE mock). 3/day is a COST guard, not a UX
  // choice — quick+mastery keep the 20/day quiz allowance for daily practice.
  examSim: 3,
  hint: 30,
  // Research tier is search-grounded (Flash + googleSearch) and pricier per
  // call than standard chat — capped tighter than the 50/day chat allowance.
  research: 10,
  // Notes v2 subject-scope reads. Checked only on a cache MISS (the assembly
  // path), never on a hit — same ordering as chat's rate-check-after-cache, so
  // reading notes the platform has already built costs a student nothing.
  notes_view: 20,
  // Notes v2 PDF export (CP-N5). Checked after the notes-row lookup, same
  // ordering as notes_view — but never waived on a "cache hit" the way
  // notes_view is, because there is no PDF-bytes cache (see the export route):
  // every export re-runs the math pre-pass, which is real CPU, so every
  // export counts against this allowance regardless of whether the source
  // blocks were freshly assembled or already stored.
  notes_export: 5,
  // Placement AI routes (CP-07) — previously uncapped, each hitting Gemini
  // directly off a student POST with no daily ceiling. Split per-route since
  // cost varies: ATS runs two sequential AI passes (keyword-match +
  // interviewer-lens) so it gets the tightest cap; bullet rewrite is a single
  // small 800-token call so it can afford the highest.
  placement_resume_ats: 10,
  placement_resume_rewrite: 30,
  placement_jd_analyze: 15,
  placement_interview_evaluate: 20,
  // Chat starter-prompt suggestions. Fires once per chat-page mount per subject,
  // so it is invisible to the student but a real AI call every time — it was the
  // only student-reachable route with no ceiling of any kind. Degrades to the
  // route's own DEFAULT_SUGGESTIONS when exhausted rather than erroring, so the
  // cap is a spend guard the student never sees.
  chat_suggestions: 30,
  // Placement prep question generation — the core practice loop. CP-07 capped the
  // four placement *tool* routes (ATS/rewrite/JD/evaluate) and missed this one,
  // which is the most-hit AI route in the placement module. Bank-served sessions
  // do not bill Gemini at all, so this ceiling only ever binds on genuinely new
  // generation.
  placement_prep_generate: 25,
} as const;

type RateLimitedEvent = keyof typeof RATE_LIMITS;

const RESET_AT = "Resets at midnight";
const MAX_CAS_ATTEMPTS = 5;

type UsageRow = { id: string; subject_id: string | null; event_count: number };

async function readUsage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  userId: string,
  eventType: RateLimitedEvent,
  date: string,
  subjectId: string | null
): Promise<{ total: number; ownRow: UsageRow | null }> {
  const { data, error } = await adminClient
    .from("usage_analytics")
    .select("id, subject_id, event_count")
    .eq("user_id", userId)
    .eq("event_type", eventType)
    .eq("date", date);

  if (error) {
    console.error("[rate-limit] Failed to read usage_analytics:", error);
  }

  const rows = (data ?? []) as UsageRow[];
  const total = rows.reduce((sum, row) => sum + (row.event_count ?? 0), 0);
  const ownRow = rows.find((row) => row.subject_id === subjectId) ?? null;
  return { total, ownRow };
}

/**
 * Atomically reserves one unit of `eventType` quota for `userId` today,
 * enforcing `limit` across all of the user's subjects (usage_analytics rows
 * are per-subject; the limit is global per user/event/day). Concurrency-safe
 * via compare-and-swap retry on the target row's `event_count` — the prior
 * version read the total, returned `allowed`, and left the increment for the
 * caller to do later, so concurrent requests could all read "under limit"
 * before any of them wrote (confirmed live on /api/chat: 49/50 -> 51/50 under
 * a concurrent burst).
 *
 * Reserves BEFORE the caller does its (often AI-billed) work — this is the
 * only way to reject over-limit requests before spending money on them.
 * Callers whose existing contract only charges quota for work actually
 * delivered (cache hits, failed generations) must call `releaseRateLimit` on
 * those paths to refund the reservation; see chat/route.ts's persistTurn.
 *
 * Known gap: this CASes a single (user, event, subject, date) row, so it does
 * not close a race between two concurrent requests against two DIFFERENT
 * subjects that both read the same stale cross-subject total — each request's
 * own row-level CAS still succeeds independently. The demonstrated bug (and
 * every route's verify burst) is single-subject; fully closing the
 * cross-subject case needs a lock spanning all of a user's rows for the day
 * (e.g. a Postgres advisory-lock RPC), which is a schema change out of scope
 * here.
 *
 * `subjectId: null` is for callers with no subject context at all (e.g. a
 * general practice hint) — it CASes its own dedicated null-subject bucket,
 * matching `usage_analytics.subject_id`'s nullable column, rather than being
 * coerced into a fake subject partition.
 */
export async function checkRateLimit(options: {
  userId: string;
  eventType: RateLimitedEvent;
  limit: number;
  subjectId: string | null;
}): Promise<{ allowed: boolean; remaining: number; resetAt: string }> {
  const { userId, eventType, limit, subjectId } = options;
  const adminClient = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const { total, ownRow } = await readUsage(
      adminClient,
      userId,
      eventType,
      today,
      subjectId
    );

    if (total >= limit) {
      return { allowed: false, remaining: 0, resetAt: RESET_AT };
    }

    if (ownRow) {
      const { data: updated, error } = await adminClient
        .from("usage_analytics")
        .update({ event_count: ownRow.event_count + 1 })
        .eq("id", ownRow.id)
        .eq("event_count", ownRow.event_count)
        .select("id");

      if (error) {
        console.error("[rate-limit] CAS update failed:", error);
        continue;
      }
      if (updated && updated.length > 0) {
        return {
          allowed: true,
          remaining: Math.max(0, limit - total - 1),
          resetAt: RESET_AT,
        };
      }
      // Someone else incremented this row between our read and write — retry.
      continue;
    }

    const { error: insertError } = await adminClient
      .from("usage_analytics")
      .insert({
        date: today,
        user_id: userId,
        subject_id: subjectId,
        event_type: eventType,
        event_count: 1,
      });

    if (!insertError) {
      return {
        allowed: true,
        remaining: Math.max(0, limit - total - 1),
        resetAt: RESET_AT,
      };
    }
    // Unique-constraint violation: another request created this row first —
    // the next loop iteration will read it and CAS-update instead.
  }

  // Heavy contention on one (user, event, subject, date) cell that never
  // resolved within the retry budget. Fail closed rather than let unresolved
  // contention silently bypass the limit.
  console.error(
    `[rate-limit] CAS retries exhausted for ${userId}/${eventType}/${today}`
  );
  return { allowed: false, remaining: 0, resetAt: RESET_AT };
}

/**
 * Refunds one unit reserved by `checkRateLimit` when the work it gated was
 * never actually delivered (generation failed, or turned out to be a cache
 * hit that didn't need the reservation). Same CAS pattern, floored at 0.
 */
export async function releaseRateLimit(options: {
  userId: string;
  eventType: RateLimitedEvent;
  subjectId: string | null;
}): Promise<void> {
  const { userId, eventType, subjectId } = options;
  const adminClient = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    // Supabase's .eq() compiles to SQL `=`, which never matches NULL — the
    // null-subject bucket (see checkRateLimit's jsdoc) needs .is() instead.
    let query = adminClient
      .from("usage_analytics")
      .select("id, event_count")
      .eq("user_id", userId)
      .eq("event_type", eventType)
      .eq("date", today);
    query = subjectId
      ? query.eq("subject_id", subjectId)
      : query.is("subject_id", null);
    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error("[rate-limit] release read failed:", error);
      return;
    }
    if (!data || data.event_count <= 0) return;

    const { data: updated, error: updateError } = await adminClient
      .from("usage_analytics")
      .update({ event_count: data.event_count - 1 })
      .eq("id", data.id)
      .eq("event_count", data.event_count)
      .select("id");

    if (updateError) {
      console.error("[rate-limit] release update failed:", updateError);
      return;
    }
    if (updated && updated.length > 0) return;
    // Lost the CAS race — retry with a fresh read.
  }

  console.error(
    `[rate-limit] release CAS retries exhausted for ${userId}/${eventType}/${today}`
  );
}
