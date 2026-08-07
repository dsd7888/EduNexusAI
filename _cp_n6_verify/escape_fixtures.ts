/**
 * CP-N6 Part 5.2 — FIXTURE half. No AI, no DB, free.
 *
 * Drives `repairGeminiJsonEscapes` with RAW response bodies carrying the Gemini
 * escape collision, and asserts the parsed result is exactly what the model
 * meant. Two halves, both required:
 *
 *   (A) CORRUPTED  — must be repaired, and must scan clean afterwards.
 *   (B) LEGITIMATE — real newlines/tabs/CRLF and already-correct LaTeX must
 *       survive BYTE-IDENTICAL. This half is the one that matters: a repair
 *       that fixes every corruption by mangling every worked example is worse
 *       than the bug.
 *
 * The nested-`$`-inside-`\text{}` case is called out separately because it is
 * the PRODUCTION failure mode (observed in lab_manual_cache), not a synthetic
 * one — and it is precisely the case the previous span-walking post-parse
 * repair could not fix.
 *
 *   npx tsx _cp_n6_verify/escape_fixtures.ts
 */
import {
  repairGeminiJsonEscapes,
  hasResidualControlChars,
  findEscapeCorruption,
} from "../src/lib/text/latexSegments";

let pass = 0;
let fail = 0;

/** `raw` is the body as Gemini emitted it; `want` is the intended string. */
function check(label: string, raw: string, want: string): void {
  let got: string;
  try {
    got = (JSON.parse(repairGeminiJsonEscapes(raw)) as { v: string }).v;
  } catch (e) {
    console.log(`  FAIL  ${label}\n          threw: ${(e as Error).message}`);
    fail++;
    return;
  }
  const residual = hasResidualControlChars(got);
  const hits = findEscapeCorruption(got);
  if (got === want && !residual && hits.length === 0) {
    pass++;
    console.log(`  PASS  ${label}`);
    return;
  }
  fail++;
  console.log(`  FAIL  ${label}`);
  console.log(`          want ${JSON.stringify(want)}`);
  console.log(`          got  ${JSON.stringify(got)}`);
  if (residual) console.log(`          residual control chars present`);
  if (hits.length) console.log(`          scanner hits: ${hits.map((h) => h.command).join(", ")}`);
}

console.log("── (A) CORRUPTED — the f/n/r/t/b/v sweep ──────────────────");
// One case per escape letter, using the commands actually seen in production.
check("\\frac (form-feed)", String.raw`{"v":"$I = \frac{dQ}{dt}$"}`, "$I = \\frac{dQ}{dt}$");
check("\\forall (form-feed)", String.raw`{"v":"$\forall x \in S$"}`, "$\\forall x \\in S$");
check("\\beta (backspace)", String.raw`{"v":"$\beta_0 + \beta_1 x$"}`, "$\\beta_0 + \\beta_1 x$");
check("\\bar (backspace)", String.raw`{"v":"$\bar{x}$"}`, "$\\bar{x}$");
check("\\begin (backspace)", String.raw`{"v":"$$\begin{bmatrix}1\end{bmatrix}$$"}`, "$$\\begin{bmatrix}1\\end{bmatrix}$$");
check("\\boxed (backspace)", String.raw`{"v":"$\boxed{V=IR}$"}`, "$\\boxed{V=IR}$");
check("\\nabla (newline)", String.raw`{"v":"$\nabla \cdot E = 0$"}`, "$\\nabla \\cdot E = 0$");
check("\\neq (newline)", String.raw`{"v":"$a \neq b$"}`, "$a \\neq b$");
check("\\nu (newline)", String.raw`{"v":"$\nu = 3$"}`, "$\\nu = 3$");
check("\\rho (carriage-return)", String.raw`{"v":"$\rho = m/V$"}`, "$\\rho = m/V$");
check("\\rightarrow (carriage-return)", String.raw`{"v":"\ce{2H2 + O2 \rightarrow 2H2O}"}`, "\\ce{2H2 + O2 \\rightarrow 2H2O}");
check("\\right (carriage-return)", String.raw`{"v":"$\left(\frac{a}{b}\right)$"}`, "$\\left(\\frac{a}{b}\\right)$");
check("\\theta (tab)", String.raw`{"v":"$\sin\theta = 0.5$"}`, "$\\sin\\theta = 0.5$");
check("\\times (tab)", String.raw`{"v":"$1.5 \times 10^5$"}`, "$1.5 \\times 10^5$");
check("\\text (tab)", String.raw`{"v":"$20\text{ kg/m}^3$"}`, "$20\\text{ kg/m}^3$");
check("\\vec (vertical-tab)", String.raw`{"v":"$\vec{F} = m\vec{a}$"}`, "$\\vec{F} = m\\vec{a}$");

console.log("\n── (A2) THE PRODUCTION FAILURE MODE — nested $ in \\text{} ──");
// Observed verbatim in lab_manual_cache 43bff754. The old span-walking repair
// closed its span at the INNER `$`, so the tab-corrupted \text landed "outside"
// every span and was left unrepaired even though the `$` count was even.
check(
  "composite wall — nested $ inside \\text{()}",
  String.raw`{"v":"$Q = UA\text{ }\text{($\text{T}_{hot} - \text{T}_{cold}$)}$"}`,
  "$Q = UA\\text{ }\\text{($\\text{T}_{hot} - \\text{T}_{cold}$)}$",
);
check(
  "thermal resistance — nested $ with \\frac",
  String.raw`{"v":"$R_i = \frac{(\text{T}_i - \text{T}_{i+1})}{Q_{exp}}$"}`,
  "$R_i = \\frac{(\\text{T}_i - \\text{T}_{i+1})}{Q_{exp}}$",
);
check(
  "overall coefficient — nested $ with \\frac + \\text",
  String.raw`{"v":"$U = \frac{1}{\text{R}_{total} A}$"}`,
  "$U = \\frac{1}{\\text{R}_{total} A}$",
);
check(
  "flow rate — \\rho and \\text in one span",
  String.raw`{"v":"$Q_{exp} = \rho \text{V} C_p (\text{T}_{out} - \text{T}_{in})$"}`,
  "$Q_{exp} = \\rho \\text{V} C_p (\\text{T}_{out} - \\text{T}_{in})$",
);
check(
  "mixed — model escaped SOME correctly in the same string",
  String.raw`{"v":"$I = \frac{12 \\text{ V}}{4 \\text{ \\Omega}} = 3\\text{ A}$"}`,
  "$I = \\frac{12 \\text{ V}}{4 \\text{ \\Omega}} = 3\\text{ A}$",
);

console.log("\n── (B) LEGITIMATE — must survive byte-identical ───────────");
check("real newline between steps", String.raw`{"v":"Step 1: find x.\nStep 2: solve."}`, "Step 1: find x.\nStep 2: solve.");
check("newline + lowercase 'then'", String.raw`{"v":"Integrate.\nthen simplify."}`, "Integrate.\nthen simplify.");
check("newline + 'under' (vs \\nu)", String.raw`{"v":"See fig.\nunder load"}`, "See fig.\nunder load");
check("newline + 'note' (vs \\not)", String.raw`{"v":"QED.\nnote the sign"}`, "QED.\nnote the sign");
check("newline + 'now' (vs \\nu)", String.raw`{"v":"Done.\nnow verify"}`, "Done.\nnow verify");
check("CR + 'hot' (vs \\rho)", String.raw`{"v":"inlet\rhot side"}`, "inlet\rhot side");
check("CR + 'result' (vs \\right)", String.raw`{"v":"x\rresult"}`, "x\rresult");
check("tab-indented code", String.raw`{"v":"def f(x):\n\treturn x + 1"}`, "def f(x):\n\treturn x + 1");
check("tab + 'total' (vs \\to)", String.raw`{"v":"Item\ttotal"}`, "Item\ttotal");
check("CRLF line ending", String.raw`{"v":"line one\r\nline two"}`, "line one\r\nline two");
check("already-correct \\frac", String.raw`{"v":"$\\frac{a}{b}$"}`, "$\\frac{a}{b}$");
check("already-correct \\theta", String.raw`{"v":"$\\theta + \\rho$"}`, "$\\theta + \\rho$");
check("escaped quotes", String.raw`{"v":"he said \"hi\""}`, 'he said "hi"');
check("unicode escape", String.raw`{"v":"café"}`, "café");
check("no backslash at all", String.raw`{"v":"plain prose, nothing to do"}`, "plain prose, nothing to do");

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
