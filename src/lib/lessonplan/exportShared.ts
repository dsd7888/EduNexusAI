// ============================================================================
// Lesson-plan export — shared header loading + table-row transformers.
//
// Both the docx and pdf builders consume the SAME structured tables from here,
// so the two formats stay identical in structure (spec §6). Server-only (uses
// the admin client to read the subject + faculty header block).
// ============================================================================

import { createAdminClient } from "@/lib/db/supabase-server";
import type { LessonPlanDoc, TeachingMethod } from "./types";

export const METHOD_LABELS: Record<TeachingMethod, string> = {
  lecture_board: "Lecture + Board",
  demo: "Demonstration",
  problem_solving: "Problem Solving",
  activity: "Activity",
  flipped: "Flipped",
  discussion: "Discussion",
};

const DEFAULT_UNIVERSITY = "P. P. Savani University";

export interface LessonPlanHeader {
  university: string;
  school: string;
  department: string;
  courseCode: string;
  courseName: string;
  facultyName: string;
  semester: string;
}

/** Structured table: header cells + body rows (cells may contain "\n"). */
export interface ExportTable {
  headers: string[];
  rows: string[][];
}

/**
 * Load the course-file header block from the subject row + faculty profile.
 * University is taken from any existing q-paper template (deployment-wide
 * constant in practice) with a safe fallback.
 */
export async function loadExportHeader(
  subjectId: string,
  facultyId: string,
): Promise<{ header: LessonPlanHeader; moduleNames: Map<number, string> }> {
  const admin = createAdminClient();

  const [subjectRes, facultyRes, uniRes, modulesRes] = await Promise.all([
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
    admin
      .from("modules")
      .select("module_number, name")
      .eq("subject_id", subjectId),
  ]);

  const subject = (subjectRes.data ?? {}) as {
    name?: string;
    code?: string;
    department?: string;
    branch?: string;
    semester?: number | string;
    school?: string;
  };
  const facultyName =
    (facultyRes.data as { full_name?: string } | null)?.full_name ?? "—";
  const university =
    (uniRes.data as { university_name?: string }[] | null)?.[0]
      ?.university_name ?? DEFAULT_UNIVERSITY;

  const moduleNames = new Map<number, string>();
  for (const m of (modulesRes.data ?? []) as {
    module_number: number;
    name: string;
  }[]) {
    moduleNames.set(m.module_number, m.name);
  }

  return {
    header: {
      university,
      school: subject.school ?? "—",
      department: subject.department ?? "—",
      courseCode: subject.code ?? "—",
      courseName: subject.name ?? "—",
      facultyName,
      semester:
        subject.semester != null && subject.semester !== ""
          ? `Semester ${subject.semester}`
          : "—",
    },
    moduleNames,
  };
}

/** Theory table: Session# | Module | Topics | Objective | CO | BTL | Method | Remarks. */
export function theoryTable(
  doc: LessonPlanDoc,
  moduleNames: Map<number, string>,
): ExportTable {
  const headers = [
    "S#",
    "Module",
    "Topics",
    "Objective",
    "CO",
    "BTL",
    "Method",
    "Remarks",
  ];
  const rows = [...doc.theory]
    .sort((a, b) => a.sessionNo - b.sessionNo)
    .map((s) => {
      const moduleCell = `M${s.moduleNumber}${
        moduleNames.get(s.moduleNumber) ? `: ${moduleNames.get(s.moduleNumber)}` : ""
      }`;
      const methodCell =
        METHOD_LABELS[s.method] + (s.methodNote ? `\n${s.methodNote}` : "");
      const remarks = [
        s.misconception ? `Misconception: ${s.misconception}` : "",
        s.examNote ? `Exam: ${s.examNote}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      return [
        String(s.sessionNo),
        moduleCell,
        s.topics.join("; "),
        s.objective,
        s.coCodes.join(", "),
        String(s.btl),
        methodCell,
        remarks,
      ];
    });
  return { headers, rows };
}

/** Practical table: Pr# | Title | Hours | CO | Assessment | Prep note. */
export function practicalTable(doc: LessonPlanDoc): ExportTable {
  const headers = ["Pr#", "Title", "Hrs", "CO", "Assessment", "Prep note"];
  const rows = [...doc.practicals]
    .sort((a, b) => a.practicalNo - b.practicalNo)
    .map((p) => [
      String(p.practicalNo),
      p.vivaSeed ? `${p.title}\nViva: ${p.vivaSeed}` : p.title,
      String(p.hours),
      p.coCodes.join(", "),
      p.assessmentHint,
      p.prepNote,
    ]);
  return { headers, rows };
}
