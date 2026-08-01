/**
 * CP-N5 harness 2 — the math pre-pass, unit-level (no server, no DB).
 *
 * Validates the two load-bearing behaviours of notesMath.ts: the pre-pass
 * actually renders every span it finds, and {@link withMathDelimiters} fires on
 * a bare `symbols[].unit` control sequence BEFORE extraction — the exact CP-N4
 * gap (`\Omega` rendering as literal text in the Unit column) this checkpoint
 * carries forward into print.
 *
 * KEYS ARE THE DELIMITER-STRIPPED LATEX, NOT THE SOURCE `$…$` STRING. The map
 * is keyed by `mathKey(latex, displayMode)` (paperMath.ts's own convention),
 * where `latex` is what `extractLatexSegments` returns AFTER stripping the `$`
 * fence — e.g. the span written as `$V = IR$` in source is keyed `"I:V = IR"`,
 * never `"I:$V = IR$"`. Asserting against the literal source string would fail
 * for a reason that has nothing to do with whether the pre-pass worked.
 *
 * Run: npx tsx _cp_n5_verify/math_prepass.ts > /tmp/cpn5_math.log 2>&1
 */
import { collectNotesMathSpans, prerenderNotesMath } from "@/lib/notes/pdf/notesMath";
import { mathKey } from "@/lib/qpaper/paperMath";
import type { EnrichedNoteBlock } from "@/lib/notes/pyq-frequency";

import { loadEnvLocal, makeChecker, hr, sub } from "./shared";

loadEnvLocal();

async function main() {
  const { check, summary } = makeChecker();

  hr("CP-N5 harness 2 — math_prepass");

  // A formula whose formula field is already delimited, and a symbol whose
  // unit is NOT — the exact real-world shape (SOEEC1010's early formula
  // blocks) that first surfaced the gap in CP-N4.
  const blocks: EnrichedNoteBlock[] = [
    {
      kind: "formula",
      id: "formula-test-ohms-law",
      name: "Test — Ohm's Law",
      formula: "$V = IR$",
      symbols: [{ symbol: "R", meaning: "Resistance", unit: "\\Omega" }],
    },
  ];

  sub("collectNotesMathSpans — the delimiter-repaired unit is found");
  const spans = collectNotesMathSpans(blocks);
  check("returns an array", Array.isArray(spans), `${typeof spans}`);
  check(
    "includes the formula's span ('V = IR')",
    spans.includes("V = IR"),
    JSON.stringify(spans)
  );
  check(
    "includes the bare-unit span ('\\Omega') — withMathDelimiters applied before scanning",
    spans.includes("\\Omega"),
    JSON.stringify(spans)
  );

  sub("prerenderNotesMath — renders without throwing, never a rejected promise");
  let map: Awaited<ReturnType<typeof prerenderNotesMath>> | null = null;
  let threw: unknown = null;
  try {
    map = await prerenderNotesMath(blocks);
  } catch (err) {
    threw = err;
  }
  check("did not throw", threw === null, threw ? String(threw) : "");
  check("returns a Map", map instanceof Map, map ? map.constructor.name : "null");

  if (map) {
    const formulaAsset = map.get(mathKey("V = IR", false));
    check(
      "map has a rendered asset for the formula span",
      Boolean(formulaAsset),
      formulaAsset ? `${formulaAsset.buffer.length} bytes` : "missing"
    );
    check(
      "formula asset's buffer is non-empty",
      Boolean(formulaAsset && formulaAsset.buffer.length > 0),
      formulaAsset ? `${formulaAsset.buffer.length} bytes` : "n/a"
    );

    const unitAsset = map.get(mathKey("\\Omega", false));
    check(
      "map has a rendered asset for the delimiter-repaired unit span",
      Boolean(unitAsset),
      unitAsset ? `${unitAsset.buffer.length} bytes` : "missing"
    );
    check(
      "unit asset's buffer is non-empty",
      Boolean(unitAsset && unitAsset.buffer.length > 0),
      unitAsset ? `${unitAsset.buffer.length} bytes` : "n/a"
    );
  }

  const { passed, failed } = summary();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
