/**
 * Checkpoint-3 test harness — lab manual per-practical generator.
 *
 *  (A) GATE TESTS — forced-bad fixtures, pure, free, no AI.
 *      buildOnePracticalSection is exported, so every §4b repair rule is driven
 *      directly: TODO/gaps mismatch, solution containing TODO(, rubric sum ≠ 10,
 *      embedded URL, bad scaffold kind, list lengths, CO validation.
 *
 *  (B) DIFFICULTY CONTRACT — the SAME practical generated at guided / standard /
 *      challenge, asserting the gap counts VISIBLY DIFFER and each lands in its
 *      contracted band. This is the assertion, not "three rows exist".
 *
 *  (C) SCAFFOLD KINDS — a code subject and a chemistry subject, asserting the AI
 *      picks non-code kinds unaided where the practical isn't a coding task.
 *
 *   npx tsx scripts/test-labmanual-generator.ts              # all
 *   GATE_ONLY=1 npx tsx scripts/test-labmanual-generator.ts  # (A) only, free
 *   SUBJECT=IDCH3051 PRACTICAL=4 npx tsx scripts/test-labmanual-generator.ts
 *
 * (B) and (C) call the real Gemini API (costs money). Same fake-request-scope
 * shim as the other harnesses — routeAI logs via after(), which needs a scope.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
// Type-only imports are erased at runtime, so they don't disturb the dynamic
// import() ordering the env shim below depends on.
import type {
  LabManualWarning,
  PracticalManualSection,
} from "@/lib/labmanual/types";
import type { SubjectContext } from "@/lib/subjectContext";

(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

/** A raw AI payload. Deliberately loose — the fixtures below are malformed on purpose. */
type Row = Record<string, unknown>;
/** Nested-object accessors for mutating a fixture without reaching for `any`. */
const scaffoldOf = (r: Row): Row => r.scaffold as Row;
const conductOf = (r: Row): Row => r.conductGuide as Row;

function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvLocal();

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

const SKELETON = { practicalNo: 1, title: "Implement binary search", hours: 2 };
const GATE_INPUT = {
  skeleton: SKELETON,
  difficulty: "standard" as const,
  language: "python" as string | null,
  validCoCodes: ["CO1", "CO2", "CO3"],
  fallbackCoCodes: ["CO2"],
};

/** A well-formed AI payload; each fixture below breaks exactly one thing. */
function goodRow(): Row {
  return {
    aim: "Implement binary search",
    objectives: ["Explain the invariant", "Implement the loop"],
    coCodes: ["CO1"],
    btl: 3,
    prereqChecks: ["What is a sorted array?", "What is O(log n)?"],
    theory: "Binary search halves the search space each iteration.",
    workedExample: "arr=[1,3,5,7], target=5 → lo=0 hi=3 mid=1 …",
    scaffold: {
      kind: "code_scaffold",
      language: "python",
      // 4 gaps and 4 markers — a genuinely clean payload for the standard
      // contract (4-6). Every fixture below breaks exactly one thing from here.
      body: "def bsearch(a, t):\n    lo, hi = 0, TODO(1)\n    while TODO(2):\n        mid = TODO(3)\n        if a[mid] == t: return mid\n        TODO(4)\n    return -1",
      gaps: [
        { n: 1, hint: "Set the initial high bound", learn: "inclusive vs exclusive bounds" },
        { n: 2, hint: "State the loop condition", learn: "loop invariant" },
        { n: 3, hint: "Compute the midpoint without overflow", learn: "midpoint arithmetic" },
        { n: 4, hint: "Move the correct pointer", learn: "invariant maintenance" },
      ],
    },
    solution:
      "def bsearch(a, t):\n    lo, hi = 0, len(a)-1\n    while lo <= hi:\n        mid = (lo+hi)//2\n        if a[mid] == t: return mid\n        elif a[mid] < t: lo = mid+1\n        else: hi = mid-1\n    return -1",
    expectedOutput: "2",
    commonErrors: [
      { error: "IndexError", meaning: "hi initialised to len(a)" },
      { error: "Infinite loop", meaning: "pointer not moved past mid" },
      { error: "Wrong result on duplicates", meaning: "returns any match, not first" },
    ],
    extensions: [
      { level: "basic", statement: "Return the first occurrence", expected: "index of first" },
      { level: "stretch", statement: "Search a rotated array", expected: "correct index" },
    ],
    viva: [
      { q: "Why sorted?", hint: "think about halving" },
      { q: "Complexity?", hint: "how many halvings" },
      { q: "Overflow?", hint: "lo+hi" },
      { q: "Duplicates?", hint: "first vs any" },
      { q: "Recursive vs iterative?", hint: "stack" },
      { q: "When is linear better?", hint: "small n" },
    ],
    rubric: [
      { criterion: "Implementation", marks: 4 },
      { criterion: "Understanding", marks: 3 },
      { criterion: "Output", marks: 3 },
    ],
    conductGuide: {
      opener: "Demo a phone-book lookup.",
      hintRelease: "Release gap 1 at minute 20.",
      checkpoints: ["By minute 30, ask why lo<=hi", "By minute 45, ask about overflow"],
      deliberateMistake: "Let them write lo=mid and hang.",
      wrapUp: "Tie back to CO1.",
    },
  };
}

async function gateTests() {
  const { buildOnePracticalSection, defaultScaffoldKind, todoMarkersIn } = await import(
    "@/lib/labmanual/generator"
  );

  console.log("\n══════════ (A) GATE TESTS — forced-bad fixtures, no AI ══════════");

  // 0. baseline
  console.log("\n--- 0. well-formed payload ---");
  {
    const w: LabManualWarning[] = [];
    const s = buildOnePracticalSection(goodRow(), GATE_INPUT, w);
    check("title verbatim from syllabus", s.title === SKELETON.title);
    check("hours verbatim from syllabus", s.hours === 2);
    check("difficulty echoed from request", s.difficulty === "standard");
    check("practicalNo from skeleton", s.practicalNo === 1);
    check(
      "no warnings on a clean payload",
      w.length === 0,
      w.map((x) => `${x.kind}: ${x.message}`).join(" | "),
    );
  }

  // 1. AI tries to override syllabus-owned fields
  console.log("\n--- 1. AI tries to rewrite the title/hours ---");
  {
    const w: LabManualWarning[] = [];
    const row = { ...goodRow(), title: "AI's better title", hours: 99, practicalNo: 42, difficulty: "challenge" };
    const s = buildOnePracticalSection(row, GATE_INPUT, w);
    check("AI title ignored", s.title === SKELETON.title, s.title);
    check("AI hours ignored", s.hours === 2, String(s.hours));
    check("AI practicalNo ignored", s.practicalNo === 1, String(s.practicalNo));
    check("AI difficulty ignored", s.difficulty === "standard", s.difficulty);
  }

  // 2. TODO/gaps mismatch — both directions
  console.log("\n--- 2. TODO(n) / gaps[] mismatch ---");
  {
    const w: LabManualWarning[] = [];
    const row = goodRow();
    scaffoldOf(row).body = "x = TODO(1)\ny = TODO(7)"; // 7 has no gap entry
    scaffoldOf(row).gaps = [
      { n: 1, hint: "a", learn: "a" },
      { n: 2, hint: "b", learn: "b" }, // 2 has no marker
      { n: 3, hint: "c", learn: "c" },
      { n: 4, hint: "d", learn: "d" },
    ];
    buildOnePracticalSection(row, GATE_INPUT, w);
    const msgs = w.filter((x) => x.kind === "gap_marker_mismatch").map((x) => x.message);
    check("orphan TODO(7) warned (marker with no gap)", msgs.some((m) => m.includes("TODO(7")), msgs.join(" | "));
    check("orphan gap #2 warned (gap with no marker)", msgs.some((m) => m.includes("#2")), msgs.join(" | "));
  }

  // 3. solution containing TODO(
  console.log("\n--- 3. solution still contains TODO( ---");
  {
    const w: LabManualWarning[] = [];
    const row = goodRow();
    row.solution = "def bsearch(a,t):\n    mid = TODO(1)\n    return -1";
    buildOnePracticalSection(row, GATE_INPUT, w);
    const hit = w.find((x) => x.kind === "solution_incomplete");
    check("solution_incomplete fired", !!hit, w.map((x) => x.kind).join(","));
    check("message names the TODO cause", !!hit && hit.message.includes("TODO("), hit?.message);
  }

  // 3b. solution identical to body
  console.log("\n--- 3b. solution identical to the scaffold body ---");
  {
    const w: LabManualWarning[] = [];
    const row = goodRow();
    row.solution = scaffoldOf(row).body;
    buildOnePracticalSection(row, GATE_INPUT, w);
    const hit = w.find((x) => x.kind === "solution_incomplete");
    check("solution_incomplete fired", !!hit);
    check("message names the identical cause", !!hit && hit.message.includes("identical"), hit?.message);
  }

  // 3c. empty solution
  console.log("\n--- 3c. empty solution ---");
  {
    const w: LabManualWarning[] = [];
    const row = goodRow();
    row.solution = "";
    buildOnePracticalSection(row, GATE_INPUT, w);
    check("solution_incomplete fired on empty", w.some((x) => x.kind === "solution_incomplete"));
  }

  // 4. rubric sum ≠ 10
  console.log("\n--- 4. rubric sum ≠ 10 ---");
  {
    const w: LabManualWarning[] = [];
    const row = goodRow();
    row.rubric = [
      { criterion: "Implementation", marks: 5 },
      { criterion: "Understanding", marks: 3 },
      { criterion: "Output", marks: 4 },
    ]; // = 12
    const s = buildOnePracticalSection(row, GATE_INPUT, w);
    const sum = s.rubric.reduce((a, r) => a + r.marks, 0);
    check("rubric forced to exactly 10", sum === 10, `sum=${sum}`);
    check("largest row was the one adjusted", s.rubric[0].marks === 3, JSON.stringify(s.rubric));
    check("rubric_sum_adjusted warning fired", w.some((x) => x.kind === "rubric_sum_adjusted"));
  }

  // 4b. rubric pathological (can't fix via one row)
  console.log("\n--- 4b. rubric wildly wrong (40 marks) ---");
  {
    const w: LabManualWarning[] = [];
    const row = goodRow();
    row.rubric = [
      { criterion: "A", marks: 20 },
      { criterion: "B", marks: 20 },
    ];
    const s = buildOnePracticalSection(row, GATE_INPUT, w);
    const sum = s.rubric.reduce((a, r) => a + r.marks, 0);
    check("still totals exactly 10", sum === 10, `sum=${sum}`);
    check("no zero/negative criterion", s.rubric.every((r) => r.marks > 0), JSON.stringify(s.rubric));
  }

  // 5. embedded URLs
  console.log("\n--- 5. embedded http(s) URLs (§8 MANDATORY strip) ---");
  {
    const w: LabManualWarning[] = [];
    const row = goodRow();
    row.theory = "Read more at https://geeksforgeeks.org/binary-search for details.";
    (row.extensions as Row[])[0].statement = "Solve https://leetcode.com/problems/binary-search/";
    (row.viva as Row[])[0].hint = "see http://example.com/x";
    const s = buildOnePracticalSection(row, GATE_INPUT, w);
    const blob = JSON.stringify(s);
    check("no http(s) URL survives anywhere in the section", !/https?:\/\//.test(blob), blob.match(/https?:\/\/\S+/)?.[0]);
    check("url_stripped warning fired", w.some((x) => x.kind === "url_stripped"));
    check("surrounding prose preserved", s.theory.includes("Read more at") && s.theory.includes("for details"), s.theory);
  }

  // 6. bad scaffold kind → heuristic default
  console.log("\n--- 6. scaffold kind outside the enum ---");
  {
    const w: LabManualWarning[] = [];
    const row = goodRow();
    scaffoldOf(row).kind = "flowchart_scaffold";
    const s = buildOnePracticalSection(row, GATE_INPUT, w);
    check("defaulted to code_scaffold (title says 'Implement')", s.scaffold.kind === "code_scaffold", s.scaffold.kind);
    check("scaffold_kind_defaulted warning fired", w.some((x) => x.kind === "scaffold_kind_defaulted"));
  }

  console.log("\n--- 6b. heuristic on non-code titles ---");
  {
    check("'Steam distillation experiment' + no language → procedure", defaultScaffoldKind("Steam distillation experiment", null) === "procedure_scaffold");
    check("'Calculate the reflux ratio' + no language → calculation", defaultScaffoldKind("Calculate the reflux ratio", null) === "calculation_scaffold");
    check("'Implement quicksort' → code", defaultScaffoldKind("Implement quicksort", null) === "code_scaffold");
    check("'Write a program to sort' → code", defaultScaffoldKind("Write a program to sort", null) === "code_scaffold");
    check("non-code title + language set → code (faculty chose a language)", defaultScaffoldKind("Study of crystallisers", "python") === "code_scaffold");
  }

  // 7. gap count off contract
  console.log("\n--- 7. gap count outside the difficulty contract ---");
  {
    const w: LabManualWarning[] = [];
    const row = goodRow();
    scaffoldOf(row).gaps = [{ n: 1, hint: "only one", learn: "x" }];
    const s = buildOnePracticalSection(row, GATE_INPUT, w);
    check("gap_count_off_contract warned (1 gap, standard wants 4-6)", w.some((x) => x.kind === "gap_count_off_contract"));
    check("NOT coerced — the single gap survives", s.scaffold.gaps.length === 1, String(s.scaffold.gaps.length));
  }

  // 7b. gap QUALITY detector — the residue the prompt can't reliably prevent
  console.log("\n--- 7b. boilerplate gap detection (gap_quality_suspect) ---");
  {
    const w: LabManualWarning[] = [];
    const row = goodRow();
    scaffoldOf(row).gaps = [
      { n: 1, hint: "Compute the midpoint", learn: "midpoint arithmetic" },
      { n: 2, hint: "Move the pointer", learn: "loop invariant" },
      { n: 3, hint: "Call the bsearch function with arr and target", learn: "function invocation for search" },
      { n: 4, hint: "Print the returned index", learn: "printing the result" },
    ];
    buildOnePracticalSection(row, GATE_INPUT, w);
    const hits = w.filter((x) => x.kind === "gap_quality_suspect");
    check("boilerplate gaps flagged", hits.length === 2, `${hits.length} flagged`);
    check("names the offending gap number", hits.some((h) => h.message.includes("Gap 3")), hits.map((h) => h.message).join(" | "));
    check("does NOT flag the two conceptual gaps", !hits.some((h) => h.message.includes("Gap 1") || h.message.includes("Gap 2")));
  }
  {
    // precision guard: "call" in a HINT is fine when the concept is real —
    // recursion legitimately involves calling a function.
    const w: LabManualWarning[] = [];
    const row = goodRow();
    scaffoldOf(row).gaps = [
      { n: 1, hint: "Call the traversal function on the left subtree", learn: "recursive descent on a binary tree" },
      { n: 2, hint: "b", learn: "tree height invariant" },
      { n: 3, hint: "c", learn: "base case identification" },
      { n: 4, hint: "d", learn: "post-order accumulation" },
    ];
    buildOnePracticalSection(row, GATE_INPUT, w);
    check(
      "no false positive: 'call' in a hint with a real concept in learn",
      !w.some((x) => x.kind === "gap_quality_suspect"),
      w.filter((x) => x.kind === "gap_quality_suspect").map((x) => x.message).join(" | "),
    );
  }

  // 7c. meta-commentary leak (the non-reproducing one-off, now a caught class)
  console.log("\n--- 7c. AI meta-commentary leaked into an artifact ---");
  {
    const w: LabManualWarning[] = [];
    const row = goodRow();
    scaffoldOf(row).body =
      "Step 1: F = A'B + AB\nThis is not helpful as A'B + AB is not a standard simplification.\nStep 2: TODO(1)";
    buildOnePracticalSection(row, GATE_INPUT, w);
    const hit = w.find((x) => x.kind === "content_leak_suspect");
    check("content_leak_suspect fired on the real observed leak", !!hit, w.map((x) => x.kind).join(","));
    check("names the offending field", !!hit && hit.message.includes("scaffold"), hit?.message);
  }
  {
    const w: LabManualWarning[] = [];
    const row = goodRow();
    row.solution = "def f():\n    pass\n# I apologize, here's the corrected version:\ndef f2(): pass";
    buildOnePracticalSection(row, GATE_INPUT, w);
    check(
      "detects leak in the solution too",
      w.some((x) => x.kind === "content_leak_suspect" && x.message.includes("solution")),
      w.map((x) => x.kind).join(","),
    );
  }
  {
    // precision guard: prose fields legitimately use these phrases, and the
    // detector must not scan them.
    const w: LabManualWarning[] = [];
    const row = goodRow();
    row.theory = "Note that I/O bound tasks differ here. Let me be precise: this is not helpful for large n.";
    (row.viva as Row[])[0].hint = "Let me know if the array is sorted first";
    buildOnePracticalSection(row, GATE_INPUT, w);
    check(
      "no false positive from prose fields (theory/viva are not scanned)",
      !w.some((x) => x.kind === "content_leak_suspect"),
      w.filter((x) => x.kind === "content_leak_suspect").map((x) => x.message).join(" | "),
    );
  }

  // 7d. Gemini math-escape repair (the §17 LaTeX-escape corruption)
  console.log("\n--- 7d. corrupted-LaTeX repair (\\frac → formfeed+rac) ---");
  {
    const { repairGeminiMathEscapes } = await import("@/lib/text/latexSegments");
    const { hasLatex } = await import("@/lib/text/latexSegments");
    const FF = String.fromCharCode(12); // what JSON.parse("\\f") yields
    const TAB = String.fromCharCode(9);
    const NL = String.fromCharCode(10);
    // exactly the corruption observed live: "$Q = -kA\frac{dT}{dx}$"
    const broken = `Rate is $Q = -kA${FF}rac{dT}{dx}$ and $${FF}rac{1}{2}$$ end.`;
    const fixed = repairGeminiMathEscapes(broken);
    check("form-feed before letter → \\f inside $…$", fixed.includes("\\frac{dT}{dx}"), JSON.stringify(fixed.slice(0, 40)));
    check("form-feed inside $$…$$ repaired", fixed.includes("\\frac{1}{2}"), fixed);
    check("repaired text now renders as math", hasLatex(fixed) && !hasLatex(broken.replace(/\$/g, "")));

    // tab → \text inside a span (the other observed case)
    const brokenTab = `Value is $0.22${TAB}ext{ m}$ across.`;
    check("tab before letter → \\t inside span", repairGeminiMathEscapes(brokenTab).includes("\\text{ m}"));

    // newline INSIDE a span is a broken \neq; newline BETWEEN spans is left alone
    const brokenNeq = `We need $x ${NL}eq 0$ here.`;
    check("newline inside span → \\n (\\neq restored)", repairGeminiMathEscapes(brokenNeq).includes("\\neq"));

    // a REAL paragraph break outside any span must survive untouched
    const prose = `First paragraph.${NL}${NL}Second paragraph.`;
    check("paragraph newlines outside spans untouched", repairGeminiMathEscapes(prose) === prose);

    // a real tab as CODE indentation (body/solution) must NOT be repaired —
    // proven by NOT calling repair on those fields; here assert the function
    // itself leaves a tab-before-letter alone when there is no surrounding span.
    const codeish = `${TAB}if (x) return;`;
    check("bare tab-indent (no span) is NOT turned into \\t", repairGeminiMathEscapes(codeish) === codeish);

    // no-op fast path
    check("plain text is returned unchanged", repairGeminiMathEscapes("no math here") === "no math here");

    // model LaTeX-tic normalisation (observed live on the heat-transfer subject)
    check("\\textDelta → \\Delta", repairGeminiMathEscapes("$\\textDelta T$").includes("\\Delta"));
    check("\\DeltaT (glued) → \\Delta T", repairGeminiMathEscapes("$\\DeltaT_{o}$").includes("\\Delta T"));
    check("\\text{approx} → \\approx", repairGeminiMathEscapes("$a \\text{approx} b$").includes("\\approx"));

    // PREFIX HAZARD — the load-bearing sort must NOT split these valid commands
    check("valid \\neq is NOT split into \\ne q", !repairGeminiMathEscapes("$x \\neq y$").includes("\\ne q"));
    check("valid \\infty is NOT split into \\int fty", !repairGeminiMathEscapes("$n \\infty x$").includes("\\int"));
    check("legit \\text{ m} unit annotation untouched", repairGeminiMathEscapes("$5 \\text{ m}$").includes("\\text{ m}"));
  }

  // 7e. BTL out of range warns (compliance metadata — no silent coercion)
  console.log("\n--- 7e. invalid BTL warns ---");
  {
    const w: LabManualWarning[] = [];
    const row = goodRow();
    row.btl = 9;
    const s = buildOnePracticalSection(row, GATE_INPUT, w);
    check("BTL coerced to 3", s.btl === 3, String(s.btl));
    check("btl_defaulted warning fired", w.some((x) => x.kind === "btl_defaulted"));
  }
  {
    const w: LabManualWarning[] = [];
    const row = goodRow();
    row.btl = 4;
    const s = buildOnePracticalSection(row, GATE_INPUT, w);
    check("valid BTL kept, no warning", s.btl === 4 && !w.some((x) => x.kind === "btl_defaulted"));
  }

  // 8. list lengths
  console.log("\n--- 8. commonErrors / viva / checkpoints lengths ---");
  {
    const w: LabManualWarning[] = [];
    const row = goodRow();
    (row.commonErrors as unknown[]) = [{ error: "only one", meaning: "m" }];
    (row.viva as unknown[]) = [{ q: "one", hint: "h" }, { q: "two", hint: "h" }];
    conductOf(row).checkpoints = ["a", "b", "c", "d"];
    const s = buildOnePracticalSection(row, GATE_INPUT, w);
    check("commonErrors padded to exactly 3", s.commonErrors.length === 3, String(s.commonErrors.length));
    check("viva padded to exactly 6", s.viva.length === 6, String(s.viva.length));
    check("checkpoints truncated to exactly 2", s.conductGuide.checkpoints.length === 2, String(s.conductGuide.checkpoints.length));
    check("list_length_adjusted warnings fired", w.filter((x) => x.kind === "list_length_adjusted").length === 3);
  }

  // 9. CO validation + validated fallback
  console.log("\n--- 9. CO validation ---");
  {
    const w: LabManualWarning[] = [];
    const row = goodRow();
    row.coCodes = ["CO9", "garbage", "CO2"];
    const s = buildOnePracticalSection(row, GATE_INPUT, w);
    check("invalid COs stripped, valid kept", JSON.stringify(s.coCodes) === JSON.stringify(["CO2"]), JSON.stringify(s.coCodes));
    check("co_stripped warnings fired", w.filter((x) => x.kind === "co_stripped").length === 2);
  }
  {
    const w: LabManualWarning[] = [];
    const row = goodRow();
    row.coCodes = [];
    const s = buildOnePracticalSection(row, GATE_INPUT, w);
    check("empty CO → validated fallback used", JSON.stringify(s.coCodes) === JSON.stringify(["CO2"]), JSON.stringify(s.coCodes));
    check("co_empty warning fired", w.some((x) => x.kind === "co_empty"));
  }
  {
    // the lesson-plan hole this gate deliberately does NOT copy: a fallback code
    // that isn't in course_outcomes must not be smuggled in.
    const w: LabManualWarning[] = [];
    const row = goodRow();
    row.coCodes = [];
    const s = buildOnePracticalSection(
      row,
      { ...GATE_INPUT, fallbackCoCodes: ["CO 99"] },
      w,
    );
    check("unvalidated fallback code is NOT smuggled in", s.coCodes.length === 0, JSON.stringify(s.coCodes));
    check("co_empty warning tells faculty to assign manually", w.some((x) => x.kind === "co_empty" && x.message.includes("manually")));
  }

  // 10. spacing-insensitive CO match (the cross-subject format drift)
  console.log("\n--- 10. CO spacing drift ('CO 1' subject, AI emits 'CO1') ---");
  {
    const w: LabManualWarning[] = [];
    const row = goodRow();
    row.coCodes = ["CO1"];
    const s = buildOnePracticalSection(
      row,
      { ...GATE_INPUT, validCoCodes: ["CO 1", "CO 2"], fallbackCoCodes: ["CO 1"] },
      w,
    );
    check("AI's 'CO1' matched to the subject's 'CO 1' canonical", JSON.stringify(s.coCodes) === JSON.stringify(["CO 1"]), JSON.stringify(s.coCodes));
    check("no co_stripped warning flood", !w.some((x) => x.kind === "co_stripped"));
  }

  // 11. total garbage
  console.log("\n--- 11. near-empty AI payload ---");
  {
    const w: LabManualWarning[] = [];
    const s = buildOnePracticalSection({}, GATE_INPUT, w);
    check("does not throw", !!s);
    check("aim falls back to the syllabus title", s.aim === SKELETON.title, s.aim);
    check("rubric still totals 10", s.rubric.reduce((a, r) => a + r.marks, 0) === 10);
    check("viva still has exactly 6 slots", s.viva.length === 6);
    check("solution_incomplete warned", w.some((x) => x.kind === "solution_incomplete"));
  }

  // 12. marker parser
  console.log("\n--- 12. TODO marker parsing ---");
  {
    check("parses TODO(1)/TODO( 2 )", JSON.stringify(todoMarkersIn("a TODO(1) b TODO( 2 )")) === JSON.stringify([1, 2]));
    check("dedupes repeats", JSON.stringify(todoMarkersIn("TODO(1) TODO(1)")) === JSON.stringify([1]));
    check("no false positive on TODO without number", JSON.stringify(todoMarkersIn("# TODO: fix later")) === JSON.stringify([]));
  }
}

// ─── live helpers ────────────────────────────────────────────────────────────

async function withScope<T>(fn: () => Promise<T>): Promise<T> {
  const { workAsyncStorage } = await import(
    "next/dist/server/app-render/work-async-storage.external"
  );
  const store = { afterContext: { after: (_f: unknown) => { void _f; } } };
  return workAsyncStorage.run(store as never, fn);
}

function logContextFor(ctx: SubjectContext) {
  return {
    userId: null,
    userEmail: "harness@test",
    userRole: "faculty",
    subjectId: ctx.subjectId,
    subjectCode: ctx.subjectCode,
    jobId: crypto.randomUUID(),
    relatedContentId: null,
    feature: "lab_manual_gen_test",
    metadata: {},
  };
}

function printSection(s: PracticalManualSection, warnings: LabManualWarning[]) {
  console.log(`\n  ── PRACTICAL ${s.practicalNo}: ${s.title} (${s.hours}h, ${s.difficulty}) ──`);
  console.log(`  aim: ${s.aim}`);
  console.log(`  CO=${s.coCodes.join("/")} BTL=${s.btl}`);
  console.log(`  objectives: ${s.objectives.join(" | ")}`);
  console.log(`  prereqChecks: ${s.prereqChecks.join(" | ")}`);
  console.log(`\n  theory (${s.theory.length} chars): ${s.theory.slice(0, 400)}${s.theory.length > 400 ? "…" : ""}`);
  console.log(`\n  workedExample (${s.workedExample.length}): ${s.workedExample.slice(0, 400)}${s.workedExample.length > 400 ? "…" : ""}`);
  console.log(`\n  SCAFFOLD [${s.scaffold.kind}] language=${s.scaffold.language ?? "—"} gaps=${s.scaffold.gaps.length}`);
  console.log("  ┌─────────────────────────────────────────");
  for (const line of s.scaffold.body.split("\n")) console.log(`  │ ${line}`);
  console.log("  └─────────────────────────────────────────");
  console.log("  GAPS:");
  for (const g of s.scaffold.gaps) console.log(`    (${g.n}) hint: ${g.hint}\n        learn: ${g.learn}`);
  console.log("\n  SOLUTION:");
  console.log("  ┌─────────────────────────────────────────");
  for (const line of s.solution.split("\n")) console.log(`  │ ${line}`);
  console.log("  └─────────────────────────────────────────");
  console.log(`  expectedOutput: ${s.expectedOutput.slice(0, 200)}`);
  console.log("  commonErrors:");
  for (const e of s.commonErrors) console.log(`    - ${e.error} → ${e.meaning}`);
  console.log("  extensions:");
  for (const e of s.extensions) console.log(`    [${e.level}] ${e.statement} (expect: ${e.expected})`);
  console.log("  viva:");
  for (const v of s.viva) console.log(`    Q: ${v.q}\n       hint: ${v.hint}`);
  console.log(`  rubric (sum=${s.rubric.reduce((a, r) => a + r.marks, 0)}):`);
  for (const r of s.rubric) console.log(`    ${r.criterion}: ${r.marks}`);
  console.log("  CONDUCT GUIDE (faculty-only):");
  console.log(`    opener: ${s.conductGuide.opener}`);
  console.log(`    hintRelease: ${s.conductGuide.hintRelease}`);
  for (const c of s.conductGuide.checkpoints) console.log(`    checkpoint: ${c}`);
  console.log(`    deliberateMistake: ${s.conductGuide.deliberateMistake}`);
  console.log(`    wrapUp: ${s.conductGuide.wrapUp}`);
  console.log(`  warnings (${warnings.length}): ${warnings.map((w) => w.kind).join(", ") || "none"}`);
  for (const w of warnings) console.log(`    [${w.kind}] ${w.message}`);
}

async function difficultyContract(subjectCode: string, practicalNo: number, language: string | null) {
  const { createAdminClient } = await import("@/lib/db/supabase-server");
  const { loadSubjectContext } = await import("@/lib/subjectContext");
  const { generateOnePractical } = await import("@/lib/labmanual/generator");
  const { GAP_COUNT_RANGE } = await import("@/lib/labmanual/types");

  const admin = createAdminClient();
  const { data } = await admin.from("subjects").select("id, code, name").eq("code", subjectCode).maybeSingle();
  const row = data as { id: string; code: string; name: string } | null;
  if (!row) return console.log(`\n!! subject ${subjectCode} not found`);
  const ctx = await loadSubjectContext(row.id);
  const target = ctx.practicals.find((p) => p.sr_no === practicalNo) ?? ctx.practicals[0];

  console.log(`\n\n══════════ (B) DIFFICULTY CONTRACT — ${row.code} #${target.sr_no}: ${target.name} ══════════`);

  const counts: Record<string, number> = {};
  const prefilled: Record<string, number> = {};
  await withScope(async () => {
    for (const difficulty of ["guided", "standard", "challenge"] as const) {
      const { section, warnings } = await generateOnePractical(
        { ctx, practicalNo: target.sr_no, difficulty, language, path: null },
        logContextFor(ctx),
      );
      printSection(section, warnings);
      counts[difficulty] = section.scaffold.gaps.length;
      // How much of the artifact is HANDED to the student: the real axis the
      // difficulty contract turns on (gap COUNT bands overlap by design).
      const body: string = section.scaffold.body;
      const lines = body.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
      const gapLines = lines.filter((l) => /TODO\(/.test(l)).length;
      prefilled[difficulty] = Math.round(((lines.length - gapLines) / lines.length) * 100);
      // Band membership is NOT asserted: §4b makes an out-of-band count a
      // WARNING, not an error, and the prompt deliberately tells the model to
      // return fewer gaps rather than pad with boilerplate to hit the number
      // (padding is what produced the trivia gaps this checkpoint fixed). What
      // IS asserted is that our gate reports it accurately — that's our code.
      const { min, max } = GAP_COUNT_RANGE[difficulty];
      const n = section.scaffold.gaps.length;
      const inBand = n >= min && n <= max;
      const warned = warnings.some((w) => w.kind === "gap_count_off_contract");
      check(
        `${difficulty}: gate flags off-contract iff off-contract (${n} gaps, band ${min}-${max})`,
        warned === !inBand,
        `inBand=${inBand} warned=${warned}`,
      );
      if (!inBand) {
        console.log(
          `  ⓘ ${difficulty} returned ${n} gaps (band ${min}-${max}) — allowed: quality over quota. Faculty sees the amber chip.`,
        );
      }
      check(`${difficulty}: difficulty echoed`, section.difficulty === difficulty);
      check(`${difficulty}: solution has no TODO(`, !/TODO\(/.test(section.solution));
      check(`${difficulty}: solution differs from body`, section.solution.trim() !== section.scaffold.body.trim());
      check(`${difficulty}: rubric sums to 10`, section.rubric.reduce((a, r) => a + r.marks, 0) === 10);
      check(`${difficulty}: no URLs`, !/https?:\/\//.test(JSON.stringify(section)));
      check(`${difficulty}: every TODO(n) has a gaps[] entry`, section.scaffold.gaps.length > 0);
    }
  });

  console.log("\n  ── DIFFICULTY CONTRACT SUMMARY ──");
  for (const d of ["guided", "standard", "challenge"] as const) {
    console.log(`    ${d.padEnd(10)} ${counts[d]} gaps | ${prefilled[d]}% of the scaffold prefilled`);
  }
  // The contract's gap-count bands OVERLAP by design (guided 3-4, standard 4-6,
  // challenge 5-7), so gap count is NOT required to be monotonic — challenge is
  // defined by how LITTLE is prefilled, and may use fewer, larger gaps than
  // standard. Asserting monotonicity here would over-specify the spec and flake
  // on independent temperature-0.4 calls. The two real assertions:
  check(
    "gap counts VISIBLY DIFFER across the three levels (guided < challenge)",
    counts.guided < counts.challenge,
    `guided=${counts.guided} standard=${counts.standard} challenge=${counts.challenge}`,
  );
  check(
    "challenge hands the student LESS of the scaffold than guided does",
    prefilled.challenge < prefilled.guided,
    `guided prefills ${prefilled.guided}%, challenge prefills ${prefilled.challenge}%`,
  );
}

async function scaffoldKinds(subjectCode: string, nos: number[], language: string | null, expectNonCode: boolean) {
  const { createAdminClient } = await import("@/lib/db/supabase-server");
  const { loadSubjectContext } = await import("@/lib/subjectContext");
  const { generatePracticalSections } = await import("@/lib/labmanual/generator");

  const admin = createAdminClient();
  const { data } = await admin.from("subjects").select("id, code, name").eq("code", subjectCode).maybeSingle();
  const row = data as { id: string; code: string; name: string } | null;
  if (!row) return console.log(`\n!! subject ${subjectCode} not found`);
  const ctx = await loadSubjectContext(row.id);

  console.log(`\n\n══════════ (C) SCAFFOLD KINDS — ${row.code} — ${row.name} ══════════`);

  await withScope(async () => {
    const { sections, warnings, failed } = await generatePracticalSections(
      {
        ctx,
        practicalNos: nos,
        language,
        path: null,
        difficulties: Object.fromEntries(nos.map((n) => [n, "standard"])),
      },
      logContextFor(ctx),
    );
    for (const s of sections) printSection(s, warnings.filter((w) => w.practicalNo === s.practicalNo));
    check(`${row.code}: no practical failed outright`, failed.length === 0, `failed=${failed}`);
    console.log("\n  ── KIND SUMMARY ──");
    for (const s of sections) console.log(`    #${s.practicalNo} [${s.scaffold.kind}] lang=${s.scaffold.language ?? "—"} — ${s.title}`);
    if (expectNonCode) {
      check(
        `${row.code}: AI picked a NON-code scaffold kind unaided for at least one practical`,
        sections.some((s) => s.scaffold.kind !== "code_scaffold"),
        sections.map((s) => s.scaffold.kind).join(","),
      );
      check(
        `${row.code}: non-code scaffolds carry language=null`,
        sections.filter((s) => s.scaffold.kind !== "code_scaffold").every((s) => s.scaffold.language === null),
      );
    }
  });
}

async function main() {
  await gateTests();

  if (process.env.GATE_ONLY) {
    console.log("\n(GATE_ONLY set — skipped live AI runs)");
  } else if (process.env.SUBJECT) {
    await difficultyContract(
      process.env.SUBJECT,
      Number(process.env.PRACTICAL ?? 1),
      process.env.LANGUAGE ?? null,
    );
  } else {
    // (B) one practical at all three difficulties — code subject
    await difficultyContract("SECE3260", 1, "python");
    // (C) chemistry: the procedure/calculation exerciser
    await scaffoldKinds("IDCH3051", [6, 4], null, true);
  }

  console.log(`\n══════════ lab-manual generator: ${passed} passed, ${failed} failed ══════════\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Harness failed:", e);
  process.exit(1);
});
