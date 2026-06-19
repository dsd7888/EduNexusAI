/**
 * Explainer content generation — a two-call pipeline producing ExtractedContent.
 *
 *   Call 1 — getPedagogicalNarrative(): routeAI("explainer_ideate") with
 *     thinking ENABLED (budget 2048). A master teacher "at the whiteboard"
 *     produces a free-text pedagogical explanation (hook → core → aha → exam).
 *
 *   Call 2 — extractStructuredContent(): routeAI("explainer_extract") on PRO
 *     with thinking OFF + a responseSchema. Classifies the narrative into ONE
 *     ExplainerPattern and extracts the structured pattern_data that drives the
 *     renderer. Pattern choice is load-bearing (wrong pattern = wrong viz), so
 *     this runs on Pro for accuracy.
 *
 * Only generateExplainerContent() is exported. The renderer (Prompt 2) consumes
 * the returned ExtractedContent.
 */

import { routeAI } from "@/lib/ai/router";
import type {
  ExplainerPattern,
  ExplainerRequest,
  ExtractedContent,
  SubjectContext,
} from "./types";

// ─── Constants ─────────────────────────────────────────────────────────────

const MAX_COURSE_OUTCOMES = 3;
const MIN_NARRATIVE_SEGMENTS = 3;

const PATTERN_VALUES: ExplainerPattern[] = [
  "array_sort",
  "array_search",
  "graph_algorithm",
  "tree_traversal",
  "stack_queue_ops",
  "dp_table",
  "formula_derivation",
  "concept_analogy",
  "comparison_table",
  "process_flow",
  "cause_effect_chain",
  "definition_with_example",
  "hierarchy_structure",
  "state_machine",
  "unknown",
];
const KNOWN_PATTERNS = new Set<string>(PATTERN_VALUES);

/**
 * responseSchema for Call 2. Enforces the load-bearing fields — the pattern /
 * color_scheme / complexity enums, and the narrative_segments shape — that the
 * renderer switches on. `pattern_data.data` is intentionally a free-form object:
 * its shape varies per pattern (PatternData is a discriminated union, which the
 * OpenAPI subset can't express), so its substance is guided by the prompt.
 */
const EXTRACT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    pattern: { type: "string", enum: PATTERN_VALUES },
    title: { type: "string" },
    subtitle: { type: "string" },
    color_scheme: { type: "string", enum: ["blue", "green", "purple", "amber"] },
    complexity: {
      type: "string",
      enum: ["foundational", "intermediate", "advanced"],
    },
    pattern_data: {
      type: "object",
      properties: {
        pattern: { type: "string", enum: PATTERN_VALUES },
        data: { type: "object" },
      },
      required: ["pattern", "data"],
    },
    narrative_segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          caption: { type: "string" },
          visual_phase: { type: "string" },
        },
        required: ["caption", "visual_phase"],
      },
    },
    exam_tip: { type: "string" },
    subject_name: { type: "string" },
    module_name: { type: "string" },
  },
  required: [
    "pattern",
    "title",
    "subtitle",
    "color_scheme",
    "complexity",
    "pattern_data",
    "narrative_segments",
    "exam_tip",
  ],
} as const;

// ─── Shared context block ──────────────────────────────────────────────────

function courseOutcomeBlock(subjectContext: SubjectContext | undefined): string {
  const cos = (subjectContext?.course_outcomes ?? []).slice(
    0,
    MAX_COURSE_OUTCOMES
  );
  return cos.length > 0
    ? cos.map((c) => `${c.co_code}: ${c.description}`).join("\n")
    : "(none provided)";
}

// ─── Call 1: pedagogical narrative (thinking ON) ───────────────────────────

const IDEATE_SYSTEM_PROMPT = `You are a master educator with 20 years of teaching experience at
top Indian engineering institutions. You have taught thousands of
students and know exactly which explanations make concepts click
versus which leave students confused.

When asked about a topic, you think and respond as if you are
standing at a whiteboard in front of a class of 40 students who
have 5 minutes to understand this concept before their exam.`;

async function getPedagogicalNarrative(
  request: ExplainerRequest,
  subjectContext: SubjectContext | undefined
): Promise<string> {
  const semester =
    request.audience_semester ?? subjectContext?.semester ?? 3;
  const subjectName = subjectContext?.subject_name ?? "General studies";
  const moduleName = subjectContext?.module_name ?? "(not specified)";
  const branch = subjectContext?.branch ?? "(not specified)";
  const coBlock = courseOutcomeBlock(subjectContext);
  const facultyNotes = request.context_hint?.trim()
    ? `\n<faculty_notes>${request.context_hint.trim()}</faculty_notes>`
    : "";

  const userPrompt = `<topic>${request.topic}</topic>
<subject>${subjectName} — ${moduleName}</subject>
<student_level>Semester ${semester} — ${branch}</student_level>
<course_outcomes>${coBlock}</course_outcomes>${facultyNotes}

You are at the whiteboard. A student says: 'I don't understand
${request.topic} at all. Can you explain it in 90 seconds?'

Respond EXACTLY as you would in that classroom. Include:

1. THE HOOK (5-10 seconds)
   What do you say or draw first to create felt need?
   Use a real Indian context example if it helps.

2. THE CORE EXPLANATION (40-60 seconds)
   Walk through what you would draw step by step.
   Be specific: 'I would draw a box with the number 38 here,
   then an arrow pointing to...'
   Name every visual element you would create.
   For algorithms: trace through a specific small example completely.
   For formulas: build it term by term.
   For concepts: use an analogy first, then map to formal definition.

3. THE AHA MOMENT (10-15 seconds)
   What is the single visual or insight that makes this click?
   The one thing they should remember.

4. THE EXAM CONNECTION (5-10 seconds)
   What specific question types will this appear as?
   What is the most common mistake students make?

Be natural. Be specific. Be a teacher, not a textbook.`;

  const result = await routeAI("explainer_ideate", {
    model: "flash",
    maxTokens: 8192,
    thinkingBudget: 2048,
    systemPrompt: IDEATE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  return String(result.content ?? "");
}

// ─── Call 2: structured extraction (Pro, thinking OFF, responseSchema) ──────

const EXTRACT_SYSTEM_PROMPT = `You are a precise content analyst. You receive a professor's
pedagogical explanation and extract structured data from it.
Your output drives an animation engine — precision is critical.
Extract only what is explicitly described in the narrative.
Do not invent data not present in the explanation.`;

async function extractStructuredContent(
  narrative: string,
  request: ExplainerRequest,
  subjectContext: SubjectContext | undefined
): Promise<ExtractedContent> {
  const subjectName = subjectContext?.subject_name ?? request.topic;

  const userPrompt = `<pedagogical_narrative>
${narrative}
</pedagogical_narrative>

<topic>${request.topic}</topic>
<subject>${subjectName}</subject>

Analyze this explanation and extract structured animation data.
Choose the single best pattern from this list:

array_sort — sorting algorithms with step-by-step array transformation
array_search — search algorithms with element-by-element checking
graph_algorithm — graph traversal/shortest path with node/edge animation
tree_traversal — tree traversal showing visit order
stack_queue_ops — stack/queue operations with push/pop animation
dp_table — dynamic programming with table cell filling
formula_derivation — mathematical formula built up step by step
concept_analogy — abstract concept explained via concrete analogy
comparison_table — two or more items compared on multiple dimensions
process_flow — sequential process with decision points
cause_effect_chain — causal chain from root cause to consequence
definition_with_example — formal definition with multiple examples
hierarchy_structure — hierarchical relationship (tree/layers/taxonomy)
state_machine — states and transitions

Extract the complete data for the chosen pattern.
For algorithmic patterns (array_sort, graph_algorithm, etc):
  Trace through the COMPLETE execution on the professor's example.
  Every step. No shortcuts. Show the full state transformation.

The pattern_data object MUST be { "pattern": <chosen pattern>, "data": { ...full data for that pattern... } }.
Produce no more than 12 narrative_segments, each caption max 25 words.

Output valid JSON matching the ExtractedContent type exactly.`;

  const result = await routeAI("explainer_extract", {
    model: "pro",
    maxTokens: 16384,
    systemPrompt: EXTRACT_SYSTEM_PROMPT,
    responseSchema: EXTRACT_RESPONSE_SCHEMA,
    messages: [{ role: "user", content: userPrompt }],
  });

  const raw = String(result.content ?? "");

  // responseSchema guarantees schema-conformant JSON — parse once, no retries.
  let parsed: ExtractedContent;
  try {
    parsed = JSON.parse(raw) as ExtractedContent;
  } catch (e) {
    throw new Error(
      `Explainer extraction for "${request.topic}" returned invalid JSON ` +
        `despite responseSchema: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  // Validate substance: known pattern, pattern_data present, enough segments.
  if (!parsed.pattern || !KNOWN_PATTERNS.has(parsed.pattern)) {
    throw new Error(
      `Explainer extraction for "${request.topic}" produced unknown pattern ` +
        `"${parsed.pattern}"`
    );
  }
  if (!parsed.pattern_data || typeof parsed.pattern_data !== "object") {
    throw new Error(
      `Explainer extraction for "${request.topic}" is missing pattern_data`
    );
  }
  if (
    !Array.isArray(parsed.narrative_segments) ||
    parsed.narrative_segments.length < MIN_NARRATIVE_SEGMENTS
  ) {
    throw new Error(
      `Explainer extraction for "${request.topic}" has too few narrative_segments ` +
        `(need >= ${MIN_NARRATIVE_SEGMENTS})`
    );
  }

  return parsed;
}

// ─── Public entrypoint ─────────────────────────────────────────────────────

export async function generateExplainerContent(
  request: ExplainerRequest,
  subjectContext?: SubjectContext
): Promise<ExtractedContent> {
  const narrative = await getPedagogicalNarrative(request, subjectContext);
  const content = await extractStructuredContent(
    narrative,
    request,
    subjectContext
  );

  // Backfill
  content.subject_name = subjectContext?.subject_name ?? request.topic;
  content.module_name = subjectContext?.module_name;
  content.pedagogical_narrative = narrative;

  console.log(
    `[generateExplainerContent] topic="${request.topic}" pattern=${content.pattern} ` +
      `segments=${content.narrative_segments.length}`
  );

  return content;
}
