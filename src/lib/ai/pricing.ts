export const USD_TO_INR = 98; // single source — gemini.ts, imagen.ts, build/route.ts,
// generator.ts, and costLogger.ts must all import this,
// not redeclare it. Real market rate as of 2026-07 (~96-98); round-numbered on
// purpose since this only sizes the pilot budget, not a billing reconciliation.

// Verified against https://ai.google.dev/gemini-api/docs/pricing (2026-07).
// Pro's >200k-token-prompt tier ($2.50 in / $15 out) is intentionally omitted —
// this app's prompts run 1k-6k tokens, nowhere near that threshold.
export const TEXT_MODEL_RATES = {
  flash: { inputPerM: 0.30, outputPerM: 2.50 }, // gemini-2.5-flash
  pro: { inputPerM: 1.25, outputPerM: 10.0 }, // gemini-2.5-pro, <=200k-token-prompt tier
} as const;

// Both tiers are native Gemini image generation (see IMAGE_MODEL_CHAIN in
// imagen.ts), not the classic per-request Imagen API — priced as image *output
// tokens*, converted here to a flat per-image rate at each model's default
// (1K/2K) resolution. Verified against https://ai.google.dev/gemini-api/docs/pricing
// (2026-07):
//   standard  → gemini-2.5-flash-image: 1290 img-tokens @ $30/M = $0.0387/image
//   intricate → gemini-3-pro-image:     $0.134/image (1K/2K tier)
// Both tiers can fall back to gemini-3.1-flash-image (~$0.045-$0.151/image
// depending on resolution) if the primary model fails — the flat rate below
// doesn't distinguish primary vs. fallback, so treat this as an approximation.
export const IMAGE_MODEL_RATES = {
  standard: 0.039, // USD per image
  intricate: 0.134, // USD per image
} as const;

export function calculateTextCostInr(
  inputTokens: number,
  outputTokens: number,
  thinkingTokens: number,
  model: "flash" | "pro"
): { costUsd: number; costInr: number } {
  const rates = TEXT_MODEL_RATES[model];
  // Thinking tokens are billed at the output rate by Gemini — they must be added
  // to the output cost, not tracked separately and left uncosted (audit finding:
  // chat currently undercounts for this reason).
  const billableOutputTokens = outputTokens + thinkingTokens;
  const costUsd =
    (inputTokens / 1_000_000) * rates.inputPerM +
    (billableOutputTokens / 1_000_000) * rates.outputPerM;
  return { costUsd, costInr: costUsd * USD_TO_INR };
}

export function calculateImageCostInr(
  tier: "standard" | "intricate",
  imageCount: number
): { costUsd: number; costInr: number } {
  const costUsd = IMAGE_MODEL_RATES[tier] * imageCount;
  return { costUsd, costInr: costUsd * USD_TO_INR };
}
