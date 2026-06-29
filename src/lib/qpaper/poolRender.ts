/**
 * Adapters: pool items → the SubQuestion / QuestionPart shapes that existing
 * PDF, DOCX, and review renderers already know how to draw.
 */

import type { SubQuestion, QuestionPart } from "./builder";
import type { PoolItem } from "./templates";
import { isPoolItemMcqLike } from "./templates";

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];

export function poolItemLabel(idx: number): string {
  return `(${ROMAN[idx] ?? idx + 1})`;
}

export function poolItemToSubQuestion(item: PoolItem, idx: number): SubQuestion {
  return {
    label: poolItemLabel(idx),
    question: item.question_text,
    options: item.options,
    co: item.co,
    btl: item.btl,
    po: item.po,
    model_answer: item.model_answer,
    image_path: item.image_path ?? null,
    image_url: item.image_url ?? null,
  };
}

export function poolItemToPart(
  item: PoolItem,
  idx: number,
  marks: number
): QuestionPart {
  return {
    label: poolItemLabel(idx),
    question: item.question_text,
    marks,
    co: item.co,
    btl: item.btl,
    po: item.po,
    model_answer: item.model_answer,
    image_path: item.image_path ?? null,
    image_url: item.image_url ?? null,
  };
}

export function poolAttemptCount(q: {
  attempt_logic?: string | null;
  items?: unknown[];
}): number {
  const logic = q.attempt_logic ?? "";
  if (logic === "any_one") return 1;
  const m = /^any_(\d+)$/.exec(logic);
  if (m) return Math.max(1, Number(m[1]) || 1);
  return q.items?.length ?? 1;
}

export function poolMarksPerItem(q: {
  total_marks: number;
  attempt_logic?: string | null;
  items?: unknown[];
}): number {
  const k = poolAttemptCount(q);
  return k > 0 ? q.total_marks / k : q.total_marks;
}

export { isPoolItemMcqLike };
