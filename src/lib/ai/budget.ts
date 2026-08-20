import { createAdminClient } from "@/lib/db/supabase-server";

/**
 * Platform-wide AI spend ceiling — the guard the per-student daily caps in
 * `src/lib/utils/rate-limit.ts` cannot provide.
 *
 * Those caps bound what ONE student can spend per day. Nothing bounded what the
 * INSTITUTION spends: 50 pilot students each staying honestly under every
 * per-feature cap still add up to thousands of Gemini calls a day against a
 * single API key, with no ceiling, no alert, and no way to stop it short of
 * pulling the key out of Vercel. This module is that stop.
 *
 * Two independent controls, both read from env so they can be changed from the
 * Vercel dashboard without a deploy:
 *
 *   AI_KILL_SWITCH=true      Hard off. Every AI call refuses immediately, no DB
 *                            read. For "something is very wrong, stop spending
 *                            NOW" — flip it, redeploy is not required (env vars
 *                            are read per-invocation).
 *
 *   AI_DAILY_BUDGET_INR=2000 Soft ceiling on today's total logged spend across
 *                            every user, feature and model. `0` disables the
 *                            check entirely. Defaults to DEFAULT_DAILY_BUDGET_INR
 *                            when unset — deliberately a real number rather than
 *                            "unlimited", because a guard nobody remembers to
 *                            turn on is the same as no guard, which is the state
 *                            this replaces.
 *
 * Sizing note: the eight audit runs (AU-*) spent between ₹0 and ₹30 each, and a
 * full GATE exam-sim — the single most expensive student action in the product —
 * is ~₹5. ₹2000/day is therefore several times a realistic 50-student day; it is
 * set to catch runaway (a loop, a leaked key, an abusive script), not to ration
 * normal use. Raise it deliberately if a real pilot day ever approaches it.
 */

const DEFAULT_DAILY_BUDGET_INR = 2000;

/** How long a spend total is reused before being re-read. */
const CACHE_TTL_MS = 60_000;

/**
 * Ceiling on rows pulled for the daily sum. Well above a realistic pilot day
 * (the audit's heaviest single run logged 46 calls); if it is ever hit the sum
 * under-reports, so the guard fails OPEN rather than blocking wrongly — see
 * `readTodaySpendInr`. Move the aggregation into a Postgres RPC before this
 * becomes reachable at real scale.
 */
const MAX_ROWS_SCANNED = 20_000;

export class AiBudgetExceededError extends Error {
  readonly reason: "kill_switch" | "daily_budget";

  constructor(reason: "kill_switch" | "daily_budget", message: string) {
    super(message);
    this.name = "AiBudgetExceededError";
    this.reason = reason;
  }
}

type SpendCache = { total: number; readAt: number; day: string };

// Module scope, so it lives as long as the serverless instance does. Instances
// are short-lived and there are many of them, so this is a best-effort damper on
// query volume, NOT a consistency mechanism: several instances can each hold a
// slightly stale total and each let a call through. That is acceptable for a
// ceiling meant to catch runaway spend — the overshoot is bounded by
// (instances x calls per TTL), not unbounded.
let cache: SpendCache | null = null;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveBudgetInr(): number {
  const raw = process.env.AI_DAILY_BUDGET_INR;
  if (raw === undefined || raw.trim() === "") return DEFAULT_DAILY_BUDGET_INR;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.error(
      `[ai-budget] AI_DAILY_BUDGET_INR is not a valid non-negative number: ${JSON.stringify(raw)}. ` +
        `Falling back to the ${DEFAULT_DAILY_BUDGET_INR} default rather than running uncapped.`
    );
    return DEFAULT_DAILY_BUDGET_INR;
  }
  return parsed;
}

/**
 * Today's total logged spend in INR, cached for CACHE_TTL_MS.
 *
 * Returns `null` when the total could not be established (query error, row cap
 * hit). Callers treat `null` as "do not block" — a monitoring failure must never
 * take the platform's AI offline, since that turns a reporting bug into a
 * total outage for every student at once.
 */
async function readTodaySpendInr(): Promise<number | null> {
  const day = today();

  if (cache && cache.day === day && Date.now() - cache.readAt < CACHE_TTL_MS) {
    return cache.total;
  }

  try {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from("ai_call_logs")
      .select("cost_inr")
      .gte("created_at", `${day}T00:00:00.000Z`)
      .limit(MAX_ROWS_SCANNED);

    if (error) {
      console.error("[ai-budget] Failed to read today's spend:", error);
      return null;
    }

    const rows = (data ?? []) as Array<{ cost_inr: number | string | null }>;

    if (rows.length >= MAX_ROWS_SCANNED) {
      console.error(
        `[ai-budget] Hit the ${MAX_ROWS_SCANNED}-row scan cap for ${day} — today's sum would ` +
          `under-report, so the budget check is being skipped rather than enforced on a wrong ` +
          `number. Move this aggregation into a Postgres RPC.`
      );
      return null;
    }

    const total = rows.reduce(
      (sum, row) => sum + (Number(row.cost_inr) || 0),
      0
    );

    cache = { total, readAt: Date.now(), day };
    return total;
  } catch (err) {
    console.error("[ai-budget] Unexpected failure reading spend:", err);
    return null;
  }
}

/**
 * Throws `AiBudgetExceededError` if this call must not proceed. Called by
 * `routeAI`/`routeAIStream` before provider dispatch, so it covers every AI
 * call in the product from one place rather than per-route.
 */
export async function assertAiBudget(task: string): Promise<void> {
  if (process.env.AI_KILL_SWITCH === "true") {
    throw new AiBudgetExceededError(
      "kill_switch",
      "AI features are temporarily switched off. Please try again later."
    );
  }

  const budget = resolveBudgetInr();
  if (budget === 0) return;

  const spent = await readTodaySpendInr();
  if (spent === null) return;

  if (spent >= budget) {
    console.error(
      `[ai-budget] BLOCKED task=${task}: today's spend ₹${spent.toFixed(2)} has reached the ` +
        `₹${budget} daily ceiling (AI_DAILY_BUDGET_INR). Raise it deliberately or wait for ` +
        `the UTC day to roll over.`
    );
    throw new AiBudgetExceededError(
      "daily_budget",
      "The platform has reached today's AI usage limit. Please try again tomorrow."
    );
  }
}

/**
 * Drops the cached total. Call after a deliberate budget change so the next
 * request re-reads instead of waiting out the TTL.
 */
export function resetAiBudgetCache(): void {
  cache = null;
}
