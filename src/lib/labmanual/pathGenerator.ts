// ============================================================================
// Lab Manual — learning-path proposal + validation gate (spec §4a)
//
// ONE routeAI("lab_path_gen", …) call per proposal. The model groups the
// syllabus practicals into teaching units and may reorder them relative to
// sr_no, but it must never invent or drop one — the practicals ARE the
// syllabus, and a lab manual that silently omits a practical is not a term-work
// document, it's a liability.
//
// So the AI's grouping is a PROPOSAL, and the gate below is what makes it safe:
// it reconciles the returned units against the real practical list and repairs
// any partition violation (missing → appended to an "Ungrouped" unit;
// duplicated → first occurrence wins). It never fails closed and never silently
// coerces — every repair emits a warning the faculty sees before approving.
// That mirrors the hard-gate-over-smarter-fallback lesson in CLAUDE_CONTEXT §17.
//
// The path is NOT cached: it lives per-faculty in lab_manuals.doc, because two
// faculty may legitimately structure the same lab differently (§3 note a).
// ============================================================================

import { routeAI } from "@/lib/ai/router";
import { buildModuleDigest, type SubjectContext } from "@/lib/subjectContext";
import type { AILogContext } from "@/lib/ai/providers/types";
import type {
  LearningPath,
  PathUnit,
  BridgeExercise,
  LabManualWarning,
} from "./types";

/** Spec §4a: 0-2 bridges only. More than this stops being supplementary. */
const MAX_BRIDGES = 2;
const MAX_UNITS = 5;
const MIN_UNITS = 2;

const PATH_SYSTEM_PROMPT =
  "You are a senior lab instructor and pedagogy designer for Indian technical " +
  "universities. You organise a semester's laboratory practicals into a teaching " +
  "sequence that builds skill progressively — prerequisites before dependents, " +
  "related techniques grouped so students consolidate before moving on. You work " +
  "ONLY with the practicals given to you: you never invent a practical and never " +
  "drop one. Output must obey the provided JSON schema exactly.";

function buildPathPrompt(ctx: SubjectContext): string {
  const coBlock =
    ctx.courseOutcomes.length > 0
      ? ctx.courseOutcomes.map((c) => `  ${c.co_code}: ${c.description}`).join("\n")
      : "  (no course outcomes recorded)";

  const practicalBlock = ctx.practicals
    .map((p) => `  #${p.sr_no}${p.hours ? ` (${p.hours}h)` : ""}: ${p.name}`)
    .join("\n");

  const allNos = ctx.practicals.map((p) => p.sr_no).join(", ");

  return `Subject: ${ctx.subjectName}${ctx.subjectCode ? ` (${ctx.subjectCode})` : ""}

<all_modules_digest>
${buildModuleDigest(ctx.modules)}
</all_modules_digest>

<course_outcomes>
${coBlock}
</course_outcomes>

<practicals>
These are the ONLY practicals. Every number below must appear in exactly one unit:
${practicalBlock}
</practicals>

RULES (follow every one):
1. Partition ALL of these practical numbers into ${MIN_UNITS}-${MAX_UNITS} teaching units:
   ${allNos}
   Every number appears in EXACTLY ONE unit. Never invent a practical number that
   is not listed. Never drop one.
2. Group by conceptual dependency, and order both the units and the practicals
   within each unit for learning progression. You MAY reorder relative to the
   syllabus numbering above — if you do, say why in that unit's rationale.
3. name: a short teaching-unit name (≤60 chars) describing the skill it builds.
4. rationale (≤200 chars): why these practicals belong together in this order.
   Be concrete about the dependency, not generic ("builds on the file I/O from
   #3 before adding buffering", not "these are related topics").
5. bridges: propose 0-2 ONLY where consecutive units have a genuine conceptual
   jump a student would fall into. Each is a ≤15-minute micro-exercise that
   closes that specific gap, marked supplementary — it is NOT a practical and
   NOT part of the term work. If there is no real jump, return an empty array.
   afterPracticalNo must be the LAST practical of the earlier unit.
6. Output JSON only, conforming to the schema.`;
}

// Narrow schema (§19) — `approved` is faculty state, never AI-set.
const PATH_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    units: {
      type: "array",
      minItems: MIN_UNITS,
      maxItems: MAX_UNITS,
      items: {
        type: "object",
        properties: {
          unitNo: { type: "integer" },
          name: { type: "string", maxLength: 60 },
          practicalNos: { type: "array", items: { type: "integer" } },
          rationale: { type: "string", maxLength: 200 },
        },
        required: ["unitNo", "name", "practicalNos", "rationale"],
      },
    },
    bridges: {
      type: "array",
      maxItems: MAX_BRIDGES,
      items: {
        type: "object",
        properties: {
          afterPracticalNo: { type: "integer" },
          title: { type: "string", maxLength: 80 },
          statement: { type: "string", maxLength: 400 },
          expected: { type: "string", maxLength: 200 },
        },
        required: ["afterPracticalNo", "title", "statement", "expected"],
      },
    },
  },
  required: ["units", "bridges"],
};

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = String(text ?? "").trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to brace salvage
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* give up */
    }
  }
  return null;
}

function str(v: unknown, max: number): string {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * The gate. Guarantees the returned path is a TRUE PARTITION of the real
 * practical numbers, whatever the model did. Exported for direct unit-testing
 * against forced-bad fixtures — the AI call is not needed to exercise it.
 */
export function validateLearningPath(
  rawUnits: unknown,
  rawBridges: unknown,
  validPracticalNos: number[],
): { units: PathUnit[]; bridges: BridgeExercise[]; warnings: LabManualWarning[] } {
  const warnings: LabManualWarning[] = [];
  const validSet = new Set(validPracticalNos);
  const seen = new Set<number>();

  const units: PathUnit[] = [];
  const rawUnitList = Array.isArray(rawUnits) ? (rawUnits as unknown[]) : [];

  for (const u of rawUnitList) {
    const row = (u ?? {}) as Record<string, unknown>;
    const nos = Array.isArray(row.practicalNos) ? (row.practicalNos as unknown[]) : [];
    const kept: number[] = [];

    for (const raw of nos) {
      const n = Math.trunc(Number(raw));
      if (!Number.isFinite(n) || !validSet.has(n)) {
        // A number that isn't in the syllabus at all: the model invented it.
        if (raw != null && String(raw).trim() !== "") {
          warnings.push({
            practicalNo: null,
            kind: "path_practical_missing",
            message: `Unit "${str(row.name, 60)}" listed practical #${String(raw)}, which is not in this subject's syllabus — removed.`,
          });
        }
        continue;
      }
      if (seen.has(n)) {
        // Duplicated across (or within) units — first occurrence wins.
        warnings.push({
          practicalNo: n,
          kind: "path_practical_duplicated",
          message: `Practical #${n} was placed in more than one unit — kept only its first placement.`,
        });
        continue;
      }
      seen.add(n);
      kept.push(n);
    }

    // An empty unit carries no teaching meaning; drop rather than render it.
    if (kept.length === 0) continue;

    units.push({
      unitNo: units.length + 1, // renumber densely — the model's own numbering may skip
      name: str(row.name, 60) || `Unit ${units.length + 1}`,
      practicalNos: kept,
      rationale: str(row.rationale, 200),
    });
  }

  // Missing practicals → appended as a final "Ungrouped" unit. Never dropped:
  // an un-manualed practical is worse than an awkwardly grouped one.
  const missing = validPracticalNos.filter((n) => !seen.has(n));
  if (missing.length > 0) {
    units.push({
      unitNo: units.length + 1,
      name: "Ungrouped",
      practicalNos: missing,
      rationale:
        "Not placed in any unit by the AI proposal — review and move these into the right unit.",
    });
    warnings.push({
      practicalNo: null,
      kind: "path_practical_missing",
      message: `Practical(s) ${missing.join(", ")} were not placed in any unit — appended as "Ungrouped".`,
    });
  }

  // Bridges: truncate past the cap, and drop any anchored to a practical that
  // doesn't exist (a bridge pointing nowhere can't render between units).
  const rawBridgeList = Array.isArray(rawBridges) ? (rawBridges as unknown[]) : [];
  const bridges: BridgeExercise[] = [];
  for (const b of rawBridgeList) {
    const row = (b ?? {}) as Record<string, unknown>;
    const after = Math.trunc(Number(row.afterPracticalNo));
    if (!Number.isFinite(after) || !validSet.has(after)) continue;
    const title = str(row.title, 80);
    const statement = str(row.statement, 400);
    if (!title || !statement) continue;
    bridges.push({
      afterPracticalNo: after,
      title,
      statement,
      expected: str(row.expected, 200),
    });
  }
  if (bridges.length > MAX_BRIDGES) {
    warnings.push({
      practicalNo: null,
      kind: "path_bridges_truncated",
      message: `AI proposed ${bridges.length} bridge exercises — kept the first ${MAX_BRIDGES} (they are supplementary, not term work).`,
    });
    bridges.length = MAX_BRIDGES;
  }

  return { units, bridges, warnings };
}

/**
 * Generate a learning-path proposal for a subject. Returns the validated path
 * with `approved: false` — faculty approval is a UI action, never an AI one.
 */
export async function generateLearningPath(
  ctx: SubjectContext,
  logContext: AILogContext,
): Promise<{ path: LearningPath; warnings: LabManualWarning[] }> {
  const validPracticalNos = ctx.practicals.map((p) => p.sr_no);
  if (validPracticalNos.length === 0) {
    return {
      path: { units: [], bridges: [], approved: false },
      warnings: [],
    };
  }

  let raw: Record<string, unknown> | null = null;
  try {
    const res = await routeAI("lab_path_gen", {
      model: "flash",
      messages: [{ role: "user", content: buildPathPrompt(ctx) }],
      systemPrompt: PATH_SYSTEM_PROMPT,
      temperature: 0.4,
      responseSchema: PATH_RESPONSE_SCHEMA,
      thinkingBudget: 0,
      logContext: {
        ...logContext,
        metadata: {
          ...(logContext.metadata ?? {}),
          stage: "path",
          practicalCount: validPracticalNos.length,
        },
      },
    });
    raw = parseJsonObject(String(res.content ?? ""));
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.warn(`[labmanual path] generation failed: ${message}`);
  }

  // A total AI failure still yields a usable, honest path: everything Ungrouped
  // with a warning, so the faculty can group it by hand rather than hit a wall.
  const { units, bridges, warnings } = validateLearningPath(
    raw?.units,
    raw?.bridges,
    validPracticalNos,
  );

  return { path: { units, bridges, approved: false }, warnings };
}
