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
} as const;

type RateLimitedEvent = keyof typeof RATE_LIMITS;

export async function checkRateLimit(options: {
  userId: string;
  eventType: RateLimitedEvent;
  limit: number;
}): Promise<{ allowed: boolean; remaining: number; resetAt: string }> {
  const { userId, eventType, limit } = options;

  const adminClient = createAdminClient();

  const { data, error } = await adminClient
    .from("usage_analytics")
    .select("event_count")
    .eq("user_id", userId)
    .eq("event_type", eventType)
    .eq("date", new Date().toISOString().slice(0, 10));

  if (error) {
    console.error("[rate-limit] Failed to read usage_analytics:", error);
  }

  const total =
    data?.reduce((sum, row) => {
      const count = (row as any).event_count ?? 0;
      return sum + count;
    }, 0) ?? 0;

  const allowed = total < limit;
  const remaining = allowed ? limit - total : 0;

  return {
    allowed,
    remaining,
    resetAt: "Resets at midnight",
  };
}
