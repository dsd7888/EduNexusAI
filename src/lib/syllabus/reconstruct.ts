import type { ExtractedSyllabus } from "./types";

/**
 * Rebuilds a single plain-text syllabus document from the structured data.
 * This is what gets stored in subject_content.content and injected into
 * chat / PPT / quiz prompts as syllabus context.
 */
export function reconstructSyllabusText(extracted: ExtractedSyllabus): string {
  const lines: string[] = [];

  const course = extracted.course;
  if (course.code || course.name) {
    lines.push(`Course: ${[course.code, course.name].filter(Boolean).join(" — ")}`);
  }
  if (course.credits) lines.push(`Credits: ${course.credits}`);
  if (course.theory_hours_per_week || course.practical_hours_per_week) {
    lines.push(
      `Hours/week: Theory ${course.theory_hours_per_week || 0}, Practical ${course.practical_hours_per_week || 0}`
    );
  }
  if (course.prerequisites.length > 0) {
    lines.push(`Prerequisites: ${course.prerequisites.join(", ")}`);
  }

  const ex = extracted.exam_scheme;
  const hasExam =
    ex.theory_ce != null ||
    ex.theory_ese != null ||
    ex.practical_ce != null ||
    ex.practical_ese != null ||
    ex.tutorial_marks != null ||
    ex.total_marks != null;
  if (hasExam) {
    lines.push("");
    lines.push("Exam Scheme:");
    if (ex.theory_ce != null) lines.push(`  Theory CE: ${ex.theory_ce}`);
    if (ex.theory_ese != null) lines.push(`  Theory ESE: ${ex.theory_ese}`);
    if (ex.practical_ce != null) lines.push(`  Practical CE: ${ex.practical_ce}`);
    if (ex.practical_ese != null) lines.push(`  Practical ESE: ${ex.practical_ese}`);
    if (ex.tutorial_marks != null) lines.push(`  Tutorial: ${ex.tutorial_marks}`);
    if (ex.total_marks != null) lines.push(`  Total: ${ex.total_marks}`);
  }

  if (extracted.modules.length > 0) {
    const bySection = new Map<number, typeof extracted.modules>();
    for (const m of extracted.modules) {
      const arr = bySection.get(m.section_number) ?? [];
      arr.push(m);
      bySection.set(m.section_number, arr);
    }
    const sections = [...bySection.keys()].sort((a, b) => a - b);
    for (const section of sections) {
      lines.push("");
      lines.push(`Section ${toRoman(section)}`);
      const mods = (bySection.get(section) ?? []).sort(
        (a, b) => a.module_number - b.module_number
      );
      for (const m of mods) {
        const header = `Module ${m.module_number}: ${m.name}`;
        const meta: string[] = [];
        if (m.hours) meta.push(`${m.hours} hours`);
        if (m.weightage_percent) meta.push(`${m.weightage_percent}% weightage`);
        if (m.btl_levels.length > 0) meta.push(`BTL: ${m.btl_levels.join(", ")}`);
        lines.push("");
        lines.push(meta.length > 0 ? `${header}  [${meta.join(" | ")}]` : header);
        if (m.content) lines.push(m.content);
      }
    }
  }

  if (extracted.course_outcomes.length > 0) {
    lines.push("");
    lines.push("Course Outcomes:");
    for (const co of extracted.course_outcomes) {
      lines.push(`  ${co.co_code}: ${co.description}`);
    }
  }

  if (extracted.co_po_mapping.length > 0) {
    lines.push("");
    lines.push("CO-PO Mapping:");
    for (const m of extracted.co_po_mapping) {
      lines.push(`  ${m.co_code} → ${m.po_code} (${m.strength})`);
    }
  }

  if (extracted.co_pso_mapping.length > 0) {
    lines.push("");
    lines.push("CO-PSO Mapping:");
    for (const m of extracted.co_pso_mapping) {
      lines.push(`  ${m.co_code} → ${m.pso_code} (${m.strength})`);
    }
  }

  if (extracted.practicals.length > 0) {
    lines.push("");
    lines.push("Practicals:");
    for (const p of extracted.practicals) {
      const hrs = p.hours ? ` (${p.hours} hrs)` : "";
      lines.push(`  ${p.sr_no}. ${p.name}${hrs}`);
    }
  }

  if (extracted.textbooks.length > 0) {
    lines.push("");
    lines.push("Textbooks:");
    for (const t of extracted.textbooks) lines.push(`  - ${t}`);
  }

  if (extracted.reference_books.length > 0) {
    lines.push("");
    lines.push("Reference Books:");
    for (const r of extracted.reference_books) lines.push(`  - ${r}`);
  }

  return lines.join("\n").trim();
}

function toRoman(n: number): string {
  const map: [number, string][] = [
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  if (!Number.isInteger(n) || n < 1) return String(n);
  let out = "";
  let rem = n;
  for (const [v, sym] of map) {
    while (rem >= v) {
      out += sym;
      rem -= v;
    }
  }
  return out;
}
