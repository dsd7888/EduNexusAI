/**
 * AI generation of Q Bank questions from GenerationSlots.
 *
 * Each slot becomes one Flash call (task='qbank_generate', thinking disabled).
 * Slots are processed with a concurrency window of 5 ("parallel batches of 5").
 * `fresh` slots draw purely from the syllabus; `pyq_inspired` slots are seeded
 * with up to 5 real PYQs and instructed to vary, not copy, them.
 */

import { routeAI } from "@/lib/ai/router";
import type {
  Difficulty,
  GenerationSlot,
  MCQOption,
  QuestionType,
} from "./types";

const CONCURRENCY = 5;
const PYQ_PER_SLOT = 5;
const MODULE_CONTENT_MAX = 300;

export interface GenModule {
  id: string;
  name: string;
  description: string | null;
}

export interface GenSubjectContext {
  subject_name: string;
  modules: GenModule[];
  course_outcomes: { co_code: string; description: string }[];
}

/** A real past question used as inspiration (text only; pyq_questions has no module_id). */
export interface PyqInspiration {
  question_text: string;
}

/** A generated question carrying the slot constraints it was produced for. */
export interface GeneratedBankQuestion {
  question_text: string;
  model_answer: string | null;
  options: MCQOption[] | null;
  co_code: string | null;
  btl_level: number | null;
  difficulty: Difficulty | null;
  question_type: QuestionType;
  marks: number;
  module_id: string | null;
}

const SYSTEM_PROMPT = `You are an expert question setter for Indian engineering university examinations. Generate questions that test genuine understanding, not just memorization. Questions must be unambiguous, self-contained, and academically rigorous.`;

// ─── Prompt assembly ───────────────────────────────────────────────────────

function buildUserPrompt(
  slot: GenerationSlot,
  ctx: GenSubjectContext,
  pyqs: PyqInspiration[]
): string {
  const moduleObj = slot.module_id
    ? ctx.modules.find((m) => m.id === slot.module_id)
    : undefined;
  const moduleName = moduleObj?.name ?? "Any module";
  const moduleContent = (moduleObj?.description ?? "")
    .slice(0, MODULE_CONTENT_MAX)
    .trim();
  const coObj = slot.co_code
    ? ctx.course_outcomes.find((c) => c.co_code === slot.co_code)
    : undefined;
  const coLine = slot.co_code
    ? `${slot.co_code}: ${coObj?.description ?? ""}`.trim()
    : "Any CO";

  let prompt = `Subject: ${ctx.subject_name}
Module: ${moduleName}
Module content: ${moduleContent || "(not specified)"}
CO: ${coLine}

Generate exactly ${slot.count} ${slot.question_type} questions worth ${slot.marks} marks each.
Difficulty: ${slot.difficulty ?? "mixed"}

Rules:
- Each question must be distinct, no repetition of concepts
- For numerical questions: include specific values, show expected approach
- For MCQ: 4 options, exactly 1 correct, plausible distractors
- For long answer (5M+): question should require multi-part response
- Do NOT include answers in question text
- Indian engineering university context

Output ONLY valid JSON array:
[
  {
    "question_text": string,
    "model_answer": string,
    "options": null or [{"label": "A", "text": string, "is_correct": boolean}],
    "co_code": string,
    "btl_level": number,
    "difficulty": "easy" | "medium" | "hard"
  }
]`;

  if (slot.style === "pyq_inspired" && pyqs.length > 0) {
    const examples = pyqs
      .slice(0, PYQ_PER_SLOT)
      .map((p, i) => `${i + 1}. ${p.question_text}`)
      .join("\n");
    prompt += `

Generate questions INSPIRED BY but NOT IDENTICAL TO these past questions.
Same concept, different values/context/framing:
PYQ examples:
${examples}

Variation rules:
- Numerical: change all values, keep the concept/algorithm
- Theory: rephrase completely, test same CO from different angle
- MCQ: change options, keep correct concept`;
  }

  return prompt;
}

// ─── Parsing / normalisation ───────────────────────────────────────────────

interface RawGen {
  question_text?: string;
  model_answer?: string;
  options?: unknown;
  co_code?: string | number;
  btl_level?: number | string;
  difficulty?: string;
}

function parseJsonArray(raw: string): RawGen[] | null {
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();
  const first = cleaned.indexOf("[");
  const last = cleaned.lastIndexOf("]");
  const slice =
    first !== -1 && last > first ? cleaned.slice(first, last + 1) : cleaned;
  try {
    const parsed = JSON.parse(slice);
    if (Array.isArray(parsed)) return parsed as RawGen[];
  } catch {
    const salvage: RawGen[] = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (ch === "{") {
        if (depth === 0) start = i;
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0 && start !== -1) {
          try {
            salvage.push(JSON.parse(cleaned.slice(start, i + 1)) as RawGen);
          } catch {
            // skip malformed
          }
          start = -1;
        }
      }
    }
    if (salvage.length > 0) return salvage;
  }
  return null;
}

const VALID_LABELS: ReadonlySet<string> = new Set(["A", "B", "C", "D"]);

function normaliseOptions(raw: unknown): MCQOption[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: MCQOption[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    const obj = o as Record<string, unknown>;
    const label = String(obj.label ?? "").toUpperCase().trim();
    const text = String(obj.text ?? "").trim();
    if (!VALID_LABELS.has(label) || !text) continue;
    out.push({
      label: label as MCQOption["label"],
      text,
      is_correct: Boolean(obj.is_correct),
    });
  }
  return out.length > 0 ? out : null;
}

function normaliseDifficulty(v: unknown): Difficulty | null {
  const s = String(v ?? "").toLowerCase().trim();
  return s === "easy" || s === "medium" || s === "hard"
    ? (s as Difficulty)
    : null;
}

function normaliseBtl(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const t = Math.trunc(n);
  return t >= 1 && t <= 6 ? t : null;
}

// ─── Slot generation ───────────────────────────────────────────────────────

async function generateSlot(
  slot: GenerationSlot,
  ctx: GenSubjectContext,
  pyqs: PyqInspiration[]
): Promise<GeneratedBankQuestion[]> {
  const prompt = buildUserPrompt(slot, ctx, pyqs);
  try {
    const result = await routeAI("qbank_generate", {
      model: "flash",
      messages: [{ role: "user", content: prompt }],
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0.6,
    });
    const arr = parseJsonArray(String(result.content ?? ""));
    if (!arr) {
      console.warn(
        `[qbank generate] parse failure for slot type=${slot.question_type} marks=${slot.marks}`
      );
      return [];
    }
    return arr
      .filter((r) => r && typeof r.question_text === "string" && r.question_text.trim())
      .map((r) => ({
        question_text: String(r.question_text).trim(),
        model_answer:
          typeof r.model_answer === "string" && r.model_answer.trim()
            ? r.model_answer.trim()
            : null,
        options:
          slot.question_type === "mcq" ? normaliseOptions(r.options) : null,
        co_code:
          slot.co_code ??
          (r.co_code != null && String(r.co_code).trim()
            ? String(r.co_code).trim()
            : null),
        btl_level: slot.btl_level ?? normaliseBtl(r.btl_level),
        difficulty: slot.difficulty ?? normaliseDifficulty(r.difficulty),
        question_type: slot.question_type,
        marks: slot.marks,
        module_id: slot.module_id ?? null,
      }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.warn(`[qbank generate] slot call failed: ${message}`);
    return [];
  }
}

/**
 * Generate questions for every slot. Slots run with a concurrency window of 5;
 * pyq_inspired slots are seeded with PYQs (filtered by the slot's module_id when
 * a mapping is available — pyq_questions has no module_id, so PYQs are matched
 * at the subject level and passed through as-is).
 */
export async function generateForSlots(
  slots: GenerationSlot[],
  ctx: GenSubjectContext,
  pyqs: PyqInspiration[]
): Promise<GeneratedBankQuestion[]> {
  const out: GeneratedBankQuestion[] = [];
  for (let i = 0; i < slots.length; i += CONCURRENCY) {
    const window = slots.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      window.map((slot) =>
        generateSlot(slot, ctx, slot.style === "pyq_inspired" ? pyqs : [])
      )
    );
    for (const r of results) out.push(...r);
  }
  return out;
}
