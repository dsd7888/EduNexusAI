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
import {
  isPoolItemMcqLike,
  poolItemAssignmentQType,
  type QuestionType,
} from "./templates";

// ─── Public types ──────────────────────────────────────────────────────────

/** A single difficulty bucket target (percentage of the section's slots). */
export interface DifficultyTarget {
  difficulty: "easy" | "medium" | "hard";
  pct: number;
}

export interface ModuleData {
  /** DB module id — needed to resolve a per-question pinnedModuleId. */
  id?: string;
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
  /**
   * True when the template pinned this slot's module explicitly. Such a slot is
   * never reassigned by the coverage floor, and the coverage ledger uses the
   * same fact to tell a pin apart from ordinary weightage rounding.
   */
  pinned?: boolean;
  /**
   * AI sourcing style for this slot, when the caller has allocated one
   * (from allocateSlotSources). "pyq_style" → mirror PYQ phrasing/framing;
   * "fresh" → original framing. Unset = no per-slot style directive.
   */
  style?: "fresh" | "pyq_style";
  /** Set on atomic slots inside a pool block — drives per-item prompt directives. */
  poolItemType?: QuestionType;
  /** Generation difficulty directive for this slot (from difficultyTargets). */
  targetDifficulty?: "easy" | "medium" | "hard";
  /**
   * The CO this slot primarily serves — set when coTargets is active and the
   * slot's module can supply an under-served CO. Secondary to weightage.
   */
  targetCo?: string;
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
  /**
   * Paper-wide BTL eligibility filter [min, max]. When set, overrides the
   * per-question-type TYPE_BTL_RANGE as each slot's targetBtlRange (clamped to
   * the module's allowed levels).
   */
  btlRange?: [number, number];
  /**
   * CO code → target marks for THIS section (already prorated from the
   * paper-wide CO% by the route). Used as a secondary module-picker bias.
   */
  coTargets?: Map<string, number>;
  /** Per-slot difficulty directives, distributed across the section's slots. */
  difficultyTargets?: DifficultyTarget[];
  /**
   * Guarantee every module in this section at least one slot, when the section
   * has room for it (slots >= modules).
   *
   * Weightage-proportional allocation legitimately rounds a small module to
   * zero, which is how a selected unit could end up with no questions at all.
   * Selecting a unit is an inclusion decision, though, not a proportion one:
   * weightage should govern how MUCH of the paper a unit gets, not whether it
   * appears. Opt-in rather than automatic so the pure allocator keeps its
   * previous behaviour by default and only the generation path takes the floor.
   */
  ensureModuleFloor?: boolean;
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

// ─── Difficulty apportionment ───────────────────────────────────────────────

/**
 * Distributes `easy`/`medium`/`hard` difficulty labels across the section's
 * slots per the requested percentages, setting slot.targetDifficulty. Hamilton
 * largest-remainder for the per-bucket counts, then a greedy-deficit sweep so
 * labels are spread evenly rather than clustered.
 *
 * Difficulty is not gated by a module's allowed BTL levels — it's a generation
 * directive, not an eligibility filter — so every slot participates.
 */
function apportionDifficulty(
  slots: QuestionSlot[],
  targets: DifficultyTarget[]
): void {
  if (slots.length === 0 || targets.length === 0) return;
  const totalPct = targets.reduce((s, t) => s + t.pct, 0);
  if (totalPct <= 0) return;

  const n = slots.length;
  const labels = targets.map((t) => t.difficulty);
  const weights = targets.map((t) => (t.pct / totalPct) * 100);

  // Largest-remainder apportionment across the difficulty buckets.
  const exact = weights.map((w) => (n * w) / 100);
  const counts = exact.map((e) => Math.floor(e));
  let remainder = n - counts.reduce((a, b) => a + b, 0);
  const order = weights
    .map((w, i) => ({ i, f: exact[i] - counts[i], w }))
    .sort((a, b) => b.f - a.f || b.w - a.w || a.i - b.i);
  for (let k = 0; remainder > 0; k++, remainder--) {
    counts[order[k % order.length].i] += 1;
  }

  // Spread evenly: greedy deficit picks whichever bucket has the highest
  // remaining fraction of its budget.
  const remaining = [...counts];
  const bucketTargets = [...counts];
  for (let i = 0; i < n; i++) {
    let best = -1;
    let bestScore = -Infinity;
    for (let j = 0; j < labels.length; j++) {
      if (remaining[j] > 0) {
        const score = bucketTargets[j] > 0 ? remaining[j] / bucketTargets[j] : 0;
        if (score > bestScore) { bestScore = score; best = j; }
      }
    }
    if (best === -1) break;
    slots[i].targetDifficulty = labels[best];
    remaining[best]--;
  }
}

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
  sectionMarks: number,
  options?: {
    coTargets?: Map<string, number>;
    moduleCosFn?: (moduleNumber: number) => string[];
  }
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

  // CO bias state — only active when the caller passes coTargets. coAssigned
  // tracks marks credited to each targeted CO so far; every commit splits the
  // slot's marks equally across the COs its module supplies.
  const coTargets = options?.coTargets;
  const moduleCosFn = options?.moduleCosFn;
  const coAssigned = new Map<string, number>();
  if (coTargets) for (const co of coTargets.keys()) coAssigned.set(co, 0);

  const cosForModule = (moduleNumber: number): string[] =>
    moduleCosFn ? moduleCosFn(moduleNumber) : [];

  // Sum of remaining demand across the targeted COs this module can serve.
  const coScoreFor = (moduleNumber: number): number => {
    if (!coTargets) return 0;
    let score = 0;
    for (const co of cosForModule(moduleNumber)) {
      const remaining = (coTargets.get(co) ?? 0) - (coAssigned.get(co) ?? 0);
      if (remaining > 0) score += remaining;
    }
    return score;
  };

  function pickModule(exclude: Set<number> = new Set()): ModuleData {
    // Weightage (shortfall) is the PRIMARY criterion: a shortfall gap wider
    // than 5% of the section wins unconditionally. Only within that band does
    // CO demand break the tie, then lower module number.
    const candidates = Array.from(byNumber.values())
      .filter((m) => !exclude.has(m.module_number))
      .map((m) => ({
        module: m,
        shortfall: (target.get(m.module_number) ?? 0) -
          (assigned.get(m.module_number) ?? 0),
        coScore: coScoreFor(m.module_number),
      }))
      .sort((a, b) => {
        if (Math.abs(a.shortfall - b.shortfall) > sectionMarks * 0.05) {
          return b.shortfall - a.shortfall;
        }
        if (b.coScore !== a.coScore) return b.coScore - a.coScore;
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
    if (coTargets) {
      const mCos = cosForModule(module.module_number);
      if (mCos.length > 0) {
        const per = marks / mCos.length;
        for (const co of mCos) {
          coAssigned.set(co, (coAssigned.get(co) ?? 0) + per);
        }
      }
    }
  }

  // The targeted CO this module is best placed to serve — the one with the
  // highest remaining demand among the module's COs. Undefined when CO
  // targeting is off or the module has no under-served CO.
  function targetCoFor(moduleNumber: number): string | undefined {
    if (!coTargets) return undefined;
    let best: string | undefined;
    let bestRemaining = 0;
    for (const co of cosForModule(moduleNumber)) {
      if (!coTargets.has(co)) continue;
      const remaining = (coTargets.get(co) ?? 0) - (coAssigned.get(co) ?? 0);
      if (remaining > 0 && remaining > bestRemaining) {
        bestRemaining = remaining;
        best = co;
      }
    }
    return best;
  }

  return { pickModule, commit, targetCoFor };
}

/**
 * Resolve a per-question pinnedModuleId against this section's modules. Falls
 * back to null (→ automatic pickModule) with a warning when the module was
 * deselected/removed after being pinned.
 */
function resolvePinnedModule(
  pinnedModuleId: string,
  modules: ModuleData[]
): ModuleData | null {
  const found = modules.find((m) => m.id === pinnedModuleId);
  if (!found) {
    console.warn(
      `[moduleAssignment] pinned module ${pinnedModuleId} not found in section modules — falling back to automatic assignment`
    );
    return null;
  }
  return found;
}

/**
 * Give every module at least one slot, by reassigning slots from the modules
 * that hold the most.
 *
 * A post-pass rather than a change to pickModule: the picker is greedy and
 * per-slot, so it cannot see a global "every module needs one" constraint
 * without losing the weightage proportionality that is its whole job. Fixing it
 * up afterwards keeps both properties — proportional in the large, complete in
 * the small.
 *
 * Never touches:
 *   - pinned slots, which encode an explicit faculty decision;
 *   - OR-alternative slots, which must stay on their primary's module or the
 *     two sides of an OR would come from different units;
 *   - a donor's last remaining slot, which would just move the hole.
 *
 * Reassignment REBUILDS the slot rather than rewriting moduleNumber, because a
 * slot also carries the module's BTL levels, COs and POs — patching the number
 * alone would leave a slot describing one module while tagged for another.
 */
function applyModuleCoverageFloor(
  slots: QuestionSlot[],
  modules: ModuleData[],
  buildSlot: (params: {
    slotKey: string;
    display: string;
    module: ModuleData;
    marks: number;
    qType: string;
    isOr?: boolean;
    poolItemType?: QuestionType;
    pinned?: boolean;
  }) => QuestionSlot
): void {
  // Not enough slots to go round: forcing the floor would just move the gap to
  // another module, and the coverage ledger explains it honestly instead.
  if (slots.length < modules.length) return;

  const countFor = (n: number) => slots.filter((s) => s.moduleNumber === n).length;
  const missing = modules.filter((m) => countFor(m.module_number) === 0);
  if (missing.length === 0) return;

  for (const needy of missing) {
    // Donor = the module with the most slots that can spare one.
    let donorNumber = -1;
    let donorCount = 1;
    for (const m of modules) {
      const c = countFor(m.module_number);
      if (c > donorCount) {
        donorCount = c;
        donorNumber = m.module_number;
      }
    }
    if (donorNumber === -1) break; // nothing can spare a slot

    // Prefer the donor's LAST eligible slot: later slots are typically the
    // lower-stakes tail of a section, so the visible reshuffle is smaller.
    let idx = -1;
    for (let i = slots.length - 1; i >= 0; i--) {
      const s = slots[i];
      if (s.moduleNumber !== donorNumber) continue;
      if (s.pinned || s.isOrAlternative) continue;
      // An OR primary must not move either: its alternative is pinned to it.
      const hasDependentOr = slots.some(
        (o) => o.isOrAlternative && o.slotKey === `${s.slotKey}_or`
      );
      if (hasDependentOr) continue;
      idx = i;
      break;
    }
    if (idx === -1) continue; // donor's slots are all immovable

    const old = slots[idx];
    slots[idx] = {
      ...buildSlot({
        slotKey: old.slotKey,
        display: old.display,
        module: needy,
        marks: old.marks,
        // The slot's question type is not stored on QuestionSlot; poolItemType
        // recovers it for pool slots, and the generic descriptive range is the
        // right default elsewhere. targetBtlRange is recomputed from the new
        // module's own levels either way.
        qType: old.poolItemType
          ? poolItemAssignmentQType(old.poolItemType)
          : "descriptive",
        ...(old.poolItemType ? { poolItemType: old.poolItemType } : {}),
      }),
      // Preserve the per-slot directives the caller already allocated; they
      // belong to the SLOT, not to whichever module fills it.
      ...(old.style ? { style: old.style } : {}),
      ...(old.targetDifficulty ? { targetDifficulty: old.targetDifficulty } : {}),
    };
  }
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

  // Picker is hoisted here so buildSlot can read its CO-bias state
  // (targetCoFor). The module CO lookup fed to the picker mirrors cosFor.
  const picker = makePicker(weighted, sectionMarks, {
    coTargets: ctx.coTargets,
    moduleCosFn: cosFor,
  });
  const { pickModule, commit } = picker;

  const buildSlot = (params: {
    slotKey: string;
    display: string;
    module: ModuleData;
    marks: number;
    qType: string;
    isOr?: boolean;
    poolItemType?: QuestionType;
    pinned?: boolean;
  }): QuestionSlot => {
    const allowed = normaliseBtl(params.module.btl_levels);
    // A paper-wide btlRange takes precedence over the per-type default range;
    // both are clamped to the module's allowed levels.
    const target = clampRangeToAllowed(
      ctx.btlRange ?? TYPE_BTL_RANGE[params.qType] ?? [2, 3],
      allowed
    );
    const cos = cosFor(params.module.module_number);
    const targetCo = picker.targetCoFor(params.module.module_number);
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
      ...(params.pinned ? { pinned: true } : {}),
      ...(params.poolItemType ? { poolItemType: params.poolItemType } : {}),
      ...(targetCo ? { targetCo } : {}),
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
      const pinnedModule = q.pinnedModuleId
        ? resolvePinnedModule(q.pinnedModuleId, modules)
        : null;
      const mcqModules = pinnedModule
        ? Array.from({ length: subCount }, () => pinnedModule)
        : distributeMcqsAcrossModules(subCount, weighted);
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
            pinned: Boolean(pinnedModule),
          })
        );
      }
      return;
    }

    if (q.type === "descriptive") {
      const pinnedModule = q.pinnedModuleId
        ? resolvePinnedModule(q.pinnedModuleId, modules)
        : null;
      const mod = pinnedModule ?? pickModule();
      commit(mod, q.total_marks);
      slots.push(
        buildSlot({
          slotKey: `Q${sectionQNum}`,
          display: qLabel,
          module: mod,
          marks: q.total_marks,
          qType: q.has_numerical ? "numerical" : "descriptive",
          pinned: Boolean(pinnedModule),
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

    if (q.type === "pool") {
      const marksPer = q.marksPerItem;
      let globalIdx = 0;
      for (const row of q.composition) {
        const count = Math.max(0, row.count);
        const qType = poolItemAssignmentQType(row.itemType);
        const pinnedModule = row.pinnedModuleId
          ? resolvePinnedModule(row.pinnedModuleId, modules)
          : null;
        const mcqModules = !pinnedModule && isPoolItemMcqLike(row.itemType)
          ? distributeMcqsAcrossModules(count, weighted)
          : null;
        for (let i = 0; i < count; i++) {
          const mod =
            pinnedModule ?? (mcqModules ? (mcqModules[i] ?? pickModule()) : pickModule());
          commit(mod, marksPer);
          slots.push(
            buildSlot({
              slotKey: `Q${sectionQNum}_${ROMAN[globalIdx] ?? `s${globalIdx + 1}`}`,
              display: `${qLabel} (${ROMAN[globalIdx] ?? `s${globalIdx + 1}`})`,
              module: mod,
              marks: marksPer,
              qType,
              poolItemType: row.itemType,
              pinned: Boolean(pinnedModule),
            })
          );
          globalIdx++;
        }
      }
      return;
    }
  });

  // Coverage floor: give every module in this section at least one slot when
  // there is room. Runs BEFORE difficulty apportionment so reassigned slots
  // still receive a difficulty directive.
  if (ctx.ensureModuleFloor) {
    applyModuleCoverageFloor(slots, modules, buildSlot);
  }

  // BTL: buildSlot already set every slot's targetBtlRange from ctx.btlRange
  // (or the per-question-type TYPE_BTL_RANGE default), clamped to the module's
  // allowed levels. Nothing further to apportion.

  // Difficulty% directives are independent of BTL — distribute them whenever
  // supplied.
  if (ctx.difficultyTargets && ctx.difficultyTargets.length > 0) {
    apportionDifficulty(slots, ctx.difficultyTargets);
  }

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
