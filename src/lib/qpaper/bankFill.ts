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
 * Matching is by question_type + marks (exact, then ±0.5 tolerance). The
 * template does not carry per-slot CO/BTL (those are assigned by the AI during
 * generation), so the spec's optional CO/BTL filters are no-ops here.
 *
 * Ordering of candidates per the spec: is_verified DESC, usage_count ASC,
 * RANDOM() — the random tiebreak runs in-memory.
 */

import type {
  GeneratedQuestion,
  GeneratedSection,
  QuestionPart,
  SubQuestion,
} from "./builder";
import type { TemplateQuestion, TemplateSection } from "./templates";
import type { BankQuestion, MCQOption, QuestionType } from "@/lib/qbank/types";

const MARKS_TOLERANCE = 0.5;
const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

type SlotKind = "mcq_sub" | "descriptive" | "or_main" | "or_alt" | "attempt_option";

interface AtomicSlot {
  qIndex: number;
  kind: SlotKind;
  innerIndex: number;
  bankType: QuestionType;
  marks: number;
}

// ─── Slot computation from the template ─────────────────────────────────────

function descriptiveBankType(marks: number, hasNumerical?: boolean): QuestionType {
  if (hasNumerical) return "numerical";
  return marks >= 5 ? "long_answer" : "short_answer";
}

function slotsForQuestion(q: TemplateQuestion, qIndex: number): AtomicSlot[] {
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
    const count = Math.max(2, q.sub_parts ?? 2);
    const marks = q.marks_per_part ?? q.total_marks;
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

function computeSlots(section: TemplateSection): AtomicSlot[] {
  return section.questions.flatMap((q, i) => slotsForQuestion(q, i));
}

// ─── Allocation ─────────────────────────────────────────────────────────────

function marksMatch(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
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
  used: Set<string>
): BankQuestion | null {
  const ofType = bank.filter(
    (b) => !used.has(b.id) && b.question_type === slot.bankType
  );
  const exact = ofType.filter((b) => marksMatch(b.marks, slot.marks, 0));
  const pool = exact.length > 0
    ? exact
    : ofType.filter((b) => marksMatch(b.marks, slot.marks, MARKS_TOLERANCE));
  if (pool.length === 0) return null;
  return pickBest(pool);
}

export interface SlotKey {
  qIndex: number;
  kind: SlotKind;
  innerIndex: number;
}

function slotKeyStr(k: SlotKey): string {
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

/**
 * Allocate bank questions to the section's slots. Mutates `used` so the same
 * bank question is never reused across slots (or across sections, when the
 * caller threads one shared set through every section).
 */
export function allocateBankForSection(
  section: TemplateSection,
  bank: BankQuestion[],
  used: Set<string>
): BankAllocation {
  const slots = computeSlots(section);
  const bySlot = new Map<string, BankQuestion>();
  const unmatched: string[] = [];

  for (const slot of slots) {
    const cand = findCandidate(slot, bank, used);
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
    fullyCovered: unmatched.length === 0,
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
  };
}

/**
 * Build a full GeneratedQuestion from bank allocations for one template
 * question. Only call when every slot of the question is covered.
 */
function assembleQuestionFromBank(
  tq: TemplateQuestion,
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
    const count = Math.max(2, tq.sub_parts ?? 2);
    const parts: QuestionPart[] = [];
    for (let i = 0; i < count; i++) {
      const b = get("attempt_option", i);
      if (b) parts.push(bankToPart(b, `(${ROMAN[i] ?? i + 1})`, false));
    }
    base.parts = parts;
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
