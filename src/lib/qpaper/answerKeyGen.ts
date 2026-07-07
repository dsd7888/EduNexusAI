/**
 * Answer-key generation pipeline.
 *
 *   1. caller fetches subject + modules + the previously assembled paper
 *   2. for each section, build a Pro prompt that lists THAT section's
 *      questions verbatim and asks for a model answer + marking scheme
 *   3. routeAI("answer_key_descriptive", { model: "pro", ... }) → JSON array
 *   4. assemble all sections' answers + render to a CONFIDENTIAL PDF
 *
 * Pro is the right model here for the same reason it's used for Q-paper
 * generation: numerical correctness and marking-scheme arithmetic must be
 * verifiable, and a single section of model answers is well within Pro's
 * 32k output budget. One Pro call per section keeps each request under
 * Vercel's per-route timeout while letting the model reason through
 * long algorithmic traces / DP tables without truncation.
 */

import { routeAI } from "@/lib/ai/router";
import { estimateMaxOutputTokens } from "@/lib/ai/tokenBudget";
import { createPDFBuilder, COLORS } from "@/lib/pdf/builder";
import { renderPaperMath } from "@/lib/qpaper/paperMath";
import { MATH_CHEM_NOTATION_GUIDE } from "@/lib/text/latexSegments";
import type {
  AssembledPaper,
  GeneratedQuestion,
} from "./builder";
import { isPoolItemMcqLike, type PoolItem } from "./templates";
import { poolItemLabel, poolMarksPerItem } from "./poolRender";
import { mcqSubSlotKey } from "./moduleAssignment";
import { imageDisplaySize, type PaperImageMap } from "./qpaperImages";

// ─── Public types ───────────────────────────────────────────────────────────

export interface AnswerKeyMCQEntry {
  label: string;
  correct_option: string;
  correct_text?: string;
  justification: string;
  distractor_note?: string;
}

export interface AnswerKeyDescriptive {
  label?: string;
  total_marks: number;
  marking_scheme: string;
  model_answer: string;
  partial_credit_note?: string;
  alternative_approaches?: string;
}

export interface AnswerKeyEntry {
  slotKey?: string;
  display_label?: string;
  type:
    | "mcq"
    | "descriptive"
    | "descriptive_with_or"
    | "attempt_any_one"
    | "pool"
    | string;
  marking_note?: string;
  answers?: AnswerKeyMCQEntry[];
  total_marks?: number;
  marking_scheme?: string;
  model_answer?: string;
  partial_credit_note?: string;
  alternative_approaches?: string;
  main?: AnswerKeyDescriptive[];
  or_alternative?: AnswerKeyDescriptive[];
  options?: AnswerKeyDescriptive[];
  /**
   * Populated only for the synthetic parent entry of a pool block. Holds one
   * child entry per pool item, each a normal "mcq"/"descriptive" entry routed
   * by its itemType, threaded back here by the merge step on its "Q<n>_i" slotKey.
   */
  pool_items?: AnswerKeyEntry[];
}

export interface AnswerKeyModuleInfo {
  module_number: number;
  name: string;
  description?: string | null;
}

export interface AnswerKeySectionInput {
  sectionName: string;
  subjectName: string;
  referenceBooks: string;
  sectionQuestions: GeneratedQuestion[];
  modules: AnswerKeyModuleInfo[];
}

export interface AnswerKeyGenSectionResult {
  sectionName: string;
  entries: AnswerKeyEntry[];
  warning?: string;
}

export interface AnswerKeyPDFInput {
  paper: AssembledPaper;
  sections: AnswerKeyGenSectionResult[];
  /** Decoded question images from loadPaperImages — used to embed bank-question images into the PDF. */
  images?: PaperImageMap;
}

// ─── System prompt ──────────────────────────────────────────────────────────

export const ANSWER_KEY_SYSTEM_PROMPT = `You are a senior academic evaluator and subject matter expert preparing a model answer key for an Indian university examination. Your answer keys are used by faculty evaluators to ensure fair, consistent, and bias-free marking across all students.

Your model answers are:
- Technically accurate — every formula, derivation, algorithm step, and numerical answer is verified correct
- Appropriately detailed — depth matches the marks and BTL level of the question
- Evaluator-friendly — marking scheme is explicit, partial credit guidance is clear
- Fair — alternative valid approaches are noted where they exist

When a model answer, marking scheme, or step contains mathematics or chemistry,
write the notation using this exact convention so it renders correctly in the
exported PDF (these delimiters are required and are NOT "markdown"):

${MATH_CHEM_NOTATION_GUIDE}

You output ONLY valid JSON. First character [, last character ]. No markdown. No prose before or after.`;

// ─── Prompt assembly ────────────────────────────────────────────────────────

function buildModuleContentBlock(modules: AnswerKeyModuleInfo[]): string {
  if (modules.length === 0) return "(no module syllabus available)";
  return modules
    .map(
      (m) =>
        `Module ${m.module_number}: ${m.name}\nSyllabus: ${m.description ?? "(no description provided)"}`
    )
    .join("\n\n---\n\n");
}

export function buildAnswerKeyPrompt(input: AnswerKeySectionInput): string {
  const {
    sectionName,
    subjectName,
    referenceBooks,
    sectionQuestions,
    modules,
  } = input;

  const refBooksBlock =
    referenceBooks.trim().length > 0
      ? referenceBooks
      : "(no reference books configured for this subject)";

  return `<evaluation_context>
Section: ${sectionName}
Subject: ${subjectName}
Reference books for this subject:
${refBooksBlock}

General marking guidance (include verbatim in answer key):
- Award marks for conceptually correct answers even if notation or phrasing differs from the model answer.
- For numerical problems: award method marks for correct approach even if an arithmetic error leads to a wrong final answer.
- Do not penalize for minor diagram variations if the diagram is conceptually correct.
- For algorithm traces: award marks for each correct step independently.
</evaluation_context>

<questions>
${JSON.stringify(sectionQuestions, null, 2)}

The above is the exact question paper JSON. Generate model answers for every question and sub-question present. Do not skip any.
For attempt_any_one: provide model answers for EVERY option present (there may be more than two).
For descriptive_with_or: provide model answers for BOTH the main set AND the OR alternative set.
If a question object includes an explicit "slotKey" field (e.g. "Q3_ii"), you MUST copy that exact string into its output entry's slotKey — do not derive your own from q_number. For objects without a slotKey field, use "Q<q_number>".
</questions>

<module_content>
${buildModuleContentBlock(modules)}

Use this syllabus content to ground your answers in what was taught. Answers should reflect this scope — do not introduce concepts beyond the syllabus.
</module_content>

<rules>

ACCURACY:
1. Every numerical answer must be computed correctly and completely. Show all intermediate steps — do not skip steps that an evaluator needs to follow.
2. Algorithm traces must show the exact state at each step. DP tables must be fully populated, not partially shown.
3. Every MCQ justification must explain WHY the correct option is right AND briefly note why the most plausible distractor is wrong — this helps evaluators handle student explanations.
4. Graph problems: show the final MST/path/tree with total cost.

MARKING SCHEME:
5. Every question's marks must be explicitly distributed across its components. Format: [xM: component description]. The marks must sum to the question's total marks.
   Example for a 6-mark numerical:
   [1M: correct formula/approach stated]
   [3M: correct step-by-step execution — 1M per major step]
   [1M: correct final answer with value]
   [1M: correct units or interpretation]

6. For descriptive questions, identify 3-5 key points that MUST be present. Mark allocation per key point must be stated. Label mandatory points vs bonus/alternative points clearly.

7. For MCQs: 1M per correct answer, no partial credit, no negative marking — state this once for the Q1 block, not per sub-question.

DEPTH CALIBRATION BY BTL LEVEL:
8. BTL 1 (Remember): answer is a definition or statement. 1-2 sentences. Do not over-elaborate.
9. BTL 2 (Understand): answer explains the concept. 3-5 sentences with an example if marks allow.
10. BTL 3 (Apply): answer shows complete execution on the given data. Every step shown.
11. BTL 4 (Analyze): answer compares, derives, or examines trade-offs. Conclusion must be explicitly stated.
12. BTL 5 (Evaluate): answer justifies a position with criteria. Both sides considered before conclusion.

PARTIAL CREDIT GUIDANCE:
13. For every numerical question, state explicitly what partial credit is awarded if a student has the right method but makes an arithmetic error partway through.
14. For questions with multiple parts (a) and (b): state whether marks from part (a) carry forward to part (b) or are independent.
</rules>

<output_format>
Output a JSON array. One element per question slot. First character [, last character ].

For MCQ (Q1):
{
  "slotKey": "Q1",
  "type": "mcq",
  "marking_note": "1 mark per correct answer, no negative marking",
  "answers": [
    {
      "label": "(i)",
      "correct_option": "b",
      "correct_text": "exact text of correct option",
      "justification": "why this is correct",
      "distractor_note": "why the most common wrong answer is incorrect"
    }
  ]
}

For descriptive/numerical (Q2):
{
  "slotKey": "Q2",
  "type": "descriptive",
  "total_marks": 6,
  "marking_scheme": "[2M: ...] [3M: ...] [1M: ...]",
  "model_answer": "complete model answer with all steps",
  "partial_credit_note": "if applicable",
  "alternative_approaches": "if any valid alternatives exist"
}

For descriptive_with_or (Q3):
{
  "slotKey": "Q3",
  "type": "descriptive_with_or",
  "main": [
    { "label": "(a)", "total_marks": 6, "marking_scheme": "...", "model_answer": "...", "partial_credit_note": "..." },
    { "label": "(b)", "total_marks": 6, "marking_scheme": "...", "model_answer": "..." }
  ],
  "or_alternative": [
    { "label": "(a)", "total_marks": 6, "marking_scheme": "...", "model_answer": "...", "partial_credit_note": "..." },
    { "label": "(b)", "total_marks": 6, "marking_scheme": "...", "model_answer": "..." }
  ]
}

For attempt_any_one (Q4):
{
  "slotKey": "Q4",
  "type": "attempt_any_one",
  "options": [
    { "label": "(i)", "total_marks": 6, "marking_scheme": "...", "model_answer": "...", "partial_credit_note": "..." },
    { "label": "(ii)", "total_marks": 6, "marking_scheme": "...", "model_answer": "..." }
  ]
}
</output_format>`;
}

// ─── JSON parsing ───────────────────────────────────────────────────────────

function stripCodeFences(raw: string): string {
  return raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function normalizeSlotKey(raw: string): string {
  // "Q - 1" → "Q1", "Q-1" → "Q1", "Q 1" → "Q1", "Q1" → "Q1"
  return raw.replace(/^Q\s*[-–]?\s*/i, "Q").replace(/\s+/g, "");
}

function parseAnswerKeyArray(raw: string): AnswerKeyEntry[] | null {
  let text = stripCodeFences(String(raw ?? "").trim());
  // Trim to outermost [...] in case the model wrapped in prose.
  const first = text.indexOf("[");
  const last = text.lastIndexOf("]");
  if (first !== -1 && last !== -1 && last > first) {
    text = text.slice(first, last + 1);
  }
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    const entries = parsed as AnswerKeyEntry[];
    // Normalize every slotKey at the parser boundary so all downstream
    // lookups (e.g. findOriginalQuestion) get the canonical "Q1"/"Q2"/…
    // form regardless of whether the AI emitted "Q - 1" or "Q-1".
    for (const e of entries) {
      if (typeof e?.slotKey === "string") {
        e.slotKey = normalizeSlotKey(e.slotKey);
      }
      normalizeEntryText(e);
    }
    return entries;
  } catch {
    return null;
  }
}

// The prompt asks for every text field as a JSON string, but answer_key_descriptive
// runs in JSON mode WITHOUT a responseSchema (see gemini.ts) — so Gemini Pro is
// free to emit model_answer / marking_scheme / etc. as a nested array or object
// (e.g. an array of step strings) for complex answers. Nothing enforced the
// string shape after the qpaper_gen reuse was split off, so those non-strings
// reached draw functions whose `.trim()` / .richText() calls assume a string and
// crashed. Coerce every text-bearing field to a string here, at the boundary,
// so all downstream rendering gets the shape its type annotation promises.
function normalizeEntryText(e: AnswerKeyEntry): void {
  if (!e || typeof e !== "object") return;

  e.marking_note = coerceMaybe(e.marking_note);
  e.marking_scheme = coerceMaybe(e.marking_scheme);
  e.model_answer = coerceMaybe(e.model_answer);
  e.partial_credit_note = coerceMaybe(e.partial_credit_note);
  e.alternative_approaches = coerceMaybe(e.alternative_approaches);

  for (const a of e.answers ?? []) {
    a.correct_text = coerceMaybe(a.correct_text);
    a.justification = coerceToText(a.justification);
    a.distractor_note = coerceMaybe(a.distractor_note);
  }

  for (const part of [
    ...(e.main ?? []),
    ...(e.or_alternative ?? []),
    ...(e.options ?? []),
  ]) {
    part.marking_scheme = coerceToText(part.marking_scheme);
    part.model_answer = coerceToText(part.model_answer);
    part.partial_credit_note = coerceMaybe(part.partial_credit_note);
    part.alternative_approaches = coerceMaybe(part.alternative_approaches);
  }
}

// Coerce a value that may be absent: undefined stays undefined (so optional
// fields don't render an empty "(no answer)" block), anything present becomes
// a string.
function coerceMaybe(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  return coerceToText(value);
}

// ─── MCQ-only Flash prompt ──────────────────────────────────────────────────
//
// The MCQ block needs none of Pro's reasoning — every answer is recall-level
// lookup plus a one-sentence justification. Splitting it off to Flash drops
// the wall-clock cost of an MCQ-bearing section to whatever the slowest
// descriptive Pro call takes, and keeps Pro's tokens for content that
// actually benefits from them.

export const ANSWER_KEY_MCQ_SYSTEM_PROMPT = `You are an exam answer key generator. Output ONLY valid JSON array. First char [, last char ].`;

export function buildMcqAnswerKeyPrompt(input: AnswerKeySectionInput): string {
  const { sectionName, subjectName, sectionQuestions } = input;
  return `Generate concise answer keys for the multiple-choice questions below.

Section: ${sectionName}
Subject: ${subjectName}

<questions>
${JSON.stringify(sectionQuestions, null, 2)}
</questions>

For every MCQ slot in the list above, produce ONE answer entry. If a question object includes an explicit "slotKey" field (e.g. "Q3_i"), copy that exact string into its entry's slotKey — do not derive your own from q_number. For objects without a slotKey field, use "Q<q_number>". For each sub-question inside that slot:
- correct_option: "a" | "b" | "c" | "d"
- correct_text: the verbatim text of the correct option (copy from the options object, do not paraphrase)
- justification: ONE sentence stating why this option is correct
- distractor_note: the most plausible wrong option label + ONE sentence on why it is wrong

Marking rule (state once at the slot level, not per sub-question): "1 mark per correct answer, no negative marking".

Be concise. Do not elaborate. One sentence per justification, one sentence per distractor note.

<output_format>
Output a JSON array. First character [, last character ]. One element per MCQ slot:

{
  "slotKey": "Q1",
  "type": "mcq",
  "marking_note": "1 mark per correct answer, no negative marking",
  "answers": [
    {
      "label": "(i)",
      "correct_option": "b",
      "correct_text": "...verbatim option text...",
      "justification": "ONE sentence.",
      "distractor_note": "Option (c) is wrong because ONE sentence."
    }
  ]
}
</output_format>`;
}

// ─── Per-section generation (parallel block split) ─────────────────────────
//
// A PPSU section typically has Q1 (MCQ), Q2 (descriptive), Q3 (descriptive
// with OR alternative) and Q4 (attempt-any-one). The three blocks below run
// in parallel:
//   - MCQ block  → Flash (recall lookup, no reasoning needed)
//   - Main block → Pro  (Q2 + Q3 main parts)
//   - Alt block  → Pro  (Q3 OR alternatives + Q4)
// Q3 is split: the Main call sees only the non-OR parts, the Alt call sees
// only the OR parts. Merge re-joins them on slotKey at the end. If a block
// is empty (e.g. section has no MCQs), the corresponding call is skipped.

type BlockKind = "mcq" | "main" | "alt";

interface BlockResult {
  kind: BlockKind;
  entries: AnswerKeyEntry[];
  warning?: string;
}

// A pool item is a standalone question of its own itemType. Wrap one as a
// synthetic GeneratedQuestion shaped exactly like a normal MCQ / descriptive
// question so it flows through the existing answer_key_mcq / answer_key_descriptive
// calls unchanged. The slotKey hint ("Q<n>_i") is what the AI echoes back and
// what the merge step uses to thread the answer under its parent pool block.
function poolItemToMcqQuestion(
  parent: GeneratedQuestion,
  item: PoolItem,
  idx: number,
  slotKey: string,
  marks: number
): GeneratedQuestion {
  const label = poolItemLabel(idx);
  return {
    q_number: parent.q_number,
    slotKey,
    display_label: label,
    type: "mcq",
    total_marks: marks,
    sub_parts: [
      {
        label,
        question: item.question_text,
        options: item.options,
        co: item.co,
        btl: item.btl,
        po: item.po,
      },
    ],
  };
}

function poolItemToDescriptiveQuestion(
  parent: GeneratedQuestion,
  item: PoolItem,
  idx: number,
  slotKey: string,
  marks: number
): GeneratedQuestion {
  const label = poolItemLabel(idx);
  return {
    q_number: parent.q_number,
    slotKey,
    display_label: label,
    type: "descriptive",
    total_marks: marks,
    parts: [
      {
        label,
        question: item.question_text,
        marks,
        co: item.co,
        btl: item.btl,
        po: item.po,
      },
    ],
  };
}

function splitQuestionsForBlocks(qs: GeneratedQuestion[]): {
  mcq: GeneratedQuestion[];
  main: GeneratedQuestion[];
  alt: GeneratedQuestion[];
} {
  const mcq: GeneratedQuestion[] = [];
  const main: GeneratedQuestion[] = [];
  const alt: GeneratedQuestion[] = [];
  for (const q of qs) {
    const type = (q.type ?? "").toLowerCase();
    if (type === "mcq") {
      mcq.push(q);
      continue;
    }
    if (type === "pool") {
      // Decompose each pool item into its own synthetic question, routed by
      // itemType: mcq/true_false → mcq (Flash) block, everything else
      // (short/long/numerical/fill_blank) → main (Pro descriptive) block. Each
      // keeps its own "Q<n>_i" slotKey so the merge can re-thread it under the
      // parent pool entry. No new task type — these are ordinary mcq/descriptive
      // questions to the answer-key calls.
      const marksPer = poolMarksPerItem(q);
      (q.items ?? []).forEach((item, idx) => {
        const slotKey = mcqSubSlotKey(q.q_number, idx);
        if (isPoolItemMcqLike(item.itemType)) {
          mcq.push(poolItemToMcqQuestion(q, item, idx, slotKey, marksPer));
        } else {
          main.push(poolItemToDescriptiveQuestion(q, item, idx, slotKey, marksPer));
        }
      });
      continue;
    }
    if (type === "descriptive_with_or") {
      const parts = q.parts ?? [];
      const mainParts = parts.filter((p) => !p.is_or_alternative);
      const altParts = parts.filter((p) => p.is_or_alternative);
      if (mainParts.length > 0) main.push({ ...q, parts: mainParts });
      if (altParts.length > 0) alt.push({ ...q, parts: altParts });
      continue;
    }
    if (type === "attempt_any_one") {
      alt.push(q);
      continue;
    }
    // descriptive / numerical / anything else → main
    main.push(q);
  }
  return { mcq, main, alt };
}

async function runBlock(
  sectionName: string,
  kind: BlockKind,
  call: () => Promise<{ content: string }>
): Promise<BlockResult> {
  try {
    const result = await call();
    const entries = parseAnswerKeyArray(result.content);
    if (!entries) {
      console.error(
        `[answer-key] ${sectionName}/${kind} parse failure:`,
        String(result.content ?? "").slice(0, 400)
      );
      return {
        kind,
        entries: [],
        warning: `${sectionName} ${kind}: failed to parse JSON`,
      };
    }
    return { kind, entries };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(
      `[answer-key] ${sectionName}/${kind} call failed:`,
      msg
    );
    return {
      kind,
      entries: [],
      warning: `${sectionName} ${kind}: ${msg}`,
    };
  }
}

/**
 * For descriptive_with_or, force the answers into the half of the entry that
 * matches the source block — regardless of which output field the AI chose.
 *
 * Without this normalization, the alt-block AI tends to put its answers
 * under the `main` output field (the parts it sees look structurally like
 * main parts: same labels (a)/(b), same shape, no special marker the prompt
 * tells it about). The downstream merge then overwrites the real main-block
 * answers, producing the "main shows OR content" symptom.
 *
 * Solution: ignore the AI's choice of bucket. Concatenate everything the AI
 * produced (main + or_alternative) and route it to the bucket dictated by
 * the source block (main-block → final.main, alt-block → final.or_alternative).
 */
function normalizeEntryForBlock(
  entry: AnswerKeyEntry,
  kind: BlockKind
): AnswerKeyEntry {
  if (kind === "mcq") return entry;
  if ((entry.type ?? "").toLowerCase() !== "descriptive_with_or") return entry;

  const collected: AnswerKeyDescriptive[] = [];
  if (Array.isArray(entry.main)) collected.push(...entry.main);
  if (Array.isArray(entry.or_alternative)) collected.push(...entry.or_alternative);
  if (collected.length === 0) return entry;

  if (kind === "main") {
    return { ...entry, main: collected, or_alternative: undefined };
  }
  // kind === "alt"
  return { ...entry, main: undefined, or_alternative: collected };
}

function mergeBlockEntries(blocks: BlockResult[]): AnswerKeyEntry[] {
  const map = new Map<string, AnswerKeyEntry>();
  const order: string[] = [];
  let unkeyedCounter = 0;
  for (const block of blocks) {
    for (const raw of block.entries) {
      const entry = normalizeEntryForBlock(raw, block.kind);
      const rawKey = entry.slotKey;
      const key =
        rawKey && rawKey.length > 0 ? rawKey : `_unkeyed_${unkeyedCounter++}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, entry);
        order.push(key);
        continue;
      }
      // Same slotKey across two blocks — happens for descriptive_with_or
      // where the Main call contributes `main` and the Alt call contributes
      // `or_alternative` (after the normalize step above forces them into
      // the right halves).
      const merged: AnswerKeyEntry = { ...existing };
      if (entry.main && entry.main.length > 0) merged.main = entry.main;
      if (entry.or_alternative && entry.or_alternative.length > 0) {
        merged.or_alternative = entry.or_alternative;
      }
      // Carry over any other fields the existing entry left empty.
      const mergedBag = merged as unknown as Record<string, unknown>;
      const incomingBag = entry as unknown as Record<string, unknown>;
      for (const k of Object.keys(incomingBag)) {
        if (k === "main" || k === "or_alternative") continue;
        const current = mergedBag[k];
        const incoming = incomingBag[k];
        if ((current == null || current === "") && incoming != null) {
          mergedBag[k] = incoming;
        }
      }
      map.set(key, merged);
    }
  }
  return order.map((k) => map.get(k) as AnswerKeyEntry);
}

// ── Pool re-threading ───────────────────────────────────────────────────────
//
// splitQuestionsForBlocks decomposed each pool block into individual per-item
// questions that ran through the mcq / main calls and came back as flat,
// independently-keyed entries (Q<n>_i, Q<n>_ii, …) — scattered across blocks
// the same way MCQ sub-parts are answered individually. This step threads those
// per-item answers back under one synthetic parent "pool" entry keyed "Q<n>",
// preserving item order, so the PDF can render the block as a unit.
function regroupPoolEntries(
  entries: AnswerKeyEntry[],
  sectionQuestions: GeneratedQuestion[]
): AnswerKeyEntry[] {
  const poolQs = sectionQuestions.filter(
    (q) => (q.type ?? "").toLowerCase() === "pool"
  );
  if (poolQs.length === 0) return entries;

  // child slotKey → { parent "Q<n>", item index }
  const childToParent = new Map<string, { parentKey: string; idx: number }>();
  // parent "Q<n>" → pre-sized item bucket (shared by reference with the entry)
  const poolBuckets = new Map<string, AnswerKeyEntry[]>();
  for (const q of poolQs) {
    const parentKey = `Q${q.q_number}`;
    const count = (q.items ?? []).length;
    poolBuckets.set(parentKey, new Array<AnswerKeyEntry>(count));
    (q.items ?? []).forEach((_, idx) => {
      childToParent.set(mcqSubSlotKey(q.q_number, idx), { parentKey, idx });
    });
  }

  const out: AnswerKeyEntry[] = [];
  const insertedParents = new Set<string>();
  for (const entry of entries) {
    const ref = entry.slotKey ? childToParent.get(entry.slotKey) : undefined;
    if (!ref) {
      out.push(entry);
      continue;
    }
    // Slot the child into its parent's bucket by item index, and emit the
    // parent entry at the position of its first-seen child.
    entry.display_label = entry.display_label ?? poolItemLabel(ref.idx);
    poolBuckets.get(ref.parentKey)![ref.idx] = entry;
    if (!insertedParents.has(ref.parentKey)) {
      insertedParents.add(ref.parentKey);
      out.push({
        slotKey: ref.parentKey,
        type: "pool",
        pool_items: poolBuckets.get(ref.parentKey)!,
      });
    }
  }

  // Drop holes for any pool item the AI failed to answer.
  for (const e of out) {
    if (e.type === "pool" && e.pool_items) {
      e.pool_items = e.pool_items.filter(Boolean);
    }
  }

  // Children arrive interleaved across mcq/main blocks, so the parent's
  // insertion point can land out of Q-number order. Re-sort the whole section
  // by leading slot number (stable) to restore Q1 → Q2 → Q3 … ordering.
  const slotQNum = (e: AnswerKeyEntry): number => {
    const m = e.slotKey ? /Q\s*-?\s*(\d+)/i.exec(e.slotKey) : null;
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  out.sort((a, b) => slotQNum(a) - slotQNum(b));
  return out;
}

// Compute the slot composition for a non-MCQ answer-key block.
// splitQuestionsForBlocks already filters q.parts to the relevant half
// (main-only or OR-only for descriptive_with_or), so (q.parts ?? []).length
// gives the exact number of full model answers this block must produce.
function buildAnswerKeyBlockSlots(
  qs: GeneratedQuestion[]
): { type: string; count: number }[] {
  const out: { type: string; count: number }[] = [];
  for (const q of qs) {
    const type = (q.type ?? "").toLowerCase();
    if (type === "mcq") {
      out.push({ type: "mcq", count: q.sub_parts?.length ?? 0 });
    } else {
      // descriptive, descriptive_with_or (filtered half), attempt_any_one, numerical
      const partCount = (q.parts ?? []).length || 1;
      out.push({ type: "descriptive", count: partCount });
    }
  }
  return out;
}

export async function generateAnswerKeySection(
  input: AnswerKeySectionInput
): Promise<AnswerKeyGenSectionResult> {
  const split = splitQuestionsForBlocks(input.sectionQuestions);

  const mcqSubParts = split.mcq.reduce(
    (s, q) => s + (q.sub_parts?.length ?? 0),
    0
  );
  const mcqBudget = estimateMaxOutputTokens(
    [{ type: "mcq", count: mcqSubParts }],
    "answer_key"
  );
  const mainBudget = estimateMaxOutputTokens(
    buildAnswerKeyBlockSlots(split.main),
    "answer_key"
  );
  const altBudget = estimateMaxOutputTokens(
    buildAnswerKeyBlockSlots(split.alt),
    "answer_key"
  );

  const proPromptFor = (subset: GeneratedQuestion[]) =>
    buildAnswerKeyPrompt({ ...input, sectionQuestions: subset });

  const emptyBlock = (kind: BlockKind): Promise<BlockResult> =>
    Promise.resolve({ kind, entries: [] });

  const mcqPromise: Promise<BlockResult> =
    split.mcq.length > 0
      ? runBlock(input.sectionName, "mcq", () =>
          routeAI("answer_key_mcq", {
            messages: [
              {
                role: "user",
                content: buildMcqAnswerKeyPrompt({
                  ...input,
                  sectionQuestions: split.mcq,
                }),
              },
            ],
            systemPrompt: ANSWER_KEY_MCQ_SYSTEM_PROMPT,
            temperature: 0.4,
            maxTokens: mcqBudget,
          })
        )
      : emptyBlock("mcq");

  const mainPromise: Promise<BlockResult> =
    split.main.length > 0
      ? runBlock(input.sectionName, "main", () =>
          routeAI("answer_key_descriptive", {
            model: "pro",
            messages: [{ role: "user", content: proPromptFor(split.main) }],
            systemPrompt: ANSWER_KEY_SYSTEM_PROMPT,
            temperature: 0.4,
            maxTokens: mainBudget,
          })
        )
      : emptyBlock("main");

  const altPromise: Promise<BlockResult> =
    split.alt.length > 0
      ? runBlock(input.sectionName, "alt", () =>
          routeAI("answer_key_descriptive", {
            model: "pro",
            messages: [{ role: "user", content: proPromptFor(split.alt) }],
            systemPrompt: ANSWER_KEY_SYSTEM_PROMPT,
            temperature: 0.4,
            maxTokens: altBudget,
          })
        )
      : emptyBlock("alt");

  const [mcqRes, mainRes, altRes] = await Promise.all([
    mcqPromise,
    mainPromise,
    altPromise,
  ]);

  const warnings: string[] = [];
  if (mcqRes.warning) warnings.push(mcqRes.warning);
  if (mainRes.warning) warnings.push(mainRes.warning);
  if (altRes.warning) warnings.push(altRes.warning);

  // Merge in mcq → main → alt order so Q1 → Q2 → Q3 → Q4 ordering is preserved.
  const merged = mergeBlockEntries([mcqRes, mainRes, altRes]);
  // Thread any decomposed pool items back under their parent "Q<n>" entry.
  // No-op (and order-preserving) for sections without pool blocks.
  const entries = regroupPoolEntries(merged, input.sectionQuestions);

  return {
    sectionName: input.sectionName,
    entries,
    warning: warnings.length > 0 ? warnings.join("; ") : undefined,
  };
}

// ─── PDF rendering ──────────────────────────────────────────────────────────

function sectionDisplay(name: string): string {
  return name.toUpperCase().replace(/SECTION\s*/i, "SECTION - ") + "  [MODEL ANSWERS]";
}

function findOriginalQuestion(
  paper: AssembledPaper,
  sectionName: string,
  entry: AnswerKeyEntry,
  fallbackIndex: number
): GeneratedQuestion | undefined {
  const section = paper.sections.find(
    (s) => s.section_name === sectionName
  );
  if (!section) return undefined;
  // Match by slotKey of the form "Q1", "Q2", … to q_number, else fall back to
  // positional alignment (which the AI is told to preserve).
  if (entry.slotKey) {
    const m = /Q\s*-?\s*(\d+)/i.exec(entry.slotKey);
    if (m) {
      const qNum = Number(m[1]);
      const byNumber = section.questions.find((q) => q.q_number === qNum);
      if (byNumber) return byNumber;
    }
  }
  return section.questions[fallbackIndex];
}

export async function buildAnswerKeyPDF(
  input: AnswerKeyPDFInput
): Promise<Buffer> {
  const { paper, sections } = input;
  const { builder } = await createPDFBuilder();

  // Rasterise every math/chemistry span in the paper AND the generated answers,
  // then embed them so the sync draw path can place them (mirrors image embed).
  await builder.embedMath(await renderPaperMath({ paper, sections }));

  const imageMap = input.images;
  const renderImageByPath = async (path: string | null | undefined): Promise<void> => {
    if (!path || !imageMap) return;
    const asset = imageMap.get(path);
    if (!asset) return;
    const dims = imageDisplaySize(asset.width, asset.height);
    await builder.image(
      asset.bytes,
      asset.format === "png" ? "image/png" : "image/jpeg",
      dims
    );
  };

  const FONT_BOLD = builder.getFont("bold");
  const FONT_REGULAR = builder.getFont("regular");
  const FONT_ITALIC = builder.getFont("italic");
  const BLACK = COLORS.text;
  const RULE = COLORS.text;

  // ── Header (matches Q paper drawHeader layout) ────────────────────────
  builder.text(paper.universityName, {
    font: FONT_BOLD,
    size: 14,
    color: BLACK,
    align: "center",
  });
  if (paper.examTitle) {
    builder.text(paper.examTitle, {
      font: FONT_REGULAR,
      size: 11,
      color: BLACK,
      align: "center",
    });
  }
  builder.text(`${paper.courseCode} - ${paper.courseName}`, {
    font: FONT_BOLD,
    size: 12,
    color: BLACK,
    align: "center",
  });
  builder.text(
    `Time: ${paper.duration} Minutes    Maximum Marks: ${paper.totalMarks}`,
    {
      font: FONT_REGULAR,
      size: 10,
      color: BLACK,
      align: "center",
    }
  );
  builder.space(4);
  builder.drawLine(RULE, 0.6);

  // ── Confidential / sub-title block (plain centered text, no banner) ───
  builder.text("MODEL ANSWER KEY AND MARKING SCHEME", {
    font: FONT_BOLD,
    size: 12,
    color: BLACK,
    align: "center",
  });
  builder.text("CONFIDENTIAL - FOR EVALUATORS ONLY", {
    font: FONT_REGULAR,
    size: 10,
    color: BLACK,
    align: "center",
  });
  builder.space(2);
  builder.drawLine(RULE, 0.6);

  // ── Per section ───────────────────────────────────────────────────────
  for (const sec of sections) {
    builder.space(10);
    builder.ensureSpace(40);
    builder.text(sectionDisplay(sec.sectionName), {
      font: FONT_BOLD,
      size: 12,
      color: BLACK,
      align: "center",
    });
    builder.space(6);

    // A warning means one of the parallel blocks (mcq / main / alt) failed.
    // The blocks that succeeded are still in sec.entries, so surface the
    // warning as a note but DO render whatever was generated — never discard a
    // section's working answers because a sibling block failed.
    if (sec.warning) {
      builder.text(
        `Note: ${sec.warning}. Some answers in this section may be incomplete — verify before distributing.`,
        { font: FONT_ITALIC, size: 10, color: BLACK }
      );
      builder.space(4);
    }

    if (sec.entries.length === 0) {
      builder.text("(no answers were generated for this section)", {
        font: FONT_ITALIC,
        size: 10,
        color: BLACK,
      });
      continue;
    }

    for (let i = 0; i < sec.entries.length; i++) {
      const entry = sec.entries[i];
      const orig = findOriginalQuestion(paper, sec.sectionName, entry, i);
      const label =
        orig?.display_label ??
        entry.display_label ??
        entry.slotKey ??
        `Q - ${i + 1}`;
      await drawAnswerEntry(builder, label, entry, orig, renderImageByPath);
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────
  builder.space(16);
  builder.drawLine(RULE, 0.6);
  builder.space(4);
  builder.text("- End of Answer Key -", {
    font: FONT_BOLD,
    size: 11,
    color: BLACK,
    align: "center",
  });
  builder.text(
    "Generated by EduNexus AI. Faculty should verify numerical answers before distributing to evaluators.",
    { font: FONT_REGULAR, size: 9, color: BLACK, align: "center" }
  );

  const bytes = await builder.build();
  return Buffer.from(bytes);
}

// Local alias for the builder type so helper signatures stay narrow.
type Builder = Awaited<ReturnType<typeof createPDFBuilder>>["builder"];
type ImageRenderer = (path: string | null | undefined) => Promise<void>;

function labelsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const clean = (s: string | null | undefined) =>
    String(s ?? "").replace(/[()]/g, "").trim().toLowerCase();
  const ca = clean(a);
  return ca !== "" && ca === clean(b);
}

// ─── Markdown stripping (render-time only) ────────────────────────────────
//
// The Pro answer-key prompt is left verbose — it can return markdown tables
// for DP grids, fenced code for tree diagrams, bold/italic emphasis. None of
// that renders well in pdf-lib (no real table layout, no monospace font in
// the Helvetica bundle). The functions below strip the markdown syntax at
// PDF build time and emit plain indented text instead, matching the visual
// register of the Q paper PDF.

function stripInline(text: string): string {
  return String(text ?? "")
    // Backticks (inline code).
    .replace(/`+/g, "")
    // Bold / italic / underline emphasis.
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|[^A-Za-z0-9])_([^_]+?)_(?=[^A-Za-z0-9]|$)/g, "$1$2")
    .trim();
}

function renderPlainBody(builder: Builder, content: string): void {
  // Defensive coercion: the `string` annotation is not always honored at
  // runtime (see drawDescriptive / answer_key_descriptive shape mismatch).
  // Turn any input shape into a string so this never throws on .trim().
  const text = coerceToText(content);
  if (!text || !text.trim()) {
    builder.text("(no answer generated)", {
      font: builder.getFont("italic"),
      size: 10,
      color: COLORS.text,
    });
    return;
  }
  // Run model answers through the shared parser so DP grids / matrices render
  // as real bordered tables and lists get proper markers, instead of the old
  // flattening that joined table cells into a single space-separated line.
  builder.richText(text, { size: 10 });
}

// Coerce an arbitrary value (string | string[] | object | null) into the
// plain text we want to render. Never throws. Falls back to the empty string
// so callers hit the graceful "(no answer generated)" path.
function coerceToText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(coerceToText).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    // Pull out whatever text-bearing field the model actually returned,
    // rather than rendering "[object Object]".
    const obj = value as Record<string, unknown>;
    for (const key of ["answer", "text", "content", "body", "value"]) {
      if (typeof obj[key] === "string" && obj[key]) {
        return obj[key] as string;
      }
    }
    // Last resort: stringify so something legible reaches the page.
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
}

// ─── Entry-type dispatch ─────────────────────────────────────────────────

async function drawAnswerEntry(
  builder: Builder,
  label: string,
  entry: AnswerKeyEntry,
  origQ?: GeneratedQuestion,
  renderImage?: ImageRenderer
): Promise<void> {
  switch ((entry.type ?? "").toLowerCase()) {
    case "mcq":
      await drawMCQ(builder, label, entry, origQ, renderImage);
      break;
    case "descriptive_with_or":
      await drawDescriptiveWithOr(builder, label, entry, origQ, renderImage);
      break;
    case "attempt_any_one":
      await drawAttemptAnyOne(builder, label, entry, origQ, renderImage);
      break;
    case "pool":
      await drawPoolAnswer(builder, label, entry, origQ, renderImage);
      break;
    default:
      await drawDescriptive(builder, label, entry, origQ, renderImage);
  }
}

// Pool block: render a header, then iterate the items and reuse the existing
// MCQ / descriptive drawers per item (the same reuse the student-paper pool
// renderer uses) — each child entry is an ordinary "mcq"/"descriptive" entry.
async function drawPoolAnswer(
  builder: Builder,
  label: string,
  entry: AnswerKeyEntry,
  origQ?: GeneratedQuestion,
  renderImage?: ImageRenderer
): Promise<void> {
  builder.space(6);
  builder.ensureSpace(40);
  builder.text(`${label}   (Pool - model answers for all listed items)`, {
    font: builder.getFont("bold"),
    size: 10.5,
    color: COLORS.text,
  });
  for (let idx = 0; idx < (entry.pool_items ?? []).length; idx++) {
    const item = entry.pool_items![idx];
    const itemLabel = item.display_label ?? item.slotKey ?? "";
    // Pool items carry image_path on the original PoolItem; render it before
    // the per-item answer so the evaluator sees the image in context.
    const origItem = origQ?.items?.[idx] as { image_path?: string | null } | undefined;
    if (origItem?.image_path && renderImage) await renderImage(origItem.image_path);
    await drawAnswerEntry(builder, itemLabel, item, undefined, renderImage);
  }
}

async function drawMCQ(
  builder: Builder,
  label: string,
  entry: AnswerKeyEntry,
  origQ?: GeneratedQuestion,
  renderImage?: ImageRenderer
): Promise<void> {
  const note =
    entry.marking_note ?? "1 mark per correct answer, no negative marking";
  builder.space(6);
  builder.ensureSpace(40);
  builder.text(`${label}   Marking: ${note}`, {
    font: builder.getFont("bold"),
    size: 10.5,
    color: COLORS.text,
  });
  builder.space(2);

  for (const a of entry.answers ?? []) {
    builder.ensureSpace(24);
    // Render the sub-question's attached image before its answer line.
    if (renderImage) {
      const sub = origQ?.sub_parts?.find((s) =>
        labelsMatch(s.label, a.label)
      );
      if (sub?.image_path) await renderImage(sub.image_path);
    }
    const head =
      a.correct_text && a.correct_text.trim().length > 0
        ? `${a.label}  Correct Answer: (${a.correct_option})  ${stripInline(a.correct_text)}`
        : `${a.label}  Correct Answer: (${a.correct_option})`;
    builder.textOrMath(head, {
      font: builder.getFont("bold"),
      size: 10,
      color: COLORS.text,
    });
    if (a.justification && a.justification.trim().length > 0) {
      builder.textOrMath(stripInline(a.justification), {
        font: builder.getFont("regular"),
        size: 10,
        color: COLORS.text,
      });
    }
    if (a.distractor_note && a.distractor_note.trim().length > 0) {
      builder.textOrMath(`Distractor note: ${stripInline(a.distractor_note)}`, {
        font: builder.getFont("italic"),
        size: 9,
        color: COLORS.text,
      });
    }
    builder.space(3);
  }
}

async function drawDescriptive(
  builder: Builder,
  label: string,
  entry: AnswerKeyEntry,
  origQ?: GeneratedQuestion,
  renderImage?: ImageRenderer
): Promise<void> {
  const marks = entry.total_marks ?? 0;
  builder.space(6);
  builder.ensureSpace(40);
  builder.text(`${label}   [Total: ${marks} marks]`, {
    font: builder.getFont("bold"),
    size: 10.5,
    color: COLORS.text,
  });
  // Render images from all original question parts so the evaluator has visual
  // context when reading the combined model answer.
  if (renderImage) {
    for (const p of origQ?.parts ?? []) {
      if (p.image_path) await renderImage(p.image_path);
    }
  }
  if (entry.marking_scheme) {
    builder.textOrMath(`Marking Scheme: ${stripInline(entry.marking_scheme)}`, {
      font: builder.getFont("regular"),
      size: 10,
      color: COLORS.text,
    });
  }
  builder.text("Model Answer:", {
    font: builder.getFont("bold"),
    size: 10,
    color: COLORS.text,
  });
  renderPlainBody(builder, entry.model_answer ?? "");
  if (entry.partial_credit_note && entry.partial_credit_note.trim()) {
    builder.textOrMath(`Note: ${stripInline(entry.partial_credit_note)}`, {
      font: builder.getFont("italic"),
      size: 10,
      color: COLORS.text,
    });
  }
  if (entry.alternative_approaches && entry.alternative_approaches.trim()) {
    builder.textOrMath(
      `Alternative approach: ${stripInline(entry.alternative_approaches)}`,
      {
        font: builder.getFont("italic"),
        size: 10,
        color: COLORS.text,
      }
    );
  }
}

async function drawDescriptivePart(
  builder: Builder,
  parentLabel: string,
  part: AnswerKeyDescriptive,
  imagePath?: string | null,
  renderImage?: ImageRenderer
): Promise<void> {
  const partLabel = part.label ? `${parentLabel} ${part.label}` : parentLabel;
  builder.space(5);
  builder.ensureSpace(40);
  builder.text(`${partLabel}   [Total: ${part.total_marks} marks]`, {
    font: builder.getFont("bold"),
    size: 10.5,
    color: COLORS.text,
  });
  // Render the part's attached image above the marking scheme so evaluators
  // see it in the same visual position as on the question paper.
  if (imagePath && renderImage) await renderImage(imagePath);
  if (part.marking_scheme) {
    builder.textOrMath(`Marking Scheme: ${stripInline(part.marking_scheme)}`, {
      font: builder.getFont("regular"),
      size: 10,
      color: COLORS.text,
    });
  }
  builder.text("Model Answer:", {
    font: builder.getFont("bold"),
    size: 10,
    color: COLORS.text,
  });
  renderPlainBody(builder, part.model_answer ?? "");
  if (part.partial_credit_note && part.partial_credit_note.trim()) {
    builder.textOrMath(`Note: ${stripInline(part.partial_credit_note)}`, {
      font: builder.getFont("italic"),
      size: 10,
      color: COLORS.text,
    });
  }
  if (part.alternative_approaches && part.alternative_approaches.trim()) {
    builder.textOrMath(
      `Alternative approach: ${stripInline(part.alternative_approaches)}`,
      {
        font: builder.getFont("italic"),
        size: 10,
        color: COLORS.text,
      }
    );
  }
}

async function drawDescriptiveWithOr(
  builder: Builder,
  label: string,
  entry: AnswerKeyEntry,
  origQ?: GeneratedQuestion,
  renderImage?: ImageRenderer
): Promise<void> {
  builder.space(6);
  builder.ensureSpace(40);
  builder.text(`${label}   (Main set)`, {
    font: builder.getFont("bold"),
    size: 10.5,
    color: COLORS.text,
  });
  const mainParts = origQ?.parts?.filter((p) => !p.is_or_alternative) ?? [];
  for (const part of entry.main ?? []) {
    const origPart = mainParts.find((p) => labelsMatch(p.label, part.label));
    await drawDescriptivePart(builder, label, part, origPart?.image_path, renderImage);
  }
  builder.space(6);
  builder.ensureSpace(24);
  builder.text("OR", {
    font: builder.getFont("italic"),
    size: 11,
    color: COLORS.text,
    align: "center",
  });
  builder.space(2);
  builder.text(`${label}   (OR alternative)`, {
    font: builder.getFont("bold"),
    size: 10.5,
    color: COLORS.text,
  });
  const altParts = origQ?.parts?.filter((p) => p.is_or_alternative) ?? [];
  for (const part of entry.or_alternative ?? []) {
    const origPart = altParts.find((p) => labelsMatch(p.label, part.label));
    await drawDescriptivePart(builder, label, part, origPart?.image_path, renderImage);
  }
}

async function drawAttemptAnyOne(
  builder: Builder,
  label: string,
  entry: AnswerKeyEntry,
  origQ?: GeneratedQuestion,
  renderImage?: ImageRenderer
): Promise<void> {
  builder.space(6);
  builder.ensureSpace(40);
  const attemptNote = origQ?.instruction?.trim() || "Attempt any one";
  builder.text(
    `${label}   (${attemptNote.replace(/\.$/, "")} - all options shown for evaluators)`,
    {
      font: builder.getFont("bold"),
      size: 10.5,
      color: COLORS.text,
    }
  );
  const opts = entry.options ?? [];
  for (let i = 0; i < opts.length; i++) {
    if (i > 0) builder.space(4);
    // Match by label first, fall back to positional alignment.
    const origPart =
      origQ?.parts?.find((p) => labelsMatch(p.label, opts[i].label)) ??
      origQ?.parts?.[i];
    await drawDescriptivePart(builder, label, opts[i], origPart?.image_path, renderImage);
  }
}
