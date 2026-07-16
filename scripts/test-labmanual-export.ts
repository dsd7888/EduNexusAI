/**
 * Checkpoint-5 export harness.
 *
 * Renders all three variants × both formats from a synthetic doc whose faculty-
 * only fields carry DISTINCTIVE marker strings, then extracts the RENDERED text
 * of each artifact (docx via its XML, pdf via the content stream) and asserts:
 *   - student  : NEVER contains the solution or conduct markers (spec §8/§9.5)
 *   - instructor: contains the conduct marker, NEVER the solution marker
 *   - solutions : contains the solution marker
 * This is the rendered-text check the spec demands — not a re-run of the code
 * assertion (that runs too, inside buildExportModel). Files are written to the
 * scratchpad for visual inspection.
 *
 *   npx tsx scripts/test-labmanual-export.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync, inflateRawSync } from "node:zlib";
import AdmZip from "adm-zip";

const OUT = "/private/tmp/claude-501/-Users-dhruvdakhara-Desktop-EduNexusAI/b89f0d9c-35e7-44f6-ae88-e6a304113235/scratchpad/exports";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── distinctive markers ──────────────────────────────────────────────────────
const SOLUTION_MARKER = "ZZSOLUTIONSECRETXX";
const CONDUCT_MARKER = "ZZCONDUCTSECRETXX";
const STUDENT_MARKER = "QQSTUDENTTHEORYXX";

function makeSection(practicalNo: number, kind: "code_scaffold" | "procedure_scaffold") {
  return {
    practicalNo,
    title: `Test Practical ${practicalNo}`,
    hours: 2,
    difficulty: "standard" as const,
    aim: `Aim of practical ${practicalNo}`,
    objectives: ["Objective one", "Objective two"],
    coCodes: ["CO1", "CO2"],
    btl: 3,
    prereqChecks: ["Prereq A?", "Prereq B?"],
    theory: `Theory ${STUDENT_MARKER}. The rate is $Q = -kA\\frac{dT}{dx}$ and \\ce{H2O}.`,
    workedExample: "arr=[1,3,5,7], target=5 -> mid=1 -> found at index 2.",
    scaffold: {
      kind,
      language: kind === "code_scaffold" ? "python" : null,
      body:
        kind === "code_scaffold"
          ? "def f(a, t):\n    lo, hi = 0, len(a)-1\n    while lo <= hi:\n        mid = TODO(1)\n        # a very long comment line intended to exceed the mono column width so we can verify hard wrapping does not run off the page edge at all\n        if a[mid] == t: return mid\n    return -1"
          : "1. Assemble the apparatus.\n2. Record readings T1..T6.\n3. Compute TODO(1).",
      gaps: [{ n: 1, hint: "Compute midpoint", learn: "midpoint arithmetic" }],
    },
    solution: `def f(a,t):\n    # ${SOLUTION_MARKER}\n    mid=(lo+hi)//2\n    return mid`,
    expectedOutput: "2",
    commonErrors: [
      { error: "IndexError", meaning: "hi set to len(a)" },
      { error: "Infinite loop", meaning: "pointer not moved" },
      { error: "Off by one", meaning: "wrong bound" },
    ],
    extensions: [
      { level: "basic" as const, statement: "First occurrence", expected: "index" },
      { level: "stretch" as const, statement: "Rotated array", expected: "index" },
    ],
    viva: Array.from({ length: 6 }, (_, i) => ({ q: `Question ${i + 1}?`, hint: `hint ${i + 1}` })),
    rubric: [
      { criterion: "Implementation", marks: 4 },
      { criterion: "Understanding", marks: 3 },
      { criterion: "Output", marks: 3 },
    ],
    conductGuide: {
      opener: `Open the slot ${CONDUCT_MARKER}.`,
      hintRelease: "Release gap 1 at minute 20.",
      checkpoints: ["By minute 30, ask why lo<=hi.", "By minute 45, ask about overflow."],
      deliberateMistake: "Let them write lo=mid and hang.",
      wrapUp: "Tie back to CO1.",
    },
  };
}

/** Text of a .docx: unzip, read word/document.xml, strip tags. */
function docxText(buf: Buffer): string {
  const zip = new AdmZip(buf);
  const xml = zip.getEntry("word/document.xml")?.getData().toString("utf8") ?? "";
  return xml.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

/**
 * Text of a .pdf. pdf-lib Flate-compresses content streams, so this inflates
 * every `stream…endstream`, then pulls the literal strings drawn by Tj/TJ. This
 * is genuine RENDERED text (what a viewer shows), not the source blocks.
 */
function pdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const chunks: string[] = [raw]; // include raw for any uncompressed streams
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const bytes = Buffer.from(m[1], "latin1");
    for (const fn of [inflateSync, inflateRawSync]) {
      try {
        chunks.push(fn(bytes).toString("latin1"));
        break;
      } catch {
        /* not this filter */
      }
    }
  }
  // pdf-lib draws text as HEX strings before Tj: `<48656C6C6F> Tj`. Also handle
  // the literal `(…) Tj` form for completeness.
  const decoded = chunks.join("\n");
  const text: string[] = [];
  let t: RegExpExecArray | null;
  const hex = /<([0-9A-Fa-f\s]+)>\s*Tj/g;
  while ((t = hex.exec(decoded)) !== null) {
    const h = t[1].replace(/\s+/g, "");
    let s = "";
    for (let k = 0; k + 1 < h.length; k += 2) s += String.fromCharCode(parseInt(h.slice(k, k + 2), 16));
    text.push(s);
  }
  const lit = /\(((?:\\.|[^()\\])*)\)\s*Tj/g;
  while ((t = lit.exec(decoded)) !== null) {
    text.push(t[1].replace(/\\([()\\])/g, "$1").replace(/\\(\d{3})/g, (_x, o) => String.fromCharCode(parseInt(o, 8))));
  }
  return text.join(" ");
}

async function main() {
  const { buildExportModel } = await import("@/lib/labmanual/exportShared");
  const { generateLabManualDocx } = await import("@/lib/labmanual/docxBuilder");
  const { generateLabManualPdf } = await import("@/lib/labmanual/pdfBuilder");

  mkdirSync(OUT, { recursive: true });

  const doc = {
    path: {
      units: [{ unitNo: 1, name: "Unit One", practicalNos: [1, 2], rationale: "r" }],
      bridges: [
        { afterPracticalNo: 1, title: "Bridge exercise", statement: "Try this.", expected: "done" },
      ],
      approved: true,
    },
    sections: [makeSection(1, "code_scaffold"), makeSection(2, "procedure_scaffold")],
    practicalStates: {
      1: { reviewed: true, difficulty: "standard" as const },
      2: { reviewed: true, difficulty: "standard" as const },
    },
    language: "python" as string | null,
  };

  const header = {
    university: "P. P. Savani University",
    school: "School of Engineering",
    department: "Engineering",
    courseCode: "TEST101",
    courseName: "Export Test Subject",
    facultyName: "Test Faculty",
    semester: "Semester 3",
    academicYear: "2026-2027",
  };

  const variants = ["student", "instructor", "solutions"] as const;

  for (const variant of variants) {
    console.log(`\n── ${variant.toUpperCase()} ──`);
    const model = buildExportModel(doc, header, variant, "all");
    const docxBuf = await generateLabManualDocx(model);
    const pdfBuf = await generateLabManualPdf(model);
    writeFileSync(resolve(OUT, `${variant}.docx`), docxBuf);
    writeFileSync(resolve(OUT, `${variant}.pdf`), pdfBuf);

    const dText = docxText(docxBuf);
    const pText = pdfText(pdfBuf);

    check(`${variant} docx is a valid zip with content`, dText.length > 200);
    check(`${variant} pdf starts with %PDF`, pdfBuf.toString("latin1", 0, 5) === "%PDF-");
    check(`${variant} pdf/docx both contain the student theory marker`, dText.includes(STUDENT_MARKER) === (variant !== "solutions"));

    if (variant === "student") {
      // THE load-bearing assertion — rendered text, both formats.
      check("student docx has NO solution marker", !dText.includes(SOLUTION_MARKER), "LEAK");
      check("student docx has NO conduct marker", !dText.includes(CONDUCT_MARKER), "LEAK");
      check("student pdf has NO solution marker", !pText.includes(SOLUTION_MARKER), "LEAK");
      check("student pdf has NO conduct marker", !pText.includes(CONDUCT_MARKER), "LEAK");
      check("student docx has certificate text", dText.includes("satisfactorily completed"));
      check("student docx has observation region", dText.toLowerCase().includes("observation"));
    }
    if (variant === "instructor") {
      check("instructor docx HAS conduct marker", dText.includes(CONDUCT_MARKER));
      check("instructor docx has NO solution marker (solutions are separate)", !dText.includes(SOLUTION_MARKER), "LEAK");
      check("instructor pdf HAS conduct marker", pText.includes(CONDUCT_MARKER));
      check("instructor pdf has NO solution marker", !pText.includes(SOLUTION_MARKER), "LEAK");
      check("instructor docx has NO certificate (faculty copy)", !dText.includes("satisfactorily completed"));
    }
    if (variant === "solutions") {
      check("solutions docx HAS solution marker", dText.includes(SOLUTION_MARKER));
      check("solutions pdf HAS solution marker", pText.includes(SOLUTION_MARKER));
      check("solutions docx has NO conduct marker", !dText.includes(CONDUCT_MARKER));
      check("solutions has CONFIDENTIAL cover", dText.includes("CONFIDENTIAL"));
    }

    // math readability: the raw LaTeX command must NOT survive into the doc text
    check(`${variant} docx has no raw \\frac command`, !dText.includes("\\frac"));
  }

  // ── single-practical export: no cover/certificate/contents ─────────────────
  console.log("\n── SINGLE-PRACTICAL (student, p1) ──");
  const single = buildExportModel(doc, header, "student", 1);
  const singleDocx = await generateLabManualDocx(single);
  const sText = docxText(singleDocx);
  check("single export has NO certificate", !sText.includes("satisfactorily completed"));
  check("single export has NO contents table title", !sText.includes("CONTENTS"));
  check("single export still has the practical heading", sText.includes("PRACTICAL 1"));
  check("single export still excludes the solution marker", !sText.includes(SOLUTION_MARKER));

  // ── the code assertion fires when a faculty block is forced into student ───
  console.log("\n── leak assertion (forced) ──");
  try {
    const { assertNoFacultyLeak } = await import("@/lib/labmanual/exportShared");
    // A realistic leak: the ACTUAL solution text rendered into a student block.
    assertNoFacultyLeak(
      [{ kind: "mono", text: doc.sections[0].solution }],
      doc,
      "all",
    );
    check("assertNoFacultyLeak THROWS on a forced leak", false, "did not throw");
  } catch {
    check("assertNoFacultyLeak THROWS on a forced leak", true);
  }
  // …and does NOT false-positive on legitimate student content.
  try {
    const { assertNoFacultyLeak } = await import("@/lib/labmanual/exportShared");
    assertNoFacultyLeak([{ kind: "para", text: "Theory about binary search." }], doc, "all");
    check("assertNoFacultyLeak does NOT throw on clean student content", true);
  } catch {
    check("assertNoFacultyLeak does NOT throw on clean student content", false, "false positive");
  }

  console.log(`\nFiles written to: ${OUT}`);
  console.log(`\n══════════ lab-manual export: ${passed} passed, ${failed} failed ══════════\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Harness failed:", e);
  process.exit(1);
});
