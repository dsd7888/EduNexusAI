/**
 * CP-QC3 — regeneration modes, input caps, token budget, JSON extraction.
 *
 *   npx tsx _cp_qc3_verify/pure.ts > _cp_qc3_verify/run.log 2>&1
 *
 * No DB, no network, no AI spend.
 */
import {
  parseRegenerateMode,
  parseAlternativesCount,
  sanitizeCustomInstruction,
  regenerateMaxTokens,
  modeDirective,
  avoidDirective,
  MAX_ALTERNATIVES,
  MAX_CUSTOM_INSTRUCTION_CHARS,
} from "../src/lib/qpaper/regenerateModes";

let pass = 0;
let fail = 0;
function assert(cond: boolean, label: string) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL: ${label}`);
  }
}

// ─── Mode parsing: untrusted input must always land on a safe default ───────

{
  assert(parseRegenerateMode("same_topic") === "same_topic", "same_topic parses");
  assert(parseRegenerateMode("different_topic") === "different_topic", "different_topic parses");
  assert(parseRegenerateMode("custom") === "custom", "custom parses");
  assert(parseRegenerateMode(undefined) === "same_topic", "missing mode → historical default");
  assert(parseRegenerateMode("") === "same_topic", "empty mode → default");
  assert(parseRegenerateMode("DROP TABLE") === "same_topic", "garbage mode → default");
  assert(parseRegenerateMode(42) === "same_topic", "non-string mode → default");
  assert(parseRegenerateMode(null) === "same_topic", "null mode → default");
  assert(parseRegenerateMode("  custom  ") === "custom", "whitespace is trimmed");
}

// ─── Alternatives count: capped at both ends ───────────────────────────────

{
  assert(parseAlternativesCount(undefined) === 1, "absent → 1");
  assert(parseAlternativesCount(1) === 1, "1 → 1");
  assert(parseAlternativesCount(3) === 3, "3 → 3");
  assert(parseAlternativesCount(MAX_ALTERNATIVES) === MAX_ALTERNATIVES, "max is allowed");
  assert(parseAlternativesCount(999) === MAX_ALTERNATIVES, "over-max is clamped (cost + latency guard)");
  assert(parseAlternativesCount(0) === 1, "0 → 1");
  assert(parseAlternativesCount(-5) === 1, "negative → 1");
  assert(parseAlternativesCount("4") === 4, "numeric string parses");
  assert(parseAlternativesCount("abc") === 1, "garbage → 1");
  assert(parseAlternativesCount(NaN) === 1, "NaN → 1");
  // Non-finite input degrades to the CHEAPEST safe value, not the most
  // expensive one: garbage must never be read as "spend maximum tokens".
  assert(parseAlternativesCount(Infinity) === 1, "Infinity → 1, not max (cost guard)");
  assert(parseAlternativesCount(-Infinity) === 1, "-Infinity → 1");
  assert(parseAlternativesCount(2.9) === 2, "fractional is truncated");
}

// ─── Custom instruction sanitisation ───────────────────────────────────────

{
  assert(sanitizeCustomInstruction("Make it a pseudocode fill-in") === "Make it a pseudocode fill-in",
    "ordinary text passes through");
  assert(sanitizeCustomInstruction(undefined) === "", "absent → empty");
  assert(sanitizeCustomInstruction(null) === "", "null → empty");
  assert(sanitizeCustomInstruction("   ") === "", "whitespace-only → empty (drives the 400)");

  // Control characters would break the prompt's block structure.
  const ctrl = sanitizeCustomInstruction("line1\u0000\u001fline2\u007f");
  assert(!/[\u0000-\u001F\u007F]/.test(ctrl), "control characters are stripped");
  assert(ctrl.includes("line1") && ctrl.includes("line2"), "surrounding text is preserved");

  // Newlines collapse to spaces so the instruction can't forge new prompt blocks.
  const multi = sanitizeCustomInstruction("a\n\n\nb");
  assert(multi === "a b", `newlines collapse to a single space (got ${JSON.stringify(multi)})`);

  const long = sanitizeCustomInstruction("x".repeat(5000));
  assert(long.length === MAX_CUSTOM_INSTRUCTION_CHARS,
    `over-long input is capped at ${MAX_CUSTOM_INSTRUCTION_CHARS}`);
}

// ─── Token budget ──────────────────────────────────────────────────────────

{
  const one = regenerateMaxTokens(1);
  const five = regenerateMaxTokens(5);
  assert(one === 2048, `single question keeps the historical 2048 (got ${one})`);
  assert(five > one, "more alternatives → a bigger budget");
  assert(five <= 8192, "stays within the qpaper_gen ceiling");
  // The regression this guards: a flat 2048 truncates a 5-alternative array.
  assert(regenerateMaxTokens(5) >= 2048 * 2,
    "five alternatives get materially more room than one");
  assert(regenerateMaxTokens(0) === 2048, "degenerate 0 is treated as 1");
  for (let n = 1; n <= MAX_ALTERNATIVES; n++) {
    assert(Number.isFinite(regenerateMaxTokens(n)) && regenerateMaxTokens(n) > 0,
      `budget is sane at n=${n}`);
  }
}

// ─── Mode directives ───────────────────────────────────────────────────────

{
  const same = modeDirective("same_topic", "");
  const diff = modeDirective("different_topic", "");
  assert(/same underlying concept/i.test(same), "same_topic asks to keep the concept");
  assert(/DIFFERENT concept/.test(diff), "different_topic asks for a new concept");
  assert(same !== diff, "the two modes produce materially different instructions");

  // The historical <avoid> text asked for "a related topic", which actively
  // fights a different-topic request. The avoid block must be mode-aware.
  const avoidSame = avoidDirective("same_topic", "PREV");
  const avoidDiff = avoidDirective("different_topic", "PREV");
  assert(avoidSame !== avoidDiff, "avoid text adapts to the mode");
  assert(/concept/i.test(avoidDiff), "different_topic avoid bans reusing the concept, not just the wording");
  assert(avoidSame.includes("PREV") && avoidDiff.includes("PREV"), "both embed the previous question");

  // Custom instruction is embedded, and inside a labelled block so it reads as
  // a faculty request rather than a new system directive.
  const custom = modeDirective("custom", "Use a pseudocode fill-in-the-blank");
  assert(custom.includes("Use a pseudocode fill-in-the-blank"), "custom text is embedded");
  assert(custom.includes("<faculty_instruction>"), "custom text is fenced in a labelled block");

  // Very long previous text must not blow the prompt budget.
  const huge = avoidDirective("same_topic", "y".repeat(10000));
  assert(huge.length < 2000, `previous question is truncated (block is ${huge.length} chars)`);
}

// ─── extractJson — the array/object slicing bug ────────────────────────────
// Mirrors the route's local helper (a route module can't be imported under tsx
// without pulling in next/server). Kept behaviourally identical.

function extractJson(raw: string, wantArray: boolean): unknown {
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  const attempt = (open: string, close: string): unknown => {
    const first = cleaned.indexOf(open);
    const last = cleaned.lastIndexOf(close);
    if (first === -1 || last === -1 || last <= first) return undefined;
    try {
      return JSON.parse(cleaned.slice(first, last + 1));
    } catch {
      return undefined;
    }
  };
  const primary = wantArray ? attempt("[", "]") : attempt("{", "}");
  if (primary !== undefined) return primary;
  return wantArray ? attempt("{", "}") : attempt("[", "]");
}

{
  const obj = extractJson('{"question":"a"}', false) as Record<string, unknown>;
  assert(obj?.question === "a", "single object parses");

  const fenced = extractJson('```json\n{"question":"a"}\n```', false) as Record<string, unknown>;
  assert(fenced?.question === "a", "code fences are stripped");

  const prosed = extractJson('Here you go:\n{"question":"a"}\nHope that helps', false) as Record<string, unknown>;
  assert(prosed?.question === "a", "surrounding prose is ignored");

  // THE BUG: the old parser sliced first '{' to last '}'. On an array that
  // spans element 1's opening brace to element 3's closing brace, producing
  // either a parse error or a plausible-looking wrong object.
  const arrText = '[{"question":"a"},{"question":"b"},{"question":"c"}]';
  const oldStyle = (() => {
    const f = arrText.indexOf("{");
    const l = arrText.lastIndexOf("}");
    try { return JSON.parse(arrText.slice(f, l + 1)); } catch { return "PARSE_ERROR"; }
  })();
  assert(oldStyle === "PARSE_ERROR",
    "[REGRESSION] brace-slicing an array demonstrably fails");

  const arr = extractJson(arrText, true) as unknown[];
  assert(Array.isArray(arr) && arr.length === 3, "array parses with the right delimiters");
  assert((arr[2] as Record<string, unknown>).question === "c", "all elements survive");

  // Tolerance both ways: a formatting slip should not waste a paid call.
  const objWhenArrayWanted = extractJson('{"question":"a"}', true);
  assert(!Array.isArray(objWhenArrayWanted) && objWhenArrayWanted !== undefined,
    "an object returned when an array was asked for is still recovered");
  const arrWhenObjectWanted = extractJson(arrText, false);
  assert(arrWhenObjectWanted !== undefined,
    "an array returned when an object was asked for is still recovered");

  assert(extractJson("not json at all", false) === undefined, "unparseable → undefined");
  assert(extractJson("", false) === undefined, "empty → undefined");
  assert(extractJson("{", false) === undefined, "truncated → undefined");
  assert(extractJson("[]", true) !== undefined, "empty array parses (caller rejects it)");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("RESULT: FAIL");
  process.exit(1);
}
console.log("RESULT: PASS");
