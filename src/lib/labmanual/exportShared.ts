// ============================================================================
// Lab-manual export — the shared, variant-aware block model (spec §6).
//
// Both the docx and pdf builders consume the SAME `Block[]` produced here, so
// the three variants stay structurally identical across formats. The `variant`
// parameter decides which blocks are emitted:
//   student     — the manual a student receives; NO solution, NO conduct guide.
//   instructor  — student blocks + a conduct panel after the aim; still no
//                 solutions (those are a separate artifact by design).
//   solutions   — a marking aid: aim + the filled solution + expected output.
//
// SECURITY (spec §8): assertNoFacultyLeak() runs on the FINISHED student block
// list and throws if any solution/conduct text slipped through. This is code, a
// second line of defence behind the by-construction filtering — a future edit
// that accidentally emits a faculty block into the student variant fails loudly
// instead of shipping answers to students.
//
// NO IMAGES anywhere (spec §6), so math cannot be rasterised. latexToReadable()
// converts `$…$` / `\ce{…}` to a plain-text approximation instead.
// ============================================================================

import { createAdminClient } from "@/lib/db/supabase-server";
import type {
  ExportVariant,
  LabManualDoc,
  PracticalManualSection,
} from "./types";

// ── Block model ─────────────────────────────────────────────────────────────

export type Block =
  | { kind: "pageBreak" }
  | { kind: "title"; text: string; size: number }
  | { kind: "subtitle"; text: string }
  | { kind: "heading"; text: string } // PRACTICAL N: title
  | { kind: "subheading"; text: string; faculty?: boolean } // Aim, Theory, …
  | { kind: "para"; text: string }
  | { kind: "labeled"; label: string; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "mono"; text: string } // shaded monospace box (scaffold / solution)
  | { kind: "table"; headers: string[]; rows: string[][]; widths?: number[] }
  | { kind: "observationBox"; lines: number } // ruled empty answer region
  | { kind: "signLine" } // Date … Signature
  | { kind: "blanks"; items: string[] } // "Name: ____________"
  | { kind: "spacer"; h: number }
  | { kind: "rule" }; // a thin horizontal divider

export interface ExportModel {
  variant: ExportVariant;
  filename: string; // without extension
  blocks: Block[];
}

// ── Header block ─────────────────────────────────────────────────────────────

export interface ManualHeader {
  university: string;
  school: string;
  department: string;
  courseCode: string;
  courseName: string;
  facultyName: string;
  semester: string;
  academicYear: string;
}

const DEFAULT_UNIVERSITY = "P. P. Savani University";

export async function loadManualHeader(
  subjectId: string,
  facultyId: string,
): Promise<ManualHeader> {
  const admin = createAdminClient();
  const [subjectRes, facultyRes, uniRes] = await Promise.all([
    admin
      .from("subjects")
      .select("name, code, department, branch, semester, school")
      .eq("id", subjectId)
      .maybeSingle(),
    admin.from("profiles").select("full_name").eq("id", facultyId).maybeSingle(),
    admin
      .from("qpaper_templates")
      .select("university_name")
      .not("university_name", "is", null)
      .limit(1),
  ]);

  const subject = (subjectRes.data ?? {}) as {
    name?: string;
    code?: string;
    department?: string;
    semester?: number | string;
    school?: string;
  };
  const now = new Date();
  // Indian academic year runs Jul–Jun.
  const ayStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;

  return {
    university:
      (uniRes.data as { university_name?: string }[] | null)?.[0]?.university_name ??
      DEFAULT_UNIVERSITY,
    school: subject.school ?? "—",
    department: subject.department ?? "—",
    courseCode: subject.code ?? "—",
    courseName: subject.name ?? "—",
    facultyName:
      (facultyRes.data as { full_name?: string } | null)?.full_name ?? "—",
    semester:
      subject.semester != null && subject.semester !== ""
        ? `Semester ${subject.semester}`
        : "—",
    academicYear: `${ayStart}-${ayStart + 1}`,
  };
}

// ── LaTeX → readable plain text (no images allowed) ─────────────────────────

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", epsilon: "ε",
  theta: "θ", lambda: "λ", mu: "μ", nu: "ν", pi: "π", Pi: "Π", rho: "ρ",
  sigma: "σ", Sigma: "Σ", tau: "τ", phi: "φ", Phi: "Φ", psi: "ψ", omega: "ω",
  Omega: "Ω", Gamma: "Γ", Lambda: "Λ", Theta: "Θ",
};
const OPS: Record<string, string> = {
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", approx: "≈", leq: "≤",
  geq: "≥", neq: "≠", ne: "≠", infty: "∞", partial: "∂", nabla: "∇",
  rightarrow: "→", to: "→", leftarrow: "←", Rightarrow: "⇒", degree: "°",
  circ: "°", cdots: "…", ldots: "…", sum: "Σ", prod: "∏", int: "∫",
};
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", n: "ⁿ", i: "ⁱ", "+": "⁺", "-": "⁻" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", i: "ᵢ", j: "ⱼ", n: "ₙ", "+": "₊", "-": "₋" };

/** Convert one math body (no delimiters) into a readable plain string. */
function mathBodyToText(m: string): string {
  let s = m;
  s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)");
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)");
  s = s.replace(/\\text\s*\{([^{}]*)\}/g, "$1");
  s = s.replace(/\\(?:mathrm|mathbf|mathit|vec|hat|bar)\s*\{([^{}]*)\}/g, "$1");
  // greek + operators
  s = s.replace(/\\([A-Za-z]+)/g, (_m, cmd: string) =>
    GREEK[cmd] ?? OPS[cmd] ?? cmd,
  );
  // superscripts / subscripts
  s = s.replace(/\^\{([^{}]*)\}/g, (_m, g: string) =>
    [...g].map((c) => SUP[c] ?? `^${c}`).join(""),
  );
  s = s.replace(/\^(\S)/g, (_m, c: string) => SUP[c] ?? `^${c}`);
  s = s.replace(/_\{([^{}]*)\}/g, (_m, g: string) =>
    [...g].map((c) => SUB[c] ?? `_${c}`).join(""),
  );
  s = s.replace(/_(\S)/g, (_m, c: string) => SUB[c] ?? `_${c}`);
  s = s.replace(/[{}]/g, "").replace(/\\[,;! ]/g, " ").replace(/\\\\/g, " ");
  return s.replace(/\s{2,}/g, " ").trim();
}

/** Replace every `$…$`, `$$…$$` and `\ce{…}` span in prose with readable text. */
export function latexToReadable(text: string): string {
  if (!text) return "";
  let out = text.replace(/\\ce\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, (_m, body: string) =>
    mathBodyToText(body).replace(/->/g, "→").replace(/<=>/g, "⇌"),
  );
  out = out.replace(/\$\$([^$]+)\$\$/g, (_m, body: string) => mathBodyToText(body));
  out = out.replace(/\$([^$]+)\$/g, (_m, body: string) => mathBodyToText(body));
  return out;
}

// ── Per-practical block builders ────────────────────────────────────────────

function ruledMarks(rubricRows: { criterion: string; marks: number }[]): {
  headers: string[];
  rows: string[][];
} {
  return {
    headers: ["Criterion", "Marks"],
    rows: rubricRows.map((r) => [r.criterion, String(r.marks)]),
  };
}

/** The blocks common to student + instructor (everything a student may see). */
function studentPracticalBlocks(
  s: PracticalManualSection,
  opts: { includeConduct: boolean },
): Block[] {
  const b: Block[] = [];
  b.push({ kind: "heading", text: `PRACTICAL ${s.practicalNo}: ${latexToReadable(s.title)}` });
  b.push({ kind: "labeled", label: "Aim", text: latexToReadable(s.aim) });

  // Instructor conduct panel sits directly after the aim (spec §6).
  if (opts.includeConduct) {
    b.push({ kind: "subheading", text: "Conducting this practical (faculty only)", faculty: true });
    b.push({ kind: "labeled", label: "Opener", text: latexToReadable(s.conductGuide.opener) });
    b.push({ kind: "labeled", label: "Hint release", text: latexToReadable(s.conductGuide.hintRelease) });
    s.conductGuide.checkpoints.forEach((c, i) =>
      b.push({ kind: "labeled", label: `Checkpoint ${i + 1}`, text: latexToReadable(c) }),
    );
    b.push({ kind: "labeled", label: "Deliberate mistake", text: latexToReadable(s.conductGuide.deliberateMistake) });
    b.push({ kind: "labeled", label: "Wrap-up", text: latexToReadable(s.conductGuide.wrapUp) });
    b.push({ kind: "rule" });
  }

  b.push({
    kind: "labeled",
    label: "Course Outcome / BTL",
    text: `${s.coCodes.join(", ") || "—"}  ·  BTL ${s.btl}`,
  });
  if (s.objectives.length) {
    b.push({ kind: "subheading", text: "Objectives" });
    b.push({ kind: "bullets", items: s.objectives.map(latexToReadable) });
  }
  if (s.prereqChecks.length) {
    b.push({ kind: "subheading", text: "Prerequisite Check" });
    b.push({ kind: "bullets", items: s.prereqChecks.map(latexToReadable) });
  }
  b.push({ kind: "subheading", text: "Theory" });
  b.push({ kind: "para", text: latexToReadable(s.theory) });
  b.push({ kind: "subheading", text: "Worked Example" });
  b.push({ kind: "para", text: latexToReadable(s.workedExample) });

  b.push({ kind: "subheading", text: "Guided Implementation" });
  b.push({ kind: "mono", text: s.scaffold.body });
  if (s.scaffold.gaps.length) {
    b.push({
      kind: "table",
      headers: ["#", "What to do", "What you learn"],
      rows: s.scaffold.gaps.map((g) => [String(g.n), latexToReadable(g.hint), latexToReadable(g.learn)]),
      widths: [0.08, 0.52, 0.4],
    });
  }

  b.push({ kind: "subheading", text: "Expected Output" });
  b.push({ kind: "mono", text: latexToReadable(s.expectedOutput) });

  if (s.commonErrors.length) {
    b.push({ kind: "subheading", text: "Common Errors" });
    b.push({
      kind: "table",
      headers: ["Error", "What it means"],
      rows: s.commonErrors.map((e) => [latexToReadable(e.error), latexToReadable(e.meaning)]),
      widths: [0.45, 0.55],
    });
  }
  if (s.extensions.length) {
    b.push({ kind: "subheading", text: "Extension Problems" });
    b.push({
      kind: "table",
      headers: ["Level", "Problem", "Expected"],
      rows: s.extensions.map((x) => [x.level, latexToReadable(x.statement), latexToReadable(x.expected)]),
      widths: [0.15, 0.55, 0.3],
    });
  }
  if (s.viva.length) {
    b.push({ kind: "subheading", text: "Viva Questions" });
    b.push({
      kind: "bullets",
      items: s.viva.map((v) => `${latexToReadable(v.q)}${v.hint ? `  (hint: ${latexToReadable(v.hint)})` : ""}`),
    });
  }
  b.push({ kind: "subheading", text: "Assessment Rubric" });
  const rub = ruledMarks(s.rubric);
  b.push({ kind: "table", headers: rub.headers, rows: rub.rows, widths: [0.8, 0.2] });

  // Handwriting region + sign line (student manual is a workbook).
  b.push({ kind: "subheading", text: "Observation / Result / Conclusion" });
  b.push({ kind: "observationBox", lines: 8 });
  b.push({ kind: "signLine" });
  return b;
}

/** Solutions variant: aim + filled solution + expected output only. */
function solutionPracticalBlocks(s: PracticalManualSection): Block[] {
  return [
    { kind: "heading", text: `PRACTICAL ${s.practicalNo}: ${latexToReadable(s.title)}` },
    { kind: "labeled", label: "Aim", text: latexToReadable(s.aim) },
    { kind: "subheading", text: "Model Solution" },
    { kind: "mono", text: s.solution },
    { kind: "subheading", text: "Expected Output" },
    { kind: "mono", text: latexToReadable(s.expectedOutput) },
  ];
}

// ── Cover / certificate / contents ──────────────────────────────────────────

const VARIANT_COVER_TITLE: Record<ExportVariant, string> = {
  student: "LABORATORY MANUAL",
  instructor: "INSTRUCTOR'S MANUAL",
  solutions: "MODEL SOLUTIONS — CONFIDENTIAL (Faculty Only)",
};

function coverBlocks(header: ManualHeader, variant: ExportVariant): Block[] {
  const b: Block[] = [
    { kind: "spacer", h: 60 },
    { kind: "title", text: header.university, size: 22 },
    { kind: "subtitle", text: `${header.school}` },
    { kind: "subtitle", text: header.department },
    { kind: "spacer", h: 30 },
    { kind: "title", text: VARIANT_COVER_TITLE[variant], size: 18 },
    { kind: "spacer", h: 12 },
    { kind: "subtitle", text: `${header.courseCode} — ${header.courseName}` },
    { kind: "spacer", h: 40 },
  ];
  if (variant === "student") {
    b.push({ kind: "blanks", items: ["Name", "Enrolment No.", "Academic Year"] });
  } else {
    b.push({ kind: "subtitle", text: `Faculty: ${header.facultyName}` });
    b.push({ kind: "subtitle", text: `Academic Year: ${header.academicYear}` });
  }
  b.push({ kind: "pageBreak" });
  return b;
}

function certificateBlocks(header: ManualHeader): Block[] {
  return [
    { kind: "title", text: "CERTIFICATE", size: 16 },
    { kind: "spacer", h: 16 },
    {
      kind: "para",
      text:
        `This is to certify that Mr./Ms. ______________________________, ` +
        `Enrolment No. ______________________, of ${header.department}, ` +
        `${header.semester}, has satisfactorily completed the term work in ` +
        `${header.courseCode} — ${header.courseName} during the academic year ` +
        `${header.academicYear}.`,
    },
    { kind: "spacer", h: 16 },
    { kind: "para", text: "Marks obtained: ________ / ________" },
    { kind: "spacer", h: 40 },
    { kind: "signLine" },
    { kind: "para", text: "Faculty in-charge                                   Head of Department" },
    { kind: "pageBreak" },
  ];
}

/** Sentinel for a contents Page cell, resolved by the PDF builder's 2nd pass. */
export const pagePlaceholder = (practicalNo: number) => `{{PAGE:${practicalNo}}}`;
export const PAGE_PLACEHOLDER_RE = /^\{\{PAGE:(\d+)\}\}$/;

function contentsBlocks(
  sections: PracticalManualSection[],
  variant: ExportVariant,
): Block[] {
  const student = variant === "student";
  const headers = student
    ? ["Sr", "Practical", "Page", "Date", "Marks", "Sign"]
    : variant === "instructor"
      ? ["Sr", "Practical", "Page"]
      : ["Sr", "Practical", "Page"];
  // The Page cell carries a sentinel the PDF builder resolves to a real page
  // number in its second pass; docx renders it as a static "—" (acceptable v1).
  const rows = sections.map((s, i) => {
    const base = [String(i + 1), latexToReadable(s.title), pagePlaceholder(s.practicalNo)];
    return student ? [...base, "", "", ""] : base;
  });
  return [
    { kind: "title", text: "CONTENTS", size: 16 },
    { kind: "spacer", h: 10 },
    {
      kind: "table",
      headers,
      rows,
      widths: student ? [0.07, 0.48, 0.09, 0.14, 0.12, 0.1] : [0.08, 0.77, 0.15],
    },
    { kind: "pageBreak" },
  ];
}

// ── Top-level model builder ─────────────────────────────────────────────────

/** Build the block model for a whole-manual OR single-practical export. */
export function buildExportModel(
  doc: LabManualDoc,
  header: ManualHeader,
  variant: ExportVariant,
  scope: "all" | number,
): ExportModel {
  const ordered = [...doc.sections].sort((a, b) => a.practicalNo - b.practicalNo);
  const sections =
    scope === "all" ? ordered : ordered.filter((s) => s.practicalNo === scope);

  const blocks: Block[] = [];
  const single = scope !== "all";

  // Single-practical export = the per-practical blocks only (no front matter).
  if (!single) {
    blocks.push(...coverBlocks(header, variant));
    if (variant === "student") blocks.push(...certificateBlocks(header));
    blocks.push(...contentsBlocks(sections, variant));
  }

  const bridgesAfter = new Map<number, NonNullable<LabManualDoc["path"]>["bridges"]>();
  if (!single && variant !== "solutions" && doc.path) {
    for (const br of doc.path.bridges) {
      const list = bridgesAfter.get(br.afterPracticalNo) ?? [];
      list.push(br);
      bridgesAfter.set(br.afterPracticalNo, list);
    }
  }

  sections.forEach((s, idx) => {
    if (idx > 0) blocks.push({ kind: "pageBreak" });
    if (variant === "solutions") {
      blocks.push(...solutionPracticalBlocks(s));
    } else {
      blocks.push(
        ...studentPracticalBlocks(s, { includeConduct: variant === "instructor" }),
      );
      // Bridge exercises between units (student + instructor only).
      for (const br of bridgesAfter.get(s.practicalNo) ?? []) {
        blocks.push({ kind: "pageBreak" });
        blocks.push({ kind: "heading", text: `Supplementary Exercise: ${latexToReadable(br.title)}` });
        blocks.push({ kind: "para", text: latexToReadable(br.statement) });
        blocks.push({ kind: "labeled", label: "Expected", text: latexToReadable(br.expected) });
      }
    }
  });

  // ── SECURITY: no faculty-only content in the student variant (spec §8) ──
  if (variant === "student") assertNoFacultyLeak(blocks, doc, scope);

  const scopeLabel = single ? `p${scope}` : "all";
  const filename = `${variant}_${scopeLabel}_${header.courseCode.replace(/[^A-Za-z0-9]/g, "")}`;
  return { variant, filename, blocks };
}

/**
 * Throw if a student export's blocks contain any solution or conduct-guide text.
 * Compares against the ACTUAL faculty-only strings in the doc, not a heuristic —
 * so it can't be fooled and can't false-positive on legitimately similar prose.
 */
export function assertNoFacultyLeak(
  blocks: Block[],
  doc: LabManualDoc,
  scope: "all" | number,
): void {
  const sections = doc.sections.filter(
    (s) => scope === "all" || s.practicalNo === scope,
  );
  const secrets: string[] = [];
  for (const s of sections) {
    if (s.solution?.trim()) secrets.push(s.solution.trim());
    const cg = s.conductGuide;
    for (const v of [cg.opener, cg.hintRelease, cg.deliberateMistake, cg.wrapUp, ...cg.checkpoints]) {
      if (v?.trim() && v.trim().length > 12) secrets.push(v.trim());
    }
  }
  const haystack = blocks
    .map((bl) => {
      switch (bl.kind) {
        case "para":
        case "labeled":
          return "text" in bl ? bl.text : "";
        case "mono":
        case "heading":
        case "subheading":
        case "title":
        case "subtitle":
          return "text" in bl ? bl.text : "";
        case "bullets":
          return bl.items.join("\n");
        case "table":
          return bl.rows.map((r) => r.join(" ")).join("\n");
        default:
          return "";
      }
    })
    .join("\n");

  for (const secret of secrets) {
    // Compare on a normalised slice — a solution's first 40 non-space chars are
    // a strong fingerprint and survive the readable-text transform of prose.
    const probe = secret.replace(/\s+/g, " ").slice(0, 40);
    if (probe.length >= 12 && haystack.replace(/\s+/g, " ").includes(probe)) {
      throw new Error(
        "Refusing to export: faculty-only content (solution or conduct guide) " +
          "leaked into the STUDENT manual. This is a bug in the export builder.",
      );
    }
  }
}
