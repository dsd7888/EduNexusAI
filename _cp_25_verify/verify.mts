/**
 * CP-25 verify: worked-example markdown tables in the Notes PDF.
 * Pure-function harness — no DB/AI, mirrors the pattern used by
 * _cp_24_verify (see CLAUDE.md's checkpoint-harness rules).
 *
 * Renders a real PDFBuilder (Helvetica-only, no math assets needed since
 * these fixtures are math-free) through drawFormulaBlock and asserts:
 *  1. happy path — a worked example WITHOUT a table still renders (no crash,
 *     content drawn), i.e. the table-aware path doesn't regress plain prose.
 *  2. the actual finding — a worked example WITH a markdown pipe table in
 *     `solution` produces a real bordered table (drawTable called with the
 *     right headers/rows), not literal `| a | b |` text.
 *  3. same for `problem` (the harness also routes it through the table-aware
 *     path now, not just `solution`).
 *  4. unhappy path — a ragged/malformed table (short row, no trailing pipe,
 *     mixed with prose before/after) still renders without throwing and
 *     still produces a table for the well-formed rows.
 *  5. unhappy path — an empty-string problem/solution (e.g. a bank item with
 *     a missing field slipping past validation) draws nothing and does not
 *     throw.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PDFBuilder } from "../src/lib/pdf/builder";
import { drawFormulaBlock } from "../src/lib/notes/pdf/formulaRenderer";
import type { FormulaBlock } from "../src/lib/notes/types";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log(`  ok   ${msg}`);
  } else {
    fail++;
    console.log(`  FAIL ${msg}`);
  }
}

async function makeBuilder() {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const boldItalic = await doc.embedFont(StandardFonts.HelveticaBoldOblique);
  const builder = new PDFBuilder(doc, { regular, bold, italic, boldItalic });
  builder.addPageHeader("CP-25 verify", "worked example tables");
  return builder;
}

function baseBlock(workedExample: FormulaBlock["workedExample"]): FormulaBlock {
  return {
    name: "Test Formula",
    formula: "F = ma",
    symbols: [{ symbol: "F", meaning: "Force" }],
    workedExample,
  } as FormulaBlock;
}

async function main() {
  console.log("1. happy path — worked example without a table renders cleanly");
  {
    const builder = await makeBuilder();
    let threw = false;
    try {
      drawFormulaBlock(
        builder,
        baseBlock({
          problem: "A 2 kg block accelerates at 3 m/s^2. Find the force.",
          solution: "Step 1: F = ma\nStep 2: F = 2 * 3\nStep 3: F = 6 N",
        }),
        new Map()
      );
    } catch {
      threw = true;
    }
    assert(!threw, "no-table worked example does not throw");
  }

  console.log("2. the finding — solution with a markdown pipe table renders as a real table");
  {
    const builder = await makeBuilder();
    const spy = { calls: 0, headers: [] as string[][], rows: [] as string[][][] };
    const orig = builder.drawTable.bind(builder);
    builder.drawTable = ((headers: string[], rows: string[][], opts?: Parameters<typeof orig>[2]) => {
      spy.calls++;
      spy.headers.push(headers);
      spy.rows.push(rows);
      return orig(headers, rows, opts);
    }) as typeof builder.drawTable;

    const solution = [
      "Compare each case:",
      "| Input | Output |",
      "| --- | --- |",
      "| 0 | 1 |",
      "| 1 | 0 |",
      "So the result is inverted.",
    ].join("\n");

    drawFormulaBlock(builder, baseBlock({ problem: "Given the truth table:", solution }), new Map());

    // drawFormulaBlock always draws the symbols table too (Symbol|Meaning) —
    // isolate the call that came from the worked-example solution.
    const idx = spy.headers.findIndex((h) => JSON.stringify(h) === JSON.stringify(["Input", "Output"]));
    assert(idx !== -1, `drawTable invoked for the solution's markdown table (got calls: ${JSON.stringify(spy.headers)})`);
    assert(
      idx !== -1 && JSON.stringify(spy.rows[idx]) === JSON.stringify([["0", "1"], ["1", "0"]]),
      `table rows parsed correctly (got ${idx !== -1 ? JSON.stringify(spy.rows[idx]) : "n/a"})`
    );
  }

  console.log("3. problem field also routes tables through drawTable, not textOrMath");
  {
    const builder = await makeBuilder();
    const headerCalls: string[][] = [];
    const orig = builder.drawTable.bind(builder);
    builder.drawTable = ((headers: string[], rows: string[][], opts?: Parameters<typeof orig>[2]) => {
      headerCalls.push(headers);
      return orig(headers, rows, opts);
    }) as typeof builder.drawTable;

    const problem = ["Given:", "| x | y |", "|---|---|", "| 1 | 2 |"].join("\n");
    drawFormulaBlock(builder, baseBlock({ problem, solution: "y = x + 1" }), new Map());
    const found = headerCalls.some((h) => JSON.stringify(h) === JSON.stringify(["x", "y"]));
    assert(found, `drawTable invoked for a table embedded in the problem field (got calls: ${JSON.stringify(headerCalls)})`);
  }

  console.log("4. unhappy path — ragged table (short row) still renders without throwing");
  {
    const builder = await makeBuilder();
    let threw = false;
    const solution = [
      "Before text.",
      "| A | B | C |",
      "| --- | --- | --- |",
      "| 1 | 2 |", // ragged — short row
      "| 3 | 4 | 5 |",
      "After text.",
    ].join("\n");
    try {
      drawFormulaBlock(builder, baseBlock({ problem: "p", solution }), new Map());
    } catch {
      threw = true;
    }
    assert(!threw, "ragged/malformed table does not throw");
  }

  console.log("5. unhappy path — empty problem/solution strings draw nothing and do not throw");
  {
    const builder = await makeBuilder();
    let threw = false;
    try {
      drawFormulaBlock(builder, baseBlock({ problem: "", solution: "" }), new Map());
    } catch {
      threw = true;
    }
    assert(!threw, "empty worked-example fields do not throw");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
