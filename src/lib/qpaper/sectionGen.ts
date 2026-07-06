/**
 * Per-section question generation pipeline.
 *
 *   1. caller computes `assignModulesToSlots(modules, sectionTemplate)`
 *   2. we build the Pro prompt (system + user) from typed inputs
 *   3. routeAI("qpaper_gen", { model: "pro", ... }) → JSON array
 *   4. parse + convert into the existing GeneratedQuestion shape
 *   5. validate CO/BTL against the slot constraints, retry once on errors
 *
 * Pro is the right model here: section generation needs reasoning over the
 * slot constraints (BTL ranges, CO assignment, PYQ style) and once-per-section
 * latency is acceptable. Flash was producing BTL-out-of-range answers and
 * hand-waving the CO assignment.
 */

import { routeAI } from "@/lib/ai/router";
import { estimateMaxOutputTokens } from "@/lib/ai/tokenBudget";
import type { TemplateSection, TemplateQuestionBlock, TemplatePoolQuestion, PoolItem } from "./templates";
import {
  attemptAnyCount,
  attemptAnyDefaultInstruction,
  attemptAnyLogic,
  attemptAnyMarksPerOption,
  attemptAnyTotalOptions,
  isPoolItemMcqLike,
  poolItemPromptDirective,
  poolItemSchemaFragment,
  poolItemTokenBudgetType,
  poolItemTypeAtIndex,
  poolTotalItems,
} from "./templates";
import type {
  GeneratedQuestion,
  QuestionPart,
  SubQuestion,
} from "./builder";
import {
  assignModulesToSlots,
  descriptiveSlotKey,
  mcqSubSlotKey,
  orAlternativeSlotKey,
  orPrimarySlotKey,
  type CustomBtlWeights,
  type DifficultyPreset,
  type DifficultyTarget,
  type ModuleData,
  type QuestionSlot,
  type SlotAssignmentContext,
} from "./moduleAssignment";

export type { CustomBtlWeights, DifficultyPreset, DifficultyTarget };

// ─── Public input/output types (kept stable for callers) ───────────────────

export interface ModuleInfo {
  /** DB module id — needed to resolve a per-question pinnedModuleId. */
  id?: string;
  module_number: number;
  name: string;
  description?: string | null;
  btl_levels?: string[] | null;
  weightage_percent?: number | null;
  hours?: number | null;
}

export interface CourseOutcomeInfo {
  co_code: string;
  description: string;
}

export interface CoPoMappingInfo {
  co_code: string;
  po_code: string;
  strength: number;
}

export interface PyqExample {
  section_name?: string | null;
  q_number?: string | null;
  marks?: number | null;
  co?: string | null;
  btl?: number | null;
  po?: string | null;
  question_type?: string | null;
  question_text: string;
  options?: Record<string, string> | null;
  year?: number | null;
}

export interface SectionGenInput {
  sectionName: string;
  sectionTemplate: TemplateSection;
  modulesInSection: ModuleInfo[];
  courseOutcomes: CourseOutcomeInfo[];
  coPoMapping: CoPoMappingInfo[];
  /** Structured PYQ examples — preferred. */
  pyqExamples?: PyqExample[];
  /** Free-text fallback if no structured PYQs are available. */
  pyqContext?: string;
  subjectName: string;
  subjectCode: string;
  /**
   * Per-slot AI sourcing style, keyed by slotKey (the section-relative key that
   * assignModulesToSlots produces). Populated from allocateSlotSources. Slots
   * with no entry get no per-slot style directive (legacy behaviour).
   */
  slotStyles?: Map<string, "fresh" | "pyq_style">;
  /** When set, biases per-slot BTL targets toward the preset's tier weights. */
  difficultyPreset?: DifficultyPreset;
  /** Tier weights to use when difficultyPreset === "custom". */
  customBtlWeights?: CustomBtlWeights | null;
  /** Paper-wide BTL eligibility filter [min, max] (secondary to weightage). */
  btlRange?: [number, number];
  /** CO code → target marks for THIS section (prorated from paper-wide CO%). */
  coTargets?: Map<string, number>;
  /** Per-slot difficulty% directives for this section. */
  difficultyTargets?: DifficultyTarget[];
  /**
   * module_number → CO codes that module teaches toward (from module_co_mapping).
   * When absent (or empty for a given module), slots fall back to the subject's
   * full CO list.
   */
  moduleCoMap?: Map<number, string[]>;
}

export interface SectionGenResult {
  questions: GeneratedQuestion[];
  warnings: string[];
}

// ─── Constants ─────────────────────────────────────────────────────────────

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
const LETTERS = "abcdefghijklm".split("");
const PYQ_EXAMPLE_LIMIT = 14;

const SYSTEM_PROMPT = `You are a Senior Professor and Chief Examiner with 25 years of experience designing university examination papers for Indian technical universities. Your expertise covers:

- Outcome-Based Education (OBE) as mandated by AICTE, NBA, and NAAC
- Bloom's Revised Taxonomy (BRT) and its precise application to question design and CO/PO/BTL mapping
- Indian university examination conventions, marking schemes, and assessment norms across engineering, science, and commerce
- Subject-matter accuracy across all technical and science disciplines

Your papers are known for:
- Absolute factual accuracy — every formula, theorem, algorithm step, complexity claim, and numerical answer is verified correct
- CO/BTL/PO assignments that pass external NBA/NAAC accreditation audit
- Mark distribution that mirrors syllabus module weightage exactly
- Question difficulty that is fair, unambiguous, and appropriate to the cognitive level specified

You output ONLY valid JSON. First character [, last character ].
No markdown. No prose before or after. No code fences.`;

// ─── Prompt assembly ───────────────────────────────────────────────────────

function summariseCoPoTable(mapping: CoPoMappingInfo[]): string {
  if (!mapping.length) return "(no CO-PO mapping available)";
  const byCo = new Map<string, Array<{ po: string; strength: number }>>();
  for (const m of mapping) {
    const arr = byCo.get(m.co_code) ?? [];
    arr.push({ po: m.po_code, strength: m.strength });
    byCo.set(m.co_code, arr);
  }
  return Array.from(byCo.entries())
    .map(
      ([co, pos]) =>
        `${co} → ${pos
          .sort((a, b) => b.strength - a.strength)
          .map((p) => `${p.po}(${p.strength})`)
          .join(", ")}`
    )
    .join("\n");
}

function difficultyDirective(d: "easy" | "medium" | "hard"): string {
  switch (d) {
    case "easy":
      return "straightforward recall or single-step application; a student who has attended lectures should be able to answer confidently";
    case "medium":
      return "requires understanding of the concept and a multi-step approach; a well-prepared student should manage with some thought";
    case "hard":
      return "requires synthesis, non-obvious problem-setup, or a multi-concept connection; designed to differentiate top performers";
  }
}

function buildSlotsBlock(
  slots: QuestionSlot[],
  templates: TemplateQuestionBlock[]
): string {
  if (slots.length === 0) return "(empty section — no slots)";

  // Per-type instruction shown right under the display label. Pool sub-slots
  // carry an explicit poolItemType from module assignment; other slots inherit
  // their parent question's type via the section-relative q-number index.
  const formatLineFor = (slot: QuestionSlot): string => {
    if (slot.poolItemType) {
      return `  Pool item type (mandatory): "${slot.poolItemType}" — ${poolItemPromptDirective(slot.poolItemType)}`;
    }
    const match = /^Q(\d+)/.exec(slot.slotKey);
    if (!match) return "";
    const idx = Number(match[1]) - 1;
    const tpl = templates[idx];
    const type = tpl?.type;
    switch (type) {
      case "mcq":
        return "  Question format: mcq";
      case "descriptive":
        return "  Question format: descriptive — single standalone question";
      case "descriptive_with_or":
        return "  Question format: descriptive_with_or — generate the main (a)+(b) pair AND a complete OR alternative (a)+(b) pair";
      case "attempt_any_one": {
        const m = attemptAnyTotalOptions(tpl);
        const k = attemptAnyCount(tpl);
        const marksEach = attemptAnyMarksPerOption(tpl);
        return `  Question format: attempt_any_one — output exactly ${m} independent standalone questions as options (i)…(${ROMAN[m - 1] ?? m}), each worth ${marksEach} marks. The student attempts any ${k} of the ${m}. Print '${attemptAnyDefaultInstruction(tpl)}' as the instruction. Use the attempt_any_one schema from Part G. A single question with internal sub-parts is WRONG for this format.`;
      }
      case "pool":
        return "  Question format: pool — contributes to the parent pool block's items[] array (see pool_composition and Part G).";
      default:
        return "";
    }
  };

  const styleLineFor = (s: QuestionSlot): string => {
    if (!s.style) return "";
    return s.style === "pyq_style"
      ? "  Sourcing style: PYQ-style — mirror the phrasing, framing, and structure of the PYQ reference questions (new data/values, never verbatim)"
      : "  Sourcing style: Fresh — original framing; no need to echo PYQ phrasing";
  };

  return slots
    .map((s) => {
      const formatLine = formatLineFor(s);
      const styleLine = styleLineFor(s);
      return `
Slot: ${s.slotKey}
  Display label: ${s.display}
${formatLine}
  Assigned module: Module ${s.moduleNumber} — ${s.moduleName}
  Marks: ${s.marks}
  Allowed BTL levels for this module: [${s.allowedBtlLevels.join(", ")}]
  Target BTL range for this question type: ${s.targetBtlRange[0]}–${s.targetBtlRange[1]}
  Relevant Course Outcomes: ${s.cos.length > 0 ? s.cos.join(", ") : "(any)"}
${
  s.targetCo
    ? `  Target CO for this slot: ${s.targetCo} — write a question that primarily develops this outcome`
    : ""
}
${
  s.targetDifficulty
    ? `  Difficulty target: ${s.targetDifficulty} — ${difficultyDirective(s.targetDifficulty)}`
    : ""
}
  Relevant Program Outcomes: ${s.pos.length > 0 ? s.pos.join(", ") : "(any)"}
${styleLine}`;
    })
    .join("");
}

/** Explicit per-block pool composition plan injected into the prompt. */
function buildPoolCompositionBlock(
  templates: TemplateQuestionBlock[]
): string {
  const lines: string[] = [];
  templates.forEach((t, qIdx) => {
    if (t.type !== "pool") return;
    const sectionQNum = qIdx + 1;
    const n = poolTotalItems(t.composition);
    const instruction =
      t.instruction?.trim() ||
      `Attempt any ${t.attemptCount} of the following ${n} questions.`;
    lines.push(
      `Block Q${sectionQNum} (${t.display_label}): POOL — ${instruction}`,
      `  Marks: ${t.marksPerItem} per item × attempt ${t.attemptCount} = ${t.total_marks} total`,
      `  Emit ONE JSON object with "slotKey": "Q${sectionQNum}", "type": "pool", and exactly ${n} entries in items[].`,
      `  Each items[] entry MUST match its slotKey and itemType exactly:`
    );
    let idx = 0;
    for (const row of t.composition) {
      for (let c = 0; c < row.count; c++) {
        const slotKey = mcqSubSlotKey(sectionQNum, idx);
        const label = `(${ROMAN[idx] ?? idx + 1})`;
        lines.push(
          `    ${slotKey} ${label}: itemType="${row.itemType}" — ${poolItemPromptDirective(row.itemType)}`
        );
        idx++;
      }
    }
  });
  if (lines.length === 0) return "";
  return `<pool_composition>
${lines.join("\n")}
</pool_composition>`;
}

function buildPoolSchemaForQuestion(
  tpl: TemplatePoolQuestion,
  sectionQNum: number
): string {
  const n = poolTotalItems(tpl.composition);
  const instruction =
    tpl.instruction?.trim() ||
    `Attempt any ${tpl.attemptCount} of the following ${n} questions.`;
  const itemFragments: string[] = [];
  let idx = 0;
  for (const row of tpl.composition) {
    for (let c = 0; c < row.count; c++) {
      itemFragments.push(
        poolItemSchemaFragment(
          row.itemType,
          mcqSubSlotKey(sectionQNum, idx),
          `(${ROMAN[idx] ?? idx + 1})`,
          tpl.marksPerItem
        )
      );
      idx++;
    }
  }
  return `For pool block Q${sectionQNum} (${tpl.display_label}) — attempt any ${tpl.attemptCount} of ${n}:
{
  "slotKey": "Q${sectionQNum}",
  "type": "pool",
  "display_label": ${JSON.stringify(tpl.display_label)},
  "instruction": ${JSON.stringify(instruction)},
  "total_marks": ${tpl.total_marks},
  "items": [
    ${itemFragments.join(",\n    ")}
  ]
}
CRITICAL: Each items[] entry MUST use the exact itemType and slotKey shown. Descriptive pool items (short, long, numerical, fill_blank) must NOT include options or correct_option.`;
}

function buildModuleBlock(modules: ModuleInfo[]): string {
  if (modules.length === 0) return "(no modules in this section)";
  return modules
    .map(
      (m) => `
MODULE ${m.module_number}: ${m.name}
Syllabus topics: ${m.description ?? "(no description provided)"}
Hours: ${m.hours ?? "?"} | Weightage: ${m.weightage_percent ?? "?"}%
Allowed BTL levels: ${(m.btl_levels ?? []).join(", ") || "(unrestricted)"}
`
    )
    .join("\n---\n");
}

function buildPyqBlock(input: SectionGenInput): string {
  const examples = (input.pyqExamples ?? []).slice(0, PYQ_EXAMPLE_LIMIT);
  if (examples.length > 0) {
    return examples
      .map((q) => {
        const co = q.co ?? "?";
        const btl = q.btl ?? "?";
        const po = q.po ?? "?";
        const marks = q.marks ?? "?";
        const optsLine = q.options
          ? `\nOptions: a) ${q.options.a ?? ""}  b) ${q.options.b ?? ""}  c) ${q.options.c ?? ""}  d) ${q.options.d ?? ""}`
          : "";
        return `[${q.section_name ?? "?"} | ${q.q_number ?? "?"} | ${marks}M | CO:${co} BTL:${btl} PO:${po}${q.year ? ` | ${q.year}` : ""}]
Type: ${q.question_type ?? "?"}
${q.question_text}${optsLine}`;
      })
      .join("\n---\n");
  }
  const raw = (input.pyqContext ?? "").trim();
  return raw
    ? raw.slice(0, 4000)
    : "(no PYQ data available — produce questions in standard PPSU style)";
}

function buildOutputSchemaBlock(
  slots: QuestionSlot[],
  templates: TemplateQuestionBlock[]
): string {
  const typesPresent = new Set<string>();
  for (const t of templates) {
    if (t && typeof t.type === "string") typesPresent.add(t.type);
  }
  void slots;

  const blocks: string[] = [];
  const questionBlockCount = templates.length;

  if (typesPresent.has("pool")) {
    templates.forEach((t, i) => {
      if (t.type === "pool") {
        blocks.push(buildPoolSchemaForQuestion(t, i + 1));
      }
    });
    blocks.push(
      `Pool output rule: emit ONE parent object per pool question block. The top-level JSON array for this section has ${questionBlockCount} element(s) — one per question block — NOT one element per atomic slot (${slots.length} slot(s) in Part B).`
    );
  }

  if (typesPresent.has("mcq")) {
    blocks.push(`For MCQ (sub-parts):
{
  "slotKey": "Q1",
  "type": "mcq",
  "display_label": "Q - 1",
  "instruction": "MCQ/Short Question/Fill in the Blanks",
  "total_marks": <sum of sub_parts marks>,
  "sub_parts": [
    {
      "slotKey": "Q1_i",
      "label": "(i)",
      "question_text": string,
      "options": { "a": string, "b": string, "c": string, "d": string },
      "correct_option": "a"|"b"|"c"|"d",
      "marks": <number>,
      "co": "<co code>",
      "btl": <integer 1-6>,
      "po": "<po code>"
    }
  ]
}`);
  }

  if (typesPresent.has("descriptive")) {
    blocks.push(`For descriptive / numerical (single part):
{
  "slotKey": "Q2",
  "type": "descriptive",
  "display_label": "Q - 2",
  "question_text": string,
  "marks": <number>,
  "co": "<co code>",
  "btl": <integer 1-6>,
  "po": "<po code>"
}`);
  }

  if (typesPresent.has("descriptive_with_or")) {
    blocks.push(`For descriptive with OR (Q-3 style):
{
  "slotKey": "Q3",
  "type": "descriptive_with_or",
  "display_label": "Q - 3",
  "main": [
    { "slotKey": "Q3a", "label": "(a)", "question_text": string, "marks": <number>, "co": "<>", "btl": <>, "po": "<>" },
    { "slotKey": "Q3b", "label": "(b)", "question_text": string, "marks": <number>, "co": "<>", "btl": <>, "po": "<>" }
  ],
  "or_alternative": [
    { "slotKey": "Q3a_or", "label": "(a)", "question_text": string, "marks": <number>, "co": "<>", "btl": <>, "po": "<>" },
    { "slotKey": "Q3b_or", "label": "(b)", "question_text": string, "marks": <number>, "co": "<>", "btl": <>, "po": "<>" }
  ]
}`);
  }

  if (typesPresent.has("attempt_any_one")) {
    templates.forEach((t, i) => {
      if (t.type !== "attempt_any_one") return;
      blocks.push(buildAttemptAnySchemaForQuestion(t, i + 1));
    });
  }

  return blocks.join("\n\n");
}

/** Per-block attempt_any_one schema — M options, faculty-configured marks. */
function buildAttemptAnySchemaForQuestion(
  tpl: TemplateQuestionBlock,
  sectionQNum: number
): string {
  const m = attemptAnyTotalOptions(tpl);
  const k = attemptAnyCount(tpl);
  const marksEach = attemptAnyMarksPerOption(tpl);
  const instruction = attemptAnyDefaultInstruction(tpl);
  const optionFragments: string[] = [];
  for (let idx = 0; idx < m; idx++) {
    const label = `(${ROMAN[idx] ?? idx + 1})`;
    optionFragments.push(
      `    { "label": "${label}", "question_text": string, "marks": ${marksEach}, "co": "<co code>", "btl": <integer 1-6>, "po": "<po code>" }`
    );
  }
  return `For attempt-any-one block Q${sectionQNum} (${tpl.display_label}) — student attempts any ${k} of ${m}:
{
  "slotKey": "Q${sectionQNum}",
  "type": "attempt_any_one",
  "display_label": ${JSON.stringify(tpl.display_label)},
  "instruction": ${JSON.stringify(instruction)},
  "total_marks": ${tpl.total_marks},
  "options": [
${optionFragments.join(",\n")}
  ]
}`;
}

function buildUserPrompt(input: SectionGenInput, slots: QuestionSlot[]): string {
  const sectionName = input.sectionName;
  const sectionMarks = input.sectionTemplate.total_marks;
  const slotsBlock = buildSlotsBlock(slots, input.sectionTemplate.questions);
  const moduleBlock = buildModuleBlock(input.modulesInSection);
  const coBlock =
    input.courseOutcomes.length > 0
      ? input.courseOutcomes
          .map((c) => `${c.co_code}: ${c.description}`)
          .join("\n")
      : "(no CO data — use the relevant CO codes provided per slot)";
  const coPoSummaryTable = summariseCoPoTable(input.coPoMapping);
  const pyqExamples = buildPyqBlock(input);
  const schemaForThisSection = buildOutputSchemaBlock(
    slots,
    input.sectionTemplate.questions
  );
  const poolCompositionBlock = buildPoolCompositionBlock(
    input.sectionTemplate.questions
  );
  const hasStyleTags = slots.some((s) => s.style != null);
  const questionBlockCount = input.sectionTemplate.questions.length;
  const hasPool = input.sectionTemplate.questions.some((t) => t.type === "pool");

  // PART A — EXAMINATION CONTEXT
  const partA = `<examination_context>
Section: ${sectionName}
Total marks for this section: ${sectionMarks}
Question blocks in this section: ${questionBlockCount}
Atomic slots (module assignments in Part B): ${slots.length}
${hasPool ? "Pool blocks: each pool block produces ONE JSON object with an items[] array — not one object per sub-slot." : ""}
</examination_context>`;

  // PART B — MODULE-TO-QUESTION ASSIGNMENT
  const partB = `<module_question_assignment>
MANDATORY: The following assignment is derived from the official syllabus weightage. Generate questions ONLY from the assigned module for each slot. Deviation from this assignment produces an invalid examination paper that will be rejected by the examination committee.
${poolCompositionBlock ? `${poolCompositionBlock}\n` : ""}${slotsBlock}
Before finalising output: verify every question's slot key matches its assigned module. A question about Module 3 content must not appear in a slot assigned to Module 1.
</module_question_assignment>`;

  // PART C — SYLLABUS CONTENT FOR ASSIGNED MODULES
  const partC = `<module_content>
Questions must ONLY draw from topics listed under each module below.
Do not introduce topics, theorems, or algorithms not present in the module's syllabus content — even if they are related or adjacent.
${moduleBlock}
</module_content>`;

  // PART D — CO / PO / BTL REFERENCE AND RULES
  const partD = `<co_po_btl_reference>
Course Outcomes for this subject:
${coBlock}

CO-PO Mapping (strength 1=weak, 2=moderate, 3=strong):
${coPoSummaryTable}

━━ CO ASSIGNMENT RULES ━━
Assign the CO that best describes what the student DEMONSTRATES by answering the question correctly:

- Question tests recall of a definition, characteristic, or identification of a concept → assign the CO whose description includes "illustrate", "identify", or "list"

- Question requires explaining, interpreting, or describing how something works → assign the CO whose description includes "explain", "describe", or "understand"

- Question requires executing a method, tracing an algorithm, or solving with given data → assign the CO whose description includes "apply", "design", or "analyze"

- Question requires computing complexity, classifying algorithms, or working with asymptotic notation → assign the CO whose description includes "compute", "classify", or "notation"

- Question requires constructing a full solution, comparing techniques, or evaluating trade-offs → assign the CO whose description includes "design efficient", "evaluate", or "compare"

When two COs are equally applicable, assign the more specific one.
Never assign a "recall" CO to an application or analysis question.

━━ BTL ASSIGNMENT RULES ━━
Before assigning a BTL level, ask:
"What cognitive operation does correctly answering this question require from the student?"

BTL 1 — Remember: student recalls a fact, definition, formula, or characteristic without needing to process it.
  Verbs: define, list, state, identify, name, recall.

BTL 2 — Understand: student interprets, explains, or describes a concept in their own terms.
  Verbs: explain, describe, summarise, differentiate, give example.

BTL 3 — Apply: student executes a known procedure or algorithm on a given instance with specific data.
  Verbs: solve, trace, compute, implement, apply, calculate, show.

BTL 4 — Analyze: student breaks down a problem, examines trade-offs, derives complexity, or compares approaches.
  Verbs: analyze, compare, examine, derive, justify, contrast.

BTL 5 — Evaluate: student assesses quality, justifies a design choice, or critiques an approach against criteria.
  Verbs: evaluate, assess, justify, critique, rank, argue.

BTL 6 — Create: student designs a new algorithm, constructs a novel solution, or produces something original.
  Verbs: design, construct, formulate, propose, develop.

HARD CONSTRAINT: The assigned BTL MUST fall within the allowed BTL levels for the question's assigned module (listed in Part B). If your question naturally demands a BTL outside the allowed range, revise the question — do not exceed the module's BTL boundary. When a Difficulty target is specified for a slot, honor it — calibrate the cognitive demand and problem complexity accordingly, not just the BTL verb.

━━ PO ASSIGNMENT RULES ━━
From the CO-PO mapping above, identify all POs mapped to the assigned CO. Assign the PO with the highest strength value.
If two POs share the highest strength, assign the lower-numbered PO.
Output the PO as a number only (e.g., "01", "03") — no prefix.
</co_po_btl_reference>`;

  // PART E — PREVIOUS YEAR QUESTION STYLE REFERENCE
  const partE = `<pyq_style_reference>
The following are actual questions from previous year examinations for this subject. Study them carefully to understand:

- The depth and scope expected per mark allocation
- How numerical problems are framed — what data is provided, what is asked, typical ranges and sizes that fit exam time
- Phrasing style for descriptive questions
- Cognitive level of questions historically asked in each section
- How OR alternatives compare to their main questions
- Which topics recur and how they are examined year over year

${pyqExamples}

${
  hasStyleTags
    ? `Each slot above carries a "Sourcing style" tag — honor it per slot:
- PYQ-style slots: closely mirror the phrasing, framing, and structure of the PYQ examples above (same style and difficulty), but with new data/values and a different specific problem. Never reproduce a PYQ verbatim.
- Fresh slots: write the question with original framing and phrasing; you need not echo the PYQ style for these slots. All factual-accuracy and module/CO/BTL constraints still apply.`
    : `APPLY this style to all generated questions.`
}
DO NOT reuse the exact data values, arrays, or problem instances from the PYQ examples above. Generate NEW problems with DIFFERENT data that follows the same pattern and difficulty.
</pyq_style_reference>`;

  // PART F — EXAMINATION QUALITY STANDARDS
  const partF = `<quality_standards>

━━ FACTUAL ACCURACY (non-negotiable) ━━

1. Every complexity claim — Big-O, recurrence relation, best/worst/average case — must be mathematically correct and standard.

2. Any question that asks a student to "find", "compute", "solve", or "trace" must have at least one verifiable answer with the given data. Verify your own problem before including it — a question with no valid solution destroys student confidence and invalidates the exam. Every algorithmic trace must produce the provably correct output for the given input.

3. Every MCQ must have EXACTLY ONE unambiguously correct answer. Distractors must be definitively wrong — not borderline, not "less correct", not dependent on interpretation.

4. Distractors must be plausible (common misconceptions, related wrong answers, adjacent concepts) but clearly incorrect upon careful analysis.

5. Numerical problem data must be:
   - Realistic (no negative weights, no disconnected graphs for connectivity problems, no contradictory constraints)
   - Solvable to completion within exam time
   - Sized appropriately: traces/sorts use 6–10 elements, DP tables use at most 4–5 items or 8–10 capacity units, graphs use 4–6 nodes

6. Theory questions involving formal relationships between complexity classes, reductions, or proofs must be logically precise. For reduction questions, state the direction explicitly and verify the conclusion follows from that direction — "A reduces to B" and "B reduces to A" have entirely different implications.

7. Questions asking to "compare X and Y" must involve two things that are genuinely comparable and where the comparison yields meaningful insight.

━━ MODULE AND COVERAGE DISCIPLINE ━━

8. Each question slot draws exclusively from its assigned module's syllabus topics. No cross-module contamination.

9. No two question slots in the same section should test the same algorithm, concept, or topic — even from the same module. Vary the aspect: one question may trace an algorithm, another may analyze its complexity, another may compare it to an alternative.

10. After generating all questions, perform a module mark tally: compute marks attributed to each module across all slots. If any module's share deviates more than 5 marks from its proportional target (given in Part B), revise to rebalance.

━━ QUESTION DESIGN STANDARDS ━━

11. MCQ stems test ONE concept. Compound stems ("which of the following is true about X AND Y") are not permitted.

12. Multi-part questions (a) and (b) must test different topics within the assigned module — never two parts on the same algorithm or concept.

13. OR alternative questions must satisfy all four conditions:
    — Same module as the main question
    — Same mark allocation
    — Comparable cognitive difficulty (same BTL level ± 1)
    — Different topic or algorithm than the main question
    An OR alternative that is noticeably easier or harder than the main question is a paper design defect.

14. "Attempt any one" options must be genuinely interchangeable in difficulty. A student choosing either option should face the same level of challenge.

22. attempt_any_one slots require exactly two independent questions that a student could answer EITHER one of — not a single question with internal numbered sub-parts. The two options must be genuinely different questions from the same module, comparable in difficulty, such that a student choosing either option faces the same cognitive challenge.

23. Generate completely fresh numerical instances for every paper. The following must vary across generations:
- Array contents and sizes for sorting/searching problems
- Graph edge weights and vertex counts for MST/shortest path
- Knapsack item values, weights, and capacities
- String matching pattern and text values
- Any numerical data used in examples or traces
Do not reproduce the same problem instance that appears in the PYQ examples above, and do not reuse data from commonly known textbook examples. When a question type requires a knapsack problem, verify that the capacity requires at least one item to be taken fractionally (for fractional knapsack) or that the DP table has a non-trivial optimal solution path.

━━ INDIAN UNIVERSITY EXAMINATION CONVENTIONS ━━

15. Use standard Indian university examination phrasing:
    "Explain X with a neat diagram."
    "Trace the execution of algorithm X on the following input."
    "Apply X to solve the following instance."
    "Compare X and Y with respect to time complexity and space complexity."
    "Justify your answer with a suitable example."
    "Draw the state-space tree for the following instance."
    "Show all intermediate steps."

16. Time appropriateness per mark:
    1-mark MCQ: answerable in 1–2 minutes
    6-mark descriptive: answerable in 10–15 minutes
    6-mark numerical trace: answerable in 15–20 minutes
    Do not set a 6-mark question that would require 30+ minutes to answer completely.

17. Avoid trick questions, double negatives in MCQ options, questions whose answer depends on a specific textbook's exact wording, and questions with culturally specific assumptions.

18. "Draw a neat figure/diagram" should only appear when a diagram is standard practice for that topic and genuinely aids completeness of the answer.

19. Numerical examples must use concrete values — never symbolic placeholders like "assume n items" in a question that asks the student to compute a specific answer.
</quality_standards>`;

  // PART G — OUTPUT FORMAT
  const partG = `<output_format>
${schemaForThisSection}

Output a JSON array matching the schema above.
First character: [
Last character: ]
No text, markdown, or explanation before or after the array.
CO values: number string, zero-padded to 2 digits (e.g., "01", "03")
BTL values: integer (e.g., 2, 3, 4)
PO values: number string, zero-padded to 2 digits (e.g., "01", "03")
correct_option: present in the JSON but NEVER printed in the PDF.
</output_format>

Generate ${questionBlockCount} question block(s) for ${sectionName}${hasPool ? " (pool blocks: one parent object each, with all sub-slots in items[])" : ""}.`;

  return [partA, partB, partC, partD, partE, partF, partG].join("\n\n");
}

// ─── JSON parsing ──────────────────────────────────────────────────────────

function parseQuestionArray(raw: string): unknown[] | null {
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();
  const first = cleaned.indexOf("[");
  const last = cleaned.lastIndexOf("]");
  const slice = first !== -1 && last > first ? cleaned.slice(first, last + 1) : cleaned;
  try {
    const parsed = JSON.parse(slice);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const maybe = (parsed as Record<string, unknown>).questions;
      if (Array.isArray(maybe)) return maybe;
    }
  } catch {
    // Salvage: collect well-formed top-level objects.
    const salvage: unknown[] = [];
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
            salvage.push(JSON.parse(cleaned.slice(start, i + 1)));
          } catch {
            // skip
          }
          start = -1;
        }
      }
    }
    if (salvage.length > 0) return salvage;
  }
  return null;
}

// ─── Conversion: model output → existing GeneratedQuestion shape ───────────

interface RawSubPart {
  slotKey?: string;
  label?: string;
  itemType?: string;
  question_text?: string;
  question?: string;
  options?: Record<string, string>;
  correct_option?: string;
  marks?: number;
  co?: string | number;
  btl?: number | string;
  po?: string | number;
  model_answer?: string | null;
}

interface RawQuestion {
  slotKey?: string;
  type?: string;
  display_label?: string;
  instruction?: string;
  total_marks?: number;
  question_text?: string;
  marks?: number;
  co?: string | number;
  btl?: number | string;
  po?: string | number;
  sub_parts?: RawSubPart[];
  main?: RawSubPart[];
  or_alternative?: RawSubPart[];
  options?: RawSubPart[];
  items?: RawSubPart[];
}

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function toInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function buildSubQuestion(raw: RawSubPart, idx: number): SubQuestion {
  const fallbackLabel = `(${ROMAN[idx] ?? idx + 1})`;
  return {
    label: raw.label?.trim() || fallbackLabel,
    question: String(raw.question_text ?? raw.question ?? ""),
    options: raw.options && typeof raw.options === "object"
      ? raw.options
      : undefined,
    correct_option: raw.correct_option ? String(raw.correct_option) : undefined,
    co: toStr(raw.co),
    btl: toInt(raw.btl),
    po: toStr(raw.po),
  };
}

function buildPart(
  raw: RawSubPart,
  idx: number,
  isOrAlt: boolean,
  letterFallback = true
): QuestionPart {
  const fallbackLabel = letterFallback
    ? LETTERS[idx] ?? String(idx + 1)
    : ROMAN[idx] ?? String(idx + 1);
  return {
    label: raw.label?.trim() || fallbackLabel,
    question: String(raw.question_text ?? raw.question ?? ""),
    marks: Number(raw.marks ?? 0) || 0,
    co: toStr(raw.co),
    btl: toInt(raw.btl),
    po: toStr(raw.po),
    is_or_alternative: isOrAlt,
  };
}

function normalizePoolItems(
  rawItems: RawSubPart[],
  sectionQNum: number,
  template: TemplatePoolQuestion
): RawSubPart[] {
  const expectedCount = poolTotalItems(template.composition);
  const bySlotKey = new Map<string, RawSubPart>();
  for (const item of rawItems) {
    const key = item.slotKey ? String(item.slotKey).trim() : "";
    if (key) bySlotKey.set(key, item);
  }
  const normalized: RawSubPart[] = [];
  for (let i = 0; i < expectedCount; i++) {
    const slotKey = mcqSubSlotKey(sectionQNum, i);
    normalized.push(bySlotKey.get(slotKey) ?? rawItems[i] ?? {});
  }
  return normalized;
}

function buildPoolItem(
  raw: RawSubPart,
  idx: number,
  template: TemplatePoolQuestion
): PoolItem {
  // Template composition is authoritative — AI itemType hints are ignored.
  const itemType = poolItemTypeAtIndex(template.composition, idx);
  const question_text = String(raw.question_text ?? raw.question ?? "");
  let options =
    raw.options && typeof raw.options === "object" ? raw.options : undefined;
  if (isPoolItemMcqLike(itemType)) {
    if (itemType === "true_false") {
      options = { a: "True", b: "False" };
    } else if (options) {
      const a = String(options.a ?? "").trim();
      const b = String(options.b ?? "").trim();
      const c = String(options.c ?? "").trim();
      const d = String(options.d ?? "").trim();
      if (a && b && c && d) {
        options = { a, b, c, d };
      }
    }
  } else {
    options = undefined;
  }
  return {
    itemType,
    question_text,
    options,
    model_answer: raw.model_answer != null ? String(raw.model_answer) : null,
    co: toStr(raw.co),
    btl: toInt(raw.btl),
    po: toStr(raw.po),
  };
}

function convertOne(
  raw: RawQuestion,
  template: TemplateQuestionBlock,
  sectionQNum: number
): GeneratedQuestion {
  const type =
    template.type === "pool"
      ? "pool"
      : (raw.type ?? template.type ?? "descriptive").toString().toLowerCase();

  const out: GeneratedQuestion = {
    q_number: template.q_number,
    display_label: template.display_label,
    type,
    instruction:
      typeof raw.instruction === "string"
        ? raw.instruction
        : template.instruction ?? null,
    total_marks:
      typeof raw.total_marks === "number"
        ? raw.total_marks
        : template.total_marks,
    attempt_logic: template.attempt_logic ?? null,
  };

  if (type === "mcq") {
    const subs = Array.isArray(raw.sub_parts) ? raw.sub_parts : [];
    out.sub_parts = subs.map((s, i) => buildSubQuestion(s, i));
    return out;
  }

  if (type === "descriptive_with_or") {
    const main = Array.isArray(raw.main) ? raw.main : [];
    const alt = Array.isArray(raw.or_alternative) ? raw.or_alternative : [];
    out.parts = [
      ...main.map((p, i) => buildPart(p, i, false)),
      ...alt.map((p, i) => buildPart(p, i, true)),
    ];
    return out;
  }

  if (type === "pool") {
    const tpl = template.type === "pool" ? template : null;
    const rawItems = Array.isArray(raw.items) ? raw.items : [];
    if (tpl) {
      const expectedCount = poolTotalItems(tpl.composition);
      const normalized = normalizePoolItems(rawItems, sectionQNum, tpl);
      out.items = normalized.map((s, i) => buildPoolItem(s, i, tpl));
      out.type = "pool";
      out.pool_expected_count = expectedCount;
      out.pool_returned_count = Math.min(rawItems.length, expectedCount);
      // The instruction's item count must always reflect what the template
      // requested, never the AI's free-form text — if the model under-
      // generates, it may (incorrectly) describe the shortfall as intended,
      // which would silently turn a choice-based pool into a compulsory one.
      out.instruction =
        tpl.instruction ??
        `Attempt any ${tpl.attemptCount} of the following ${expectedCount} questions.`;
      out.total_marks = tpl.total_marks;
      out.attempt_logic =
        tpl.attemptCount === 1 ? "any_one" : `any_${tpl.attemptCount}`;
    }
    return out;
  }

  if (type === "attempt_any_one") {
    const m = attemptAnyTotalOptions(template);
    const k = attemptAnyCount(template);
    const marksEach = attemptAnyMarksPerOption(template);
    const rawOptions = Array.isArray(raw.options) ? raw.options : [];
    // Per-option marks are ALWAYS the faculty-configured value — never the
    // AI's free-form "marks" (which mirrors the block total and doubles them).
    const built = rawOptions
      .slice(0, m)
      .map((p, i) => buildPart({ ...p, marks: marksEach }, i, false, false));
    // Pad to M with blank options if the AI under-delivered, so the paper
    // always offers the configured number of choices (BUG-2 shortfall pattern).
    while (built.length < m) {
      const i = built.length;
      built.push({
        label: ROMAN[i] ?? String(i + 1),
        question: "",
        marks: marksEach,
        co: null,
        btl: null,
        po: null,
        is_or_alternative: false,
      });
    }
    out.parts = built;
    // The label ALWAYS derives from the configured K-of-M (attemptCount +
    // sub_parts), never a stored instruction string — that can go stale when
    // the faculty changes M after saving, showing "of 3" on a 4-option block.
    // It also can't come from AI output shape, so a shortfall can't silently
    // turn "any K of M" into a compulsory question.
    out.instruction = attemptAnyDefaultInstruction(template);
    out.total_marks = template.total_marks;
    out.attempt_logic = attemptAnyLogic(k);
    out.attempt_expected_count = m;
    out.attempt_returned_count = Math.min(rawOptions.length, m);
    return out;
  }

  // descriptive / numerical / fallback — single part with the body.
  out.parts = [
    {
      label: null,
      question: String(raw.question_text ?? ""),
      marks: Number(raw.marks ?? template.total_marks ?? 0) || 0,
      co: toStr(raw.co),
      btl: toInt(raw.btl),
      po: toStr(raw.po),
      is_or_alternative: false,
    },
  ];
  return out;
}

function convertResponse(
  rawArr: unknown[],
  templates: TemplateQuestionBlock[]
): GeneratedQuestion[] {
  return templates.map((t, i) => {
    // Slot keys are section-relative (Q1..Q4) — index, not template.q_number,
    // which may be paper-absolute (Q5..Q8 for Section II).
    const sectionQNum = i + 1;
    const match = (rawArr.find((r) => {
      if (!r || typeof r !== "object") return false;
      const obj = r as RawQuestion;
      return obj.slotKey === `Q${sectionQNum}`;
    }) ?? rawArr[i] ?? {}) as RawQuestion;
    return convertOne(match, t, sectionQNum);
  });
}

// ─── Validation ────────────────────────────────────────────────────────────

interface PartLookup {
  slotKey: string;
  btl: number | null;
  co: string | null;
  po: string | null;
}

function gatherParts(
  questions: GeneratedQuestion[],
  templates: TemplateQuestionBlock[]
): PartLookup[] {
  const out: PartLookup[] = [];
  questions.forEach((q, qi) => {
    const t = templates[qi];
    if (!t) return;
    // Slot keys are section-relative — index drives the lookup, not q_number.
    const sectionQNum = qi + 1;
    if (q.type === "mcq") {
      (q.sub_parts ?? []).forEach((sp, i) => {
        out.push({
          slotKey: mcqSubSlotKey(sectionQNum, i),
          btl: sp.btl ?? null,
          co: sp.co ?? null,
          po: sp.po ?? null,
        });
      });
      return;
    }
    if (q.type === "descriptive_with_or") {
      const primaryCount = (t.parts ?? ["a", "b"]).length;
      (q.parts ?? []).forEach((p, i) => {
        if (p.is_or_alternative) {
          out.push({
            slotKey: orAlternativeSlotKey(sectionQNum, i - primaryCount),
            btl: p.btl ?? null,
            co: p.co ?? null,
            po: p.po ?? null,
          });
        } else {
          out.push({
            slotKey: orPrimarySlotKey(sectionQNum, i),
            btl: p.btl ?? null,
            co: p.co ?? null,
            po: p.po ?? null,
          });
        }
      });
      return;
    }
    if (q.type === "attempt_any_one") {
      // Both options share the parent slot (Q4). The assignment algorithm
      // emits a single parent slot for attempt_any_one, so look up by parent.
      const parentKey = descriptiveSlotKey(sectionQNum);
      (q.parts ?? []).forEach((p) => {
        out.push({
          slotKey: parentKey,
          btl: p.btl ?? null,
          co: p.co ?? null,
          po: p.po ?? null,
        });
      });
      return;
    }
    if (q.type === "pool") {
      (q.items ?? []).forEach((item, i) => {
        out.push({
          slotKey: mcqSubSlotKey(sectionQNum, i),
          btl: item.btl ?? null,
          co: item.co ?? null,
          po: item.po ?? null,
        });
      });
      return;
    }
    // descriptive
    const head = q.parts?.[0];
    out.push({
      slotKey: descriptiveSlotKey(sectionQNum),
      btl: head?.btl ?? null,
      co: head?.co ?? null,
      po: head?.po ?? null,
    });
  });
  return out;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Normalize CO codes to a canonical form for cross-format comparison.
 * "CO1", "CO 1", "co1", "1", "01" → "01".
 * Two-digit codes ("CO11", "11") stay two-digit.
 */
function normalizeCoCode(co: string): string {
  return co
    .toString()
    .toUpperCase()
    .replace(/^CO\s*/i, "")
    .trim()
    .padStart(2, "0");
}

export function validateGeneratedSection(
  questions: GeneratedQuestion[],
  slots: QuestionSlot[],
  templates: TemplateQuestionBlock[],
  validCoCodes: string[]
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const slotMap = new Map(slots.map((s) => [s.slotKey, s]));
  const validCoNormalized = new Set(validCoCodes.map(normalizeCoCode));

  const parts = gatherParts(questions, templates);
  for (const part of parts) {
    const slot = slotMap.get(part.slotKey);
    if (!slot) {
      warnings.push(`Unknown slot key in output: ${part.slotKey}`);
      continue;
    }
    if (part.btl != null && !slot.allowedBtlLevels.includes(part.btl)) {
      errors.push(
        `BTL violation in ${part.slotKey}: got ${part.btl}, allowed [${slot.allowedBtlLevels.join(",")}]`
      );
    }
    if (
      part.co &&
      validCoNormalized.size > 0 &&
      !validCoNormalized.has(normalizeCoCode(part.co))
    ) {
      warnings.push(`Unknown CO code "${part.co}" in ${part.slotKey}`);
    }
  }

  questions.forEach((q, qi) => {
    const t = templates[qi];
    if (!t || t.type !== "pool" || q.type !== "pool") return;
    const sectionQNum = qi + 1;
    const expectedCount = poolTotalItems(t.composition);
    const items = q.items ?? [];
    // items.length is always padded out to expectedCount by normalizePoolItems
    // (missing slots become blank placeholders), so it can never itself
    // reveal a shortfall — pool_returned_count carries the AI's true output
    // count from before padding.
    const returnedCount = q.pool_returned_count ?? items.length;
    if (returnedCount < expectedCount) {
      errors.push(
        `Pool Q${sectionQNum}: requested ${expectedCount} items, AI returned ${returnedCount} — paper may not have sufficient choice.`
      );
    }
    items.forEach((item, i) => {
      const slotKey = mcqSubSlotKey(sectionQNum, i);
      const expectedType = poolItemTypeAtIndex(t.composition, i);
      if (item.itemType !== expectedType) {
        errors.push(
          `Pool item type mismatch in ${slotKey}: expected "${expectedType}", got "${item.itemType}"`
        );
      }
      if (isPoolItemMcqLike(expectedType)) {
        if (!item.options) {
          warnings.push(`${slotKey}: ${expectedType} item missing options`);
        } else if (expectedType === "true_false") {
          const keys = Object.keys(item.options).sort().join(",");
          if (keys !== "a,b") {
            warnings.push(
              `${slotKey}: true_false options should be a/b only, got ${keys}`
            );
          }
        } else if (
          !item.options.a ||
          !item.options.b ||
          !item.options.c ||
          !item.options.d
        ) {
          warnings.push(`${slotKey}: mcq item missing one or more options a–d`);
        }
      } else if (item.options && Object.keys(item.options).length > 0) {
        warnings.push(
          `${slotKey}: ${expectedType} item must not have options`
        );
      }
    });
  });

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Public entrypoint ─────────────────────────────────────────────────────

function buildSlotCtx(
  courseOutcomes: CourseOutcomeInfo[],
  coPoMapping: CoPoMappingInfo[],
  difficultyPreset?: DifficultyPreset,
  customBtlWeights?: CustomBtlWeights | null,
  moduleCoMap?: Map<number, string[]>,
  btlRange?: [number, number],
  coTargets?: Map<string, number>,
  difficultyTargets?: DifficultyTarget[]
): SlotAssignmentContext {
  const coPoMap = new Map<string, Array<{ po_code: string; strength: number }>>();
  for (const m of coPoMapping) {
    const list = coPoMap.get(m.co_code) ?? [];
    list.push({ po_code: m.po_code, strength: m.strength });
    coPoMap.set(m.co_code, list);
  }
  return {
    coPoMap,
    allCoCodes: courseOutcomes.map((c) => c.co_code),
    difficultyPreset,
    customBtlWeights,
    btlRange,
    coTargets,
    difficultyTargets,
    // Per-module COs (from module_co_mapping) when available. Returning [] for a
    // module with no mapping rows is intentional — SlotAssignmentContext.cosFor
    // already falls back to allCoCodes on an empty result.
    moduleCosFn: moduleCoMap
      ? (moduleNumber: number) => moduleCoMap.get(moduleNumber) ?? []
      : undefined,
  };
}

function modulesToData(modules: ModuleInfo[]): ModuleData[] {
  return modules.map((m) => ({
    id: m.id,
    module_number: m.module_number,
    name: m.name,
    description: m.description,
    weightage_percent: m.weightage_percent,
    btl_levels: m.btl_levels,
    hours: m.hours,
  }));
}

/**
 * Public access to the same deterministic slot→module assignment that
 * `generateSection` computes internally. Callers (e.g. the qpaper route) use
 * this to build per-slot bank targets that line up exactly with what the AI is
 * told to generate. Pure + deterministic, so calling it again yields the same
 * assignment the section generation will use.
 */
export function buildSectionSlotsAssignment(
  modulesInSection: ModuleInfo[],
  sectionTemplate: TemplateSection,
  courseOutcomes: CourseOutcomeInfo[],
  coPoMapping: CoPoMappingInfo[],
  difficultyPreset?: DifficultyPreset,
  customBtlWeights?: CustomBtlWeights | null,
  moduleCoMap?: Map<number, string[]>,
  btlRange?: [number, number],
  coTargets?: Map<string, number>,
  difficultyTargets?: DifficultyTarget[]
): QuestionSlot[] {
  return assignModulesToSlots(
    modulesToData(modulesInSection),
    sectionTemplate,
    buildSlotCtx(
      courseOutcomes,
      coPoMapping,
      difficultyPreset,
      customBtlWeights,
      moduleCoMap,
      btlRange,
      coTargets,
      difficultyTargets
    )
  );
}

function buildSectionSlots(
  templates: TemplateQuestionBlock[]
): { type: string; count: number }[] {
  const out: { type: string; count: number }[] = [];
  for (const t of templates) {
    if (t.type === "mcq") {
      out.push({ type: "mcq", count: t.sub_parts ?? 0 });
    } else if (t.type === "attempt_any_one") {
      out.push({ type: "descriptive", count: t.sub_parts ?? 2 });
    } else if (t.type === "pool") {
      for (const row of t.composition) {
        out.push({
          type: poolItemTokenBudgetType(row.itemType),
          count: row.count,
        });
      }
    } else {
      out.push({ type: t.type, count: 1 });
    }
  }
  return out;
}

async function callPro(prompt: string, maxTokens: number): Promise<string> {
  const result = await routeAI("qpaper_gen", {
    model: "pro",
    messages: [{ role: "user", content: prompt }],
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.4,
    maxTokens,
  });
  return String(result.content ?? "");
}

export async function generateSection(
  input: SectionGenInput
): Promise<SectionGenResult> {
  const slots = assignModulesToSlots(
    modulesToData(input.modulesInSection),
    input.sectionTemplate,
    buildSlotCtx(
      input.courseOutcomes,
      input.coPoMapping,
      input.difficultyPreset,
      input.customBtlWeights,
      input.moduleCoMap,
      input.btlRange,
      input.coTargets,
      input.difficultyTargets
    )
  );
  if (input.slotStyles && input.slotStyles.size > 0) {
    for (const s of slots) {
      const st = input.slotStyles.get(s.slotKey);
      if (st) s.style = st;
    }
  }
  const templates = input.sectionTemplate.questions;
  const validCoCodes = input.courseOutcomes.map((c) => c.co_code);

  const sectionBudget = estimateMaxOutputTokens(
    buildSectionSlots(templates),
    "generation"
  );

  const attempt = async (label: string) => {
    const prompt = buildUserPrompt(input, slots);
    console.log(
      `[generateSection] ${input.sectionName} ${label} promptChars=${prompt.length} slots=${slots.length} maxTokens=${sectionBudget}`
    );
    const raw = await callPro(prompt, sectionBudget);
    const arr = parseQuestionArray(raw);
    if (!arr || arr.length === 0) {
      console.error(
        `[generateSection] ${input.sectionName} ${label} parse failure. head:`,
        raw.slice(0, 300),
        " tail:",
        raw.slice(-300)
      );
      throw new Error(
        `Failed to parse questions for ${input.sectionName} (${label})`
      );
    }
    const questions = convertResponse(arr, templates);
    const validation = validateGeneratedSection(
      questions,
      slots,
      templates,
      validCoCodes
    );
    return { questions, validation };
  };

  const first = await attempt("attempt 1");
  if (first.validation.valid) {
    return { questions: first.questions, warnings: first.validation.warnings };
  }
  console.warn(
    `[generateSection] ${input.sectionName} validation errors on attempt 1:\n  ` +
      first.validation.errors.join("\n  ")
  );

  const retry = await attempt("attempt 2 (retry)");
  if (retry.validation.valid) {
    return { questions: retry.questions, warnings: retry.validation.warnings };
  }
  console.warn(
    `[generateSection] ${input.sectionName} validation errors on retry — proceeding with warnings:\n  ` +
      retry.validation.errors.join("\n  ")
  );
  return {
    questions: retry.questions,
    warnings: [...retry.validation.warnings, ...retry.validation.errors],
  };
}

// ─── Backwards-compat: keep normaliseQuestion for the regenerate route ─────

function normaliseSubPart(
  raw: Record<string, unknown>,
  idx: number
): Record<string, unknown> {
  const romanLabels = ["(i)", "(ii)", "(iii)", "(iv)", "(v)", "(vi)", "(vii)", "(viii)"];
  return {
    label:
      typeof raw.label === "string" && raw.label.trim()
        ? raw.label
        : romanLabels[idx] ?? `(${idx + 1})`,
    question: String(raw.question ?? raw.question_text ?? ""),
    options:
      raw.options && typeof raw.options === "object" ? raw.options : undefined,
    correct_option:
      raw.correct_option != null ? String(raw.correct_option) : undefined,
    co: raw.co != null ? String(raw.co) : null,
    btl: raw.btl != null ? Number(raw.btl) || null : null,
    po: raw.po != null ? String(raw.po) : null,
  };
}

function normalisePart(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    label: raw.label != null ? String(raw.label) : null,
    question: String(raw.question ?? raw.question_text ?? ""),
    marks: Number(raw.marks) || 0,
    co: raw.co != null ? String(raw.co) : null,
    btl: raw.btl != null ? Number(raw.btl) || null : null,
    po: raw.po != null ? String(raw.po) : null,
    is_or_alternative: Boolean(raw.is_or_alternative ?? false),
  };
}

export function normaliseQuestion(
  raw: unknown,
  template: TemplateQuestionBlock
): GeneratedQuestion {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const type =
    template.type === "pool"
      ? "pool"
      : typeof row.type === "string" && row.type
        ? row.type
        : template.type;
  const out: GeneratedQuestion = {
    q_number: Number(row.q_number ?? template.q_number),
    display_label: template.display_label,
    type,
    instruction:
      typeof row.instruction === "string"
        ? row.instruction
        : template.instruction ?? null,
    total_marks: Number(row.total_marks ?? template.total_marks ?? 0),
    attempt_logic:
      typeof row.attempt_logic === "string"
        ? row.attempt_logic
        : template.attempt_logic ?? null,
  };
  if (type === "mcq") {
    const subs = Array.isArray(row.sub_parts) ? row.sub_parts : [];
    out.sub_parts = subs.map((s, i) =>
      normaliseSubPart(
        (s && typeof s === "object" ? s : {}) as Record<string, unknown>,
        i
      )
    ) as unknown as GeneratedQuestion["sub_parts"];
  } else if (type === "pool" && template.type === "pool") {
    const rawItems = Array.isArray(row.items) ? row.items : [];
    const sectionQNum = template.q_number;
    const normalized = normalizePoolItems(
      rawItems as RawSubPart[],
      sectionQNum,
      template
    );
    out.items = normalized.map((s, i) => buildPoolItem(s, i, template));
    out.attempt_logic =
      template.attemptCount === 1
        ? "any_one"
        : `any_${template.attemptCount}`;
    out.total_marks = template.total_marks;
  } else if (type === "attempt_any_one" && template.type === "attempt_any_one") {
    const m = attemptAnyTotalOptions(template);
    const k = attemptAnyCount(template);
    const marksEach = attemptAnyMarksPerOption(template);
    // The AI may return the options under "parts" (regenerate prompt) or
    // "options" (section-gen prompt) — accept either.
    const rawOptions = Array.isArray(row.options)
      ? row.options
      : Array.isArray(row.parts)
        ? row.parts
        : [];
    const built = rawOptions.slice(0, m).map((p) => {
      const part = normalisePart(
        (p && typeof p === "object" ? p : {}) as Record<string, unknown>
      ) as unknown as QuestionPart;
      // Per-option marks always come from faculty config, not the AI.
      part.marks = marksEach;
      return part;
    });
    while (built.length < m) {
      const i = built.length;
      built.push({
        label: ROMAN[i] ?? String(i + 1),
        question: "",
        marks: marksEach,
        co: null,
        btl: null,
        po: null,
        is_or_alternative: false,
      });
    }
    out.parts = built;
    // Always derive the label from the configured K-of-M — never a stored
    // instruction string (which can go stale when M changes after saving).
    out.instruction = attemptAnyDefaultInstruction(template);
    out.total_marks = template.total_marks;
    out.attempt_logic = attemptAnyLogic(k);
    out.attempt_expected_count = m;
    out.attempt_returned_count = Math.min(rawOptions.length, m);
  } else {
    const parts = Array.isArray(row.parts) ? row.parts : [];
    out.parts = parts.map((p) =>
      normalisePart(
        (p && typeof p === "object" ? p : {}) as Record<string, unknown>
      )
    ) as unknown as GeneratedQuestion["parts"];
  }
  return out;
}
