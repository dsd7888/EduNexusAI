// Pilot Analysis — single source of truth for the tunable assumptions on the page.
// These are ESTIMATES/assumptions, not measured data; the page labels them as such
// wherever it shows a derived number.

// Re-export the idle timeout from Checkpoint 3's session client rather than
// duplicating the literal (2h). This is a plain numeric const, safe to import from a
// server route even though the source module is marked "use client".
export { IDLE_TIMEOUT_MS } from "@/lib/session/client";

// Minutes to produce one artifact manually vs. with AI. Keyed by the ai_call_logs
// `feature` bucket. Revisit manually if an estimate feels wrong.
export const TIME_SAVED_MINUTES_PER_ARTIFACT: Record<
  string,
  { manual: number; ai: number }
> = {
  ppt_generation: { manual: 90, ai: 8 },
  qpaper: { manual: 120, ai: 12 },
  answer_key: { manual: 45, ai: 5 },
  qbank: { manual: 10, ai: 2 }, // per question
  ppt_refine: { manual: 20, ai: 3 },
  explainer: { manual: 60, ai: 10 },
};

// Update these if/when the Supabase tier changes.
export const STORAGE_TIER_LIMITS = {
  dbBytes: 500 * 1024 * 1024, // 500MB free tier
  storageBytes: 1024 * 1024 * 1024, // 1GB free tier
};

// USD→INR snapshot rate lives in src/lib/ai/pricing.ts; cost figures come pre-computed
// (cost_inr) from ai_call_logs, so this page does not re-convert.

// pilot_analysis_settings key for the manually-entered Gemini recharge budget (INR).
export const RECHARGE_BUDGET_SETTING_KEY = "gemini_recharge_budget_inr";
