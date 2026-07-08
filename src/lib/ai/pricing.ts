export const USD_TO_INR = 83.33; // single source — gemini.ts, imagen.ts, build/route.ts,
// generator.ts, and costLogger.ts must all import this,
// not redeclare it

export const TEXT_MODEL_RATES = {
  flash: { inputPerM: 0.15, outputPerM: 0.6 },
  pro: { inputPerM: 1.25, outputPerM: 10.0 },
} as const;

// Imagen is priced per-image, not per-token. Confirm these two tier rates against
// current Google pricing before hardcoding — audit found the existing standard-tier
// rate ($0.04) and intricate-tier rate ($0.10) already in use in two places
// (build/route.ts and the older generator.ts, which ignores the intricate tier
// entirely — that inconsistency is fixed by centralizing here).
export const IMAGE_MODEL_RATES = {
  standard: 0.04, // USD per image
  intricate: 0.10, // USD per image
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
  // explainer_ideate and chat currently undercount for this reason).
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
