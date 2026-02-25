import { createAdminClient } from "@/lib/db/supabase-server";

export const RATE_LIMITS = {
  chat: 50,
  quiz: 20,
  hint: 30,
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

export async function checkRateLimit(identifier: string) {
  return { allowed: true, remaining: 100 };
}
