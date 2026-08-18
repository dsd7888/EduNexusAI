/**
 * Notes v2 — pure math-text helpers shared by the client renderers (CP-N4) and
 * the server PDF renderers (CP-N5). No `use client`, no server-only imports —
 * importable from both sides of the client/server boundary.
 */

/**
 * Wrap a bare TeX control sequence in `$…$` so a LaTeX-aware renderer sees it.
 *
 * FOUND IN REAL OUTPUT, NOT ANTICIPATED. §13's authoring convention is `$…$` for
 * math, and the generator honours it in `formula`, `meaning` and `solution` — but
 * NOT in `unit`, which comes back as bare `\Omega` / `\mu F`. A delimiter-driven
 * `hasLatex()` check correctly reports false for those, so they would render as
 * the literal string "\Omega" in the Unit column. Verified against the first real
 * formula blocks generated for SOEEC1010.
 *
 * The repair is deliberately narrow: only when the value carries a control
 * sequence AND no `$` already. Plain units ("V", "A", "m/s") are returned
 * untouched and take the no-math fast path exactly as before, so this cannot
 * disturb the common case. Fixing it here rather than in the prompt is the right
 * layer — this is a rendering concern (screen AND print), not a generation one.
 */
export function withMathDelimiters(text: string): string {
  if (text.includes("$")) return text;
  return /\\[a-zA-Z]+/.test(text) ? `$${text}$` : text;
}
