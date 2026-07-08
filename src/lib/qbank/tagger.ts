/**
 * AI-based CO / BTL / difficulty inference for Q Bank questions that arrive
 * without academic tagging (chiefly faculty CSV imports).
 *
 * `tagQuestions` runs Flash in batches of 10 (thinkingBudget is disabled for
 * the `qbank_tag` task in the router/provider, so structured JSON is never
 * truncated by thinking tokens). Parsing has a 2-attempt fallback; on total
 * failure a batch is returned with confidence='low' and null inferred fields.
 * This module NEVER throws — every input question yields a TaggedQuestion.
 */

import { routeAI } from "@/lib/ai/router";
import type { Difficulty, ImportedQuestion } from "./types";
import type { AILogContext } from "@/lib/ai/providers/types";

// ─── Public input/output types ─────────────────────────────────────────────

export interface SubjectModule {
  id: string;
  name: string;
  description: string;
}

export interface SubjectCourseOutcome {
  co_code: string;
  description: string;
}

export interface SubjectContext {
  subject_name: string;
  modules: SubjectModule[];
  course_outcomes: SubjectCourseOutcome[];
}

export interface TaggedQuestion extends ImportedQuestion {
  inferred_co_code: string;
  inferred_btl_level: number;
  inferred_difficulty: Difficulty;
  inferred_module_id: string | null;
  confidence: "high" | "medium" | "low";
}

// ─── Constants ─────────────────────────────────────────────────────────────

const BATCH_SIZE = 10;
const DIFFICULTIES: ReadonlySet<string> = new Set(["easy", "medium", "hard"]);

const SYSTEM_PROMPT = `You are an academic question classifier for Indian engineering universities. Given a question and its subject context, accurately infer CO mapping, Bloom's Taxonomy level, and difficulty.`;

// ─── Prompt assembly ───────────────────────────────────────────────────────

function buildUserPrompt(
  batch: ImportedQuestion[],
  context: SubjectContext
): string {
  const coBlock =
    context.course_outcomes.length > 0
      ? context.course_outcomes
          .map((c) => `${c.co_code}: ${c.description}`)
          .join("\n")
      : "(none provided)";

  const moduleBlock =
    context.modules.length > 0
      ? context.modules
          .map((m) => `${m.id}: ${m.name} - ${m.description}`)
          .join("\n")
      : "(none provided)";

  const questionsBlock = batch
    .map(
      (q, i) =>
        `${i}. [${q.marks}M | ${q.question_type}] ${q.question_text}`
    )
    .join("\n");

  return `Subject: ${context.subject_name}
Course Outcomes:
${coBlock}

Modules:
${moduleBlock}

Classify each question below. Output ONLY valid JSON array.
First char [, last char ]. No markdown.

Questions:
${questionsBlock}

Output format:
[
  {
    "index": 0,
    "co_code": "CO2",
    "btl_level": 3,
    "difficulty": "medium",
    "module_id": "{uuid}",
    "confidence": "high"
  }
]

Rules:
- co_code: pick the single most relevant CO
- btl_level: 1=Remember, 2=Understand, 3=Apply, 4=Analyze, 5=Evaluate, 6=Create
- difficulty: easy=recall/definition, medium=application/analysis, hard=synthesis/evaluation/multi-step
- module_id: uuid of the most relevant module, null if unclear
- confidence: high if clearly maps, medium if probable, low if ambiguous`;
}

// ─── JSON parsing ──────────────────────────────────────────────────────────

interface RawTag {
  index?: number;
  co_code?: string;
  btl_level?: number | string;
  difficulty?: string;
  module_id?: string | null;
  confidence?: string;
}

function parseTagArray(raw: string): RawTag[] | null {
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
    if (Array.isArray(parsed)) return parsed as RawTag[];
  } catch {
    // Salvage: collect well-formed top-level objects.
    const salvage: RawTag[] = [];
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
            salvage.push(JSON.parse(cleaned.slice(start, i + 1)) as RawTag);
          } catch {
            // skip malformed object
          }
          start = -1;
        }
      }
    }
    if (salvage.length > 0) return salvage;
  }
  return null;
}

// ─── Normalisation ─────────────────────────────────────────────────────────

function normaliseBtl(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  const t = Math.trunc(n);
  return t >= 1 && t <= 6 ? t : 1;
}

function normaliseDifficulty(v: unknown): Difficulty {
  const s = String(v ?? "").toLowerCase().trim();
  return DIFFICULTIES.has(s) ? (s as Difficulty) : "medium";
}

function normaliseConfidence(v: unknown): "high" | "medium" | "low" {
  const s = String(v ?? "").toLowerCase().trim();
  return s === "high" || s === "medium" || s === "low" ? s : "low";
}

function normaliseModuleId(
  v: unknown,
  validIds: ReadonlySet<string>
): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s && validIds.has(s) ? s : null;
}

/** Fallback tag for a question we couldn't classify — never throws downstream. */
function lowConfidenceTag(q: ImportedQuestion): TaggedQuestion {
  return {
    ...q,
    inferred_co_code: q.co_code ?? "",
    inferred_btl_level: q.btl_level ?? 1,
    inferred_difficulty: q.difficulty ?? "medium",
    inferred_module_id: null,
    confidence: "low",
  };
}

// ─── Batch processing ──────────────────────────────────────────────────────

async function tagBatch(
  batch: ImportedQuestion[],
  context: SubjectContext,
  validModuleIds: ReadonlySet<string>,
  logContext: AILogContext,
  batchIndex: number
): Promise<TaggedQuestion[]> {
  const prompt = buildUserPrompt(batch, context);

  // 2-attempt fallback: parse failures are the common Flash-JSON issue.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await routeAI("qbank_tag", {
        model: "flash",
        messages: [{ role: "user", content: prompt }],
        systemPrompt: SYSTEM_PROMPT,
        temperature: 0.2,
        logContext: {
          ...logContext,
          attemptNumber: attempt,
          metadata: {
            ...(logContext.metadata ?? {}),
            batchIndex,
            batchSize: batch.length,
          },
        },
      });
      const arr = parseTagArray(String(result.content ?? ""));
      if (arr && arr.length > 0) {
        const byIndex = new Map<number, RawTag>();
        arr.forEach((t, i) => {
          const idx = typeof t.index === "number" ? t.index : i;
          byIndex.set(idx, t);
        });
        return batch.map((q, i) => {
          const tag = byIndex.get(i);
          if (!tag) return lowConfidenceTag(q);
          return {
            ...q,
            inferred_co_code: tag.co_code?.trim() || (q.co_code ?? ""),
            inferred_btl_level: normaliseBtl(tag.btl_level),
            inferred_difficulty: normaliseDifficulty(tag.difficulty),
            inferred_module_id: normaliseModuleId(tag.module_id, validModuleIds),
            confidence: normaliseConfidence(tag.confidence),
          };
        });
      }
      console.warn(
        `[tagQuestions] batch parse failure (attempt ${attempt}) — content head: ${String(
          result.content ?? ""
        ).slice(0, 200)}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      console.warn(
        `[tagQuestions] batch call failed (attempt ${attempt}): ${message}`
      );
    }
  }

  // Both attempts failed — degrade gracefully.
  return batch.map(lowConfidenceTag);
}

// ─── Public entrypoint ─────────────────────────────────────────────────────

export async function tagQuestions(
  questions: ImportedQuestion[],
  subjectContext: SubjectContext,
  logContext: AILogContext
): Promise<TaggedQuestion[]> {
  if (questions.length === 0) return [];

  const validModuleIds = new Set(subjectContext.modules.map((m) => m.id));

  const batches: ImportedQuestion[][] = [];
  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    batches.push(questions.slice(i, i + BATCH_SIZE));
  }

  // Batches are independent — run them in parallel and flatten in order.
  const tagged = await Promise.all(
    batches.map((batch, batchIndex) =>
      tagBatch(batch, subjectContext, validModuleIds, logContext, batchIndex)
    )
  );

  return tagged.flat();
}
