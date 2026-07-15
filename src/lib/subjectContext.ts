// ============================================================================
// Shared subject context loader
//
// ONE loader for everything a generator needs to know about a subject: its
// modules (with parsed btl_levels + CO mapping), its course outcomes, and its
// practicals. Extracted from lessonplan/generator.ts so the lesson-plan and
// lab-manual pipelines read the syllabus through identical code — a divergence
// here would mean the two course-file artifacts describe the same subject
// differently, which is exactly the failure a shared loader prevents.
//
// SERVER-ONLY: uses the admin client (bypasses RLS). Every caller is expected to
// have already done its own access check (assertSubjectAccess in the API routes).
// Do NOT import this from a client component — see CLAUDE_CONTEXT §19. The
// faculty lesson-plan page deliberately keeps its own copy of parseBtlLevels in
// _components/shared.ts for that reason.
// ============================================================================

import { createAdminClient } from "@/lib/db/supabase-server";

/** A module row, with btl_levels parsed to ints and CO codes joined in. */
export interface SubjectModule {
  id: string;
  module_number: number;
  name: string;
  description: string;
  hours: number | null;
  weightage_percent: number | null;
  btl_levels: number[]; // parsed to ints 1–6
  coCodes: string[]; // from module_co_mapping (validated against subject COs)
}

export interface SubjectCourseOutcome {
  co_code: string;
  description: string;
}

export interface SubjectPractical {
  sr_no: number;
  name: string;
  hours: number | null;
}

export interface SubjectContext {
  subjectId: string;
  subjectName: string;
  subjectCode: string | null;
  modules: SubjectModule[];
  courseOutcomes: SubjectCourseOutcome[];
  practicals: SubjectPractical[];
}

const DEFAULT_BTL_LEVELS = [1, 2, 3];

const BTL_LABEL_TO_LEVEL: Record<string, number> = {
  remember: 1,
  understand: 2,
  apply: 3,
  analyze: 4,
  analyse: 4,
  evaluate: 5,
  create: 6,
};

/** Parse a modules.btl_levels text[] into distinct ints 1–6. */
export function parseBtlLevels(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_BTL_LEVELS];
  const out = new Set<number>();
  for (const item of raw as Array<string | number>) {
    if (typeof item === "number" && item >= 1 && item <= 6) {
      out.add(Math.trunc(item));
      continue;
    }
    const s = String(item).trim().toLowerCase();
    const n = Number(s.replace(/[^0-9]/g, ""));
    if (Number.isFinite(n) && n >= 1 && n <= 6) {
      out.add(n);
      continue;
    }
    if (BTL_LABEL_TO_LEVEL[s] != null) out.add(BTL_LABEL_TO_LEVEL[s]);
  }
  return out.size > 0
    ? Array.from(out).sort((a, b) => a - b)
    : [...DEFAULT_BTL_LEVELS];
}

/**
 * Load everything a generator needs for one subject via the admin client
 * (server-only; bypasses RLS — the API route does the faculty-assignment check).
 * Also used by the test harnesses.
 */
export async function loadSubjectContext(
  subjectId: string,
): Promise<SubjectContext> {
  const admin = createAdminClient();

  const { data: subjectRow } = await admin
    .from("subjects")
    .select("name, code")
    .eq("id", subjectId)
    .maybeSingle();

  const { data: moduleRows } = await admin
    .from("modules")
    .select("id, module_number, name, description, hours, weightage_percent, btl_levels")
    .eq("subject_id", subjectId)
    .order("module_number");

  const { data: coRows } = await admin
    .from("course_outcomes")
    .select("co_code, description")
    .eq("subject_id", subjectId);

  const { data: contentRow } = await admin
    .from("subject_content")
    .select("practicals")
    .eq("subject_id", subjectId)
    .maybeSingle();

  const moduleIds = (moduleRows ?? []).map((m) => (m as { id: string }).id);
  const { data: mcoRows } = moduleIds.length
    ? await admin
        .from("module_co_mapping")
        .select("module_id, co_code")
        .in("module_id", moduleIds)
    : { data: [] as { module_id: string; co_code: string }[] };

  const coByModule = new Map<string, string[]>();
  for (const r of (mcoRows ?? []) as { module_id: string; co_code: string }[]) {
    const list = coByModule.get(r.module_id) ?? [];
    list.push(r.co_code);
    coByModule.set(r.module_id, list);
  }

  const modules: SubjectModule[] = (moduleRows ?? []).map((m) => {
    const row = m as {
      id: string;
      module_number: number;
      name: string;
      description: string | null;
      hours: number | null;
      weightage_percent: number | null;
      btl_levels: string[] | null;
    };
    return {
      id: row.id,
      module_number: row.module_number,
      name: row.name,
      description: row.description ?? "",
      hours: row.hours,
      weightage_percent: row.weightage_percent,
      btl_levels: parseBtlLevels(row.btl_levels),
      coCodes: coByModule.get(row.id) ?? [],
    };
  });

  const practicalsRaw = (contentRow as { practicals?: unknown } | null)
    ?.practicals;
  const practicals: SubjectPractical[] = Array.isArray(practicalsRaw)
    ? (practicalsRaw as Array<{ sr_no?: number; name?: string; hours?: number }>)
        .filter((p) => p && typeof p.name === "string")
        .map((p, i) => ({
          sr_no: typeof p.sr_no === "number" ? p.sr_no : i + 1,
          name: String(p.name).trim(),
          hours: typeof p.hours === "number" ? p.hours : null,
        }))
    : [];

  return {
    subjectId,
    subjectName: (subjectRow as { name?: string } | null)?.name ?? "this subject",
    subjectCode: (subjectRow as { code?: string | null } | null)?.code ?? null,
    modules,
    courseOutcomes: (coRows ?? []) as SubjectCourseOutcome[],
    practicals,
  };
}

/**
 * ≤100-char one-line digest of every module — the cross-module context block
 * shared by the lesson-plan and lab-manual prompts.
 */
export function buildModuleDigest(modules: SubjectModule[]): string {
  return modules
    .map((m) => {
      const topics = m.description.replace(/\s+/g, " ").trim();
      const line = `Module ${m.module_number} (${m.name}): ${topics}`;
      return line.length > 100 ? `${line.slice(0, 97)}…` : line;
    })
    .join("\n");
}
