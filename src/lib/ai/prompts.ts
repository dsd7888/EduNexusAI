export type QueryMode = "exam_prep" | "problem_solving" | "conceptual";

/**
 * Classifies raw student intent so the tutor prompt can switch behavioral
 * mode. Pure function: deterministic, no DB/AI/imports, no side effects.
 *
 * Evaluation order follows the spec — exam_prep → problem_solving →
 * conceptual (default / everything else).
 */
export function detectQueryMode(message: string): QueryMode {
  const m = (message ?? "").trim();

  // ── exam_prep — recall / definition / one-liner intent ───────────────
  const examKeyword =
    /\b(defin|list|state|enumerat|abbreviat)\w*/i.test(m) ||
    /what is the formula|write the equation|full form of|in one line/i.test(m);
  const hasQuestionWord =
    /\b(what|why|how|when|where|who|whom|whose|which)\b/i.test(m);
  const shortNoQuestion = m.length < 60 && !hasQuestionWord;
  if (examKeyword || shortNoQuestion) return "exam_prep";

  // ── problem_solving — numerical / derivation intent ──────────────────
  const hasDigit = /\d/.test(m);
  const computeVerb =
    /\b(calculat|comput|solv|find|determin|deriv|given)\w*/i.test(m) ||
    /\bif\b[\s\S]+\bthen\b/i.test(m);
  const operatorsWithNumbers = /\d\s*[-+*/^=×÷]\s*\d/.test(m);
  if ((hasDigit && computeVerb) || operatorsWithNumbers)
    return "problem_solving";

  // ── conceptual — default, full LearnLM behavior ──────────────────────
  return "conceptual";
}

export function buildTutorSystemPrompt(options: {
  subjectName: string;
  subjectCode: string;
  semester: number;
  branch: string;
  syllabusContent: string;
  referenceBooks?: string;
  /** Student-intent mode. Optional; defaults to "conceptual" (existing behavior). */
  mode?: QueryMode;
}): string {
  const {
    subjectName,
    subjectCode,
    semester,
    branch,
    syllabusContent,
    referenceBooks,
    mode = "conceptual",
  } = options;

  // Adjust complexity based on semester
  const complexityLevel =
    semester <= 2 ? "beginner" : semester <= 4 ? "intermediate" : "advanced";
  const explanation_style = {
    beginner:
      "Use very simple language, avoid jargon, explain every term",
    intermediate:
      "Use clear language with some technical terms, provide examples",
    advanced:
      "Use technical language, assume foundational knowledge, focus on depth",
  };

  // ── Mode-specific behavioral section ───────────────────────────────────
  // Only the closing behavioral instructions change between modes. Persona,
  // syllabus context, citation rules, SVG/Mermaid rules and few-shot
  // examples below are mode-agnostic and stay identical.

  const CONCEPTUAL_PRINCIPLES = `<learning_principles>
Apply these principles in every response:

1. ACTIVE LEARNING — Never just give answers. For conceptual questions,
   show your reasoning. For numerical problems, show every step.
   When a student seems stuck, ask one guiding question rather than
   giving the answer directly.

2. MANAGE COGNITIVE LOAD — One concept at a time. Break complex explanations
   into numbered steps. Bold the single most important term per explanation.
   Do not dump everything you know — give what's needed to understand, then stop.

3. ADAPT TO THE LEARNER — If the student asks a basic question, meet them there
   without condescension. If they ask a deep question, go deep.
   Mirror their vocabulary level.

4. STIMULATE CURIOSITY — End responses with one genuinely interesting
   implication, application, or "what if" that makes the student want to know more.
   Not a generic "Let me know if you have questions!" — something specific to the topic.

5. DEEPEN METACOGNITION — Occasionally help students understand *how* to study
   this subject, not just *what* to study. Exam strategies, common mistake patterns,
   what professors typically test — this is high-value guidance.
</learning_principles>`;

  const EXAM_PREP_BEHAVIOR = `<exam_prep_mode>
The student wants a fast, exam-ready recall answer. Optimise for that:

1. DIRECT ANSWER FIRST — Give the definition, list, statement, formula, or
   full form immediately. No analogy, no warm-up, no preamble.

2. STRUCTURED & COMPACT — A tight definition line, then a short numbered or
   bulleted list only if the question implies multiple points. Bold the single
   key term. Show any formula on its own line with each symbol defined in one
   short clause. Keep it to what an examiner expects on the answer sheet.

3. NO CURIOSITY HOOK — Do NOT end with an interesting implication, "what if",
   or application. Do NOT add study-strategy or metacognition commentary.
   No motivational framing, no reasoning walkthrough, no filler.

End your response with exactly this line, on its own line, and nothing after it:
Want a quick quiz on this?
</exam_prep_mode>`;

  const PROBLEM_SOLVING_BEHAVIOR = `<problem_solving_mode>
The student has a numerical or derivation problem. Optimise for a clean,
checkable worked solution:

1. NO CURIOSITY HOOK — Do NOT open with an analogy or end with an interesting
   implication or "what if". Stay focused on solving.

2. SET UP BRIEFLY — State the governing formula on its own line, then list the
   given quantities with their units. One or two lines maximum.

3. LABELLED STEPS — Present the solution as numbered steps ("Step 1:",
   "Step 2:", ...). One operation per step. Carry units through every step.
   Never skip algebra.

4. MARK THE FINAL ANSWER — Put the result on its own line, clearly marked,
   e.g. **Final answer: P = 12,500 Pa**. Correct units, sensible significant
   figures.

End your response with exactly this line, on its own line — generate one new
related numerical problem of the same type and do NOT solve it:
Try a variation: [one related numerical problem]
</problem_solving_mode>`;

  const behavioralSection =
    mode === "exam_prep"
      ? EXAM_PREP_BEHAVIOR
      : mode === "problem_solving"
        ? PROBLEM_SOLVING_BEHAVIOR
        : CONCEPTUAL_PRINCIPLES;

  const closingLine =
    mode === "exam_prep"
      ? `Your goal: Deliver a precise, exam-ready answer on ${subjectName}, then close with the exact line "Want a quick quiz on this?" and nothing after it.`
      : mode === "problem_solving"
        ? `Your goal: Deliver a fully worked, unit-consistent solution for this ${subjectName} problem with the final answer clearly marked, then close with the "Try a variation:" line and a fresh related problem of the same type.`
        : `Your goal: Help students not just pass exams but build genuine understanding of ${subjectName}
they will carry into their careers.`;

  return `<persona>
You are EduNexus — an expert university tutor specialising in ${subjectName} (${subjectCode}).
You teach ${complexityLevel}-level students (Semester ${semester}, ${branch} branch).
Your teaching is modelled on the best human tutors: you simplify without dumbing down,
connect theory to real life, and make students feel capable rather than overwhelmed.
</persona>

<context>
<syllabus>
${syllabusContent}
</syllabus>
${referenceBooks ? `<reference_books>\n${referenceBooks}\n</reference_books>` : ""}
<student_level>
Semester ${semester} student. Complexity: ${complexityLevel}.
Style: ${explanation_style[complexityLevel]}.
</student_level>
</context>

${behavioralSection}

<response_rules>
SCOPE: Only answer questions related to ${subjectName} or general study/exam strategy.
OUT OF SCOPE: Say "That's outside your ${subjectName} syllabus. For this subject, I can help with [list 2-3 specific topics from the syllabus]."
CITATIONS: Reference syllabus with "According to Unit X..." or "As covered in the section on..."
NUMERICAL PROBLEMS: Show complete step-by-step solutions. Never skip steps.
FORMATTING: Bold key terms. Use numbered steps for processes. Show formulas on their own line.
LENGTH: Match response length to question complexity. Simple question = concise answer.
        Complex derivation = full treatment. Never pad with filler sentences.
</response_rules>

<visual_diagram_rules>
When a visual genuinely aids understanding — and only then — include ONE diagram.

Choose the right tool:

SVG for precise 2D technical visuals (use \`\`\`svg fence):
- Labeled schematics, apparatus, anatomical cross-sections
- Algorithm step-through: array states, pointer movement, tree traversal
- Graphs and plots: P-V diagram, ECG trace, dose-response curve, sine wave
- Data structure layout: binary tree, linked list, hash table
- Any diagram where geometry, spacing, and labels are critical

Mermaid for flow and logic diagrams (use \`\`\`mermaid fence):
- Step-by-step processes: thermodynamic cycles, reaction pathways, manufacturing steps
- Decision trees: diagnostic algorithms, engineering choices
- Cause-and-effect chains: pathophysiology cascade, economic feedback
- Hierarchical classifications and timelines

CRITICAL RULES:
- ALWAYS wrap SVG in a fenced code block: \`\`\`svg ... \`\`\`  Never output raw <svg> tags.
- SVG viewBox MUST be "0 0 800 400". Every element needs a <text> label. Min font-size 13px.
- Mermaid: NO parentheses in edge labels |like (this)|. NO underscores in labels. Max 4 words per label. Max 8 nodes.
- Place diagram AFTER your text explanation, never before.
- One diagram per response maximum.

SVG colors: #2563EB (blue), #1E40AF (dark blue), #16A34A (green), #D97706 (amber), #DC2626 (red)
SVG background: always start with <rect width="800" height="400" fill="#F8FAFC"/>
</visual_diagram_rules>

<few_shot_examples>
Example 1 — Conceptual question (good response pattern):
Student: "What's the difference between heat and work in thermodynamics?"
Response pattern: Start with an analogy → define both precisely → show the key distinction →
one real-world example → end with a curiosity hook about why the distinction matters for engines.

Example 2 — Numerical problem (good response pattern):
Student: "A piston expands from 0.1 m³ to 0.3 m³ at constant pressure 200 kPa. Find work done."
Response pattern: State the formula → identify what's given → substitute step by step →
state the answer with units → note what this means physically.

Example 3 — Out of scope (good response pattern):
Student: "Can you help me with my marketing assignment?"
Response pattern: Politely decline → name 2-3 specific topics from this subject's syllabus
that you CAN help with right now.
</few_shot_examples>

${closingLine}`;
}
export function buildSuggestedPromptsRequest(options: {
  subjectId: string;
  syllabusContent: string;
}): string {
  const { subjectId, syllabusContent } = options;

  return `You are an expert university tutor helping a student get started with a subject (ID: ${subjectId}).

Below is the official syllabus content for this subject:

${syllabusContent}

Your task:
- Propose exactly 4 short, student-friendly question prompts the student could ask to start learning effectively.
- Cover a mix of: overview, exam prep, real-world applications, and deeper understanding.
- Each prompt should be a single sentence, under 120 characters, and concrete (not meta-instructions).

Output format:
- Return ONLY a valid JSON array of 4 strings.
- Do not include any explanation or text outside the JSON.
- Example format: ["Prompt 1", "Prompt 2", "Prompt 3", "Prompt 4"].`;
}

export function buildQuickNotesPrompt(options: {
  topicLabel: string;
  subjectName: string;
  syllabusContent: string;
  moduleName: string | null;
}): string {
  const { topicLabel, subjectName, syllabusContent, moduleName } = options;
  const scope = moduleName
    ? `module "${moduleName}"`
    : `the subject "${subjectName}"`;

  return `Generate comprehensive quick notes for ${scope}.

Syllabus content:
${syllabusContent}

Format the notes exactly as:

# ${topicLabel}

## Key Concepts
- Bullet points of core ideas, definitions, formulas

## Important Formulas / Rules
- List all key formulas with brief explanation

## Quick Summary
- 3-5 sentence overview of the entire topic

## Remember For Exams
- Most important points to memorize

VISUAL DIAGRAMS (include when genuinely useful for the topic):
For spatial/structural/algorithm/graph content → use SVG:
\`\`\`svg
<svg viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg">
  <rect width="800" height="400" fill="#F8FAFC"/>
  <!-- diagram content with text labels -->
</svg>
\`\`\`
CRITICAL: The opening line must be exactly \`\`\`svg (three backticks + svg).
Never write <svg> directly in your response text without the fence.
Never use any other fence name like \`\`\`xml or \`\`\`html for SVG content.

For process/flow/decision content → use Mermaid:
\`\`\`mermaid
graph TD
    A[Start] --> B[Step 1]
\`\`\`

Rules for both: one diagram maximum in the entire notes output, placed 
after the relevant section text, never before. For Mermaid: 4-8 nodes, 
no parentheses/underscores/curly braces in edge labels, max 4 words per 
edge label. For SVG: viewBox="0 0 800 400", white background, all 
elements labeled with <text> tags, no external refs, no scripts.

Be concise but complete. Use markdown formatting. Return only the markdown notes.`;
}

/**
 * Appended inside {@link buildOutlinePrompt} in `src/lib/ppt/generator.ts`
 * immediately after the CANONICAL DIAGRAM RULE block (before `</teaching_sequence>`).
 * Keeps outline prompt fragments in one place for editing.
 */
export const OUTLINE_PROMPT_ILLUSTRATION_MANDATE = `<illustration_mandate>
File Structures, Data Structures, Operating Systems, Database Systems, and
other CONCEPTUAL courses require visual metaphors.

For every major concept introduction, ask:
"What familiar object or process is this like?"

Generate an ILLUSTRATION slide (renderHint="illustration") showing the metaphor:

Sequential Files → "Sequential Access: Like a Cassette Tape"
  imagenPrompt: "Conveyor belt with labeled boxes moving in sequence,
  reader at end must wait for each box"

Indexed Files → "Indexed Access: Like a Library Card Catalog"
  imagenPrompt: "Card catalog drawer with index cards pointing to shelf locations"

Hashing → "Hashing: Like Post Office Mail Sorting"
  imagenPrompt: "Post office worker reading address and placing mail into
  numbered pigeonholes"

B-trees → "B-Tree Growth: Like a Tree Branching"
  imagenPrompt: "Tree with root trunk splitting into branches as it grows,
  leaves at equal height"

Place illustration slides BEFORE technical concept slides.
Sequence: Illustration → Concept (bullets) → Diagram (SVG) → Example

This applies to ALL courses with abstract systems concepts.
</illustration_mandate>`;

/**
 * Dual metaphor + technical panel outline example; injected next to
 * {@link OUTLINE_PROMPT_ILLUSTRATION_MANDATE} in `buildOutlinePrompt` (generator.ts).
 */
export const OUTLINE_PROMPT_DUAL_VISUAL_EXAMPLE = `<dual_visual_slide_example>
For complex concepts requiring both metaphor AND mechanism, use type "dual_visual"
with renderHint "dual". Include leftVisual, rightVisual, leftPrompt, and rightPrompt
(string values only — valid JSON in the real outline).

Example outline entry:
{
  "index": 10,
  "type": "dual_visual",
  "title": "Hashing: Direct Address Computation",
  "renderHint": "dual",
  "diagramComplexity": "intricate",
  "leftVisual": "illustration",
  "rightVisual": "svg",
  "leftPrompt": "Post office sorting mail into numbered pigeonholes based on address",
  "rightPrompt": "Hash table with 7 buckets, keys mapping via h(key) = key % 7"
}

(diagramComplexity is "standard" or "intricate" — required on every diagram and
dual_visual slide; see <diagram_complexity_rules>.)

Intent:
- Left 50%: Imagen illustration (conceptual metaphor) from leftPrompt
- Right 50%: SVG technical diagram from rightPrompt
- Single diagramCaption at the bottom connecting both panels

<dual_visual_selection_criteria>
Use dual_visual (split-screen metaphor + mechanism) when ALL of these apply:
1. The concept has BOTH an intuitive metaphor AND a technical mechanism
2. Showing them side-by-side creates immediate "aha!" connection
3. The metaphor and mechanism are simple enough to fit 50% width each

Examples of when to use:
- Concept with hidden mechanism → show metaphor (left) + internal structure (right)
- Two contrasting approaches → show visual comparison side-by-side
- Process with both "what it looks like" and "how it works"

Examples of when NOT to use:
- Simple metaphor that doesn't need technical diagram (use illustration only)
- Complex mechanism that needs full-width diagram (use separate slides)
- Pure definition with no visual mechanism (use concept slide with bullets)

Maximum 3-4 dual_visual slides per deck to avoid cognitive overload.
</dual_visual_selection_criteria>

Use for: Hashing, indexing structures, sequential vs direct comparison, and similar pairs.
Both this rule and the canonical diagram / illustration rules may apply — some topics need
a dual_visual slide plus separate focused diagram slides.
</dual_visual_slide_example>`;

/**
 * INDIAN CONTEXT MANDATE — injected into {@link buildOutlinePrompt}
 * (generator.ts) as a top-level block after </teaching_sequence>.
 * Makes Indian context a hard requirement for every example.
 */
export const OUTLINE_PROMPT_INDIAN_CONTEXT = `<indian_context_mandate>
INDIAN CONTEXT MANDATE:
Every real-world example and every worked example MUST use Indian context.
This is non-negotiable for engineering and science subjects.

BANNED references (never use these):
- Google Maps → use Ola Maps, Maps.me, the IRCTC route planner
- Amazon (US) → use Flipkart, Meesho, or Amazon India
- Netflix → use JioCinema, Hotstar, Zee5
- "A company in X" without naming an actual Indian company
- Generic "city A to city B" → use real Indian cities
(JPEG, ZIP, and other technical standards are acceptable — they are not brands.)

REQUIRED — worked examples and activities must draw from:
- Indian cities for graph / route problems:
  Mumbai-Pune-Nashik-Aurangabad; Delhi-Noida-Gurugram-Faridabad-Ghaziabad;
  Ahmedabad-Surat-Vadodara-Rajkot-Bhavnagar; Bangalore-Mysore-Hubli-Mangalore-Hassan
- Indian companies for business scenarios:
  Zomato, Swiggy, Ola, Uber India, Flipkart, IRCTC, PhonePe, Paytm, NPCI,
  Jio, Infosys, TCS, Wipro
- Indian currency (₹), Indian sports (IPL, kabaddi),
  Indian infrastructure (Indian Railways, NHAI highways, BSNL)
- Indian academic context: JEE / IIT entrance prep, university exam scheduling,
  hostel room allocation

This context makes the content immediately recognizable and relatable to
Indian engineering students.

EXCEPTION: For the rare subject where an Indian framing would be forced or
unnatural, use neutral / universal context rather than an awkward Indian
reference. Engineering algorithms always have natural Indian contexts available
— use them.
</indian_context_mandate>`;

/**
 * HOOK SLIDE rule — injected into {@link buildOutlinePrompt} inside
 * <teaching_sequence>. A section-opener that creates cognitive need.
 * Rendered as an existing "concept" slide (renderHint null) so it needs
 * no renderer changes; the title format makes its purpose explicit.
 */
export const OUTLINE_PROMPT_HOOK_SLIDE = `<hook_slide_rule>
HOOK SLIDE — SECTION OPENER:
At the start of every major concept section (each new algorithm or technique
being introduced), include one HOOK slide BEFORE its definition slide.

Emit the hook as type "concept" with renderHint null.
Title: "Why does [concept name] matter?"

A hook slide must contain exactly ONE scenario — not a list of reasons.
Structure: a specific entity facing a specific constraint encounters a problem
that seems unsolvable without the algorithm about to be taught. End with a
single question. No bullets. No abstract benefits ('efficiency', 'scalability').
Maximum 4 sentences. The scenario must use Indian context.

WRONG: a bullet list of abstract benefits ("efficient", "scalable",
       "fundamental in areas like...").
RIGHT: one concrete scenario in 2-3 short sentences, ending on a single
       question — no bullets, no theory.
</hook_slide_rule>`;

/**
 * ACTIVITY SLIDE mandate — injected into {@link buildOutlinePrompt} inside
 * <teaching_sequence>. Structurally mandatory after each algorithm's worked
 * example. Rendered as an existing "example" slide (problem / steps / answer)
 * so it needs no renderer changes while keeping the exercise styling.
 */
export const OUTLINE_PROMPT_ACTIVITY_MANDATE = `<activity_slide_mandate>
ACTIVITY SLIDE — MANDATORY PLACEMENT RULE:
For every algorithm, optimization technique, or graph problem, the outline MUST
include one ACTIVITY slide placed immediately AFTER the worked example slide for
that concept. Zero exceptions. If a module contains algorithms and the outline
has no activity slides for it, the outline is WRONG and must be corrected.

Emit each activity as type "example" with renderHint null (the existing example
renderer gives it the right exercise styling).
Title format: "Activity: [specific scenario name]"

An activity is a concrete real-world INDIAN scenario that IS the algorithm
problem — not an analogy, the actual problem. The student DOES the work (compute,
draw, map, decide); they do not just read.

Map the activity into the example fields:
- problem = the Indian scenario, concise (≤180 chars): who, where, the data, what to find
- steps   = 3-4 numbered things the STUDENT DOES (verbs: Map, Calculate, Draw,
            Identify, Decide), then one final step that is a discussion prompt
            connecting their answer back to the algorithm just learned.
            The step list MUST include at least one step where the student
            computes a specific numerical result from the actual numbers in
            the scenario — "identify", "discuss", "outline", or "propose"
            alone are not sufficient for that step.
            WRONG: "Outline the steps the algorithm would take."
            RIGHT:  "Calculate the new address using the values given above."
- answer  = the solution hint: how the algorithm solves exactly this scenario

Scenario inspiration (generate one fitting the actual concept and subject —
these are guidance, not a fixed bank):
- Shortest path / Dijkstra: a Zomato partner in Bengaluru delivering across
  Koramangala, HSR Layout, Indiranagar, Whitefield — minimise total distance.
- TSP / Backtracking: an IRCTC tour from Delhi visiting Agra, Jaipur, Udaipur,
  Jodhpur and back — find the cheapest tour from given road distances.
- Fractional Knapsack: a founder at a Bengaluru incubator with ₹50 lakh and 6
  projects (funding need + expected return) — maximise ROI.
- Sorting: rank 8 IPL players by strike rate for fantasy-league selection.
- MST / Prim's / Kruskal's: BSNL laying fibre across 6 Himachal villages —
  minimise total cable from given distances.
- Huffman Coding: build the Huffman tree from letter frequencies in a
  Hindi-transliterated WhatsApp message.
- 0-1 Knapsack / DP: a 15 kg bag limit for a Ladakh trek, 7 items with weight
  and utility scores — which to pack?
- Matrix multiplication: how Strassen's cuts the multiplications for a mobile
  game's 3D transformation matrix.

Generate appropriate Indian scenarios for any subject's algorithms.
</activity_slide_mandate>`;

/**
 * CONTEXT RULE — injected near the opening of {@link buildBatchContentPrompt}
 * (generator.ts), right after </output_rules>. Forces Indian context in content.
 */
export const BATCH_PROMPT_INDIAN_CONTEXT = `<context_rule>
CONTEXT RULE: All worked examples, numerical data, and real-world references
must use Indian context as defined in the outline. If the outline's activity or
example carries Indian city names or Indian company names (Zomato, Swiggy, Ola,
Flipkart, IRCTC, PhonePe, Jio, Infosys, TCS, ...), use exactly those in the slide
content. Do not substitute generic or Western alternatives — no Google Maps, no
US Amazon, no Netflix. Use ₹ for currency. Technical standards (JPEG, ZIP) are
fine. For activity slides (type "example" titled "Activity: ..."), the scenario,
the student-action steps, and the data must all stay in Indian context.
</context_rule>`;

/**
 * COMPLETENESS RULE — injected into {@link buildBatchContentPrompt} inside
 * <accuracy_mandate>. No truncation; real-world callouts must be specific.
 */
export const BATCH_PROMPT_COMPLETENESS = `<completeness_rule>
COMPLETENESS RULE:
Never truncate content with an ellipsis (... or …). Every sentence must finish.
Every bullet point must be a complete thought. If content is too long for a
bullet: (a) split it into two bullets, or (b) reduce it to the essential claim.
A shorter complete sentence always beats a truncated one.

Real-world callouts (💡 Real world: ...) must name a specific Indian company,
product, or scenario. Generic phrases like "Used in large-scale systems" are not
acceptable.
</completeness_rule>`;

/**
 * DIAGRAM COMPLETENESS RULE — injected into {@link buildBatchContentPrompt}
 * inside the SVG quality section. Forbids describing a diagram instead of
 * generating it.
 */
export const BATCH_PROMPT_NO_PLACEHOLDER_DIAGRAMS = `<diagram_completeness_rule>
DIAGRAM COMPLETENESS RULE:
Never output a description of a diagram instead of the diagram. These patterns
are FAILURES and are not allowed in any diagram field:
- "This diagram illustrates..."
- "The following diagram shows..."
- "A diagram depicting..."
- Any prose that describes what a diagram would look like instead of BEING the diagram.

If you cannot generate a sophisticated SVG for an "svg" slide, generate a
SIMPLER but COMPLETE one — a basic flowchart of labelled boxes and arrows is
fine. A simple correct diagram beats a sophisticated description every time.
- renderType "mermaid": output valid Mermaid syntax, never a description.
- renderType "svg": output a complete <svg>...</svg>, never a description.
Activity slides (type "example") carry no diagram — the scenario and the
student-action steps are the slide.
</diagram_completeness_rule>`;

/**
 * NO HEDGING RULE — injected at the top of {@link buildBatchContentPrompt}
 * (after output_rules). Prevents reasoning-in-progress leaking into output fields.
 */
export const BATCH_PROMPT_NO_HEDGING = `<no_hedging_rule>
NO HEDGING RULE:
Never include reasoning-in-progress, self-correction, or hedge language
("wait", "actually", "let me reconsider", "hmm") in any output field.
If a computation seems wrong mid-generation, redo it silently and output
only the final clean result.
</no_hedging_rule>`;

/**
 * MCQ CONSISTENCY RULE — injected into {@link buildBatchContentPrompt} immediately
 * before the "practice" slide type requirements. Enforces answer-first construction.
 */
export const BATCH_PROMPT_MCQ_CONSISTENCY = `<mcq_consistency_rule>
MCQ CONSISTENCY RULE:
When generating a practice question, compute the true correct result FIRST
from the given data, then write the four options so the computed result appears
verbatim as one of them, then build the other three as plausible near-miss
distractors (off-by-one, wrong formula step, wrong unit). Never generate
options and the answer independently of each other.
</mcq_consistency_rule>`;

/**
 * LAYOUT VARIETY RULE — injected into {@link buildBatchContentPrompt} after the
 * per-slide-type content requirements. Varies structure by slide purpose, using
 * only the existing renderable slide types (concept / example).
 */
export const BATCH_PROMPT_LAYOUT_VARIETY = `<layout_variety_rule>
LAYOUT VARIETY RULE:
Do not make every slide six identical bullets. Vary the structure by purpose:

- DEFINITION slides (type "concept"): open with 1-2 sentences of formal
  definition, then 3 short labelled key-property bullets.
- COMPARISON slides (type "concept"): when contrasting two algorithms or
  approaches, structure the bullets as explicit pairs — "A — ..." then "B — ..."
  — so the two sides read side by side.
- WORKED EXAMPLE slides (type "example"): number each step 1, 2, 3...; show the
  intermediate state after each step; the ✓ answer bar is the clearly marked result.
- HOOK slides (type "concept", title "Why does ... matter?"): one concrete scenario
  in 2-3 short prose sentences (NOT a bullet list), ending on a single question.
  No bullets. No abstract benefit list ("efficient", "scalable", "fundamental
  in areas like..."). No formulas.
  WRONG: bullets listing "efficient", "scalable", "fundamental in areas like..."
  RIGHT: "Swiggy's router assigns 800 delivery orders per minute across Bengaluru.
          Every second of delay costs a delivery partner ₹3. How does it decide
          the fastest path in under 10 ms?"
- ACTIVITY slides (type "example", title "Activity: ..."): the Indian scenario in
  the problem field, then numbered STUDENT-ACTION steps (Map..., Calculate...,
  Draw..., Identify..., Decide...). No theory — student-action language only.
- KEY INSIGHT slides (type "concept"): use sparingly, at most one per major
  concept. One core insight as the first bold bullet, one supporting explanation
  bullet, one connecting Indian-context example bullet — three bullets total.
</layout_variety_rule>`;

