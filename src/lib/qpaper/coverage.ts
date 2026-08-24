/**
 * Module coverage ledger — why a selected unit did or did not reach the paper.
 *
 * The faculty-facing complaint this answers: "I generated with 3 units selected
 * and unit 3 never appeared, and nothing told me why." Coverage was previously
 * invisible; a unit could be dropped by a scoping bug, filtered out by a BTL
 * range it could not satisfy, or rounded out of every slot by weightage, and all
 * three looked identical from the outside — a paper that silently lacked a unit.
 *
 * Design
 * ------
 * Pure and deterministic, with no DB, network or AI dependency, because it runs
 * in TWO places and they must never disagree:
 *
 *   - the builder, as a PRE-FLIGHT preview, so "unit 3 will get 0 questions" is
 *     caught before a Pro call is spent; and
 *   - the generation route, as the ledger returned with the finished paper.
 *
 * Each reason is a discriminated union carrying the numbers behind the verdict,
 * so the UI can render a specific remedy ("widen the BTL range to 2–5") rather
 * than a generic "not covered" — the difference between a message a faculty
 * member can act on and one they can only be annoyed by.
 */

import type { QuestionSlot, ModuleData } from "./moduleAssignment";

/** Why a selected module ended up with the coverage it did. */
export type CoverageReason =
  /** Covered. `slots`/`marks` describe how much. */
  | { kind: "ok" }
  /**
   * In scope and eligible, but every slot went to a competing module.
   * Weightage-proportional allocation genuinely rounds a small module to zero
   * when there are few slots — real, and previously invisible.
   */
  | {
      kind: "rounded_out";
      weightagePct: number | null;
      totalSlotsInScope: number;
      competingModules: number;
    }
  /**
   * No section draws from this module, so it could never be picked. The classic
   * cause of the reported bug.
   */
  | { kind: "not_in_any_section"; sectionScopes: Array<{ name: string; modules: number[] }> }
  /**
   * COVERED, but its questions could not honour the paper's BTL range.
   *
   * Deliberately NOT a zero-coverage reason. assignModulesToSlots does not
   * exclude a BTL-mismatched module — clampRangeToAllowed degrades it to the
   * nearest level the module does allow — so the unit still reaches the paper,
   * carrying tags outside the range that was asked for. Reporting this as
   * "0 questions" would have been simply untrue, and would have sent faculty
   * hunting for a missing unit that is in fact present and mis-tagged.
   */
  | {
      kind: "btl_clamped";
      moduleBtl: number[];
      requestedRange: [number, number];
      actualRange: [number, number];
    }
  /**
   * Every slot in the module's sections was explicitly pinned to other modules
   * by the template. Only reported when real pins exist — see
   * SectionCoverageInput.pinnedModuleIds.
   */
  | { kind: "displaced_by_pins"; pinnedSlots: number; totalSlotsInScope: number }
  /**
   * Slots were assigned, but the generated paper came back with fewer questions
   * than those slots — an AI shortfall, not an allocation decision.
   */
  | { kind: "ai_shortfall"; expectedSlots: number; producedQuestions: number };

export interface ModuleCoverage {
  moduleId?: string;
  moduleNumber: number;
  moduleName: string;
  /** Atomic slots allocated to this module across the whole paper. */
  slots: number;
  /** Marks those slots carry. */
  marks: number;
  reason: CoverageReason;
}

/** One section's resolved scope + slot assignment. */
export interface SectionCoverageInput {
  sectionName: string;
  /** Modules this section actually draws from, post-scoping. */
  modules: ModuleData[];
  /** Slots produced by assignModulesToSlots for this section. */
  slots: QuestionSlot[];
  /**
   * Module ids explicitly pinned by this section's template blocks
   * (TemplateQuestion.pinnedModuleId / PoolCompositionEntry.pinnedModuleId).
   *
   * Required to tell "displaced by a pin" apart from "lost on weightage":
   * QuestionSlot records only the module that won, not whether the template
   * forced it, and both cases look identical from the slot list alone.
   * Inferring a pin from the shape of the allocation produced a confident
   * wrong answer, so the caller passes the facts instead.
   */
  pinnedModuleIds?: string[];
}

export interface CoverageInput {
  /** Every module the faculty selected — the set coverage is judged against. */
  selectedModules: ModuleData[];
  sections: SectionCoverageInput[];
  /** Paper-wide BTL eligibility filter, when one is active. */
  btlRange?: [number, number];
  /**
   * module_number → questions actually present in the generated paper. Supplied
   * only on the post-generation path; its absence is what makes the same
   * function usable as a pre-flight preview.
   */
  producedByModule?: Map<number, number>;
}

const BTL_LABEL_TO_LEVEL: Record<string, number> = {
  remember: 1, understand: 2, apply: 3,
  analyze: 4, analyse: 4, evaluate: 5, create: 6,
};

const DEFAULT_BTL_LEVELS = [1, 2, 3, 4];

/**
 * Normalise a module's BTL levels to numbers.
 *
 * Deliberately mirrors `normaliseBtl` in moduleAssignment.ts, including its
 * "unparseable or empty → default 1–4" fallback. If the two ever disagree the
 * ledger would explain a decision the allocator did not actually make, which is
 * worse than no explanation at all.
 */
export function normaliseBtlLevels(raw: ModuleData["btl_levels"]): number[] {
  if (!raw || (Array.isArray(raw) && raw.length === 0)) return [...DEFAULT_BTL_LEVELS];
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
    if (BTL_LABEL_TO_LEVEL[s] != null) out.add(BTL_LABEL_TO_LEVEL[s]);
  }
  return out.size > 0 ? Array.from(out).sort((a, b) => a - b) : [...DEFAULT_BTL_LEVELS];
}

/**
 * The BTL span the allocator actually assigned to a module's slots — what the
 * questions will really be tagged, after clamping.
 */
function actualBtlRangeFor(
  sections: SectionCoverageInput[],
  moduleNumber: number
): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of sections) {
    for (const slot of s.slots) {
      if (slot.moduleNumber !== moduleNumber) continue;
      lo = Math.min(lo, slot.targetBtlRange[0]);
      hi = Math.max(hi, slot.targetBtlRange[1]);
    }
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

/**
 * Build the coverage ledger.
 *
 * Reasons are evaluated most-specific first, because several can be true at
 * once and only the actionable one helps: a module that is both out of scope
 * and BTL-incompatible should be reported as out of scope, since fixing the BTL
 * range alone would not bring it back.
 */
export function computeCoverage(input: CoverageInput): ModuleCoverage[] {
  const { selectedModules, sections, btlRange, producedByModule } = input;

  // Slot/mark tallies per module, plus which sections each module is scoped to.
  const slotsByModule = new Map<number, number>();
  const marksByModule = new Map<number, number>();
  const scopedSections = new Map<number, string[]>();

  for (const s of sections) {
    for (const m of s.modules) {
      const list = scopedSections.get(m.module_number) ?? [];
      list.push(s.sectionName);
      scopedSections.set(m.module_number, list);
    }
    for (const slot of s.slots) {
      slotsByModule.set(slot.moduleNumber, (slotsByModule.get(slot.moduleNumber) ?? 0) + 1);
      marksByModule.set(slot.moduleNumber, (marksByModule.get(slot.moduleNumber) ?? 0) + slot.marks);
    }
  }

  const sectionScopes = sections.map((s) => ({
    name: s.sectionName,
    modules: s.modules.map((m) => m.module_number).sort((a, b) => a - b),
  }));

  // Slots sitting in sections that include this module — the pool it competed
  // in. Used to distinguish "lost the allocation" from "was never eligible".
  const slotsInScopeFor = (
    moduleNumber: number,
    moduleId?: string
  ): { total: number; pinned: number; competitors: number } => {
    let total = 0;
    let pinned = 0;
    let competitors = 0;
    for (const s of sections) {
      if (!s.modules.some((m) => m.module_number === moduleNumber)) continue;
      total += s.slots.length;
      competitors = Math.max(competitors, s.modules.length - 1);

      // Count slots held by modules the template explicitly pinned — and only
      // those. A pin on THIS module doesn't displace it, so it is excluded.
      const pins = new Set(
        (s.pinnedModuleIds ?? []).filter((id) => id && id !== moduleId)
      );
      if (pins.size === 0) continue;
      const pinnedNumbers = new Set(
        s.modules.filter((m) => m.id && pins.has(m.id)).map((m) => m.module_number)
      );
      pinned += s.slots.filter((sl) => pinnedNumbers.has(sl.moduleNumber)).length;
    }
    return { total, pinned, competitors };
  };

  return selectedModules.map((m): ModuleCoverage => {
    const slots = slotsByModule.get(m.module_number) ?? 0;
    const marks = marksByModule.get(m.module_number) ?? 0;
    const base = {
      moduleId: m.id,
      moduleNumber: m.module_number,
      moduleName: m.name,
      slots,
      marks,
    };

    // ── Covered: did it actually arrive, and on the requested terms? ───────
    if (slots > 0) {
      if (producedByModule) {
        const produced = producedByModule.get(m.module_number) ?? 0;
        if (produced === 0) {
          return {
            ...base,
            reason: { kind: "ai_shortfall", expectedSlots: slots, producedQuestions: produced },
          };
        }
      }
      // Present, but forced off the requested BTL range by clampRangeToAllowed.
      if (btlRange) {
        const levels = normaliseBtlLevels(m.btl_levels);
        const [lo, hi] = btlRange;
        if (!levels.some((b) => b >= lo && b <= hi)) {
          const actual = actualBtlRangeFor(sections, m.module_number) ?? [
            levels[0],
            levels[levels.length - 1],
          ];
          return {
            ...base,
            reason: {
              kind: "btl_clamped",
              moduleBtl: levels,
              requestedRange: btlRange,
              actualRange: actual,
            },
          };
        }
      }
      return { ...base, reason: { kind: "ok" } };
    }

    // ── Zero slots: establish why, most actionable cause first ─────────────

    // 1. Never in scope — nothing about BTL or weightage could have helped.
    const inScope = scopedSections.get(m.module_number);
    if (!inScope || inScope.length === 0) {
      return { ...base, reason: { kind: "not_in_any_section", sectionScopes } };
    }

    // 2. In scope, but every slot went to a module the template pinned.
    const { total, pinned, competitors } = slotsInScopeFor(m.module_number, m.id);
    if (pinned > 0 && pinned === total) {
      return {
        ...base,
        reason: { kind: "displaced_by_pins", pinnedSlots: pinned, totalSlotsInScope: total },
      };
    }

    // 3. Default: weightage-proportional allocation rounded it to zero.
    return {
      ...base,
      reason: {
        kind: "rounded_out",
        weightagePct: m.weightage_percent ?? null,
        totalSlotsInScope: total,
        competingModules: competitors,
      },
    };
  });
}

/** Modules that reached the paper (`btl_clamped` did — on degraded terms). */
export function coveredModules(ledger: ModuleCoverage[]): ModuleCoverage[] {
  return ledger.filter((c) => c.slots > 0);
}

/**
 * Modules that produced no questions at all.
 *
 * `btl_clamped` is deliberately NOT here: those units are in the paper. Listing
 * them as missing would send faculty looking for something that is present.
 * Use {@link warnedModules} for "needs attention", which spans both.
 */
export function uncoveredModules(ledger: ModuleCoverage[]): ModuleCoverage[] {
  return ledger.filter((c) => c.slots === 0);
}

/** Everything worth showing the faculty: missing units and degraded ones. */
export function warnedModules(ledger: ModuleCoverage[]): ModuleCoverage[] {
  return ledger.filter((c) => c.reason.kind !== "ok");
}

/**
 * One-line explanation of a coverage verdict, plus the remedy.
 *
 * Kept next to the reason definitions rather than in a component so the
 * pre-flight preview and the post-generation ledger word things identically —
 * the same cause described two different ways reads as two different problems.
 */
export function explainCoverage(c: ModuleCoverage): { title: string; detail: string; remedy: string } {
  const unit = `Unit ${c.moduleNumber} — ${c.moduleName}`;
  switch (c.reason.kind) {
    case "ok":
      return {
        title: `${unit}: ${c.slots} question${c.slots === 1 ? "" : "s"} (${c.marks} marks)`,
        detail: "",
        remedy: "",
      };
    case "not_in_any_section": {
      const scopes = c.reason.sectionScopes
        .map((s) => `${s.name} draws from ${s.modules.length > 0 ? `units ${s.modules.join(", ")}` : "no units"}`)
        .join("; ");
      return {
        title: `${unit}: 0 questions`,
        detail: `No section of this paper draws from it — ${scopes}.`,
        remedy: "Add it to a section's unit scope, or add a section that covers it.",
      };
    }
    case "btl_clamped": {
      const [lo, hi] = c.reason.requestedRange;
      const [alo, ahi] = c.reason.actualRange;
      const actual = alo === ahi ? `BTL ${alo}` : `BTL ${alo}–${ahi}`;
      return {
        title: `${unit}: ${c.slots} question${c.slots === 1 ? "" : "s"}, outside your BTL range`,
        detail:
          `This unit's Bloom's levels (${c.reason.moduleBtl.join(", ")}) don't overlap the paper's ` +
          `BTL range (${lo}–${hi}), so its questions were set at ${actual} instead. They are in the ` +
          `paper, but they will not meet the BTL target you asked for.`,
        remedy: `Widen the BTL range to include ${c.reason.moduleBtl[0]}, or update this unit's BTL levels in Syllabus.`,
      };
    }
    case "displaced_by_pins":
      return {
        title: `${unit}: 0 questions`,
        detail: `All ${c.reason.totalSlotsInScope} question slot${c.reason.totalSlotsInScope === 1 ? "" : "s"} in its section are pinned to other units.`,
        remedy: "Unpin a question, or pin one explicitly to this unit.",
      };
    case "rounded_out": {
      const w = c.reason.weightagePct;
      return {
        title: `${unit}: 0 questions`,
        detail:
          `Question slots are shared out by unit weightage${w != null ? ` (this unit is ${w}%)` : ""}, and with ` +
          `${c.reason.totalSlotsInScope} slot${c.reason.totalSlotsInScope === 1 ? "" : "s"} shared across ` +
          `${c.reason.competingModules + 1} units its share rounded down to zero.`,
        remedy: "Add more questions, raise this unit's weightage, or pin a question to it.",
      };
    }
    case "ai_shortfall":
      return {
        title: `${unit}: 0 questions`,
        detail: `${c.reason.expectedSlots} slot${c.reason.expectedSlots === 1 ? " was" : "s were"} reserved for this unit, but the generated paper came back without them.`,
        remedy: "Regenerate the paper, or add a question pinned to this unit.",
      };
  }
}
