type QType =
  | "mcq"
  | "short_answer"
  | "long_answer"
  | "numerical"
  | "fill_blank"
  | "descriptive"
  | "descriptive_with_or"
  | string;

// Profile for QUESTION generation (question text + brief model answer)
const GEN_TOKENS_PER_Q: Record<string, number> = {
  mcq: 220, short_answer: 200, fill_blank: 150,
  numerical: 350, long_answer: 450, descriptive: 400,
  descriptive_with_or: 700,
};

// Profile for ANSWER KEY generation — model answers here are full, detailed
// explanations, materially longer than the question text alone. Calibrated
// so typical PPSU Pro blocks (Q2 + Q3 main ≈ 3 descriptive parts, or
// Q3 OR + Q4 ≈ 4 descriptive parts) land at or above the previously
// hand-tuned 12 288-token ceiling — do not regress below what's proven necessary.
// Verification: 3 × 3200 × 1.35 + 600 = 13 560 ✓  4 × 3200 × 1.35 + 600 = 17 880 ✓
const ANSWER_KEY_TOKENS_PER_Q: Record<string, number> = {
  mcq: 180, short_answer: 500, numerical: 3500,
  long_answer: 3800, descriptive: 3200, descriptive_with_or: 9000,
};

const DEFAULT_GEN = 300;
const DEFAULT_KEY = 700;
const SAFETY_MULTIPLIER = 1.35;
const FIXED_OVERHEAD = 600;
const FLOOR = 2048;
const CEILING = 24000; // comfortably under the real ~65536 ceiling; keeps single-call latency sane on Vercel

// Math/chemistry content is materially more token-verbose per question — LaTeX
// markup (`\frac{}{}`, `\ce{}`, `\begin{}`), shown-steps derivations, and the
// $…$ delimiters all cost tokens that plain prose does not. When a caller knows
// it is generating for a math/chem subject (and especially when the archetype
// hint pushes shown-step problems), it passes latexVerbose so the OUTPUT budget
// grows to match — this is the headroom check that keeps LaTeX answers from
// truncating (the BUG-2 failure mode). It scales the per-question estimate, not
// the fixed overhead, so it tracks question count.
const LATEX_VERBOSITY_MULTIPLIER = 1.25;

export function estimateMaxOutputTokens(
  slots: { type: QType; count: number }[],
  profile: "generation" | "answer_key" = "generation",
  opts?: { latexVerbose?: boolean }
): number {
  const table = profile === "answer_key" ? ANSWER_KEY_TOKENS_PER_Q : GEN_TOKENS_PER_Q;
  const fallback = profile === "answer_key" ? DEFAULT_KEY : DEFAULT_GEN;
  const raw = slots.reduce(
    (sum, s) => sum + (table[s.type] ?? fallback) * s.count,
    0
  );
  const verbosity = opts?.latexVerbose ? LATEX_VERBOSITY_MULTIPLIER : 1;
  const withSafety = raw * verbosity * SAFETY_MULTIPLIER + FIXED_OVERHEAD;
  return Math.max(FLOOR, Math.min(CEILING, Math.ceil(withSafety)));
}
