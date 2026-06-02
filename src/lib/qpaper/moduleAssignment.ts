/**
 * Pure-TypeScript module → question-slot assignment.
 *
 * Given the modules that belong to a section and the section's question
 * template, return the ordered list of "slots" with an explicit module
 * assignment for each. No AI, no DB calls.
 *
 * Why deterministic? Letting Gemini decide the module-per-question made
 * weightage drift; the model would over-weight whichever module had the
 * longest description. Computing the mapping here means weightage is
 * honored exactly and the prompt only has to *write* — not *plan*.
 */

import type { TemplateSection } from "./templates";

// ─── Public types ──────────────────────────────────────────────────────────

export interface ModuleData {
  module_number: number;
  name: string;
  description?: string | null;
  weightage_percent?: number | null;
  /** Either numeric levels (1..6) or text labels ("Remember", "Apply", ...). */
  btl_levels?: string[] | number[] | null;
  hours?: number | null;
}

export interface QuestionSlot {
  /** Stable identifier — `Q${qNum}` for solo slots, `Q${qNum}_<roman>` for sub-parts. */
  slotKey: string;
  /** Friendly label shown in prompts e.g. "Q - 1 (i)". */
  display: string;
  marks: number;
  moduleNumber: number;
  moduleName: string;
  /** Numeric BTL levels the module *allows* (already normalised to 1..6). */
  allowedBtlLevels: number[];
  /** Recommended [min, max] BTL for this question type (clamped to allowed). */
  targetBtlRange: [number, number];
  /** Course outcomes that this slot's module supports (codes only). */
  cos: string[];
  /** Programme outcomes reachable via the COs above. */
  pos: string[];
  /** If true, this slot is the OR-alternative of an earlier slot — same module. */
  isOrAlternative: boolean;
}

export interface SlotAssignmentContext {
  /** Map from CO code → array of `{ po_code, strength }`. */
  coPoMap?: Map<string, Array<{ po_code: string; strength: number }>>;
  /**
   * Optional CO codes per module (if your data has it). When omitted, every
   * slot just sees the full CO list of the subject.
   */
  moduleCosFn?: (moduleNumber: number) => string[];
  /** Full list of CO codes for the subject (fallback when moduleCosFn absent). */
  allCoCodes?: string[];
}

// ─── Constants ─────────────────────────────────────────────────────────────

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
const LETTERS = "abcdefghijklm".split("");

const BTL_LABEL_TO_LEVEL: Record<string, number> = {
  remember: 1,
  understand: 2,
  apply: 3,
  analyze: 4,
  analyse: 4,
  evaluate: 5,
  create: 6,
};

const DEFAULT_BTL_LEVELS = [1, 2, 3, 4];

/** Question-type → recommended (min, max) BTL range. */
const TYPE_BTL_RANGE: Record<string, [number, number]> = {
  mcq: [1, 2],
  descriptive: [2, 4],
  numerical: [3, 4],
  descriptive_with_or: [2, 4],
  attempt_any_one: [2, 3],
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function normaliseBtl(raw: ModuleData["btl_levels"]): number[] {
  if (!raw || (Array.isArray(raw) && raw.length === 0)) {
    return [...DEFAULT_BTL_LEVELS];
  }
  const out = new Set<number>();
  for (const item of raw as Array<string | number>) {
    if (typeof item === "number" && item >= 1 && item <= 6) {
      out.add(Math.trunc(item));
      continue;
    }
    const s = String(item).trim().toLowerCase();
    const asNum = Number(s);
    if (Number.isFinite(asNum) && asNum >= 1 && asNum <= 6) {
      out.add(Math.trunc(asNum));
      continue;
    }
    if (BTL_LABEL_TO_LEVEL[s] != null) {
      out.add(BTL_LABEL_TO_LEVEL[s]);
    }
  }
  return out.size > 0
    ? Array.from(out).sort((a, b) => a - b)
    : [...DEFAULT_BTL_LEVELS];
}

function clampRangeToAllowed(
  [lo, hi]: [number, number],
  allowed: number[]
): [number, number] {
  if (allowed.length === 0) return [lo, hi];
  const inRange = allowed.filter((b) => b >= lo && b <= hi);
  if (inRange.length > 0) {
    return [Math.min(...inRange), Math.max(...inRange)];
  }
  // No overlap — degrade gracefully to the nearest single allowed level.
  const nearest = allowed
    .map((b) => ({ b, d: Math.min(Math.abs(b - lo), Math.abs(b - hi)) }))
    .sort((a, b) => a.d - b.d)[0].b;
  return [nearest, nearest];
}

function computeEffectiveWeights(
  modules: ModuleData[]
): Array<{ module: ModuleData; weight: number }> {
  const allMissing = modules.every(
    (m) => m.weightage_percent == null || m.weightage_percent === 0
  );
  if (allMissing) {
    const w = 100 / Math.max(1, modules.length);
    return modules.map((m) => ({ module: m, weight: w }));
  }
  const fallback = 100 / Math.max(1, modules.length);
  return modules.map((m) => ({
    module: m,
    weight: m.weightage_percent ?? fallback,
  }));
}

function distributeMcqsAcrossModules(
  count: number,
  weighted: Array<{ module: ModuleData; weight: number }>
): ModuleData[] {
  if (count <= 0 || weighted.length === 0) return [];
  const total = weighted.reduce((s, w) => s + w.weight, 0) || 1;

  // Largest-remainder allocation — proportional but always sums to `count`.
  const exact = weighted.map(({ module, weight }) => ({
    module,
    weight,
    raw: (weight / total) * count,
  }));
  const floors = exact.map((e) => ({
    module: e.module,
    weight: e.weight,
    n: Math.floor(e.raw),
    frac: e.raw - Math.floor(e.raw),
  }));
  let allocated = floors.reduce((s, f) => s + f.n, 0);
  // Distribute leftovers to largest fractional remainders (ties → higher weight).
  const remainderOrder = [...floors]
    .map((f, idx) => ({ idx, frac: f.frac, weight: f.weight }))
    .sort((a, b) => b.frac - a.frac || b.weight - a.weight);
  let i = 0;
  while (allocated < count && remainderOrder.length > 0) {
    floors[remainderOrder[i % remainderOrder.length].idx].n += 1;
    allocated += 1;
    i += 1;
  }
  // Expand to per-slot array, preserving module-number order.
  const ordered = [...floors].sort(
    (a, b) => a.module.module_number - b.module.module_number
  );
  const out: ModuleData[] = [];
  for (const f of ordered) {
    for (let k = 0; k < f.n; k++) out.push(f.module);
  }
  return out;
}

function makePicker(
  weighted: Array<{ module: ModuleData; weight: number }>,
  sectionMarks: number
) {
  const total = weighted.reduce((s, w) => s + w.weight, 0) || 1;
  const target = new Map<number, number>(
    weighted.map((w) => [
      w.module.module_number,
      (w.weight / total) * sectionMarks,
    ])
  );
  const assigned = new Map<number, number>(
    weighted.map((w) => [w.module.module_number, 0])
  );
  const byNumber = new Map<number, ModuleData>(
    weighted.map((w) => [w.module.module_number, w.module])
  );

  function pickModule(exclude: Set<number> = new Set()): ModuleData {
    // Sort by largest shortfall; tie-break by lower module number.
    const candidates = Array.from(byNumber.values())
      .filter((m) => !exclude.has(m.module_number))
      .map((m) => ({
        module: m,
        shortfall: (target.get(m.module_number) ?? 0) -
          (assigned.get(m.module_number) ?? 0),
      }))
      .sort((a, b) => {
        if (Math.abs(b.shortfall - a.shortfall) > 1e-9) {
          return b.shortfall - a.shortfall;
        }
        return a.module.module_number - b.module.module_number;
      });
    return (
      candidates[0]?.module ??
      // Exhausted exclusions — fall back to any module.
      Array.from(byNumber.values())[0]
    );
  }

  function commit(module: ModuleData, marks: number) {
    assigned.set(
      module.module_number,
      (assigned.get(module.module_number) ?? 0) + marks
    );
  }

  return { pickModule, commit };
}

// ─── Public entry point ────────────────────────────────────────────────────

export function assignModulesToSlots(
  modules: ModuleData[],
  sectionTemplate: TemplateSection,
  ctx: SlotAssignmentContext = {}
): QuestionSlot[] {
  if (modules.length === 0) return [];

  const sectionMarks =
    sectionTemplate.total_marks > 0
      ? sectionTemplate.total_marks
      : sectionTemplate.questions.reduce(
          (sum, q) => sum + (q.total_marks || 0),
          0
        ) || 30;

  const weighted = computeEffectiveWeights(modules);
  const { pickModule, commit } = makePicker(weighted, sectionMarks);

  const slots: QuestionSlot[] = [];

  // Looks up COs for a module — defaults to the subject's full CO list so the
  // prompt always has *something* to assign from.
  const cosFor = (moduleNumber: number): string[] => {
    if (ctx.moduleCosFn) {
      const ms = ctx.moduleCosFn(moduleNumber);
      if (ms.length > 0) return ms;
    }
    return ctx.allCoCodes ?? [];
  };

  // POs are derived from each candidate CO via the CO-PO mapping.
  const posFor = (cos: string[]): string[] => {
    if (!ctx.coPoMap || ctx.coPoMap.size === 0) return [];
    const seen = new Set<string>();
    for (const co of cos) {
      const list = ctx.coPoMap.get(co) ?? [];
      for (const { po_code } of list) seen.add(po_code);
    }
    return Array.from(seen);
  };

  const buildSlot = (params: {
    slotKey: string;
    display: string;
    module: ModuleData;
    marks: number;
    qType: string;
    isOr?: boolean;
  }): QuestionSlot => {
    const allowed = normaliseBtl(params.module.btl_levels);
    const target = clampRangeToAllowed(
      TYPE_BTL_RANGE[params.qType] ?? [2, 3],
      allowed
    );
    const cos = cosFor(params.module.module_number);
    return {
      slotKey: params.slotKey,
      display: params.display,
      marks: params.marks,
      moduleNumber: params.module.module_number,
      moduleName: params.module.name,
      allowedBtlLevels: allowed,
      targetBtlRange: target,
      cos,
      pos: posFor(cos),
      isOrAlternative: params.isOr ?? false,
    };
  };

  // Slot keys are SECTION-RELATIVE (Q1..Q4), not paper-absolute. The template
  // may carry paper-wide numbering (Section II → q_number 5..8) but that's a
  // PDF concern; the prompt + validator only ever see Q1..Q4.
  sectionTemplate.questions.forEach((q, qIdx) => {
    const sectionQNum = qIdx + 1;
    const qLabel = q.display_label ?? `Q - ${sectionQNum}`;

    if (q.type === "mcq") {
      const subCount = q.sub_parts ?? 0;
      const marksPer = q.marks_per_part ?? 1;
      const mcqModules = distributeMcqsAcrossModules(subCount, weighted);
      for (let i = 0; i < subCount; i++) {
        const mod = mcqModules[i] ?? pickModule();
        commit(mod, marksPer);
        slots.push(
          buildSlot({
            slotKey: `Q${sectionQNum}_${ROMAN[i] ?? `s${i + 1}`}`,
            display: `${qLabel} (${ROMAN[i] ?? `s${i + 1}`})`,
            module: mod,
            marks: marksPer,
            qType: "mcq",
          })
        );
      }
      return;
    }

    if (q.type === "descriptive") {
      const mod = pickModule();
      commit(mod, q.total_marks);
      slots.push(
        buildSlot({
          slotKey: `Q${sectionQNum}`,
          display: qLabel,
          module: mod,
          marks: q.total_marks,
          qType: q.has_numerical ? "numerical" : "descriptive",
        })
      );
      return;
    }

    if (q.type === "descriptive_with_or") {
      const partLabels = q.parts ?? ["a", "b"];
      const marksPerPart =
        q.marks_per_part ?? Math.floor(q.total_marks / partLabels.length);
      // Primary parts: distinct modules where the section has enough variety.
      const primaryUsed = new Set<number>();
      const primarySlots: QuestionSlot[] = [];
      for (const p of partLabels) {
        const exclude =
          modules.length > primaryUsed.size ? primaryUsed : new Set<number>();
        const mod = pickModule(exclude);
        primaryUsed.add(mod.module_number);
        commit(mod, marksPerPart);
        const slot = buildSlot({
          slotKey: `Q${sectionQNum}${p}`,
          display: `${qLabel} (${p})`,
          module: mod,
          marks: marksPerPart,
          qType: "descriptive",
        });
        primarySlots.push(slot);
        slots.push(slot);
      }
      // OR alternatives: same module as their primary counterpart — the student
      // picks which side to attempt, the module coverage is unchanged.
      partLabels.forEach((p, i) => {
        const primary = primarySlots[i];
        const primaryMod = modules.find(
          (m) => m.module_number === primary.moduleNumber
        );
        if (!primaryMod) return;
        slots.push(
          buildSlot({
            slotKey: `Q${sectionQNum}${p}_or`,
            display: `${qLabel} OR (${p})`,
            module: primaryMod,
            marks: marksPerPart,
            qType: "descriptive",
            isOr: true,
          })
        );
      });
      return;
    }

    if (q.type === "attempt_any_one") {
      // Single PARENT slot for attempt_any_one. The AI emits one top-level
      // entry with nested options[]; both options share this module. Picking
      // distinct modules per option made the validator's slot-lookup miss
      // because the AI never produces Q4_i / Q4_ii as top-level keys.
      const mod = pickModule();
      commit(mod, q.total_marks);
      slots.push(
        buildSlot({
          slotKey: `Q${sectionQNum}`,
          display: qLabel,
          module: mod,
          marks: q.total_marks,
          qType: "attempt_any_one",
        })
      );
      return;
    }
  });

  return slots;
}

// ─── Slot-key helpers used by the prompt + validator ───────────────────────

export function mcqSubSlotKey(qNumber: number, idx: number): string {
  return `Q${qNumber}_${ROMAN[idx] ?? `s${idx + 1}`}`;
}

export function descriptiveSlotKey(qNumber: number): string {
  return `Q${qNumber}`;
}

export function orPrimarySlotKey(qNumber: number, idx: number): string {
  return `Q${qNumber}${LETTERS[idx] ?? `p${idx + 1}`}`;
}

export function orAlternativeSlotKey(qNumber: number, idx: number): string {
  return `Q${qNumber}${LETTERS[idx] ?? `p${idx + 1}`}_or`;
}

export function attemptAnySlotKey(qNumber: number, idx: number): string {
  return `Q${qNumber}_${ROMAN[idx] ?? `o${idx + 1}`}`;
}
