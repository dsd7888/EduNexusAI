/**
 * Answer-key generation pipeline.
 *
 *   1. caller fetches subject + modules + the previously assembled paper
 *   2. for each section, build a Pro prompt that lists THAT section's
 *      questions verbatim and asks for a model answer + marking scheme
 *   3. routeAI("qpaper_gen", { model: "pro", ... }) → JSON array
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
import { createPDFBuilder, COLORS } from "@/lib/pdf/builder";
import type {
  AssembledPaper,
  GeneratedQuestion,
} from "./builder";

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
}

// ─── System prompt ──────────────────────────────────────────────────────────

export const ANSWER_KEY_SYSTEM_PROMPT = `You are a senior academic evaluator and subject matter expert preparing a model answer key for an Indian university examination. Your answer keys are used by faculty evaluators to ensure fair, consistent, and bias-free marking across all students.

Your model answers are:
- Technically accurate — every formula, derivation, algorithm step, and numerical answer is verified correct
- Appropriately detailed — depth matches the marks and BTL level of the question
- Evaluator-friendly — marking scheme is explicit, partial credit guidance is clear
- Fair — alternative valid approaches are noted where they exist

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
For attempt_any_one: provide model answers for BOTH options.
For descriptive_with_or: provide model answers for BOTH the main set AND the OR alternative set.
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
    }
    return entries;
  } catch {
    return null;
  }
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

For every MCQ slot in the list above, produce ONE answer entry. For each sub-question inside that slot:
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

export async function generateAnswerKeySection(
  input: AnswerKeySectionInput
): Promise<AnswerKeyGenSectionResult> {
  const split = splitQuestionsForBlocks(input.sectionQuestions);

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
            maxTokens: 2048,
          })
        )
      : emptyBlock("mcq");

  const mainPromise: Promise<BlockResult> =
    split.main.length > 0
      ? runBlock(input.sectionName, "main", () =>
          routeAI("qpaper_gen", {
            model: "pro",
            messages: [{ role: "user", content: proPromptFor(split.main) }],
            systemPrompt: ANSWER_KEY_SYSTEM_PROMPT,
            temperature: 0.4,
            maxTokens: 12288,
          })
        )
      : emptyBlock("main");

  const altPromise: Promise<BlockResult> =
    split.alt.length > 0
      ? runBlock(input.sectionName, "alt", () =>
          routeAI("qpaper_gen", {
            model: "pro",
            messages: [{ role: "user", content: proPromptFor(split.alt) }],
            systemPrompt: ANSWER_KEY_SYSTEM_PROMPT,
            temperature: 0.4,
            maxTokens: 12288,
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
  const entries = mergeBlockEntries([mcqRes, mainRes, altRes]);

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

    if (sec.warning) {
      builder.text(
        `Note: ${sec.warning}. Answers for this section were not generated.`,
        { font: FONT_ITALIC, size: 10, color: BLACK }
      );
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
      drawAnswerEntry(builder, label, entry);
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
  if (!content || !content.trim()) {
    builder.text("(no answer generated)", {
      font: builder.getFont("italic"),
      size: 10,
      color: COLORS.text,
    });
    return;
  }
  const lines = String(content).split(/\r?\n/);
  let inFence = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/g, "");
    const trimmed = line.trim();

    // Blank → small vertical gap.
    if (!trimmed) {
      builder.space(3);
      continue;
    }

    // Fenced code block toggle — strip the fence line, render contents
    // as plain indented text on the next iterations.
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }

    // Markdown table separator row (|---|---| or ----- or =====).
    if (/^[|\s\-:=]+$/.test(trimmed) && /[-=]/.test(trimmed)) {
      continue;
    }

    // Markdown table data row: |cell|cell|cell|
    if (
      trimmed.startsWith("|") &&
      trimmed.endsWith("|") &&
      trimmed.indexOf("|", 1) !== -1
    ) {
      const cells = trimmed
        .slice(1, -1)
        .split("|")
        .map((c) => stripInline(c))
        .filter((c) => c.length > 0);
      if (cells.length > 0) {
        builder.text("  " + cells.join("   "), {
          font: builder.getFont("regular"),
          size: 10,
          color: COLORS.text,
        });
      }
      continue;
    }

    // Markdown heading line → render as plain bold, drop the # markers.
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      builder.text(stripInline(headingMatch[2]), {
        font: builder.getFont("bold"),
        size: 10,
        color: COLORS.text,
      });
      continue;
    }

    // Bullet → "- text" indented.
    const bulletMatch = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (bulletMatch) {
      builder.text("  - " + stripInline(bulletMatch[1]), {
        font: builder.getFont("regular"),
        size: 10,
        color: COLORS.text,
      });
      continue;
    }

    // Numbered list → "1. text" indented.
    const numberedMatch = /^(\d+)[.)]\s+(.+)$/.exec(trimmed);
    if (numberedMatch) {
      builder.text(
        `  ${numberedMatch[1]}. ${stripInline(numberedMatch[2])}`,
        { font: builder.getFont("regular"), size: 10, color: COLORS.text }
      );
      continue;
    }

    // Inside a code fence → indent the line so it still reads as a block.
    if (inFence) {
      builder.text("  " + stripInline(trimmed), {
        font: builder.getFont("regular"),
        size: 10,
        color: COLORS.text,
      });
      continue;
    }

    // Default paragraph.
    builder.text(stripInline(trimmed), {
      font: builder.getFont("regular"),
      size: 10,
      color: COLORS.text,
    });
  }
}

// ─── Entry-type dispatch ─────────────────────────────────────────────────

function drawAnswerEntry(
  builder: Builder,
  label: string,
  entry: AnswerKeyEntry
): void {
  switch ((entry.type ?? "").toLowerCase()) {
    case "mcq":
      drawMCQ(builder, label, entry);
      break;
    case "descriptive_with_or":
      drawDescriptiveWithOr(builder, label, entry);
      break;
    case "attempt_any_one":
      drawAttemptAnyOne(builder, label, entry);
      break;
    default:
      drawDescriptive(builder, label, entry);
  }
}

function drawMCQ(
  builder: Builder,
  label: string,
  entry: AnswerKeyEntry
): void {
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
    const head =
      a.correct_text && a.correct_text.trim().length > 0
        ? `${a.label}  Correct Answer: (${a.correct_option})  ${stripInline(a.correct_text)}`
        : `${a.label}  Correct Answer: (${a.correct_option})`;
    builder.text(head, {
      font: builder.getFont("bold"),
      size: 10,
      color: COLORS.text,
    });
    if (a.justification && a.justification.trim().length > 0) {
      builder.text(stripInline(a.justification), {
        font: builder.getFont("regular"),
        size: 10,
        color: COLORS.text,
      });
    }
    if (a.distractor_note && a.distractor_note.trim().length > 0) {
      builder.text(`Distractor note: ${stripInline(a.distractor_note)}`, {
        font: builder.getFont("italic"),
        size: 9,
        color: COLORS.text,
      });
    }
    builder.space(3);
  }
}

function drawDescriptive(
  builder: Builder,
  label: string,
  entry: AnswerKeyEntry
): void {
  const marks = entry.total_marks ?? 0;
  builder.space(6);
  builder.ensureSpace(40);
  builder.text(`${label}   [Total: ${marks} marks]`, {
    font: builder.getFont("bold"),
    size: 10.5,
    color: COLORS.text,
  });
  if (entry.marking_scheme) {
    builder.text(`Marking Scheme: ${stripInline(entry.marking_scheme)}`, {
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
    builder.text(`Note: ${stripInline(entry.partial_credit_note)}`, {
      font: builder.getFont("italic"),
      size: 10,
      color: COLORS.text,
    });
  }
  if (entry.alternative_approaches && entry.alternative_approaches.trim()) {
    builder.text(
      `Alternative approach: ${stripInline(entry.alternative_approaches)}`,
      {
        font: builder.getFont("italic"),
        size: 10,
        color: COLORS.text,
      }
    );
  }
}

function drawDescriptivePart(
  builder: Builder,
  parentLabel: string,
  part: AnswerKeyDescriptive
): void {
  const partLabel = part.label ? `${parentLabel} ${part.label}` : parentLabel;
  builder.space(5);
  builder.ensureSpace(40);
  builder.text(`${partLabel}   [Total: ${part.total_marks} marks]`, {
    font: builder.getFont("bold"),
    size: 10.5,
    color: COLORS.text,
  });
  if (part.marking_scheme) {
    builder.text(`Marking Scheme: ${stripInline(part.marking_scheme)}`, {
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
    builder.text(`Note: ${stripInline(part.partial_credit_note)}`, {
      font: builder.getFont("italic"),
      size: 10,
      color: COLORS.text,
    });
  }
  if (part.alternative_approaches && part.alternative_approaches.trim()) {
    builder.text(
      `Alternative approach: ${stripInline(part.alternative_approaches)}`,
      {
        font: builder.getFont("italic"),
        size: 10,
        color: COLORS.text,
      }
    );
  }
}

function drawDescriptiveWithOr(
  builder: Builder,
  label: string,
  entry: AnswerKeyEntry
): void {
  builder.space(6);
  builder.ensureSpace(40);
  builder.text(`${label}   (Main set)`, {
    font: builder.getFont("bold"),
    size: 10.5,
    color: COLORS.text,
  });
  for (const part of entry.main ?? []) {
    drawDescriptivePart(builder, label, part);
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
  for (const part of entry.or_alternative ?? []) {
    drawDescriptivePart(builder, label, part);
  }
}

function drawAttemptAnyOne(
  builder: Builder,
  label: string,
  entry: AnswerKeyEntry
): void {
  builder.space(6);
  builder.ensureSpace(40);
  builder.text(
    `${label}   (Attempt any one - both options shown for evaluators)`,
    {
      font: builder.getFont("bold"),
      size: 10.5,
      color: COLORS.text,
    }
  );
  const opts = entry.options ?? [];
  for (let i = 0; i < opts.length; i++) {
    if (i > 0) builder.space(4);
    drawDescriptivePart(builder, label, opts[i]);
  }
}
