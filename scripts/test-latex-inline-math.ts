/**
 * Regression battery for isInlineMathContent() in latexSegments.ts.
 *
 * History:
 *  - Originally added for rule 4 (hyphen-chain graph-cycle spans, "$A-B-C-D-E-A$").
 *  - Extended when the classifier's default was FLIPPED (Aug 2026): from
 *    "reject unless a positive math signal is found" to "accept any letter-bearing
 *    span as math UNLESS it matches a specific enumerated non-math shape". See the
 *    doc comment above isInlineMathContent() for the full rationale and the live-DB
 *    corpus evidence that justified the flip.
 *
 * There is no test framework in this repo (see CLAUDE.md); this is a
 * self-contained assertion runner, same convention as the other scripts/*.ts.
 * isInlineMathContent itself is not exported, so this drives it indirectly
 * through extractLatexSegments() — a `$...$` span becomes a "math" segment
 * iff isInlineMathContent(inner) returned true.
 *
 *   npx tsx scripts/test-latex-inline-math.ts
 *
 * Exit code 0 = all passed, 1 = at least one failure.
 */
import { extractLatexSegments } from "../src/lib/text/latexSegments";

function isMath(inner: string): boolean {
  const segs = extractLatexSegments(`$${inner}$`);
  return segs.length === 1 && segs[0].type === "math";
}

interface Case {
  input: string;
  expected: boolean;
  label: string;
}

const cases: Case[] = [
  // ── MUST return true: rule 1 structural markers (unchanged fast path) ──
  { input: "\\frac{a}{b}", expected: true, label: "rule1: \\frac" },
  { input: "x^2", expected: true, label: "rule1: superscript ^" },
  { input: "x_n", expected: true, label: "rule1: subscript _" },
  { input: "\\{2, 3\\}", expected: true, label: "rule1: braces {}" },
  { input: "0.34\\,mA", expected: true, label: "rule1: \\, thin-space (backslash present)" },
  { input: "0.7\\,V", expected: true, label: "rule1: \\,V (renders fine, the screenshot's control)" },

  // ── MUST return true: previously-working non-structural math (now via the flip) ──
  { input: "x", expected: true, label: "lone variable" },
  { input: "n", expected: true, label: "lone variable" },
  { input: "a = b", expected: true, label: "relation" },
  { input: "x > 0", expected: true, label: "relation" },
  { input: "a+b", expected: true, label: "relation" },
  { input: "A-B-C-D-E-A", expected: true, label: "graph cycle (old rule 4)" },
  { input: "u-v", expected: true, label: "edge notation (old rule 4)" },
  { input: "x-y-z", expected: true, label: "short hyphen chain (old rule 4)" },

  // ── MUST return true: the shapes this session's flip was built to fix ──
  // (1) bare quantity + unit — the SOEEC1010 Q Bank bug (Step 1 resolution).
  { input: "0.48 A", expected: true, label: "quantity+unit (SOEEC1010 MCQ option)" },
  { input: "2.4 A", expected: true, label: "quantity+unit" },
  { input: "24 A", expected: true, label: "quantity+unit (integer)" },
  { input: "0.34 mA", expected: true, label: "quantity+unit (the real 'mA' shape: space, no backslash)" },
  // (2) bare variable / prime lists — the Boolean-algebra question bug.
  { input: "A, B, C", expected: true, label: "variable list" },
  { input: "A', B', C'", expected: true, label: "prime variable list" },
  { input: "F(A, B, C)", expected: true, label: "function notation" },
  { input: "R(A, B, C, D)", expected: true, label: "relation notation" },
  { input: "A'BC", expected: true, label: "boolean term with prime" },
  { input: "ABC'", expected: true, label: "boolean term with trailing prime" },

  // ── MUST return false: currency / bare-number guards (no letter at all) ──
  { input: "1,400", expected: false, label: "bare currency number" },
  { input: "3,000", expected: false, label: "bare currency number" },
  { input: "4.50", expected: false, label: "bare decimal amount" },
  { input: "5 + ", expected: false, label: "digit-only fragment" },
  { input: "5-10", expected: false, label: "pure numeric range, no letter" },
  { input: "+5", expected: false, label: "signed number" },

  // ── MUST return true: lone math SYMBOL spans (no letter, but not a number) ──
  // Keyed on the number shape, not "no letter", so these are math. Rejecting "$*$"
  // would re-trigger the cascade on the real abstract-algebra row (see integration).
  { input: "*", expected: true, label: "lone binary-operation symbol (real: 'binary operation $*$')" },
  { input: "=", expected: true, label: "lone relation symbol" },
  { input: "(G, *)", expected: true, label: "symbol group, no bare-number shape" },

  // ── MUST return false: numeric-range + trailing word (the enumerated exception) ──
  // These carry a letter, so under the flip they are ONLY kept literal by the
  // explicit range-shape guard. See the adversarial pair below.
  { input: "3-5 kg", expected: false, label: "range+unit (must stay literal)" },
  { input: "10-15 students", expected: false, label: "range+word (must stay literal)" },
  { input: "5-10 marks", expected: false, label: "range+word (must stay literal)" },
  { input: "2.5-3.5 kg", expected: false, label: "decimal range+unit" },

  // ── ADVERSARIAL PAIR (explicit): distinguishable ONLY by the hyphen-range shape ──
  // Both are "number(s) + a trailing letter token"; the ONLY structural difference is
  // that the literal one is a RANGE (\d+-\d+). The guard must key on that, never on a
  // looser "number near a word" heuristic — which would wrongly swallow "0.48 A".
  { input: "0.48 A", expected: true, label: "ADVERSARIAL: single quantity+unit → MATH" },
  { input: "3-5 kg", expected: false, label: "ADVERSARIAL: numeric range+unit → LITERAL" },
];

let pass = 0;
let fail = 0;
console.log("input".padEnd(20), "expected".padEnd(10), "actual".padEnd(10), "result  label");
for (const c of cases) {
  const actual = isMath(c.input);
  const ok = actual === c.expected;
  if (ok) pass++;
  else fail++;
  console.log(
    JSON.stringify(c.input).padEnd(20),
    String(c.expected).padEnd(10),
    String(actual).padEnd(10),
    (ok ? "PASS" : "FAIL") + "    " + c.label,
  );
}

// ── Integration test: the cascade artifact must be gone ──────────────────────
// The flip's real payoff is not just that the three shapes classify as math — it is
// that accepting them RE-ALIGNS the delimiters so the cascading mispair (a rejected
// span swallowing the following prose AND the next math span into one giant literal)
// no longer happens. This drives the full segmenter on the exact stored SOEEC1010 /
// Boolean-algebra shape and asserts the prose stays TEXT while both math spans render.
console.log("\n── integration: cascade re-alignment ──");
interface SegCase {
  input: string;
  wantText: string[]; // substrings that MUST appear in some text segment
  wantMath: string[]; // exact inner latex values that MUST appear as math segments
  label: string;
}
const segCases: SegCase[] = [
  {
    input:
      "Given $F(A, B, C) = A'BC + AB'C + ABC'$, where $A', B', C'$ denote the complements of $A, B, C$ respectively.",
    wantText: ["Given ", ", where ", " denote the complements of ", " respectively."],
    wantMath: ["F(A, B, C) = A'BC + AB'C + ABC'", "A', B', C'", "A, B, C"],
    label: "Boolean-algebra cascade (verified repro)",
  },
  {
    input: "The current is $0.48 A$ and the voltage is $0.7\\,V$ here.",
    wantText: ["The current is ", " and the voltage is ", " here."],
    wantMath: ["0.48 A", "0.7\\,V"],
    label: "quantity+unit alongside \\,-unit (no cascade)",
  },
  {
    // Real IDSH2020 row e3f54808 — the lone "$*$" symbol span must NOT trigger a
    // cascade; every math span (incl. "$(G, *)$", "$a \\in G$") stays math and the
    // connective prose stays text.
    input:
      "a non-empty set $G$ equipped with a binary operation $*$ such that $(G, *)$ is a semigroup, and for every element $a \\in G$, there exists $e \\in G$.",
    wantText: [" equipped with a binary operation ", " such that ", " is a semigroup, and for every element ", ", there exists "],
    wantMath: ["G", "*", "(G, *)", "a \\in G", "e \\in G"],
    label: "lone-symbol $*$ cascade (verified repro, IDSH2020)",
  },
];
for (const sc of segCases) {
  const segs = extractLatexSegments(sc.input);
  const textBlob = segs.filter((s) => s.type === "text").map((s) => (s as { value: string }).value).join("");
  const mathInners = segs.filter((s) => s.type === "math").map((s) => (s as { latex: string }).latex);
  const textOk = sc.wantText.every((t) => textBlob.includes(t));
  const mathOk = sc.wantMath.every((m) => mathInners.includes(m));
  // Crucially, no prose fragment should have leaked INTO a math segment.
  const noProseInMath = !mathInners.some((m) =>
    /\b(where|denote|respectively|and the|here|such that|semigroup|exists|every element|equipped|operation)\b/.test(m),
  );
  const ok = textOk && mathOk && noProseInMath;
  if (ok) pass++;
  else fail++;
  console.log(
    (ok ? "PASS" : "FAIL") + "    " + sc.label,
    ok ? "" : `\n   textOk=${textOk} mathOk=${mathOk} noProseInMath=${noProseInMath}\n   math=${JSON.stringify(mathInners)}`,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
