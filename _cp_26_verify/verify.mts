/**
 * CP-26 verify: Q Paper PDF page-break orphaning.
 *
 * Black-box harness against the real `generatePPSUPaperPDF` export (no
 * internal functions are exported for this one) — builds an `AssembledPaper`
 * with a variable amount of filler content followed by one "target" MCQ
 * question whose first sub-part is deliberately large (long wrapped text +
 * all four options), then renders a real PDF and inspects which page each
 * marker string landed on by decompressing each page's content stream and
 * decoding the hex-string `Tj`/`TJ` show-text operators pdf-lib emits for
 * standard fonts — no new PDF-reading dependency needed, pdf-lib's own
 * `PDFDocument.load` + node's built-in `zlib` are enough.
 *
 * The core assertion — "a question header's page number always equals its
 * first sub-part's page number" — is swept across filler counts 0..60 so it
 * crosses the danger zone (header fits near the bottom margin, but header +
 * first sub-part together don't) many times over, not just once by luck.
 *
 * This was additionally confirmed manually against the pre-fix code
 * (`git show ebad038:src/lib/qpaper/builder.ts`, the commit before CP-26's
 * WIP fix `a8330e7`): the same sweep produces at least one split (header on
 * one page, first option on the next) against the old code and zero splits
 * against the fixed code — see .claude/logs-fix/CP-26.log for that
 * comparison's output. The committed harness below only asserts the
 * post-fix invariant, since that's the regression guard that matters going
 * forward.
 */
import { generatePPSUPaperPDF } from "../src/lib/qpaper/builder";
import type { AssembledPaper } from "../src/lib/qpaper/builder";
import { PDFArray, PDFDocument, PDFRef, PDFStream } from "pdf-lib";
import zlib from "zlib";

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

function hexToAscii(hex: string): string {
  let out = "";
  for (let i = 0; i + 1 < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
}

/** Decoded text (hex-string show operators only, sufficient for our markers) per page. */
async function extractPageTexts(bytes: Buffer): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const page of doc.getPages()) {
    const contentsRef = page.node.Contents();
    if (!contentsRef) continue;
    const refs: (PDFRef | PDFStream)[] =
      contentsRef instanceof PDFArray
        ? (contentsRef.asArray() as (PDFRef | PDFStream)[])
        : [contentsRef];
    let combined = "";
    for (const ref of refs) {
      const obj = (ref instanceof PDFRef ? doc.context.lookup(ref) : ref) as unknown as {
        contents: Uint8Array;
      };
      let text: string;
      try {
        text = zlib.inflateSync(obj.contents).toString("latin1");
      } catch {
        text = Buffer.from(obj.contents).toString("latin1");
      }
      const hexMatches = text.match(/<([0-9A-Fa-f]+)>/g) ?? [];
      combined += hexMatches.map((h) => hexToAscii(h.slice(1, -1))).join("");
    }
    out.push(combined);
  }
  return out;
}

function pageIndexOf(pageTexts: string[], marker: string): number {
  return pageTexts.findIndex((t) => t.includes(marker));
}

function basePaper(
  filler: number,
  targetLabel: string,
  targetSubMarker: string,
  targetLastOptionMarker = "TARGETOPTDMARK"
): AssembledPaper {
  const fillerQuestions = Array.from({ length: filler }, (_, i) => ({
    q_number: i + 1,
    display_label: `Q - ${i + 1}`,
    type: "mcq",
    total_marks: 2,
    sub_parts: [{ label: "i)", question: `Filler question body number ${i + 1}.` }],
  }));

  const longOption = (k: string) =>
    `Option ${k}: a long wrapped answer choice that spans enough words to occupy more than one line of the rendered PDF page so the estimated sub-part height is non-trivial.`;

  const targetQuestion = {
    q_number: 9999,
    display_label: targetLabel,
    type: "mcq",
    total_marks: 2,
    sub_parts: [
      {
        label: "i)",
        question: `${targetSubMarker} A deliberately long first sub-part question stem that wraps across several lines by itself before any of its four options are even considered, to push its estimated height well past a single header row.`,
        options: {
          a: longOption("a"),
          b: longOption("b"),
          c: longOption("c"),
          d: `${targetLastOptionMarker} ${longOption("d")}`,
        },
      },
    ],
  };

  return {
    universityName: "CP-26 Verify University",
    examTitle: "Verify Exam",
    courseCode: "CP26",
    courseName: "Page Break Orphaning",
    duration: 60,
    totalMarks: 100,
    instructions: ["Answer all questions."],
    sections: [
      {
        section_name: "Section A",
        questions: [...fillerQuestions, targetQuestion],
      },
    ],
  } as unknown as AssembledPaper;
}

async function main() {
  console.log("1. sweep filler counts 0..60 — header page must equal first sub-part's page AND its last option's page");
  let sawSplit = false;
  let sawSamePage = false;
  for (let filler = 0; filler <= 60; filler++) {
    const headerMarker = "TARGETHEADERMARK";
    const subMarker = "TARGETSUBMARK";
    const optMarker = "TARGETOPTDMARK";
    const paper = basePaper(filler, headerMarker, subMarker, optMarker);
    const bytes = await generatePPSUPaperPDF(paper);
    const pageTexts = await extractPageTexts(bytes);
    const headerPage = pageIndexOf(pageTexts, headerMarker);
    const subPage = pageIndexOf(pageTexts, subMarker);
    const optPage = pageIndexOf(pageTexts, optMarker);
    assert(headerPage !== -1, `filler=${filler}: header marker found in output`);
    assert(subPage !== -1, `filler=${filler}: sub-part marker found in output`);
    assert(optPage !== -1, `filler=${filler}: last-option marker found in output`);
    if (headerPage !== subPage || headerPage !== optPage) sawSplit = true;
    if (headerPage === subPage && headerPage === optPage && headerPage !== -1) sawSamePage = true;
    assert(
      headerPage === subPage && headerPage === optPage,
      `filler=${filler}: header page (${headerPage}) === first sub-part page (${subPage}) === last-option page (${optPage})`
    );
  }
  assert(!sawSplit, "no filler count in the sweep split a header from its first sub-part");
  assert(sawSamePage, "sanity: at least one run actually rendered both markers (extraction isn't silently broken)");

  console.log("\n2. unhappy path — interrupted-looking input: a question with an empty sub_parts array doesn't throw");
  {
    const paper = basePaper(5, "EMPTYHEADERMARK", "unused");
    (paper.sections[0].questions[1] as { sub_parts: unknown[] }).sub_parts = [];
    let threw = false;
    try {
      await generatePPSUPaperPDF(paper);
    } catch {
      threw = true;
    }
    assert(!threw, "MCQ question with zero sub_parts renders without throwing");
  }

  console.log("\n3. unhappy path — two concurrent generatePPSUPaperPDF calls on different papers don't cross-contaminate pages");
  {
    const [bytesA, bytesB] = await Promise.all([
      generatePPSUPaperPDF(basePaper(3, "CONCURRENT_A_HEADER", "CONCURRENT_A_SUB")),
      generatePPSUPaperPDF(basePaper(30, "CONCURRENT_B_HEADER", "CONCURRENT_B_SUB")),
    ]);
    const textsA = await extractPageTexts(bytesA);
    const textsB = await extractPageTexts(bytesB);
    const aHasB = textsA.some((t) => t.includes("CONCURRENT_B_HEADER"));
    const bHasA = textsB.some((t) => t.includes("CONCURRENT_A_HEADER"));
    assert(!aHasB && !bHasA, "concurrent PDF builds do not leak content across each other (no shared mutable module state)");
    const aHeader = pageIndexOf(textsA, "CONCURRENT_A_HEADER");
    const aSub = pageIndexOf(textsA, "CONCURRENT_A_SUB");
    const bHeader = pageIndexOf(textsB, "CONCURRENT_B_HEADER");
    const bSub = pageIndexOf(textsB, "CONCURRENT_B_SUB");
    assert(aHeader === aSub, "concurrent run A: header/sub-part still keep-with-next together");
    assert(bHeader === bSub, "concurrent run B: header/sub-part still keep-with-next together");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
