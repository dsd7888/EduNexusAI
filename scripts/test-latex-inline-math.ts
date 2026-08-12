/**
 * Regression battery for isInlineMathContent() in latexSegments.ts — in
 * particular its rule 4 (hyphen-chain spans like graph-cycle notation), added
 * to fix "$A-B-C-D-E-A$" rendering as literal text instead of KaTeX.
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
  // MUST now return true (the fix)
  { input: "A-B-C-D-E-A", expected: true, label: "the exact broken case (graph cycle)" },
  { input: "u-v", expected: true, label: "edge notation" },
  { input: "x-y-z", expected: true, label: "short hyphen chain" },

  // MUST still return true (no regression — already-working math)
  { input: "x", expected: true, label: "lone variable" },
  { input: "n", expected: true, label: "lone variable" },
  { input: "a = b", expected: true, label: "relation" },
  { input: "x > 0", expected: true, label: "relation" },
  { input: "a+b", expected: true, label: "relation" },
  { input: "\\frac{a}{b}", expected: true, label: "structural marker \\frac" },
  { input: "x^2", expected: true, label: "structural marker ^" },
  { input: "x_n", expected: true, label: "structural marker _" },
  { input: "\\{2, 3\\}", expected: true, label: "structural marker {}" },

  // MUST still return false (currency/range guards)
  { input: "1,400", expected: false, label: "bare currency number" },
  { input: "3,000", expected: false, label: "bare currency number" },
  { input: "5 + ", expected: false, label: "digit-only fragment (rule-3 comment example)" },
  { input: "5-10", expected: false, label: "pure numeric range, no letter" },
  { input: "3-5 kg", expected: false, label: "digit range + unit word (the false-positive trap)" },
  { input: "10-15 students", expected: false, label: "digit range + unit word (the false-positive trap)" },
  { input: "5-10 marks", expected: false, label: "digit range + unit word (the false-positive trap)" },
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
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
