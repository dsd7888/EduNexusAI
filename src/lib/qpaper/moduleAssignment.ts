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
  poolItemTokenBudgetType,
  poolItemTypeAtIndex,
  type QuestionType,
  type TemplatePoolQuestion,
} from "./templates";

// ─── Public types ──────────────────────────────────────────────────────────

export type DifficultyPreset =
  | "foundational"
  | "balanced"
  | "application_heavy"
  | "custom";

/** Faculty-supplied tier weights, used when the "custom" preset is active. */
export interface CustomBtlWeights {
  /** BTL 1–2 weight. */
  tier1: number;
  /** BTL 3–4 weight. */
  tier2: number;
  /** BTL 5–6 weight. */
  tier3: number;
}

/** A single difficulty bucket target (percentage of the section's slots). */
export interface DifficultyTarget {
  difficulty: "easy" | "medium" | "hard";
  pct: number;
}

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
  /** When set, biases per-slot targetBtlRange toward the preset's tier weights. */
  difficultyPreset?: DifficultyPreset;
  /** Tier weights to use when difficultyPreset === "custom". */
  customBtlWeights?: CustomBtlWeights | null;
  /**
   * Paper-wide BTL eligibility filter [min, max]. When set, overrides the
   * per-question-type TYPE_BTL_RANGE as each slot's targetBtlRange (clamped to
   * the module's allowed levels) and suppresses apportionBtlTiers.
   */
  btlRange?: [number, number];
  /**
   * CO code → target marks for THIS section (already prorated from the
   * paper-wide CO% by the route). Used as a secondary module-picker bias.
   */
  coTargets?: Map<string, number>;
  /** Per-slot difficulty directives, distributed across the section's slots. */
  difficultyTargets?: DifficultyTarget[];
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

// ─── Difficulty preset ──────────────────────────────────────────────────────

/** [tier1-weight, tier2-weight, tier3-weight] summing to 100. */
const PRESET_TIER_WEIGHTS: Record<
  Exclude<DifficultyPreset, "custom">,
  [number, number, number]
> = {
  foundational:      [50, 35, 15],
  balanced:          [25, 50, 25],
  application_heavy: [10, 45, 45],
};

/** Inclusive [lo, hi] BTL ranges for each tier (0=low, 1=mid, 2=high). */
export const BTL_TIER: [[number, number], [number, number], [number, number]] = [
  [1, 2],
  [3, 4],
  [5, 6],
];

/**
 * Which of the three BTL tiers (0 = BTL 1–2, 1 = BTL 3–4, 2 = BTL 5–6) a set
 * of allowed BTL levels can actually satisfy. Ascending tier order.
 */
export function achievableTiersForLevels(allowed: number[]): number[] {
  return [0, 1, 2].filter((t) => {
    const [lo, hi] = BTL_TIER[t];
    return allowed.some((b) => b >= lo && b <= hi);
  });
}

/**
 * THE renormalization primitive — the single source of truth shared by the real
 * generation path (apportionBtlTiers) and the live UI preview. Given full 3-tier
 * weights and the subset of tiers actually achievable, redistribute the weight
 * that would have gone to unachievable tiers proportionally across the achievable
 * ones so the result sums to 100. Returns one percentage per achievable tier,
 * positionally aligned with `achievableTiers`. Never reimplement this elsewhere.
 *
 * Example: a module that only supports BTL 1–4 has achievable tiers {0, 1}.
 *   Foundational {50,35,15} renormalizes to ~{59%, 41%} across tier0/tier1.
 *   Application-Heavy {10,45,45} renormalizes to ~{18%, 82%} across tier0/tier1.
 */
export function renormalizeTierWeights(
  weights: readonly [number, number, number],
  achievableTiers: number[]
): number[] {
  const rawW = achievableTiers.map((t) => weights[t]);
  const totalW = rawW.reduce((a, b) => a + b, 0);
  if (totalW === 0) return achievableTiers.map(() => 0);
  return rawW.map((w) => (w / totalW) * 100);
}

/** Resolve the effective 3-tier weights for a preset (or custom weights). */
export function resolveTierWeights(
  preset: DifficultyPreset,
  custom?: CustomBtlWeights | null
): [number, number, number] {
  if (preset === "custom") {
    if (!custom) return [...PRESET_TIER_WEIGHTS.balanced];
    return [custom.tier1, custom.tier2, custom.tier3];
  }
  return [...PRESET_TIER_WEIGHTS[preset]];
}

export interface BtlDistributionPreview {
  /** Achievable tiers (0/1/2 indices), ascending. Empty when no modules. */
  tiers: number[];
  /** Renormalized percentage per achievable tier, aligned with `tiers`. */
  percents: number[];
  /** Min/max achievable BTL level across the modules, or null when none. */
  span: [number, number] | null;
}

/**
 * High-level preview of how the active tier weights spread across whatever BTL
 * tiers the given modules collectively support, *weighted by each module's share
 * of the paper*. Mirrors the generation path: it normalises each module's BTL
 * levels exactly like assignModulesToSlots, then caps each tier's deliverable
 * percentage at the summed weightage of the modules that can actually reach it
 * before renormalizing the requested weights against those real ceilings.
 *
 * Why weight by module share? A tier is only as deliverable as the marks that
 * flow through modules supporting it. Treating tiers as binary achievable/not
 * (the old behaviour) let the preview promise e.g. 80% BTL 5–6 even when a single
 * module worth ~12% of the paper was the only one that could ever supply it.
 * Capping at that ~12% ceiling — then spreading the freed weight over the lower
 * tiers per the requested ratio — keeps the "~%" copy honest. Still approximate
 * by design (it ignores slot counts / largest-remainder rounding).
 */
export function previewBtlDistribution(
  modules: Array<Pick<ModuleData, "btl_levels" | "weightage_percent">>,
  weights: readonly [number, number, number]
): BtlDistributionPreview {
  if (modules.length === 0) return { tiers: [], percents: [], span: null };

  // Per-module normalised BTL levels + raw paper share. When every module is
  // missing a weightage, fall back to an even split (same spirit as
  // computeEffectiveWeights) so ceilings stay meaningful.
  const normalised = modules.map((m) => ({
    levels: normaliseBtl(m.btl_levels),
    weight: m.weightage_percent ?? 0,
  }));
  if (normalised.every((m) => m.weight <= 0)) {
    const even = 100 / normalised.length;
    for (const m of normalised) m.weight = even;
  }
  const totalWeight = normalised.reduce((s, m) => s + m.weight, 0) || 1;

  // Union of allowed levels → overall achievable span + tier set.
  const allowed = new Set<number>();
  for (const m of normalised) for (const b of m.levels) allowed.add(b);
  const allowedArr = Array.from(allowed).sort((a, b) => a - b);
  if (allowedArr.length === 0) return { tiers: [], percents: [], span: null };
  const tiers = achievableTiersForLevels(allowedArr);

  // Per-tier deliverable ceiling: the share of the paper carried by modules
  // whose levels reach that tier (a module spanning two tiers counts toward
  // both — it can supply either, just not both at full strength).
  const ceilings = [0, 1, 2].map((t) => {
    const [lo, hi] = BTL_TIER[t];
    const w = normalised
      .filter((m) => m.levels.some((b) => b >= lo && b <= hi))
      .reduce((s, m) => s + m.weight, 0);
    return (w / totalWeight) * 100;
  }) as [number, number, number];

  return {
    tiers,
    percents: capTierWeightsToCeilings(weights, ceilings, tiers),
    span: [allowedArr[0], allowedArr[allowedArr.length - 1]],
  };
}

/**
 * Proportional allocation of 100% across the achievable tiers in the ratio of
 * `weights`, but with each tier capped at its deliverable `ceilings[t]`. When a
 * tier's proportional share exceeds its ceiling it is pinned at the ceiling and
 * the surplus is redistributed across the remaining (uncapped) tiers in their
 * requested ratio — iterating until nothing else caps. Returns one percentage
 * per achievable tier, positionally aligned with `achievableTiers`.
 *
 * The weighted generalisation of renormalizeTierWeights: with every ceiling at
 * 100 (every module reaches every tier) it reduces to exactly that function.
 * sum(ceilings over achievable tiers) is always ≥ 100 — each module adds its
 * full share to at least one tier — so the surplus always finds a home.
 */
function capTierWeightsToCeilings(
  weights: readonly [number, number, number],
  ceilings: readonly [number, number, number],
  achievableTiers: number[]
): number[] {
  const result = new Map<number, number>(achievableTiers.map((t) => [t, 0]));
  const capped = new Set<number>();
  let remaining = 100;

  for (let guard = 0; guard <= achievableTiers.length; guard++) {
    const uncapped = achievableTiers.filter((t) => !capped.has(t));
    if (uncapped.length === 0 || remaining <= 1e-9) break;

    const totalW = uncapped.reduce((s, t) => s + weights[t], 0);
    if (totalW <= 0) {
      // Requested ratio gives the remaining tiers zero weight, yet the paper
      // must still be filled — spread the surplus by leftover ceiling capacity.
      const totalCap = uncapped.reduce(
        (s, t) => s + (ceilings[t] - (result.get(t) ?? 0)),
        0
      );
      if (totalCap <= 0) break;
      for (const t of uncapped) {
        const cap = ceilings[t] - (result.get(t) ?? 0);
        result.set(t, (result.get(t) ?? 0) + remaining * (cap / totalCap));
      }
      break;
    }

    // Pin any tier whose proportional share would breach its ceiling, then loop
    // so the surplus reflows to whoever still has headroom.
    let placed = 0;
    let newlyCapped = false;
    for (const t of uncapped) {
      if (remaining * (weights[t] / totalW) >= ceilings[t] - 1e-9) {
        placed += ceilings[t] - (result.get(t) ?? 0);
        result.set(t, ceilings[t]);
        capped.add(t);
        newlyCapped = true;
      }
    }
    if (newlyCapped) {
      remaining -= placed;
      continue;
    }

    // No tier breached — assign the rest proportionally and finish.
    for (const t of uncapped) {
      result.set(t, (result.get(t) ?? 0) + remaining * (weights[t] / totalW));
    }
    break;
  }

  return achievableTiers.map((t) => result.get(t) ?? 0);
}

/**
 * Mutates each slot's targetBtlRange to bias toward the given tier weights.
 *
 * Groups slots by which tiers their module can actually satisfy, then
 * renormalizes the weights across only those achievable tiers before
 * apportioning. This ensures different presets produce visibly different
 * distributions even when some modules don't cover all three tiers.
 */
function apportionBtlTiers(
  slots: QuestionSlot[],
  weights: readonly [number, number, number]
): void {
  if (slots.length === 0) return;

  // Group slot indices by their achievable tier set (comma-joined for Map key).
  const groups = new Map<string, number[]>();
  for (let i = 0; i < slots.length; i++) {
    const tiers = achievableTiersForLevels(slots[i].allowedBtlLevels);
    if (tiers.length === 0) continue; // no tier reachable — leave slot untouched
    const key = tiers.join(",");
    const arr = groups.get(key) ?? [];
    arr.push(i);
    groups.set(key, arr);
  }

  for (const [key, indices] of groups) {
    const achievable = key.split(",").map(Number);
    const n = indices.length;

    // Renormalize weights to only the achievable tiers for this group.
    const normW = renormalizeTierWeights(weights, achievable);
    if (normW.every((w) => w === 0)) continue;

    // Largest-remainder apportionment across achievable tiers.
    const exact = normW.map((w) => (n * w) / 100);
    const counts = exact.map((e) => Math.floor(e));
    let remainder = n - counts.reduce((a, b) => a + b, 0);
    const order = normW
      .map((w, i) => ({ i, f: exact[i] - counts[i], w }))
      .sort((a, b) => b.f - a.f || b.w - a.w || a.i - b.i);
    for (let k = 0; remainder > 0; k++, remainder--) {
      counts[order[k % order.length].i] += 1;
    }

    // Spread tier assignments evenly across the group: greedy deficit picks
    // whichever achievable tier has the highest remaining fraction of its budget.
    const tierSeq: number[] = [];
    const remaining = [...counts];
    const targets = [...counts];
    for (let i = 0; i < n; i++) {
      let best = -1;
      let bestScore = -Infinity;
      for (let j = 0; j < achievable.length; j++) {
        if (remaining[j] > 0) {
          const score = targets[j] > 0 ? remaining[j] / targets[j] : 0;
          if (score > bestScore) { bestScore = score; best = j; }
        }
      }
      if (best === -1) break;
      tierSeq.push(achievable[best]);
      remaining[best]--;
    }

    // Apply: tighten targetBtlRange to the assigned tier ∩ allowedBtlLevels.
    for (let i = 0; i < indices.length; i++) {
      const tier = tierSeq[i];
      if (tier === undefined) continue;
      const [lo, hi] = BTL_TIER[tier];
      const slot = slots[indices[i]];
      const inTier = slot.allowedBtlLevels.filter((b) => b >= lo && b <= hi);
      if (inTier.length > 0) {
        slot.targetBtlRange = [Math.min(...inTier), Math.max(...inTier)];
      }
    }
  }
}

/**
 * Distributes `easy`/`medium`/`hard` difficulty labels across the section's
 * slots per the requested percentages, setting slot.targetDifficulty. Mirrors
 * apportionBtlTiers: Hamilton largest-remainder for the per-bucket counts, then
 * a greedy-deficit sweep so labels are spread evenly rather than clustered.
 *
 * Unlike BTL tiers, difficulty is not gated by a module's allowed levels — it's
 * a generation directive — so every slot participates.
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

    if (q.type === "pool") {
      const marksPer = q.marksPerItem;
      let globalIdx = 0;
      for (const row of q.composition) {
        const count = Math.max(0, row.count);
        const qType = poolItemAssignmentQType(row.itemType);
        const mcqModules = isPoolItemMcqLike(row.itemType)
          ? distributeMcqsAcrossModules(count, weighted)
          : null;
        for (let i = 0; i < count; i++) {
          const mod = mcqModules
            ? (mcqModules[i] ?? pickModule())
            : pickModule();
          commit(mod, marksPer);
          slots.push(
            buildSlot({
              slotKey: `Q${sectionQNum}_${ROMAN[globalIdx] ?? `s${globalIdx + 1}`}`,
              display: `${qLabel} (${ROMAN[globalIdx] ?? `s${globalIdx + 1}`})`,
              module: mod,
              marks: marksPer,
              qType,
              poolItemType: row.itemType,
            })
          );
          globalIdx++;
        }
      }
      return;
    }
  });

  // BTL apportionment: an explicit btlRange already set each slot's
  // targetBtlRange in buildSlot, so skip the preset-based tier apportionment.
  // The old preset path stays for backward compat while the UI still uses it.
  if (ctx.difficultyPreset && !ctx.btlRange) {
    apportionBtlTiers(
      slots,
      resolveTierWeights(ctx.difficultyPreset, ctx.customBtlWeights)
    );
  }

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
