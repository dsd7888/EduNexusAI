import type { ExtractedSyllabus } from "./types";

/**
 * Best-effort JSON parser for the syllabus extraction response.
 * Five attempts with progressive cleaning, matching the PPT outline parser.
 */
export function parseExtractedSyllabus(raw: string): ExtractedSyllabus | null {
  let cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();

  cleaned = cleaned
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/}\s*{/g, "},{");

  // Attempt 1: direct parse after light cleaning
  const a1 = tryParse(cleaned);
  if (a1) return a1;

  // Attempt 2: slice between first { and last }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const a2 = tryParse(cleaned.slice(start, end + 1));
    if (a2) return a2;
  }

  // Attempt 3: replace single quotes with double quotes (common Gemini slip)
  const singleQuoteFixed = cleaned.replace(/'/g, '"');
  const a3 = tryParse(singleQuoteFixed);
  if (a3) return a3;
  if (start !== -1 && end > start) {
    const a3b = tryParse(singleQuoteFixed.slice(start, end + 1));
    if (a3b) return a3b;
  }

  // Attempt 4: quote unquoted keys
  const keyQuoted = cleaned.replace(
    /([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g,
    '$1"$2":'
  );
  const a4 = tryParse(keyQuoted);
  if (a4) return a4;
  if (start !== -1 && end > start) {
    const a4b = tryParse(keyQuoted.slice(start, end + 1));
    if (a4b) return a4b;
  }

  // Attempt 5: strip trailing junk after the last closing brace
  if (start !== -1 && end > start) {
    const sliced = cleaned.slice(start, end + 1);
    const stripped = sliced
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]");
    const a5 = tryParse(stripped);
    if (a5) return a5;
  }

  return null;
}

function tryParse(text: string): ExtractedSyllabus | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return normalizeExtracted(parsed);
  } catch {
    return null;
  }
}

/**
 * Coerces a parsed object into the ExtractedSyllabus shape.
 * Missing sections become empty arrays / nulls so downstream code never crashes.
 */
function normalizeExtracted(parsed: unknown): ExtractedSyllabus | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;

  const course = (p.course ?? {}) as Record<string, unknown>;
  const examScheme = (p.exam_scheme ?? {}) as Record<string, unknown>;

  return {
    course: {
      code: str(course.code),
      name: str(course.name),
      prerequisites: strArr(course.prerequisites),
      credits: num(course.credits),
      theory_hours_per_week: num(course.theory_hours_per_week),
      practical_hours_per_week: num(course.practical_hours_per_week),
    },
    exam_scheme: {
      theory_ce: nullableNum(examScheme.theory_ce),
      theory_ese: nullableNum(examScheme.theory_ese),
      practical_ce: nullableNum(examScheme.practical_ce),
      practical_ese: nullableNum(examScheme.practical_ese),
      tutorial_marks: nullableNum(examScheme.tutorial_marks),
      total_marks: nullableNum(examScheme.total_marks),
    },
    modules: Array.isArray(p.modules)
      ? p.modules.map((m) => {
          const mm = (m ?? {}) as Record<string, unknown>;
          return {
            module_number: num(mm.module_number),
            name: str(mm.name),
            content: str(mm.content),
            hours: num(mm.hours),
            weightage_percent: num(mm.weightage_percent),
            section_number: num(mm.section_number) || 1,
            btl_levels: strArr(mm.btl_levels),
          };
        })
      : [],
    course_outcomes: Array.isArray(p.course_outcomes)
      ? p.course_outcomes.map((c) => {
          const cc = (c ?? {}) as Record<string, unknown>;
          return {
            co_code: str(cc.co_code),
            description: str(cc.description),
          };
        })
      : [],
    co_po_mapping: Array.isArray(p.co_po_mapping)
      ? p.co_po_mapping
          .map((m) => {
            const mm = (m ?? {}) as Record<string, unknown>;
            return {
              co_code: str(mm.co_code),
              po_code: str(mm.po_code),
              strength: num(mm.strength),
            };
          })
          .filter((m) => m.co_code && m.po_code && m.strength >= 1 && m.strength <= 3)
      : [],
    co_pso_mapping: Array.isArray(p.co_pso_mapping)
      ? p.co_pso_mapping
          .map((m) => {
            const mm = (m ?? {}) as Record<string, unknown>;
            return {
              co_code: str(mm.co_code),
              pso_code: str(mm.pso_code),
              strength: num(mm.strength),
            };
          })
          .filter((m) => m.co_code && m.pso_code && m.strength >= 1 && m.strength <= 3)
      : [],
    practicals: Array.isArray(p.practicals)
      ? p.practicals.map((pr) => {
          const pp = (pr ?? {}) as Record<string, unknown>;
          return {
            sr_no: num(pp.sr_no),
            name: str(pp.name),
            hours: num(pp.hours),
          };
        })
      : [],
    textbooks: strArr(p.textbooks),
    reference_books: strArr(p.reference_books),
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
function nullableNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim().length > 0) as string[];
}
