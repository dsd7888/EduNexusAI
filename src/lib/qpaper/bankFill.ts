/**
 * "From Q Bank" question sourcing for the Q-paper generator.
 *
 * Given a paper template section and the faculty's question bank, this module
 * computes the section's atomic slots (one per MCQ sub-part, descriptive part,
 * OR-alternative, or attempt-any option), allocates real bank questions to
 * them, and either:
 *   - assembles the whole section directly from the bank (no AI), when every
 *     slot is covered, or
 *   - overlays the matched bank questions onto an AI-generated section, leaving
 *     the unmatched slots as their AI fallback.
 *
 * Matching is by question_type + marks (exact, then ±0.5 tolerance), and then
 * — when the caller supplies them — by a per-slot module/CO/BTL target. Slots
 * arrive pre-targeted by the code-computed module assignment (moduleAssignment.ts),
 * so bank content must respect that targeting, not just type/marks. Candidate
 * selection is tiered (highest priority first):
 *
 *   1. a `preferredQuestionIds` question that also satisfies the slot's target,
 *   2. any question whose module/CO/BTL match the slot's target,
 *   3. any question matching only type+marks (the original behaviour).
 *
 * Within the chosen tier, ordering is per the spec: is_verified DESC,
 * usage_count ASC, RANDOM() — the random tiebreak runs in-memory. The shared
 * `used` set guarantees no bank question (and no preferred id) is reused across
 * slots in a single request.
 */

import type {
  GeneratedQuestion,
  GeneratedSection,
  QuestionPart,
  SubQuestion,
} from "./builder";
import type {
  TemplateQuestionBlock,
  TemplateSection,
  QuestionType as PoolQuestionType,
  PoolItem,
} from "./templates";
import {
  attemptAnyCount,
  attemptAnyDefaultInstruction,
  attemptAnyLogic,
  attemptAnyMarksPerOption,
  attemptAnyTotalOptions,
  isPoolItemMcqLike,
} from "./templates";
import type { BankQuestion, MCQOption, QuestionType } from "@/lib/qbank/types";
import {
  mcqSubSlotKey,
  descriptiveSlotKey,
  orPrimarySlotKey,
  orAlternativeSlotKey,
} from "./moduleAssignment";

const MARKS_TOLERANCE = 0.5;
const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

type SlotKind = "mcq_sub" | "descriptive" | "or_main" | "or_alt" | "attempt_option" | "pool_item";

/**
 * Per-slot match target. Any subset of fields may be set; an unset field is not
 * constrained. Supplied by the caller from the deterministic module assignment
 * (moduleAssignment.ts) so the bank respects where each slot is supposed to draw
 * its content from.
 */
export interface SlotTarget {
  moduleId?: string;
  coCode?: string;
  btlLevel?: number;
}

export interface AtomicSlot {
  qIndex: number;
  kind: SlotKind;
  innerIndex: number;
  bankType: QuestionType;
  marks: number;
  /** Pre-computed module/CO/BTL target for this slot (optional). */
  target?: SlotTarget;
}

// ─── Slot computation from the template ─────────────────────────────────────

function descriptiveBankType(marks: number, hasNumerical?: boolean): QuestionType {
  if (hasNumerical) return "numerical";
  return marks >= 5 ? "long_answer" : "short_answer";
}

/** Maps pool composition item types to Q Bank question_type values. */
function poolItemBankType(itemType: PoolQuestionType): QuestionType {
  if (isPoolItemMcqLike(itemType)) return "mcq";
  if (itemType === "numerical") return "numerical";
  if (itemType === "long") return "long_answer";
  if (itemType === "fill_blank") return "fill_blank";
  return "short_answer";
}

function slotsForQuestion(q: TemplateQuestionBlock, qIndex: number): AtomicSlot[] {
  const slots: AtomicSlot[] = [];
  if (q.type === "mcq") {
    const count = Math.max(1, q.sub_parts ?? 1);
    const marks = q.marks_per_part ?? 1;
    for (let i = 0; i < count; i++) {
      slots.push({ qIndex, kind: "mcq_sub", innerIndex: i, bankType: "mcq", marks });
    }
  } else if (q.type === "descriptive_with_or") {
    const count = Math.max(1, q.parts?.length ?? 2);
    const marks = q.marks_per_part ?? q.total_marks;
    const bankType = descriptiveBankType(marks);
    for (let i = 0; i < count; i++) {
      slots.push({ qIndex, kind: "or_main", innerIndex: i, bankType, marks });
    }
    for (let i = 0; i < count; i++) {
      slots.push({ qIndex, kind: "or_alt", innerIndex: i, bankType, marks });
    }
  } else if (q.type === "attempt_any_one") {
    const count = attemptAnyTotalOptions(q);
    const marks = attemptAnyMarksPerOption(q);
    const bankType = descriptiveBankType(marks);
    for (let i = 0; i < count; i++) {
      slots.push({
        qIndex,
        kind: "attempt_option",
        innerIndex: i,
        bankType,
        marks,
      });
    }
  } else if (q.type === "pool") {
    let idx = 0;
    for (const row of q.composition) {
      const bankType = poolItemBankType(row.itemType);
      for (let i = 0; i < Math.max(0, row.count); i++) {
        slots.push({
          qIndex,
          kind: "pool_item",
          innerIndex: idx,
          bankType,
          marks: q.marksPerItem,
        });
        idx++;
      }
    }
  } else {
    // descriptive (single)
    slots.push({
      qIndex,
      kind: "descriptive",
      innerIndex: 0,
      bankType: descriptiveBankType(q.total_marks, q.has_numerical),
      marks: q.total_marks,
    });
  }
  return slots;
}

export function computeSlots(section: TemplateSection): AtomicSlot[] {
  return section.questions.flatMap((q, i) => slotsForQuestion(q, i));
}

/**
 * The slot key used by the module-assignment layer (moduleAssignment.ts) for
 * this atomic slot. Lets a caller look its pre-computed module/CO/BTL target up
 * by the same key the assignment produced. attempt_any_one's two options share
 * their parent question's assignment (one module for the whole question).
 */
export function slotAssignmentKey(slot: AtomicSlot): string {
  const qNum = slot.qIndex + 1; // section-relative, matches moduleAssignment
  switch (slot.kind) {
    case "mcq_sub":
    case "pool_item":
      return mcqSubSlotKey(qNum, slot.innerIndex);
    case "or_main":
      return orPrimarySlotKey(qNum, slot.innerIndex);
    case "or_alt":
      return orAlternativeSlotKey(qNum, slot.innerIndex);
    case "attempt_option":
    case "descriptive":
    default:
      return descriptiveSlotKey(qNum);
  }
}

// ─── Allocation ─────────────────────────────────────────────────────────────

function marksMatch(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

/** "CO1", "CO 1", "co1", "1", "01" → "01"; two-digit codes stay two-digit. */
function normalizeCo(co: string): string {
  return co
    .toString()
    .toUpperCase()
    .replace(/^CO\s*/i, "")
    .trim()
    .padStart(2, "0");
}

function hasTargetFields(t?: SlotTarget): boolean {
  return (
    !!t &&
    (t.moduleId != null || t.coCode != null || t.btlLevel != null)
  );
}

/**
 * True when `b` satisfies every *specified* field of the target. A target with
 * no fields is trivially satisfied (so a preferred question is still usable when
 * the slot carries no module/CO/BTL constraint).
 */
function satisfiesTarget(b: BankQuestion, t?: SlotTarget): boolean {
  if (!hasTargetFields(t)) return true;
  if (t!.moduleId != null && b.module_id !== t!.moduleId) return false;
  if (
    t!.coCode != null &&
    (b.co_code == null || normalizeCo(b.co_code) !== normalizeCo(t!.coCode))
  ) {
    return false;
  }
  if (t!.btlLevel != null && b.btl_level !== t!.btlLevel) return false;
  return true;
}

/** is_verified DESC, usage_count ASC, RANDOM() tiebreak. */
function pickBest(candidates: BankQuestion[]): BankQuestion {
  const sorted = [...candidates].sort((a, b) => {
    if (a.is_verified !== b.is_verified) return a.is_verified ? -1 : 1;
    if (a.usage_count !== b.usage_count) return a.usage_count - b.usage_count;
    return Math.random() - 0.5;
  });
  // Spec: take 3 candidates, pick the first.
  return sorted.slice(0, 3)[0];
}

function findCandidate(
  slot: AtomicSlot,
  bank: BankQuestion[],
  used: Set<string>,
  preferred: Set<string>
): BankQuestion | null {
  const ofType = bank.filter(
    (b) => !used.has(b.id) && b.question_type === slot.bankType
  );
  const exact = ofType.filter((b) => marksMatch(b.marks, slot.marks, 0));
  const pool = exact.length > 0
    ? exact
    : ofType.filter((b) => marksMatch(b.marks, slot.marks, MARKS_TOLERANCE));
  if (pool.length === 0) return null;

  const target = slot.target;

  // 1. A preferred question (e.g. reference-material, Part 4) that also
  //    satisfies the slot's module/CO/BTL target wins outright.
  if (preferred.size > 0) {
    const pref = pool.filter(
      (b) => preferred.has(b.id) && satisfiesTarget(b, target)
    );
    if (pref.length > 0) return pickBest(pref);
  }

  // 2. Questions whose module/CO/BTL match the slot's pre-computed target.
  if (hasTargetFields(target)) {
    const onTarget = pool.filter((b) => satisfiesTarget(b, target));
    if (onTarget.length > 0) return pickBest(onTarget);
  }

  // 3. Fall back to any type+marks match (the original behaviour).
  return pickBest(pool);
}

export interface SlotKey {
  qIndex: number;
  kind: SlotKind;
  innerIndex: number;
}

export function slotKeyStr(k: SlotKey): string {
  return `${k.qIndex}:${k.kind}:${k.innerIndex}`;
}

export interface BankAllocation {
  /** slotKeyStr → bank question */
  bySlot: Map<string, BankQuestion>;
  /** all slot keys for the section, in order */
  slots: AtomicSlot[];
  fullyCovered: boolean;
  /** human-readable descriptions of slots that found no bank match */
  unmatched: string[];
}

export interface AllocateOptions {
  /**
   * Per-slot module/CO/BTL targets, keyed by `slotAssignmentKey(slot)` (i.e. the
   * moduleAssignment.ts slot key). Slots without an entry are matched on
   * type+marks only.
   */
  targets?: Map<string, SlotTarget>;
  /**
   * Question ids to prefer when they satisfy a slot's target. The shared `used`
   * set still prevents any id from being placed in more than one slot.
   */
  preferredQuestionIds?: string[];
  /**
   * Restrict bank fill to these slots, keyed by `slotKeyStr(slot)`. Slots not in
   * the set are left untouched (the AI path fills them). When omitted, every
   * slot is attempted (legacy "From Q Bank" behaviour).
   */
  bankSlotKeys?: Set<string>;
  /**
   * Slots (keyed by `slotKeyStr(slot)`) reserved for a guaranteed-included
   * preferred question: their module/CO/BTL target is suppressed so a preferred
   * question places via the preferred tier regardless of targeting. Must also be
   * present in `bankSlotKeys`.
   */
  forcedPreferredKeys?: Set<string>;
}

/**
 * Allocate bank questions to the section's slots. Mutates `used` so the same
 * bank question is never reused across slots (or across sections, when the
 * caller threads one shared set through every section).
 *
 * `unmatched` only lists slots that were actually *attempted* (i.e. bank-eligible
 * per `bankSlotKeys`) but found no match — these are the slots that fall back to
 * AI. `fullyCovered` means every slot in the section is bank-sourced.
 */
export function allocateBankForSection(
  section: TemplateSection,
  bank: BankQuestion[],
  used: Set<string>,
  options?: AllocateOptions
): BankAllocation {
  const slots = computeSlots(section);
  const bySlot = new Map<string, BankQuestion>();
  const unmatched: string[] = [];
  const preferred = new Set(options?.preferredQuestionIds ?? []);
  const bankSlotKeys = options?.bankSlotKeys;

  const forcedPreferredKeys = options?.forcedPreferredKeys;

  for (const slot of slots) {
    const keyStr = slotKeyStr(slot);
    if (bankSlotKeys && !bankSlotKeys.has(keyStr)) continue;
    // Reserved-for-preferred slots drop their target so a preferred question
    // places regardless of module/CO/BTL — that's the point of "guaranteed".
    slot.target = forcedPreferredKeys?.has(keyStr)
      ? undefined
      : options?.targets?.get(slotAssignmentKey(slot));
    const cand = findCandidate(slot, bank, used, preferred);
    if (cand) {
      used.add(cand.id);
      bySlot.set(slotKeyStr(slot), cand);
    } else {
      unmatched.push(
        `${section.section_name} Q${slot.qIndex + 1} (${slot.bankType}, ${slot.marks}M)`
      );
    }
  }

  return {
    bySlot,
    slots,
    fullyCovered: bySlot.size === slots.length,
    unmatched,
  };
}

// ─── Bank question → paper shapes ───────────────────────────────────────────

function bankOptionsToRecord(opts: MCQOption[] | null): {
  options?: Record<string, string>;
  correct_option?: string;
} {
  if (!opts || opts.length === 0) return {};
  const record: Record<string, string> = {};
  let correct: string | undefined;
  for (const o of opts) {
    const k = o.label.toLowerCase();
    record[k] = o.text;
    if (o.is_correct) correct = k;
  }
  return { options: record, correct_option: correct };
}

function bankPo(b: BankQuestion): string | null {
  return b.po_codes && b.po_codes.length > 0 ? b.po_codes[0] : null;
}

function bankToPoolItem(
  b: BankQuestion,
  itemType: PoolQuestionType,
  idx: number
): PoolItem {
  const { options } = bankOptionsToRecord(b.options);
  const item: PoolItem = {
    itemType,
    question_text: b.question_text,
    co: b.co_code,
    btl: b.btl_level,
    po: bankPo(b),
    model_answer: b.model_answer,
    image_path: b.image_path ?? null,
    image_url: b.image_url ?? null,
  };
  if (isPoolItemMcqLike(itemType)) {
    item.options =
      itemType === "true_false" && !options
        ? { a: "True", b: "False" }
        : options;
  }
  void idx;
  return item;
}

function bankToSubQuestion(b: BankQuestion, idx: number): SubQuestion {
  const { options, correct_option } = bankOptionsToRecord(b.options);
  return {
    label: `(${ROMAN[idx] ?? idx + 1})`,
    question: b.question_text,
    options,
    correct_option,
    co: b.co_code,
    btl: b.btl_level,
    po: bankPo(b),
    from_bank: true,
    bank_id: b.id,
    model_answer: b.model_answer,
    image_path: b.image_path ?? null,
    image_url: b.image_url ?? null,
  };
}

function bankToPart(
  b: BankQuestion,
  label: string | null,
  isOrAlt: boolean
): QuestionPart {
  return {
    label,
    question: b.question_text,
    marks: b.marks,
    co: b.co_code,
    btl: b.btl_level,
    po: bankPo(b),
    is_or_alternative: isOrAlt,
    from_bank: true,
    bank_id: b.id,
    model_answer: b.model_answer,
    image_path: b.image_path ?? null,
    image_url: b.image_url ?? null,
  };
}

/**
 * Build a full GeneratedQuestion from bank allocations for one template
 * question. Only call when every slot of the question is covered.
 */
function assembleQuestionFromBank(
  tq: TemplateQuestionBlock,
  qIndex: number,
  bySlot: Map<string, BankQuestion>
): GeneratedQuestion {
  const get = (kind: SlotKind, innerIndex: number) =>
    bySlot.get(slotKeyStr({ qIndex, kind, innerIndex }));

  const base: GeneratedQuestion = {
    q_number: tq.q_number,
    display_label: tq.display_label,
    type: tq.type,
    instruction: tq.instruction ?? null,
    total_marks: tq.total_marks,
    attempt_logic: tq.attempt_logic ?? null,
    from_bank: true,
  };

  if (tq.type === "mcq") {
    const count = Math.max(1, tq.sub_parts ?? 1);
    const subs: SubQuestion[] = [];
    for (let i = 0; i < count; i++) {
      const b = get("mcq_sub", i);
      if (b) subs.push(bankToSubQuestion(b, i));
    }
    base.sub_parts = subs;
    return base;
  }

  if (tq.type === "descriptive_with_or") {
    const count = Math.max(1, tq.parts?.length ?? 2);
    const parts: QuestionPart[] = [];
    for (let i = 0; i < count; i++) {
      const b = get("or_main", i);
      if (b) parts.push(bankToPart(b, `(${LETTERS[i]})`, false));
    }
    for (let i = 0; i < count; i++) {
      const b = get("or_alt", i);
      if (b) parts.push(bankToPart(b, `(${LETTERS[i]})`, true));
    }
    base.parts = parts;
    return base;
  }

  if (tq.type === "attempt_any_one") {
    const count = attemptAnyTotalOptions(tq);
    const marksEach = attemptAnyMarksPerOption(tq);
    const parts: QuestionPart[] = [];
    for (let i = 0; i < count; i++) {
      const b = get("attempt_option", i);
      if (b) {
        // Per-option marks are the faculty-configured value, not the bank
        // question's own marks.
        parts.push({ ...bankToPart(b, `(${ROMAN[i] ?? i + 1})`, false), marks: marksEach });
      }
    }
    base.parts = parts;
    // Label always derives from configured K-of-M, never a stale stored string.
    base.instruction = attemptAnyDefaultInstruction(tq);
    base.attempt_logic = attemptAnyLogic(attemptAnyCount(tq));
    base.attempt_expected_count = count;
    base.attempt_returned_count = parts.length;
    return base;
  }

  if (tq.type === "pool") {
    const items: PoolItem[] = [];
    let idx = 0;
    for (const row of tq.composition) {
      for (let i = 0; i < Math.max(0, row.count); i++) {
        const b = get("pool_item", idx);
        if (b) items.push(bankToPoolItem(b, row.itemType, idx));
        idx++;
      }
    }
    base.items = items;
    base.attempt_logic =
      tq.attemptCount === 1 ? "any_one" : `any_${tq.attemptCount}`;
    return base;
  }

  // descriptive (single)
  const b = get("descriptive", 0);
  base.parts = b ? [bankToPart(b, null, false)] : [];
  return base;
}

/** Assemble an entire section from the bank. Requires `fullyCovered`. */
export function assembleSectionFromBank(
  section: TemplateSection,
  allocation: BankAllocation
): GeneratedSection {
  return {
    section_name: section.section_name,
    module_range: section.module_range,
    total_marks: section.total_marks,
    questions: section.questions.map((tq, i) =>
      assembleQuestionFromBank(tq, i, allocation.bySlot)
    ),
  };
}

/**
 * Overlay matched bank questions onto an AI-generated section. Unmatched slots
 * keep their AI text. Returns the mutated section (new objects) and the count
 * of atomic units that were replaced from the bank.
 */
export function overlayBankOntoSection(
  aiSection: GeneratedSection,
  section: TemplateSection,
  allocation: BankAllocation
): { section: GeneratedSection; replaced: number } {
  let replaced = 0;
  const bySlot = allocation.bySlot;

  const questions = aiSection.questions.map((q, qIndex) => {
    const tq = section.questions[qIndex];
    if (!tq) return q;
    const next: GeneratedQuestion = { ...q };
    let anyFromBank = false;

    const get = (kind: SlotKind, innerIndex: number) =>
      bySlot.get(slotKeyStr({ qIndex, kind, innerIndex }));

    if (q.type === "mcq" && q.sub_parts) {
      next.sub_parts = q.sub_parts.map((sub, i) => {
        const b = get("mcq_sub", i);
        if (!b) return sub;
        replaced++;
        anyFromBank = true;
        return bankToSubQuestion(b, i);
      });
    } else if (q.type === "descriptive_with_or" && q.parts) {
      const mainCount = q.parts.filter((p) => !p.is_or_alternative).length;
      let mainSeen = 0;
      let altSeen = 0;
      next.parts = q.parts.map((part) => {
        const isAlt = !!part.is_or_alternative;
        const inner = isAlt ? altSeen++ : mainSeen++;
        const b = get(isAlt ? "or_alt" : "or_main", inner);
        if (!b) return part;
        replaced++;
        anyFromBank = true;
        return bankToPart(b, part.label ?? `(${LETTERS[inner]})`, isAlt);
      });
      void mainCount;
    } else if (q.type === "attempt_any_one" && q.parts) {
      next.parts = q.parts.map((part, i) => {
        const b = get("attempt_option", i);
        if (!b) return part;
        replaced++;
        anyFromBank = true;
        return bankToPart(b, part.label ?? `(${ROMAN[i] ?? i + 1})`, false);
      });
    } else if (q.type === "pool" && q.items) {
      next.items = q.items.map((item, i) => {
        const b = get("pool_item", i);
        if (!b) return item;
        replaced++;
        anyFromBank = true;
        let rowType = item.itemType;
        if (tq.type === "pool") {
          let cursor = 0;
          outer: for (const row of tq.composition) {
            for (let j = 0; j < row.count; j++) {
              if (cursor === i) {
                rowType = row.itemType;
                break outer;
              }
              cursor++;
            }
          }
        }
        return bankToPoolItem(b, rowType, i);
      });
    } else if (q.parts) {
      next.parts = q.parts.map((part, i) => {
        const b = get("descriptive", i);
        if (!b) return part;
        replaced++;
        anyFromBank = true;
        return bankToPart(b, part.label ?? null, !!part.is_or_alternative);
      });
    }

    if (anyFromBank) next.from_bank = true;
    return next;
  });

  return {
    section: { ...aiSection, questions },
    replaced,
  };
}

/** Collect the bank question ids actually used across an allocation. */
export function usedBankIds(allocation: BankAllocation): string[] {
  return Array.from(new Set(Array.from(allocation.bySlot.values()).map((b) => b.id)));
}
