/**
 * latexSegments — the CLIENT-SAFE half of the math/chemistry foundation.
 *
 * These are pure string functions (no `sharp`, no `mathjax-full`, no native
 * binaries), so they are safe to import from client components as well as from
 * the server-only rasteriser in `./katexRender`. The split exists precisely so a
 * client bundle can call `extractLatexSegments` / `shouldRenderInline` without
 * dragging the server-only image pipeline into the browser.
 *
 * `katexRender.ts` re-exports everything here, so server code may import from
 * either module.
 *
 * This file deliberately does NOT touch `markdownLite.ts` (bold/code/table/list
 * segmentation). Math/chemistry is a parallel rendering concern.
 */

// ── Inline-vs-block layout heuristic ─────────────────────────────────────────

/**
 * Decide whether a snippet should flow INLINE within a text line or be promoted
 * to its own BLOCK line. This is a *layout* hint for the PDF/Word/PPT builders —
 * it is independent of MathJax's display-math mode (which controls typography,
 * not placement).
 *
 * A snippet stays INLINE when it is roughly one line tall: single-level
 * superscripts/subscripts, symbols, and single chemical species — e.g. `x^2`,
 * `x_n`, `\leq`, `\ce{H2O}`, `\ce{SO4^{2-}}`.
 *
 * It becomes BLOCK when it contains any construct that grows noticeably taller or
 * wider than body text. The exact trigger list (kept explicit so a future editor
 * can adjust it deliberately):
 *
 *   \frac \dfrac \tfrac \cfrac   stacked fractions
 *   \int \iint \iiint \oint      integrals (tall, often with limits)
 *   \sum \prod \coprod           big operators carrying limits
 *   \lim                         limits
 *   \sqrt \nthroot               radicals — BORDERLINE (see NOTE)
 *   \binom \dbinom \tbinom       binomials (stacked)
 *   \begin{...}                  environments: matrix, cases, aligned, array, …
 *   \\                           an explicit line break (inherently multi-line)
 *   \overbrace \underbrace \substack   stacked annotations
 *
 * Chemistry (`\ce{...}`) is BLOCK when it is a *reaction/equation* rather than a
 * lone species: it contains a reaction arrow (`->`, `<-`, `<=>`, `<->`) or joins
 * species with a `+`. A single formula stays INLINE.
 *
 * NOTE on \sqrt: a bare `\sqrt{x}` is only marginally taller than a line and is
 * arguably fine inline; it is grouped with the block triggers here per the agreed
 * convention. To make simple square roots inline, drop the `\\sqrt`/`\\nthroot`
 * entry from BLOCK_PATTERNS below.
 */
export function shouldRenderInline(latex: string): boolean {
  // Defensively strip surrounding $…$ / $$…$$ if a caller passed a delimited span.
  const expr = latex.trim().replace(/^\${1,2}/, "").replace(/\${1,2}$/, "");

  // Chemistry: judge the reaction-vs-species question on the \ce{...} contents.
  const ce = extractCeContent(expr);
  if (ce != null) {
    const isReaction = /->|<-|<=>|<->|\s\+\s/.test(ce);
    return !isReaction;
  }

  return !BLOCK_PATTERNS.some((re) => re.test(expr));
}

const BLOCK_PATTERNS: RegExp[] = [
  /\\[dt]?frac\b/,
  /\\cfrac\b/,
  /\\i{1,3}nt\b/,
  /\\oint\b/,
  /\\sum\b/,
  /\\prod\b/,
  /\\coprod\b/,
  /\\lim\b/,
  /\\sqrt\b/,
  /\\nthroot\b/,
  /\\[dt]?binom\b/,
  /\\begin\{/,
  /\\\\/,
  /\\overbrace\b/,
  /\\underbrace\b/,
  /\\substack\b/,
];

// ── Extraction of math/chemistry spans from mixed text ───────────────────────

/**
 * The ONE syntax rule taught everywhere downstream (see {@link MATH_CHEM_NOTATION_GUIDE}):
 *
 *   • Inline math   → wrap in single dollars:  `$x^2$`
 *   • Block  math   → wrap in double dollars:  `$$\int_0^1 x\,dx$$`
 *   • Chemistry     → write `\ce{...}` BARE, with NO dollar signs
 *
 * Chemistry is recognised without delimiters because faculty type `\ce{...}`
 * constantly and dollar-wrapping it is an error-prone extra step; the `\ce{`
 * token is itself unambiguous, so it needs no fence.
 */
export type LatexSegment =
  | { type: "text"; value: string }
  | {
      type: "math";
      /** The LaTeX/chemistry body, without delimiters. */
      latex: string;
      /** MathJax display mode to render with. */
      displayMode: boolean;
      /** True when the span is chemistry (a bare `\ce{...}`). */
      chem: boolean;
      /** Where the span came from — useful for diagnostics. */
      source: "block" | "inline" | "ce";
    };

/**
 * Split mixed text into an ordered run of plain-text and math/chemistry segments.
 * Recognises `$$…$$` (block), `$…$` (inline), and bare `\ce{…}` (chemistry) that
 * is not already inside a `$…$` span. A literal dollar is written `\$`.
 *
 * Returns the whole input as an ordered segmentation so downstream builders can
 * interleave rendered images with the surrounding text.
 */
export function extractLatexSegments(text: string): LatexSegment[] {
  const segments: LatexSegment[] = [];
  let textBuf = "";
  let i = 0;
  const n = text.length;

  const flush = () => {
    if (textBuf) {
      segments.push({ type: "text", value: textBuf });
      textBuf = "";
    }
  };

  while (i < n) {
    const ch = text[i];

    // Escaped dollar → literal `$` in the text run.
    if (ch === "\\" && text[i + 1] === "$") {
      textBuf += "$";
      i += 2;
      continue;
    }

    // Block math: $$ … $$
    if (ch === "$" && text[i + 1] === "$") {
      const end = findClosing(text, i + 2, "$$");
      if (end !== -1) {
        flush();
        const latex = text.slice(i + 2, end).trim();
        segments.push({
          type: "math",
          latex,
          displayMode: true,
          chem: /\\ce\{/.test(latex),
          source: "block",
        });
        i = end + 2;
        continue;
      }
    }

    // Inline math: $ … $
    //
    // A single `$` is ambiguous: it opens inline math AND it is the currency
    // symbol. Uploaded / refined content (where faculty never escaped anything)
    // routinely contains prose like "$1,400, $3,000, $4,200" — naively pairing
    // those dollars turns "1,400," and "3,000," into italic math spans and eats
    // the `$`/commas. So we only accept a `$…$` pair as math when its contents
    // actually LOOK like math (see {@link isInlineMathContent}); otherwise this
    // `$` falls through and is emitted as a literal character, and scanning
    // continues from the next one.
    if (ch === "$") {
      const end = findClosing(text, i + 1, "$");
      if (end !== -1) {
        const latex = text.slice(i + 1, end).trim();
        if (isInlineMathContent(latex)) {
          flush();
          segments.push({
            type: "math",
            latex,
            displayMode: false,
            chem: /\\ce\{/.test(latex),
            source: "inline",
          });
          i = end + 1;
          continue;
        }
        // Not math (a currency amount / plain prose) — leave this `$` literal.
      }
    }

    // Bare chemistry: \ce{ … } with brace matching (handles nested braces such as
    // `\ce{SO4^{2-}}`).
    if (text.startsWith("\\ce{", i)) {
      const end = matchBrace(text, i + 3); // index of the `{` after \ce
      if (end !== -1) {
        flush();
        const body = text.slice(i, end + 1); // includes `\ce{ … }`
        segments.push({
          type: "math",
          latex: body,
          displayMode: !shouldRenderInline(body),
          chem: true,
          source: "ce",
        });
        i = end + 1;
        continue;
      }
    }

    textBuf += ch;
    i += 1;
  }

  flush();
  return segments;
}

/**
 * True when `text` contains any math/chemistry span this module recognises. Lets
 * callers cheaply keep their existing plain-text path when there is no math at
 * all (guaranteeing byte-identical output for non-math content).
 */
export function hasLatex(text: string): boolean {
  if (!text) return false;
  return extractLatexSegments(text).some((s) => s.type === "math");
}

/**
 * Find the index where `delimiter` next occurs starting at `from`, skipping an
 * escaped `\$`. Returns -1 if not found (caller then treats the opener as literal).
 */
function findClosing(text: string, from: number, delimiter: "$" | "$$"): number {
  let i = from;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text.startsWith(delimiter, i)) return i;
    i += 1;
  }
  return -1;
}

/**
 * Decide whether the contents of a candidate `$…$` inline span are actually math,
 * as opposed to a bare currency amount that happens to sit between two dollar
 * signs ("$1,400, $3,000, …"). Only applies to the ambiguous SINGLE-`$` case —
 * `$$…$$` block math and bare `\ce{…}` are unambiguous and never routed here.
 *
 * `inner` is the already-trimmed text between the two dollars. It counts as math
 * when it carries at least one genuine math signal:
 *
 *   1. A structural LaTeX marker — a backslash command (`\cup`, `\frac`, `\{`),
 *      a superscript `^`, a subscript `_`, or a brace `{`/`}`. None of these ever
 *      occur inside a currency amount, so their presence is decisive.
 *   2. A lone variable / symbol — a short (≤3 char) token with no whitespace that
 *      contains a letter and isn't purely digits: "x", "n", "ab", "R". This keeps
 *      minimal real formulae like `$x$` and `$n$` rendering as math.
 *   3. A simple relation between symbols — an algebraic operator (`= < > + * / |`)
 *      together with a letter: "a = b", "x > 0", "a+b". The letter requirement is
 *      what keeps digit-only currency fragments ("5 + ", "1,400,") literal.
 *
 * Anything else — spans that are just digits, commas, spaces and prose words —
 * is rejected, so the dollars stay literal text.
 */
function isInlineMathContent(inner: string): boolean {
  const s = inner.trim();
  if (!s) return false;

  // 1. Unambiguous structural LaTeX markers.
  if (/[\\^_{}]/.test(s)) return true;

  // 2. A lone variable / symbol (e.g. "$x$", "$n$").
  if (!/\s/.test(s) && s.length <= 3 && /[a-zA-Z]/.test(s) && !/^[\d.,]+$/.test(s)) {
    return true;
  }

  // 3. A simple relation/operation between symbols (e.g. "$a = b$", "$x > 0$").
  if (/[=<>+*/|]/.test(s) && /[a-zA-Z]/.test(s)) return true;

  return false;
}

/** Given the index of an opening `{`, return the index of its matching `}`, or -1. */
function matchBrace(text: string, openBrace: number): number {
  if (text[openBrace] !== "{") return -1;
  let depth = 0;
  for (let i = openBrace; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i += 1; // skip escaped char
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Return the inner body of a lone `\ce{...}` snippet, or null if it isn't one. */
function extractCeContent(expr: string): string | null {
  const trimmed = expr.trim();
  if (!trimmed.startsWith("\\ce{")) return null;
  const end = matchBrace(trimmed, 3);
  if (end !== trimmed.length - 1) return null; // must be exactly one \ce{...}
  return trimmed.slice(4, end);
}

// ── Unsupported / risky-notation detection ───────────────────────────────────

/**
 * Detect math/chemistry notation that the shared renderer cannot render cleanly
 * (or that is structurally malformed) and so should be flagged for human review
 * rather than silently stored — where it would surface later as literal `$…$`
 * source or a render error in a generated paper/slide.
 *
 * This is deliberately GENERIC over every entry point (CSV rows, manual entry,
 * image-drafted questions) and every text field (question text, model answers).
 * It is pure/client-safe so the CSV preview, the manual-entry preview, and the
 * server-side persistence routes all share ONE definition of "needs review".
 *
 * Returns a short human-readable reason, or null when the notation is fine.
 *
 * What it flags (see {@link MATH_CHEM_NOTATION_GUIDE} for the taught, supported
 * subset):
 *   • An unclosed `$`/`$$` math delimiter — a `$` that never paired (a literal
 *     dollar must be escaped as `\$`), which breaks the whole span.
 *   • An unterminated `\ce{…}` chemistry span (missing closing brace).
 *   • A LaTeX environment (`\begin{matrix}`, `\begin{align}`, `\begin{array}`,
 *     tabular, …). Environments are outside the taught inline/block/`\ce`
 *     notation and are the exact "matrix / other environment" case that renders
 *     inconsistently across the KaTeX (screen) and MathJax (print) engines — a
 *     reviewer should confirm it before it ships.
 */
export function findUnsupportedNotation(text: string): string | null {
  if (!text) return null;
  const segments = extractLatexSegments(text);

  for (const seg of segments) {
    if (seg.type === "text") {
      // A `$` surviving in a plain-text segment means the segmenter could not
      // pair it into a math span → an unclosed delimiter. Escaped `\$` is
      // already converted to a literal by the segmenter, so it won't appear here.
      if (/(?<!\\)\$/.test(seg.value)) return "unclosed $ math delimiter";
      // Likewise a bare `\ce{` left in text means its braces never closed.
      if (/\\ce\{/.test(seg.value)) return "unterminated \\ce{…} span";
    } else {
      const env = seg.latex.match(/\\begin\{([a-zA-Z*]+)\}/);
      if (env) return `LaTeX environment \\begin{${env[1]}} needs review`;
    }
  }
  return null;
}

/**
 * True when ANY of the supplied text fields carries unsupported/malformed
 * notation. Convenience wrapper used by the persistence routes to decide the
 * needs-review (`is_verified = false`) flag across every entry point.
 */
export function hasUnsupportedNotation(
  ...texts: (string | null | undefined)[]
): boolean {
  return texts.some((t) => t != null && findUnsupportedNotation(t) != null);
}

// ── Shared notation cheat-sheet ──────────────────────────────────────────────

/**
 * The single source of truth for the math/chemistry notation convention.
 *
 * Import this into: AI prompt fragments, the CSV template documentation, and any
 * in-app help text. Keeping it a single exported constant guarantees "what we
 * tell faculty" can never drift from "what we tell the AI".
 */
export const MATH_CHEM_NOTATION_GUIDE = `MATH & CHEMISTRY NOTATION

Delimiters:
- Inline math (flows in a sentence): wrap in single dollar signs — $E = mc^2$
- Block / display math (its own line): wrap in double dollar signs — $$\\int_0^1 x^2\\,dx$$
- Chemistry: write \\ce{...} directly, with NO dollar signs — \\ce{H2SO4 -> H2O + SO3}

Math examples:
  Powers & indices : x^2, x_n, a_{ij}
  Fractions        : \\frac{a}{b}
  Roots            : \\sqrt{x}, \\sqrt[3]{x}
  Relations        : \\leq, \\geq, \\neq, \\approx
  Big operators    : \\sum_{i=1}^{n} i, \\prod_{k=1}^{n} k, \\int_a^b f(x)\\,dx
  Greek & vectors  : \\alpha, \\beta, \\theta, \\pi, \\vec{v}, \\hat{n}
  Set notation     : $\\{2, 3\\}$, $\\{x \\mid x > 0\\}$, $A \\cup B$, $\\emptyset$

Chemistry (\\ce{...}) examples:
  Species          : \\ce{H2O}, \\ce{CO2}
  Ions & charges   : \\ce{SO4^{2-}}, \\ce{Na+}
  Reactions        : \\ce{2H2 + O2 -> 2H2O}
  Conditions       : \\ce{CaCO3 ->[\\Delta] CaO + CO2}
  Equilibria       : \\ce{N2 + 3H2 <=> 2NH3}

Rules:
- Every inline math span must open AND close with a single $.
- Every block math span must open AND close with $$.
- Use \\ce{...} for ALL chemical formulae and equations; do NOT wrap \\ce{...} in dollar signs.
- Set-notation braces must ALWAYS be inside a math span and escaped: write $\\{2, 3\\}$, never a bare \\{2, 3\\} or {2, 3}. Bare braces break rendering.
- To write a literal dollar sign, escape it as \\$.`;
