/**
 * CP-QC5 — fenced-code support in markdownLite (the basis for open/custom
 * question formats such as pseudocode fill-in-the-logic).
 *
 *   npx tsx _cp_qc5_verify/pure.ts > _cp_qc5_verify/run.log 2>&1
 *
 * No DB, no network, no AI spend.
 */
import { parseMarkdownLite, type Segment } from "../src/lib/text/markdownLite";

let pass = 0;
let fail = 0;
function assert(cond: boolean, label: string) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL: ${label}`);
  }
}

const codeOf = (segs: Segment[]) =>
  segs.filter((s): s is Extract<Segment, { type: "code" }> => s.type === "code");

// ─── Basic fencing ──────────────────────────────────────────────────────────

{
  const segs = parseMarkdownLite("Before\n```\nline1\nline2\n```\nAfter");
  const code = codeOf(segs);
  assert(code.length === 1, "one code segment is produced");
  assert(code[0].content === "line1\nline2", "code content is exact");
  assert(segs[0].type === "text", "text before the fence is kept");
  assert(segs[segs.length - 1].type === "text", "text after the fence is kept");
}

{
  const segs = parseMarkdownLite("```pseudocode\nFOR i = 1 TO n\n```");
  assert(codeOf(segs)[0].language === "pseudocode", "language tag is captured");
  assert(parseMarkdownLite("```\nx\n```")[0].type === "code", "bare fence works");
  const noLang = codeOf(parseMarkdownLite("```\nx\n```"))[0];
  assert(noLang.language === null, "absent language is null, not empty string");
}

// ─── Indentation and blank lines are MEANING, not decoration ───────────────

{
  const src = [
    "```",
    "FUNCTION binarySearch(A, key)",
    "    lo = 0",
    "    WHILE lo <= hi DO",
    "        mid = (lo + hi) / 2",
    "",
    "        IF A[mid] == key THEN",
    "            RETURN mid",
    "```",
  ].join("\n");
  const c = codeOf(parseMarkdownLite(src))[0];
  assert(c.content.includes("    lo = 0"), "4-space indentation preserved");
  assert(c.content.includes("        mid = (lo + hi) / 2"), "8-space indentation preserved");
  assert(c.content.includes("\n\n"), "interior blank line preserved");
  assert(c.content.split("\n").length === 7, "no lines lost");
  // A pseudocode fill-in question is unanswerable if indentation collapses.
  assert(/^ {12}RETURN mid$/m.test(c.content), "deep indentation is exact");
}

{
  // Leading/trailing BLANK lines are trimmed, interior structure is not.
  const c = codeOf(parseMarkdownLite("```\n\n\nA\n\nB\n\n\n```"))[0];
  assert(c.content === "A\n\nB", `blank-line trim is edges-only (got ${JSON.stringify(c.content)})`);
}

// ─── Fences take precedence over tables and lists ──────────────────────────
// This is the whole reason fences are matched first: a listing routinely
// contains lines that look exactly like a table row or a bullet item.

{
  const src = "```\n| i | 0 | 1 |\n|---|---|---|\n| A | 3 | 5 |\n```";
  const segs = parseMarkdownLite(src);
  assert(segs.length === 1 && segs[0].type === "code",
    "a table-shaped listing inside a fence stays code, not a table");
  assert(codeOf(segs)[0].content.includes("|---|---|---|"),
    "the separator row is preserved verbatim rather than consumed");
}

{
  const segs = parseMarkdownLite("```\n- swap a, b\n- return a\n```");
  assert(segs.length === 1 && segs[0].type === "code",
    "bullet-shaped lines inside a fence stay code, not a list");
  assert(codeOf(segs)[0].content === "- swap a, b\n- return a", "bullets preserved verbatim");
}

{
  const segs = parseMarkdownLite("```\n1. first\n2. second\n```");
  assert(segs.length === 1 && segs[0].type === "code",
    "numbered-looking lines inside a fence stay code");
}

// ─── Tables and lists still work OUTSIDE fences (no regression) ────────────

{
  const segs = parseMarkdownLite("| a | b |\n|---|---|\n| 1 | 2 |");
  assert(segs.length === 1 && segs[0].type === "table", "a real table still parses");
}

{
  const segs = parseMarkdownLite("- one\n- two");
  assert(segs.length === 1 && segs[0].type === "list", "a real bullet list still parses");
}

{
  const segs = parseMarkdownLite("Just some prose.");
  assert(segs.length === 1 && segs[0].type === "text", "plain text is unchanged");
}

{
  assert(parseMarkdownLite("").length === 0, "empty input → no segments");
}

// ─── Malformed input must degrade, never throw ─────────────────────────────

{
  // Unterminated fence: the model forgot the closing ```. Must still yield a
  // code block rather than dumping raw backticks into a printed paper.
  const segs = parseMarkdownLite("```\nFOR i = 1 TO n\n    x = x + 1");
  const code = codeOf(segs);
  assert(code.length === 1, "unterminated fence still yields a code segment");
  assert(code[0].content.includes("FOR i = 1 TO n"), "its content is retained");
  assert(!JSON.stringify(segs).includes("```"), "no raw fence markers leak into output");
}

{
  const empty = parseMarkdownLite("```\n```");
  assert(empty.length === 1 && empty[0].type === "code", "empty fence is a code segment");
  assert(codeOf(empty)[0].content === "", "with empty content");
}

{
  const two = parseMarkdownLite("```\nA\n```\nmiddle\n```\nB\n```");
  const code = codeOf(two);
  assert(code.length === 2, "two fenced blocks in one string");
  assert(code[0].content === "A" && code[1].content === "B", "each keeps its own content");
  assert(two.some((s) => s.type === "text"), "the prose between them survives");
}

{
  // Mixed real content: prose, a fence, then a real list.
  const segs = parseMarkdownLite(
    "Complete the algorithm:\n```\nWHILE x < n DO\n    ____\n```\nThen answer:\n- What is the complexity?"
  );
  const kinds = segs.map((s) => s.type);
  assert(kinds.includes("code") && kinds.includes("list") && kinds.includes("text"),
    `all three block kinds coexist (got ${kinds.join(",")})`);
  assert(codeOf(segs)[0].content.includes("    ____"),
    "the blanked line keeps its indentation");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("RESULT: FAIL");
  process.exit(1);
}
console.log("RESULT: PASS");
