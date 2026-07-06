export interface ModuleRow {
  id: string;
  module_number: number;
  name: string;
  description: string | null;
  weightage_percent: number | null;
  btl_levels: string[] | null;
}

export interface CourseOutcomeRef {
  co_code: string;
  description: string;
}

export type MappingSource = "ai_inferred" | "faculty_verified" | "superadmin_verified";
export type MappingConfidence = "high" | "medium" | "low";

export interface MappingRow {
  id: string;
  module_id: string;
  co_code: string;
  confidence: MappingConfidence;
  source: MappingSource;
}

export const CONFIDENCE_CLASSES: Record<MappingConfidence, string> = {
  high: "border-emerald-400/40 bg-emerald-500/10 text-emerald-300",
  medium: "border-amber-400/40 bg-amber-500/10 text-amber-300",
  low: "border-rose-400/40 bg-rose-500/10 text-rose-300",
};

/** Normalise a CO code for display, e.g. "2" / "CO2" / "02" → "CO2". */
export function formatCo(co: string | null | undefined): string {
  if (!co) return "";
  const n = String(co).replace(/^CO/i, "").replace(/^0+/, "");
  return `CO${n || "0"}`;
}

export const SOURCE_LABELS: Record<MappingSource, string> = {
  ai_inferred: "AI-inferred",
  faculty_verified: "Verified by you",
  superadmin_verified: "Admin verified",
};

const BTL_LABEL_TO_LEVEL: Record<string, number> = {
  remember: 1,
  understand: 2,
  apply: 3,
  analyze: 4,
  analyse: 4,
  evaluate: 5,
  create: 6,
};

/** Normalise a module's btl_levels (numbers or text labels) to sorted BTL numbers. */
export function normaliseBtlLevels(raw: string[] | null | undefined): number[] {
  if (!raw || raw.length === 0) return [];
  const out = new Set<number>();
  for (const item of raw) {
    const s = String(item).trim().toLowerCase();
    const asNum = Number(s);
    if (Number.isFinite(asNum) && asNum >= 1 && asNum <= 6) {
      out.add(Math.trunc(asNum));
      continue;
    }
    if (BTL_LABEL_TO_LEVEL[s] != null) out.add(BTL_LABEL_TO_LEVEL[s]);
  }
  return Array.from(out).sort((a, b) => a - b);
}

export async function patchModuleCoMapping(
  moduleId: string,
  coCode: string,
  action: "add" | "remove"
): Promise<void> {
  const res = await fetch("/api/syllabus/module-co-mapping", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ module_id: moduleId, co_code: coCode, action }),
  });
  if (!res.ok) throw new Error(await res.text());
}
