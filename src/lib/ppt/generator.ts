import path from "path";
import PptxGenJS from "pptxgenjs";

// ── TYPES ──────────────────────────────────────────────────

export type SlideType =
  | "title"
  | "overview"
  | "concept"
  | "diagram"
  | "example"
  | "practice"
  | "summary";

function sanitizeMermaidCode(code: string): string {
  if (!code || code.trim().length === 0) return code;

  const lines = code.split("\n");

  const sanitizedLines = lines.map((line) => {
    const trimmed = line.trim();

    // Skip empty lines and directive lines (graph TD, flowchart LR, etc.)
    if (
      !trimmed ||
      /^(graph|flowchart|sequenceDiagram|stateDiagram|classDiagram|gitGraph|pie|gantt|erDiagram|journey|mindmap|timeline)\b/i.test(
        trimmed
      )
    ) {
      return line;
    }

    // Fix edge labels: content inside |...| pipes
    let result = line.replace(/\|([^|]*)\|/g, (_, label) => {
      const cleaned = label
        .replace(/[(){}]/g, "")
        .replace(/_/g, " ")
        .replace(/:/g, "-")
        .replace(/[<>&%#"]/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      return `|${cleaned}|`;
    });

    // Fix node labels: content inside [...] that contain special chars
    result = result.replace(/(\w+)\[([^\]]*)\]/g, (match, id, label) => {
      const needsQuoting = /[:&<>%#]/.test(label);
      if (needsQuoting) {
        const cleaned = label
          .replace(/:/g, " -")
          .replace(/[&<>%#]/g, "")
          .replace(/"/g, "'")
          .trim();
        return `${id}["${cleaned}"]`;
      }
      return match;
    });

    // Fix node IDs that start with a number (invalid in Mermaid)
    result = result.replace(
      /(?:^|\s)(\d[\w]*)\s*(?:\[|\(|\{|-->|---)/g,
      (match) => match.replace(/(\d[\w]*)/, "n$1")
    );

    // Fix subgraph labels with colons
    result = result.replace(
      /^(\s*subgraph\s+)(.+)$/,
      (_, prefix, label) =>
        prefix + label.replace(/:/g, " -").replace(/[&<>%#]/g, "")
    );

    return result;
  });

  const sanitized = sanitizedLines.join("\n");

  // Final pass: if the diagram has >15 nodes, truncate to prevent render timeouts
  const nodeCount = (sanitized.match(/\w+\s*[\[({]/g) || []).length;
  if (nodeCount > 15) {
    const header =
      sanitizedLines.find((l) =>
        /^(graph|flowchart|sequenceDiagram|stateDiagram)\b/i.test(l.trim())
      ) || "graph TD";
    const nodeLines = sanitizedLines
      .filter(
        (l) =>
          l.trim() &&
          !/^(graph|flowchart|sequenceDiagram|stateDiagram)\b/i.test(l.trim())
      )
      .slice(0, 15);
    return [header, ...nodeLines].join("\n");
  }

  return sanitized;
}

export interface SlideContent {
  type: SlideType;
  title: string;
  bullets?: string[];
  svgCode?: string;
  diagramCaption?: string;
  /** Render strategy for diagram slides */
  diagramRenderType?: "svg" | "mermaid" | "imagen";
  /** For imagen slides: detailed generation prompt */
  imagenPrompt?: string;
  /** For mermaid slides: valid mermaid code */
  mermaidCode?: string;
  /** Filled post-generation: base64 PNG from Imagen API */
  imageBase64?: string;
  /** Rare alternate path for example steps (prefer example.steps). */
  steps?: string[];
  example?: {
    problem: string;
    steps: string[];
    answer: string;
  };
  question?: {
    text: string;
    options?: string[];
    answer: string;
    explanation: string;
  };
  note?: string;
}

export interface PPTSlideJSON {
  presentationTitle: string;
  subject: string;
  topic: string;
  slides: SlideContent[];
  addLogo?: boolean;
  logoUrl?: string;
}

export interface SlideOutline {
  presentationTitle: string;
  subject: string;
  topic: string;
  outline: {
    index: number;
    type: SlideType;
    title: string;
    renderHint?: "svg" | "mermaid" | "imagen" | null;
  }[];
}

// ── PROMPT BUILDERS ────────────────────────────────────────

export function buildOutlinePrompt(options: {
  subjectName: string;
  subjectCode: string;
  /** Full subject syllabus text (caller may slice); outline uses first 3000 chars for context. */
  fullSyllabus: string;
  moduleName?: string;
  customTopic?: string;
  /** From modules.description when generating for a module. */
  moduleDescription?: string;
  depth: "basic" | "intermediate" | "advanced";
  /** Optional textbook list from DB — guides pedagogy and notation. */
  referenceBooks?: string;
}): string {
  const {
    subjectName,
    subjectCode,
    fullSyllabus,
    moduleName,
    customTopic,
    moduleDescription = "",
    depth,
    referenceBooks = "",
  } = options;
  const focusLabel = moduleName ?? customTopic ?? "the module";
  const isModule = Boolean(moduleName);

  const slideCountGuide = {
    basic: isModule ? "16–20" : "14–18",
    intermediate: isModule ? "20–26" : "18–24",
    advanced: isModule ? "26–32" : "24–32",
  }[depth];

  const syllabusContext = fullSyllabus.slice(0, 3000);
  const refInline =
    referenceBooks.trim().length > 0
      ? `

REFERENCE TEXTBOOKS: ${referenceBooks.trim()}
Follow their notation and pedagogical sequence.
`
      : "";

  return `<persona>
You are a senior academic curriculum designer with deep expertise in
university-level education across all disciplines. You design slide outlines
that expert lecturers actually use — structured for genuine learning,
not just coverage.
</persona>

<context>
<subject>${subjectName} (${subjectCode})</subject>
<focus_topic>${focusLabel}</focus_topic>
${moduleDescription.trim() ? `<module_description>${moduleDescription.trim()}</module_description>` : ""}
<depth_level>${depth}</depth_level>
<target_slide_count>${slideCountGuide}</target_slide_count>
<domain_adaptation>
Adapt entirely to this subject's domain:
- STEM/Engineering: derivations, worked numericals, governing equations, precision diagrams
- Medical/Health: clinical cases, anatomical diagrams, diagnostic criteria, pharmacological values
- Management/Commerce/Law: frameworks, case analyses, ethical dimensions, policy implications
- Humanities/Social Sciences: thematic analysis, comparative examples, historiography
- Basic Sciences: first-principles reasoning, experimental setups, molecular/cellular diagrams
</domain_adaptation>

<full_syllabus>
${syllabusContext}
</full_syllabus>
${refInline}
</context>

<task>
Design a complete slide OUTLINE (titles and types only — no content yet) for: ${focusLabel}

Use the full syllabus to understand prerequisites, avoid duplicating other modules,
and add cross-references like "builds on Unit 2" where relevant.
</task>

<slide_count_rules>
Generate AS MANY slides as the content genuinely requires.
When a syllabus item has sub-points (derivation, formula, assumptions, applications,
clinical signs, diagnostic criteria) — each sub-point cluster deserves its own slide.
Never compress two distinct concepts onto one slide.
</slide_count_rules>

<teaching_sequence>
For every significant concept in the syllabus, follow this sequence:
1. CONCEPT slide — definition, governing principle, mathematical/mechanistic basis
2. CONCEPT slide — deeper treatment: derivation, limiting cases, clinical/engineering significance
3. DIAGRAM slide — visual that makes the concept tangible (assign renderHint below)
4. EXAMPLE slide — domain-appropriate worked example with real parameters

CANONICAL DIAGRAM RULE:
For any named theoretical model, cycle, framework, mechanism, or structure
that appears in the syllabus — if searching "[name] diagram" returns the same
standard visual across every textbook — that diagram is MANDATORY as its own slide.
The concept without its canonical diagram is incomplete.
Examples of the principle (not exhaustive): a named thermodynamic cycle needs its
P-V or T-S diagram; a named anatomical structure needs its labeled cross-section;
a named algorithm needs its step-by-step state diagram; a named economic framework
needs its standard visual; a named biological pathway needs its arrow diagram.
</teaching_sequence>

<renderhint_rules>
For every diagram slide, assign exactly one renderHint based on what the diagram IS:

"svg" — precise 2D technical content where geometry and labels are critical:
- Quantitative graphs (P-V, T-S, stress-strain, dose-response, supply-demand)
- Labeled schematics (apparatus, circuits, pipe systems, 2D anatomical cross-sections)
- Waveforms and signal patterns (ECG, EEG, action potential, sound wave, seismic trace)
- Free body diagrams, force diagrams, vector diagrams
- Algorithm state diagrams (array states for sorting, pointer movement, tree traversal)
- Data structure layouts (binary tree, graph adjacency, hash table, heap)
- Chemical structural formulas, phase diagrams, titration curves
- 2D schematic cross-sections of mechanical components (gear tooth, screw thread, valve)

"mermaid" — sequential or logical flow where connections matter:
- Step-by-step processes (synthesis pathway, diagnostic algorithm, manufacturing flow)
- Decision trees (clinical decision-making, engineering design choice)
- Cause-and-effect chains (pathophysiology cascade, economic feedback loop)
- Hierarchical classifications, timelines, state transition diagrams

"imagen" — requires 3D spatial depth or photorealism that 2D cannot convey:
- 3D anatomy (organs, joints, tissue layers, cellular ultrastructure)
- Equipment internals requiring 3D geometry (turbines, pumps, reactors, MRI machines)
- 3D mechanical assemblies (gearbox, ball bearing, piston-cylinder, cam-follower)
- Physical phenomena needing depth (boundary layer flow, turbulent combustion, crystal structures)
- Real laboratory/clinical setups (operating theatre, lab bench, construction site)
- Computer hardware physical components (CPU die, RAM module, PCB layer stack)

RULE: Default to "svg" for anything a textbook would draw in 2D.
Only use "imagen" when 3D spatial understanding is genuinely necessary.
</renderhint_rules>

<practice_distribution>
One practice question per major concept group, distributed across the deck.
Test different cognitive levels: recall → application → analysis → synthesis.
For ${depth} depth: ${depth === 'basic' ? 'test definitions and direct application' : depth === 'intermediate' ? 'require combining 2+ concepts' : 'require analysis, clinical/engineering reasoning, or synthesis — not recall'}.
Never cluster all practice questions at the end.
CRITICAL: Practice question answer options must ONLY reference concepts
taught earlier in this deck — never introduce untaught terms in options.
</practice_distribution>

<structure_requirements>
- Start: 1 title slide + 1 overview slide (overview must cover the FULL deck scope)
- End: 1 summary slide
- Every formula-heavy or mechanism-heavy concept: dedicated diagram slide
- Comparison slides where 2+ related concepts benefit from side-by-side treatment
- No filler slides — every slide must serve a learning purpose
- No skipped syllabus concepts
</structure_requirements>

<slide_types>
title    — opening slide, 1 total
overview — full-deck agenda, 1 total
concept  — theory, derivations, mechanisms, classifications, comparisons
diagram  — visual (assign renderHint)
example  — worked problem with full domain-appropriate solution
practice — student question with answer
summary  — final takeaways, 1 total
</slide_types>

<output_format>
Return ONLY valid JSON. No markdown. No backticks. No explanation.
Start your response with { and end with }

{
  "presentationTitle": "string",
  "subject": "string",
  "topic": "string",
  "outline": [
    { "index": 0, "type": "title", "title": "string", "renderHint": null },
    { "index": 1, "type": "overview", "title": "string", "renderHint": null },
    { "index": 3, "type": "diagram", "title": "ECG: P-QRS-T Waveform", "renderHint": "svg" },
    { "index": 7, "type": "diagram", "title": "Heart: 3D Chamber Anatomy", "renderHint": "imagen" },
    { "index": 12, "type": "diagram", "title": "Diagnostic Algorithm: Chest Pain", "renderHint": "mermaid" }
  ]
}

Rules:
- renderHint is null for non-diagram slides
- renderHint is required for all diagram slides
- Indexes start at 0 and increment sequentially with no gaps
</output_format>`;
}

export function buildBatchContentPrompt(options: {
  subjectName: string;
  /** Full subject syllabus; first 3000 chars used for batch context. */
  fullSyllabus: string;
  depth: string;
  slides: {
    index: number;
    type: SlideType;
    title: string;
    renderHint?: "svg" | "mermaid" | "imagen" | null;
  }[];
  moduleName?: string;
  customTopic?: string;
  moduleDescription?: string;
  /** Optional textbook list from DB — notation and pedagogy. */
  referenceBooks?: string;
}): string {
  const {
    subjectName,
    fullSyllabus,
    depth,
    slides,
    referenceBooks = "",
    moduleName,
    customTopic,
    moduleDescription = "",
  } = options;

  const focusLabel = moduleName ?? customTopic ?? "";
  const syllabusContext = fullSyllabus.slice(0, 3000);

  const referenceBlock =
    referenceBooks.trim().length > 0
      ? `

REFERENCE TEXTBOOKS: ${referenceBooks.trim()}
Follow the pedagogical sequence and notation conventions from these books.
`
      : "";

  const slidesJson = JSON.stringify(
    slides.map((s) => ({
      index: s.index,
      type: s.type,
      title: s.title,
      renderType: s.renderHint ?? (s.type === "diagram" ? "svg" : null),
    })),
    null,
    2
  );

  return `<output_rules>
THESE RULES ARE ABSOLUTE. VIOLATION CAUSES SYSTEM FAILURE.
1. Return ONLY a valid JSON array. Nothing else.
2. First character of your response: [
3. Last character of your response: ]
4. No text before [. No text after ].
5. No markdown fences anywhere (no \`\`\`).
6. No comments inside JSON.
7. No trailing commas.
8. All strings use double quotes. Escape internal quotes with \\"
9. Complete ALL ${slides.length} slide objects fully. Never truncate.
10. Diagram slides: generate the most accurate, detailed SVG/Mermaid
    possible — correct labels, arrows, annotations.
</output_rules>

<accuracy_mandate>
ACCURACY IS NON-NEGOTIABLE.
Every fact, formula, value, mechanism, clinical parameter, and example
must be correct. Do not invent values. Use standard textbook values.
When unsure of a specific value, state the principle clearly using
a well-known general case rather than inventing a number.
Before writing any worked example, verify EACH STEP individually:
(1) confirm every intermediate calculation is arithmetically correct,
(2) confirm units are consistent throughout,
(3) confirm the final answer matches what step-by-step working produces.
A correct final answer with wrong intermediate steps is invalid —
students follow the steps, not just the answer.
This content goes directly to university classrooms — errors
damage student understanding and institutional trust.
</accuracy_mandate>

You are an expert university lecturer creating detailed slide content for ${subjectName}.

FULL SUBJECT SYLLABUS (for context and cross-referencing):
${syllabusContext}

YOUR FOCUS: "${focusLabel || "this section of the course"}"
${moduleDescription.trim() ? `Module description: ${moduleDescription.trim()}` : ""}

Use the full syllabus to align content with prerequisites and avoid contradicting other units.
${referenceBlock}
DEPTH LEVEL: ${depth}

You are given a batch of slide titles and types from an existing outline. For each slide, generate COMPLETE content as SlideContent objects.

SLIDE TYPES:
- \"title\": Presentation title slide.
- \"overview\": Agenda/overview of all concepts.
- \"concept\": Explanatory slide with key points and real-world relevance.
- \"diagram\": Visual SVG diagram that helps understanding.
- \"example\": Worked example with full step-by-step solution.
- \"practice\": Practice question (with answer and explanation).
- \"summary\": Key takeaways.

CONTENT REQUIREMENTS BY SLIDE TYPE:
- \"title\": Use the title string as main heading; you may also include a short subtitle in bullets.
- \"overview\": bullets should list the main concepts/topics.
- \"concept\" slides — EXACTLY 5-7 bullets. Each bullet MUST:
  - Be ONE complete sentence, maximum 110 characters
  - Contain the actual fact/formula/definition (not a summary)
  - End with a period
  - NEVER be a paragraph — if you need more, split into two bullets
  - Format: "Term/concept: brief explanation with value/formula if applicable."
  
  Examples of GOOD bullets (under 110 chars each):
  ✓ "Bernoulli's equation: P + ½ρv² + ρgh = constant along a streamline."
  ✓ "Reynolds number Re = ρvD/μ determines laminar (<2300) vs turbulent (>4000) flow."
  ✓ "Continuity equation for incompressible flow: A₁V₁ = A₂V₂ (mass conservation)."
  
  Examples of BAD bullets (too long, paragraph-style):
  ✗ "The continuity equation is a fundamental statement of conservation of mass within a control volume or system, and for steady incompressible flow it simplifies to A₁V₁ = A₂V₂."
  
  <note_field_rules>
  The "note" field (the 💡 tip bar rendered at slide bottom):

  This note must be something a great lecturer would say aloud in class
  that students would write in the margin of their notes.

  Domain formats:
  - STEM/Engineering: "💡 Rule: [shorthand or limit to remember]"
  - Medical: "💡 Clinical pearl: [one practical diagnostic or treatment insight]"
  - Management/Commerce: "💡 In practice: [real company example or market behaviour]"
  - Humanities: "💡 Key insight: [one interpretive or contextual observation]"
  - Any domain: "💡 Real world: [concrete observation from daily life]"

  DISQUALIFIED notes (do not write these):
  ✗ Anything that just restates a limitation: "Rarely used in practice."
  ✗ Anything that could appear on a Wikipedia article unchanged
  ✗ Anything a student could derive themselves from the bullets
  ✗ Generic importance claims: "This concept is fundamental."

  QUALIFIED notes (write these):
  ✓ "💡 Real world: Python's built-in sort is Timsort — a Merge+Insertion hybrid."
  ✓ "💡 Clinical pearl: LAD occlusion = anterior STEMI = widowmaker artery."
  ✓ "💡 Rule: Re > 4000 = turbulent — pipe engineers use this threshold daily."
  ✓ "💡 Mnemonic: Atria Above, Ventricles Below — never mix them up."
  ✓ "💡 Real world: Python's built-in sort is Timsort — a Merge+Insertion hybrid."
  ✓ "💡 Real world: Bubble Sort shines only on nearly-sorted arrays of < 20 elements."
  ✓ "💡 Real world: Binary search requires sorted data — that's why sorting matters."

  For algorithm and data structure slides specifically: the note must name a
  real system, language, or tool that uses this concept — not restate a limitation.

  Max 90 characters total including the emoji prefix.
  </note_field_rules>
- \"diagram\" slides — CRITICAL: check the renderType field in the input slide.

  If renderType is "svg":
    Generate complete valid SVG in "svgCode" field.
    viewBox="0 0 800 400". Clean technical diagram.
    Use colors: #2563EB, #1E40AF, #16A34A, #D97706, #DC2626.
    Include <text> labels and <defs><marker> arrows.
    <svg_quality_rules>
    Before writing any SVG code, mentally plan:
    1. What elements are needed (shapes, labels, arrows)?
    2. Approximate positions in an 800×400 viewBox — sketch left-to-right
       or top-to-bottom to avoid overlap
    3. What text labels each element needs (minimum 13px font)

    Then generate SVG that meets ALL of these:
    - viewBox="0 0 800 400" always
    - <rect width="800" height="400" fill="#F8FAFC"/> as first element
    - Every shape has a corresponding <text> label
    - No elements overlap
    - Arrows use <defs><marker> arrowheads
    - Colors: #2563EB blue, #1E40AF dark blue, #16A34A green, #D97706 amber, #DC2626 red

    For algorithm / data structure SVGs:
    Show step-by-step state, not a snapshot. Sorting: show array at each
    significant pass as horizontal labelled boxes stacked vertically,
    current comparison pair highlighted, sorted elements in green.
    Tree traversal: colour-code visited nodes by order.
    Linked list: show before and after pointer states with arrows.
    The diagram must teach the algorithm without any text alongside it.
    </svg_quality_rules>
    Set diagramCaption to 1-2 sentence explanation.
    Leave imagenPrompt and mermaidCode as undefined.

  If renderType is "mermaid":
    Generate valid Mermaid diagram code in "mermaidCode" field.
    Supported types: flowchart, graph, sequenceDiagram, stateDiagram.
    Keep it clean — max 15 nodes for readability.
    Set diagramCaption to 1-2 sentence explanation.
    Leave svgCode and imagenPrompt as undefined.
    Example:
    "mermaidCode": "flowchart TD\\n  A[Input] --> B{Decision}\\n  B -->|Yes| C[Output A]\\n  B -->|No| D[Output B]"

  MERMAID SYNTAX RULES — these will cause parse failures if violated:
  - Never use parentheses () inside edge labels: |like (this)| ✗ → |like this| ✓
  - Never use curly braces {} inside edge labels
  - Never use subscript notation with underscore in labels: |Q_in| ✗ → |Qin| ✓
  - Keep edge labels short — max 4 words
  - Use only: letters, numbers, spaces, hyphens, colons inside labels

  If renderType is "imagen":
    Generate a detailed image generation prompt in "imagenPrompt" field.
    Describe: what the object/scene is (use its specific name),
    viewpoint (cross-section, isometric, cutaway, anterior view, etc.),
    key components to label, style (technical illustration or anatomical diagram),
    background (white or light neutral), and level of detail.

    <imagen_examples>
    The imagenPrompt must be a NARRATIVE PARAGRAPH describing what to
    illustrate — not a keyword list. Narrative descriptions produce
    significantly better image quality.

    Medical anatomy:
    "imagenPrompt": "An anterior view anatomical illustration of the human
    heart showing all four chambers in accurate proportion. The right atrium
    receives blood from the superior and inferior vena cava. The left atrium
    connects to the four pulmonary veins. The right and left ventricles are
    shown with the interventricular septum clearly visible. All four valves
    are labelled: tricuspid, mitral, aortic, and pulmonary. The left anterior
    descending, circumflex, and right coronary arteries are shown on the
    surface. Medical illustration style, white background, publication quality."

    Engineering equipment:
    "imagenPrompt": "A cutaway isometric illustration of a centrifugal pump
    showing its internal geometry. The transparent casing reveals the rotating
    impeller with curved vanes drawing fluid axially through the inlet eye and
    expelling it radially into the volute casing. The shaft, bearings, and
    discharge port are all visible and labelled. Flow arrows show the complete
    fluid path. Technical engineering illustration style, white background,
    high contrast labels."

    Mechanical assembly:
    "imagenPrompt": "A 3D exploded view of a ball bearing assembly showing each
    component separated along the central axis for clarity. Moving outward from
    centre: inner race, steel balls evenly spaced in the cage/retainer, outer
    race, and rubber seals on both sides. Component labels point to each part
    with clean leader lines. The illustration communicates how the components
    nest together. Engineering technical illustration, white background."

    Cellular biology:
    "imagenPrompt": "A detailed cross-section illustration of a eukaryotic animal
    cell cut through the centre to reveal all major organelles. The nucleus
    occupies the centre, showing the nuclear envelope with pores and a visible
    nucleolus. Mitochondria, rough and smooth endoplasmic reticulum, Golgi
    apparatus, lysosomes, and the plasma membrane are all shown in their correct
    relative positions and sizes. Each organelle uses a distinct pastel colour
    and carries a label. Scientific textbook illustration style, white background."

    CS/Hardware:
    "imagenPrompt": "A cutaway cross-section illustration of a modern CPU chip
    package revealing its internal layer stack. From top to bottom: the metal
    integrated heat spreader, thermal compound layer, silicon die showing
    processor cores as rectangular regions, organic substrate, solder bumps,
    and PCB connection pads. Each layer is colour-coded and labelled with a
    clean leader line. Technical illustration style, white background,
    publication quality."

    Management/Strategy:
    "imagenPrompt": "A clean isometric 3D business diagram showing a supply chain
    network. On the left, a supplier warehouse feeds into a central manufacturing
    facility. From there, two distribution centres branch out to multiple retail
    stores on the right. Blue arrows show physical material flow; orange dashed
    arrows show information flow in the reverse direction. Every node is labelled.
    Professional business illustration style, white background."
    </imagen_examples>

    Leave svgCode and mermaidCode as undefined.
    Set diagramCaption to 1-2 sentence explanation.
- \"example\" slides:
  - example.problem: max 180 characters. State ONLY the given values and what to find.
    Format: "Given: [values]. Find: [what to calculate]."
  - example.steps: EXACTLY 4-6 steps. Each step max 100 characters.
    Format: "Step N: [formula used] = [substitution] = [result with units]."
    Example: "Step 2: A₂ = π(0.075)²/4 = 0.00442 m²."
    NO explanations of why — just show the calculation.
  - example.answer: max 80 characters. Final value + units only.
    Example: "The average velocity at section 2 is 6.78 m/s."
  <example_accuracy_rules>
  Worked examples must use real, consistent numbers throughout.
  Before writing the answer, verify your calculation is correct for your inputs.

  Domain-appropriate formats:
  - STEM/Engineering: given values → formula identification → substitution →
    result with correct units
  - Medical: patient data → clinical reasoning steps → interpretation →
    management decision
  - Management: scenario data → framework application → insight → implication
  - Humanities: source/context → analysis → interpretation → significance

  Unit consistency check: After verifying each step arithmetically,
  confirm that units are consistent through every step, especially
  when converting between J and kJ, m/s and km/h, kPa and Pa.
  If a step converts kJ to J or vice versa, the unit label must
  change accordingly. Writing "4514 kJ / 373 K = 12.10 J/K" is
  a unit error — the result unit must match the input units.

  MCQ VALIDATION (for practice slides — mandatory):
  After calculating the correct answer, write that value down first, then
  construct four options ensuring option A, B, C, or D exactly matches
  that calculated value. If your draft options don't include the correct
  answer, replace the nearest option with it. A question where no option
  equals the correct answer is invalid and actively harms students.
  When the correct answer is a decimal (e.g., 0.333), round it
  to match the precision of the options before selecting the answer.
  If 0.333 rounds to 0.3, select the option containing 0.3.
  Design the four options such that only one option is within ±15%
  of the correct answer — if your draft options have two options
  within ±15%, replace the closer one with a value further away.
  </example_accuracy_rules>
- \"practice\" slides:
PRACTICE ANSWER RULE: The correct answer and all wrong answer 
options must only reference concepts, algorithms, or terms that 
appear earlier in this presentation's outline. Never introduce 
a new term in an answer option without it having been taught.
  - question.text: max 200 characters. Question + necessary data only.
  - question.options: 4 options, each max 40 characters.
  - question.answer: the letter only: "A", "B", "C", or "D"
  - question.explanation: must show the KEY calculation step, not just restate the method. Max 150 chars.
    BAD: "Apply momentum equation in x-direction."
    GOOD: "ṁ = ρAV = 1000×0.005×20 = 100 kg/s; Fx = ṁ×ΔVx = 100×(0-20) = -2000 N."
    Always include at least one number being substituted.
- \"summary\" slides — 6-8 bullets.
  Each bullet: max 100 characters. One key takeaway per bullet.
  Format: "Key concept: [one-line takeaway]."

INPUT SLIDES (DO NOT CHANGE index OR type, only fill content based on title and syllabus):
${slidesJson}

OUTPUT:
Return ONLY a JSON array of SlideContent objects (no wrapper object, no markdown, no backticks).
Each SlideContent must match this TypeScript shape:
{
  "type": "title" | "overview" | "concept" | "diagram" | "example" | "practice" | "summary",
  "title": "string",
  "bullets"?: string[],
  "svgCode"?: string,
  "mermaidCode"?: string,
  "imagenPrompt"?: string,
  "imageBase64"?: null,
  "diagramCaption"?: string,
  "example"?: { "problem": string, "steps": string[], "answer": string },
  "question"?: { "text": string, "options"?: string[], "answer": string, "explanation": string },
  "note"?: string
}
For diagram slides: only populate the field matching the slide's renderType (svgCode, mermaidCode, or imagenPrompt). Always set imageBase64 to null.

VERY IMPORTANT:
- The returned array length must equal the number of input slides.
- Preserve the order of slides exactly as in the input.
- Do NOT include any text before or after the JSON array.

Remember: Your entire response must be parseable by JSON.parse().
Start with [ and end with ]. Nothing else.`;
}

// Existing full JSON prompt (may be used in other flows)
// ── FULL PPT PROMPT (LEGACY) ──────────────────────────────

export function buildPPTPrompt(options: {
  subjectName: string;
  subjectCode: string;
  syllabusContent: string;
  moduleName?: string;
  customTopic?: string;
  depth: "basic" | "intermediate" | "advanced";
}): string {
  const {
    subjectName,
    subjectCode,
    syllabusContent,
    moduleName,
    customTopic,
    depth,
  } = options;

  const topic = moduleName ?? customTopic ?? "the module";

  const depthRules = {
    basic:
      "Use simple language, basic examples, and avoid heavy math. Focus on intuition.",
    intermediate:
      "Use standard university level. Include complete derivations where applicable.",
    advanced:
      "Use rigorous treatment. Include edge cases and industry applications where relevant.",
  };

  const svgGuidance = `
For SVG diagram slides:
- Generate complete, valid SVG code with viewBox="0 0 800 500".
- Use clean colors: #2563EB (blue), #1E40AF (dark blue), #16A34A (green), #D97706 (amber), #DC2626 (red), #6B7280 (gray), white backgrounds.
- Include clear text labels inside the SVG using <text> elements.
- Add arrows using <defs><marker> for arrowheads.
- For Mechanical engineering: P-V diagrams, T-S diagrams, cycle diagrams, free body diagrams, cross-sections, system schematics.
- For Chemical engineering: molecular bond diagrams, reaction pathway arrows, energy level diagrams, apparatus schematics, structural formulas.
- SVG must be self-contained, no external references.
- Set diagramCaption to a 1-2 sentence explanation of what the diagram shows.
`;

  return `You are an expert educational content creator. Generate a comprehensive presentation in JSON format for ${subjectName} (${subjectCode}).

SYLLABUS CONTENT:
${syllabusContent}

TASK:
Create a presentation on: ${topic}
Depth level: ${depth}. ${depthRules[depth]}

Generate as many slides as the content genuinely requires.
The rule is: every major concept gets its own concept slide +
a worked example slide. Complex concepts that benefit from a
visual get a diagram slide. Do not add filler slides to hit
a number — but do not skip concepts either.

For a topic with 3 concepts: expect ~12-15 slides total.
For a module with 8 concepts: expect ~28-35 slides total.
Let the syllabus content determine the count.

Always include:
- 1 title slide
- 1 overview slide
- Concept + example slides for each major topic
- Diagram slide where a visual genuinely helps understanding
- 2-3 practice question slides
- 1 summary slide

SLIDE STRUCTURE (follow this order):
1. Title slide (1 slide) — type: "title", title: presentation title
2. Overview/Agenda slide (1 slide) — type: "overview", list all concepts covered in bullets
3. For EACH major concept in the topic:
   a. Concept slide (type: "concept") — definition, key points, real-world relevance
   b. Deep-dive slide (type: "concept") — detailed explanation, formula derivations if applicable
   c. SVG diagram slide (type: "diagram") — visual representation; include svgCode and diagramCaption
   d. Worked example slide (type: "example") — complete step-by-step numerical/theoretical solution with example: { problem, steps[], answer }
   e. Another worked example if the concept has multiple applications
4. Concept comparison slide where applicable (type: "concept") — comparing 2+ related concepts
5. Practice questions (3-5 slides, type: "practice") — one question per slide with question: { text, options?, answer, explanation }
6. Summary slide (1 slide, type: "summary") — key takeaways in bullets

CONTENT RULES:
- Every worked example must show COMPLETE step-by-step solution (steps array with each step as a full sentence).
- Practice questions must vary: numerical, conceptual, application-based. Use options for MCQ.
- Use real-world applications relevant to ${subjectName}.
- Bullet points should be complete sentences, not just keywords.
- For "concept" slides you may include an optional "note" field for a short callout.
${svgGuidance}

OUTPUT:
Return ONLY a valid JSON object. No markdown, no backticks, no text outside the JSON.
The JSON must match this TypeScript interface exactly:
{
  "presentationTitle": "string",
  "subject": "string",
  "topic": "string",
  "slides": [
    {
      "type": "title" | "overview" | "concept" | "diagram" | "example" | "practice" | "summary",
      "title": "string",
      "bullets": ["optional array of strings"],
      "svgCode": "optional full SVG string for diagram slides",
      "diagramCaption": "optional for diagram slides",
      "example": { "problem": "", "steps": [], "answer": "" },
      "question": { "text": "", "options": [], "answer": "", "explanation": "" },
      "note": "optional string"
    }
  ]
}`;
}

// ── PPTX GENERATOR ─────────────────────────────────────────

const C = {
  primary: "2563EB",
  dark: "1E40AF",
  accent: "DBEAFE",
  success: "16A34A",
  warning: "D97706",
  danger: "DC2626",
  textDark: "1E293B",
  textMuted: "64748B",
  white: "FFFFFF",
  lightGray: "F8FAFC",
  border: "E2E8F0",
} as const;

function stripMd(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1") // bold
    .replace(/\*(.*?)\*/g, "$1") // italic
    .replace(/`(.*?)`/g, "$1") // code
    .trim();
}

function svgToBase64(svg: string): string {
  const cleaned = svg
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\r\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .trim();
  const withNs = cleaned.includes("xmlns=")
    ? cleaned
    : cleaned.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  return `data:image/svg+xml;base64,${Buffer.from(withNs, "utf-8").toString("base64")}`;
}

function isValidSVG(svg: string): boolean {
  return Boolean(svg && svg.length > 100 && svg.includes("<svg") && svg.includes("viewBox"));
}

function addHeaderBar(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  title: string,
  bgColor: string
): void {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: "100%",
    h: 1.1,
    fill: { color: bgColor },
  });
  slide.addText(title, {
    x: 0.3,
    y: 0.1,
    w: 9,
    h: 0.9,
    fontSize: 26,
    bold: true,
    color: C.white,
    fontFace: "Calibri",
  });
}

// ── PPTX GENERATOR (16:9, 10x5.625) ─────────────────────

const SLIDE_W = 10;
const SLIDE_H = 5.625;

const ZONE = {
  header: { x: 0, y: 0, w: 10, h: 0.82 },
  body: { x: 0.35, y: 0.95, w: 9.3, h: 3.85 },
  footer: { x: 0, y: 5.1, w: 10, h: 0.525 },
  accent: { x: 0, y: 0.82, w: 0.07, h: 4.28 },
} as const;

const FONT = {
  title: { size: 22, bold: true },
  subtitle: { size: 16, bold: true },
  body: { size: 14, bold: false },
  small: { size: 11, bold: false },
  tiny: { size: 10, bold: false },
} as const;

const MAX_BULLETS_PER_SLIDE = 7;
const MAX_BULLET_CHARS = 160;

function cap(text: string, _max = MAX_BULLET_CHARS): string {
  if (!text) return "";
  return stripMd(text);
}

function capTitle(text: string, max = 90): string {
  if (!text) return "";
  const clean = stripMd(text);
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function capBullet(text: string): string {
  if (!text) return "";
  const cleaned = stripMd(text);
  // Hard cap at 130 chars for bullets to prevent overflow
  return cleaned.length > 130 ? `${cleaned.slice(0, 127)}…` : cleaned;
}

function capStep(text: string): string {
  if (!text) return "";
  const cleaned = stripMd(text);
  return cleaned.length > 110 ? `${cleaned.slice(0, 107)}…` : cleaned;
}

function capAnswer(text: string): string {
  if (!text) return "";
  const cleaned = stripMd(text);
  return cleaned.length > 90 ? `${cleaned.slice(0, 87)}…` : cleaned;
}

/** Practice explanation: strip markdown and cap for rendering (prompt allows up to 150). */
function capExplanation(text: string): string {
  if (!text) return "";
  const cleaned = stripMd(text);
  return cleaned.length > 160 ? `${cleaned.slice(0, 157)}…` : cleaned;
}

function capNote(text: string): string {
  if (!text) return "";
  const cleaned = stripMd(text);
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}…` : cleaned;
}

function capProblem(text: string): string {
  if (!text) return "";
  const cleaned = stripMd(text);
  return cleaned.length > 180 ? `${cleaned.slice(0, 177)}…` : cleaned;
}

function splitToBullets(raw: string | string[]): string[] {
  const input = Array.isArray(raw) ? raw : [raw];
  return input
    .flatMap((b) => b.split(/\n+/))
    .map((b) => b.replace(/^[\s\-–—•*]+/, "").trim())
    .filter((b) => b.length > 3)
    .slice(0, 7);
}

/** Normalize AI bullet arrays: split on newlines, trim, drop short lines, max 7. */
function normalizeSlideBullets(bullets: string[] | undefined): string[] {
  return (bullets ?? [])
    .flatMap((b: string) => b.split("\n"))
    .map((b: string) => b.replace(/^\s+/, ""))
    .filter((b: string) => b.trim().length > 3)
    .slice(0, 7);
}

/** Collapse newlines/spaces in a single bullet line for PPTX; drop tiny fragments. */
function cleanBulletLineForPpt(rawBullet: string): string | null {
  const cleanText = rawBullet
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (cleanText.length < 3) return null;
  return cleanText;
}

function isEquation(text: string): boolean {
  const hasLhsSymbol = /[A-ZΦψρṁγ∂∇][₀-₉A-Za-z]?\s*=/.test(text);
  const hasRhsValue =
    /=\s*[-\d√∫(]/.test(text) || /=\s*[A-Z][₀-₉]/.test(text);
  const notTooLong = text.length < 90;
  const notSentence = text.split(" ").length < 12;
  return (hasLhsSymbol || hasRhsValue) && notTooLong && notSentence;
}

function chunkBullets(bullets: string[]): string[][] {
  if (!bullets.length) return [[]];

  const MAX = 7;
  const MIN_LAST_CHUNK = 3; // don't create a cont. slide for < 3 bullets

  if (bullets.length <= MAX) return [bullets];

  const chunks: string[][] = [];
  let i = 0;

  while (i < bullets.length) {
    const remaining = bullets.length - i;

    // If remaining fits in one chunk, take it all
    if (remaining <= MAX) {
      // But if this would create a tiny orphan continuation,
      // redistribute: split previous chunk to balance
      if (remaining < MIN_LAST_CHUNK && chunks.length > 0) {
        const prev = chunks[chunks.length - 1];
        const combined = [...prev, ...bullets.slice(i)];
        const half = Math.ceil(combined.length / 2);
        chunks[chunks.length - 1] = combined.slice(0, half);
        chunks.push(combined.slice(half));
      } else {
        chunks.push(bullets.slice(i));
      }
      break;
    }

    chunks.push(bullets.slice(i, i + MAX));
    i += MAX;
  }

  return chunks.length ? chunks : [[]];
}

function addHeader(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  title: string,
  bgColor: string,
  textColor = C.white
) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: ZONE.header.h,
    fill: { color: bgColor },
    line: { color: bgColor },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: ZONE.header.h - 0.04,
    w: SLIDE_W,
    h: 0.04,
    fill: { color: C.dark },
    line: { color: C.dark },
  });
  slide.addText(capTitle(title, 90), {
    x: ZONE.header.x + 0.25,
    y: 0,
    w: ZONE.header.w - 0.5,
    h: ZONE.header.h,
    fontSize: FONT.title.size,
    bold: true,
    color: textColor,
    fontFace: "Calibri",
    valign: "middle",
    wrap: true,
    autoFit: true,
  });
}

function addAccentBar(slide: PptxGenJS.Slide, color: string) {
  slide.addShape("rect", {
    x: 0,
    y: ZONE.accent.y,
    w: ZONE.accent.w,
    h: ZONE.accent.h,
    fill: { color },
    line: { color },
  });
}

function addPageNumber(
  slide: PptxGenJS.Slide,
  num: number,
  total: number
): void {
  slide.addText(`${num} / ${total}`, {
    x: 8.5,
    y: 5.35,
    w: 1.2,
    h: 0.25,
    fontSize: 9,
    color: C.textMuted,
    align: "right",
    fontFace: "Calibri",
  });
}

export async function generatePPTXBuffer(
  data: PPTSlideJSON
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = data.presentationTitle;
  pptx.subject = data.subject;

  let totalCostInr = 0;
  // Add this to accumulate costs — caller passes AI costs in via data
  // We track imagen cost here per-image

  // Estimate total slides (concept slides may fan out)
  let estimatedTotal = 0;
  for (const s of data.slides) {
    if (!s || typeof s !== "object") continue;
    if (s.type === "concept") {
      const chunks = chunkBullets(splitToBullets(s.bullets ?? []));
      estimatedTotal += Math.max(1, chunks.length);
    } else {
      estimatedTotal += 1;
    }
  }
  const totalSlides = Math.max(1, estimatedTotal);

  let slideNum = 1;
  let practiceNum = 0;

  for (const slideData of data.slides) {
    if (!slideData || typeof slideData !== "object") continue;
    switch (slideData.type) {
      case "title": {
        const slide = pptx.addSlide();

        slide.addShape(pptx.ShapeType.rect, {
          x: 0,
          y: 0,
          w: SLIDE_W,
          h: SLIDE_H,
          fill: { color: C.primary },
          line: { color: C.primary },
        });
        slide.addShape(pptx.ShapeType.rect, {
          x: 0,
          y: 3.8,
          w: SLIDE_W,
          h: SLIDE_H - 3.8,
          fill: { color: C.dark },
          line: { color: C.dark },
        });

        slide.addShape(pptx.ShapeType.rect, {
          x: 8.5,
          y: 0,
          w: 1.5,
          h: 0.06,
          fill: { color: C.accent },
          line: { color: C.accent },
        });
        slide.addShape(pptx.ShapeType.rect, {
          x: 9.94,
          y: 0,
          w: 0.06,
          h: 1.5,
          fill: { color: C.accent },
          line: { color: C.accent },
        });

        slide.addText(capTitle(slideData.title, 80), {
          x: 0.6,
          y: 1.0,
          w: 8.8,
          h: 2.2,
          fontSize: 34,
          bold: true,
          color: C.white,
          fontFace: "Calibri",
          align: "center",
          valign: "middle",
          wrap: true,
          autoFit: true,
        });

        slide.addShape(pptx.ShapeType.rect, {
          x: 2,
          y: 3.5,
          w: 6,
          h: 0.04,
          fill: { color: C.accent },
          line: { color: C.accent },
        });

        slide.addText(capTitle(data.subject), {
          x: 0.6,
          y: 3.6,
          w: 8.8,
          h: 0.5,
          fontSize: 16,
          color: C.accent,
          fontFace: "Calibri",
          align: "center",
          wrap: true,
          autoFit: true,
        });

        slide.addText(capTitle(data.topic, 60), {
          x: 0.6,
          y: 4.1,
          w: 8.8,
          h: 0.4,
          fontSize: 12,
          color: "BFDBFE",
          fontFace: "Calibri",
          align: "center",
          italic: true,
        });

        if (data.addLogo && data.logoUrl) {
          try {
            const logoPath = data.logoUrl.startsWith("/")
              ? path.join(process.cwd(), "public", data.logoUrl.replace(/^\//, ""))
              : data.logoUrl;
            slide.addImage({
              path: logoPath,
              x: SLIDE_W - 1.9,
              y: 0.12,
              w: 1.6,
              h: 0.58,
              sizing: { type: "contain", w: 1.6, h: 0.58 },
            });
          } catch (err) {
            console.warn("[ppt] Logo failed:", err);
          }
        }

        addPageNumber(slide, slideNum, totalSlides);
        slideNum += 1;
        break;
      }

      case "overview": {
        const slide = pptx.addSlide();
        addHeader(pptx, slide, `Overview — ${data.topic}`, C.primary);
        addAccentBar(slide, "60A5FA");

        const overviewBullets = splitToBullets(slideData.bullets ?? []);
        const half = Math.ceil(overviewBullets.length / 2);
        const col1 = overviewBullets.slice(0, half);
        const col2 = overviewBullets.slice(half);

        const overviewBulletBase = {
          bullet: { code: "2022", indent: 15 } as any,
          fontSize: 13,
          color: "1e293b",
          breakLine: true,
          paraSpaceBefore: 3,
        };

        slide.addText(
          col1.map((b) => ({
            text: cap(b),
            options: { ...overviewBulletBase },
          })),
          {
            x: 0.4,
            y: ZONE.body.y,
            w: 4.4,
            h: ZONE.body.h,
            fontFace: "Calibri",
            valign: "top",
            wrap: true,
            autoFit: true,
          }
        );

        if (col2.length > 0) {
          slide.addText(
            col2.map((b) => ({
              text: cap(b),
              options: { ...overviewBulletBase },
            })),
            {
              x: 5.1,
              y: ZONE.body.y,
              w: 4.6,
              h: ZONE.body.h,
              fontFace: "Calibri",
              valign: "top",
              wrap: true,
              autoFit: true,
            }
          );
        }

        addPageNumber(slide, slideNum, totalSlides);
        slideNum += 1;
        break;
      }

      case "concept": {
        const chunks = chunkBullets(splitToBullets(slideData.bullets ?? []));
        chunks.forEach((chunk, idx) => {
          const slide = pptx.addSlide();
          const titleText =
            idx === 0 ? slideData.title : `${slideData.title} (cont.)`;

          addHeader(pptx, slide, titleText, C.primary);
          addAccentBar(slide, C.accent);

          slide.addShape("rect", {
            x: 0,
            y: ZONE.header.h,
            w: SLIDE_W,
            h: SLIDE_H - ZONE.header.h,
            fill: { color: C.lightGray },
            line: { color: C.lightGray },
          });

          slide.addShape("rect", {
            x: ZONE.body.x,
            y: ZONE.body.y - 0.05,
            w: ZONE.body.w,
            h: ZONE.body.h + 0.1,
            fill: { color: C.white },
            line: { color: C.border, width: 0.75 },
            shadow: {
              type: "outer",
              blur: 3,
              offset: 2,
              angle: 45,
              color: "CBD5E1",
              opacity: 0.5,
            },
          });

          const hasNote = Boolean(slideData.note) && idx === chunks.length - 1;
          const bullets = splitToBullets(chunk);
          const count = bullets.length;
          const fontSize =
            count <= 4 ? 18 : count <= 5 ? 17 : count <= 6 ? 16 : 14;
          const paraSpaceBefore =
            count <= 4 ? 18 : count <= 5 ? 14 : count <= 6 ? 10 : 7;
          const paraSpaceAfter =
            count <= 4 ? 5 : count <= 5 ? 4 : count <= 6 ? 3 : 2;
          const formulaBullet = bullets.find((b) => isEquation(b));
          const hasFormula = Boolean(formulaBullet);
          let bodyHeight = hasNote ? ZONE.body.h - 0.7 : ZONE.body.h - 0.15;
          if (hasFormula) bodyHeight -= 0.65;

          slide.addText(
            bullets.map((b) => ({
              text: capBullet(b),
              options: {
                bullet: { code: "2022", indent: 15 } as any,
                fontSize,
                color: "1e293b",
                breakLine: true,
                paraSpaceBefore,
                paraSpaceAfter,
              } as any,
            })),
            {
              x: ZONE.body.x,
              y: ZONE.body.y,
              w: ZONE.body.w,
              h: bodyHeight,
              fontFace: "Calibri",
              valign: "middle",
              autoFit: true,
            }
          );

          if (hasFormula && formulaBullet) {
            const formulaText = formulaBullet
              .replace(/^[^:]+:\s*/, "")
              .trim();
            slide.addShape("rect", {
              x: ZONE.body.x + 0.2,
              y: ZONE.body.y + ZONE.body.h - 1.0,
              w: ZONE.body.w - 0.4,
              h: 0.55,
              fill: { color: "1E3A5F" },
              line: { color: "2563EB", width: 1.5 },
            });
            slide.addText(capBullet(formulaText), {
              x: ZONE.body.x + 0.3,
              y: ZONE.body.y + ZONE.body.h - 1.0,
              w: ZONE.body.w - 0.6,
              h: 0.55,
              fontSize: 13,
              fontFace: "Calibri",
              color: "FFFFFF",
              bold: true,
              align: "center",
              valign: "middle",
              wrap: true,
              autoFit: true,
            });
          }

          if (slideData.note && idx === chunks.length - 1) {
            const noteText = (slideData.note ?? "")
              .split(/\n/)[0]
              .replace(/^💡\s*/g, "")
              .replace(/ — /g, ". ")
              .trim();
            const tipFinal =
              noteText.length > 3 ? `💡  ${capNote(noteText)}` : "";
            if (tipFinal) {
              slide.addShape("rect", {
                x: 0,
                y: SLIDE_H - 0.5,
                w: SLIDE_W,
                h: 0.5,
                fill: { color: C.accent },
                line: { color: C.accent },
              });
              slide.addText(tipFinal, {
                x: 0.3,
                y: SLIDE_H - 0.5,
                w: 9.4,
                h: 0.5,
                fontSize: 10,
                italic: true,
                color: C.dark,
                fontFace: "Calibri",
                valign: "middle",
                wrap: true,
                autoFit: true,
              });
            }
          }

          addPageNumber(slide, slideNum, totalSlides);
          slideNum += 1;
        });
        break;
      }

      case "diagram": {
        const slide = pptx.addSlide();
        addHeader(pptx, slide, slideData.title, "0F766E");

        slide.addShape("rect", {
          x: 0,
          y: ZONE.header.h,
          w: SLIDE_W,
          h: SLIDE_H - ZONE.header.h,
          fill: { color: C.lightGray },
          line: { color: C.lightGray },
        });

        const hasCaption = Boolean(slideData.diagramCaption);
        const captionBarY = SLIDE_H - 0.52;
        const imgAreaH = hasCaption
          ? captionBarY - ZONE.body.y - 0.05
          : SLIDE_H - ZONE.body.y - 0.12;

        // PRIORITY 1: Imagen-generated image (base64 PNG)
        if (slideData.imageBase64) {
          slide.addImage({
            data: `data:image/png;base64,${slideData.imageBase64}`,
            x: ZONE.body.x,
            y: ZONE.body.y,
            w: ZONE.body.w,
            h: imgAreaH,
            sizing: { type: "contain", w: ZONE.body.w, h: imgAreaH },
          });
        }
        // PRIORITY 2: SVG diagram
        else if (isValidSVG(slideData.svgCode ?? "")) {
          slide.addImage({
            data: svgToBase64(slideData.svgCode!),
            x: ZONE.body.x,
            y: ZONE.body.y,
            w: ZONE.body.w,
            h: imgAreaH,
            sizing: { type: "contain", w: ZONE.body.w, h: imgAreaH },
          });
        }
        // PRIORITY 3: Mermaid code — render via mermaid.ink
        else if (slideData.mermaidCode) {
          try {
            const safeMermaid = sanitizeMermaidCode(
              slideData.mermaidCode.trim()
            );
            const encoded = Buffer.from(safeMermaid, "utf-8")
              .toString("base64")
              .replace(/\+/g, "-")
              .replace(/\//g, "_")
              .replace(/=/g, "");
            const mermaidUrl = `https://mermaid.ink/img/${encoded}?type=png&bgColor=white`;
            const res = await fetch(mermaidUrl, {
              signal: AbortSignal.timeout(8000),
            });
            if (res.ok) {
              const buf = await res.arrayBuffer();
              const b64 = Buffer.from(buf).toString("base64");
              slide.addImage({
                data: `data:image/png;base64,${b64}`,
                x: ZONE.body.x,
                y: ZONE.body.y,
                w: ZONE.body.w,
                h: imgAreaH,
                sizing: { type: "contain", w: ZONE.body.w, h: imgAreaH },
              });
            } else {
              throw new Error("mermaid.ink failed");
            }
          } catch {
            // Fallback to caption-only
            slide.addShape("rect", {
              x: ZONE.body.x,
              y: ZONE.body.y,
              w: ZONE.body.w,
              h: imgAreaH,
              fill: { color: "E0F2FE" },
              line: { color: "7DD3FC", width: 1 },
            });
            slide.addText(
              `📊 ${cap(slideData.diagramCaption ?? slideData.title, 300)}`,
              {
                x: 0.7,
                y: ZONE.body.y + 0.5,
                w: 8.6,
                h: imgAreaH - 1,
                fontSize: 13,
                color: "075985",
                fontFace: "Calibri",
                valign: "middle",
                wrap: true,
                autoFit: true,
                lineSpacingMultiple: 1.6,
              }
            );
          }
        }
        // PRIORITY 4: No visual — show caption or placeholder
        else {
          slide.addShape("rect", {
            x: ZONE.body.x,
            y: ZONE.body.y,
            w: ZONE.body.w,
            h: imgAreaH,
            fill: { color: "F1F5F9" },
            line: { color: "CBD5E1", width: 1 },
          });
          slide.addText(
            slideData.diagramCaption
              ? `📊 ${cap(slideData.diagramCaption, 400)}`
              : `[ Visual: ${capTitle(slideData.title, 50)} ]`,
            {
              x: 0.7,
              y: ZONE.body.y + 0.5,
              w: 8.6,
              h: imgAreaH - 1,
              fontSize: 13,
              color: "94A3B8",
              fontFace: "Calibri",
              align: "center",
              valign: "middle",
              wrap: true,
              autoFit: true,
            }
          );
        }

        // Caption bar (shown for all render types)
        if (hasCaption && slideData.diagramCaption) {
          slide.addShape("rect", {
            x: 0,
            y: SLIDE_H - 0.52,
            w: SLIDE_W,
            h: 0.52,
            fill: { color: "0E7490" },
            line: { color: "0E7490" },
          });
          slide.addText(`📊 ${cap(slideData.diagramCaption, 130)}`, {
            x: 0.3,
            y: SLIDE_H - 0.52,
            w: 9.4,
            h: 0.52,
            fontSize: 11,
            italic: true,
            color: C.white,
            fontFace: "Calibri",
            valign: "middle",
            wrap: true,
            autoFit: true,
          });
        }

        addPageNumber(slide, slideNum, totalSlides);
        slideNum += 1;
        break;
      }

      case "example": {
        const slide = pptx.addSlide();
        slide.addShape("rect", {
          x: 0,
          y: 0,
          w: SLIDE_W,
          h: SLIDE_H,
          fill: { color: "F0FDF4" },
          line: { color: "F0FDF4" },
        });
        addHeader(
          pptx,
          slide,
          `📝 ${capTitle(slideData.title, 70)}`,
          C.success
        );

        const ex = slideData.example;
        if (ex) {
          const problemBoxH = 0.9;
          const answerBarH = 0.7;
          const availableH =
            SLIDE_H - ZONE.header.h - problemBoxH - answerBarH - 0.15;

          slide.addShape("rect", {
            x: 0.35,
            y: ZONE.header.h + 0.08,
            w: 9.3,
            h: problemBoxH,
            fill: { color: "DCFCE7" },
            line: { color: C.success, width: 1.5 },
          });
          slide.addText(`Problem: ${capProblem(ex.problem)}`, {
            x: 0.5,
            y: ZONE.header.h + 0.08,
            w: 9.1,
            h: problemBoxH,
            fontSize: 13,
            bold: true,
            color: "14532D",
            fontFace: "Calibri",
            valign: "middle",
            wrap: true,
            autoFit: true,
          });

          const rawSteps = ex.steps ?? slideData.steps ?? [];
          const steps = Array.isArray(rawSteps) ? rawSteps : [String(rawSteps)];

          slide.addText(
            steps.map((step: string, idx: number) => {
              const cleaned = capStep(
                step.replace(/^Step\s*\d+\s*[:\-–]\s*/i, "").trim()
              );
              return {
                text: `Step ${idx + 1}:  ${cleaned}`,
                options: {
                  bullet: false,
                  fontSize: 12,
                  color: "1e293b",
                  breakLine: true,
                  paraSpaceBefore: 5,
                  bold: false,
                } as any,
              };
            }),
            {
              x: ZONE.body.x,
              y: ZONE.header.h + problemBoxH + 0.1,
              w: ZONE.body.w,
              h: availableH,
              fontFace: "Calibri",
              valign: "top",
              autoFit: true,
            }
          );

          slide.addShape("rect", {
            x: 0,
            y: SLIDE_H - answerBarH,
            w: SLIDE_W,
            h: answerBarH,
            fill: { color: C.success },
            line: { color: C.success },
          });
          slide.addText(`✓  ${capAnswer(ex.answer)}`, {
            x: 0.3,
            y: SLIDE_H - answerBarH,
            w: 9.4,
            h: answerBarH,
            fontSize: 14,
            bold: true,
            color: C.white,
            fontFace: "Calibri",
            valign: "middle",
            wrap: true,
            autoFit: true,
          });
        }

        addPageNumber(slide, slideNum, totalSlides);
        slideNum += 1;
        break;
      }

      case "practice": {
        const slide = pptx.addSlide();
        slide.addShape("rect", {
          x: 0,
          y: 0,
          w: SLIDE_W,
          h: SLIDE_H,
          fill: { color: "FFFBEB" },
          line: { color: "FFFBEB" },
        });

        practiceNum += 1;
        addHeader(
          pptx,
          slide,
          "✏️ Practice Question",
          C.warning
        );

        const q = slideData.question;
        if (q) {
          slide.addShape("ellipse", {
            x: 0.35,
            y: 1.0,
            w: 0.55,
            h: 0.55,
            fill: { color: C.warning },
            line: { color: C.warning },
          });
          slide.addText(String(practiceNum), {
            x: 0.35,
            y: 1.0,
            w: 0.55,
            h: 0.55,
            fontSize: 16,
            bold: true,
            color: C.white,
            fontFace: "Calibri",
            align: "center",
            valign: "middle",
          });

          slide.addText(cap(q.text, 200), {
            x: 1.05,
            y: 1.0,
            w: 8.6,
            h: 1.1,
            fontSize: 15,
            bold: true,
            color: C.textDark,
            fontFace: "Calibri",
            valign: "top",
            wrap: true,
            autoFit: true,
            lineSpacingMultiple: 1.3,
          });

          if (q.options && q.options.length) {
            const labels = ["A", "B", "C", "D"];
            const optText = q.options
              .map((opt: string, i: number) => {
                const stripped = opt
                  .replace(/^\([A-Da-d]\)\s*/i, "")
                  .replace(/^[A-Da-d][\.\)]\s*/i, "")
                  .trim();
                return `${labels[i] ?? i + 1}. ${cap(stripped)}`;
              })
              .join("\n");
            slide.addText(optText, {
              x: 0.5,
              y: 2.25,
              w: 9.1,
              h: 1.9,
              fontSize: 13,
              color: C.textMuted,
              fontFace: "Calibri",
              valign: "top",
              wrap: true,
              autoFit: true,
              lineSpacingMultiple: 1.6,
            });
          }

          slide.addShape("rect", {
            x: 0,
            y: SLIDE_H - 0.6,
            w: SLIDE_W,
            h: 0.6,
            fill: { color: C.accent },
            line: { color: C.accent },
          });

          const ansText = q.answer
            ? `Answer: ${capAnswer(q.answer)}${
                q.explanation
                  ? `. ${capExplanation(q.explanation)}`
                  : ""
              }`
            : "";

          slide.addText(ansText, {
            x: 0.3,
            y: SLIDE_H - 0.6,
            w: 9.4,
            h: 0.6,
            fontSize: 11,
            color: C.dark,
            italic: true,
            fontFace: "Calibri",
            valign: "middle",
            wrap: true,
            autoFit: true,
          });
        }

        addPageNumber(slide, slideNum, totalSlides);
        slideNum += 1;
        break;
      }

      case "summary": {
        const slide = pptx.addSlide();
        slide.addShape("rect", {
          x: 0,
          y: 0,
          w: SLIDE_W,
          h: SLIDE_H,
          fill: { color: C.dark },
          line: { color: C.dark },
        });
        slide.addShape("rect", {
          x: 0,
          y: 0,
          w: SLIDE_W,
          h: 0.06,
          fill: { color: C.accent },
          line: { color: C.accent },
        });
        slide.addShape("rect", {
          x: 0,
          y: SLIDE_H - 0.06,
          w: SLIDE_W,
          h: 0.06,
          fill: { color: C.accent },
          line: { color: C.accent },
        });

        slide.addText("Key Takeaways", {
          x: 0.5,
          y: 0.1,
          w: 9,
          h: 0.75,
          fontSize: 28,
          bold: true,
          color: C.white,
          fontFace: "Calibri",
          align: "center",
          valign: "middle",
        });

        slide.addShape("rect", {
          x: 1.5,
          y: 0.85,
          w: 7,
          h: 0.04,
          fill: { color: "60A5FA" },
          line: { color: "60A5FA" },
        });

        const takeawayBullets = splitToBullets(
          slideData.bullets?.length
            ? slideData.bullets
            : ["No key takeaways provided."]
        );
        slide.addText(
          takeawayBullets.map((b) => ({
            text: cap(b),
            options: {
              bullet: false,
              fontSize: 13,
              color: C.white,
              breakLine: true,
              paraSpaceBefore: 10,
            } as any,
          })),
          {
            x: 0.7,
            y: 1.0,
            w: 8.6,
            h: 3.9,
            fontFace: "Calibri",
            valign: "top",
            wrap: true,
            autoFit: true,
          }
        );

        slide.addText(`End of ${capTitle(data.topic, 60)}`, {
          x: 0.5,
          y: SLIDE_H - 0.45,
          w: 9,
          h: 0.35,
          fontSize: 11,
          color: "93C5FD",
          italic: true,
          fontFace: "Calibri",
          align: "center",
        });

        addPageNumber(slide, slideNum, totalSlides);
        slideNum += 1;
        break;
      }
    }
  }

  const result = await pptx.stream();

  if (totalCostInr > 0) {
    console.log(
      `[ppt] Total Imagen cost this deck: ₹${totalCostInr.toFixed(2)}`
    );
  }

  const uint8 =
    result instanceof ArrayBuffer
      ? new Uint8Array(result)
      : result instanceof Uint8Array
        ? result
        : new Uint8Array(0);
  return Buffer.from(uint8);
}

// ── PARSE ──────────────────────────────────────────────────

export function parsePPTJSON(rawText: string): PPTSlideJSON | null {
  try {
    let cleaned = rawText.trim();

    // Strip markdown fences (various formats)
    cleaned = cleaned.replace(/^```json\s*/i, "");
    cleaned = cleaned.replace(/^```\s*/i, "");
    cleaned = cleaned.replace(/\s*```$/i, "");
    cleaned = cleaned.trim();

    // Find the first { and last } to extract just the JSON object
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1) {
      console.error("[parsePPTJSON] No JSON object found in response");
      return null;
    }

    cleaned = cleaned.slice(firstBrace, lastBrace + 1);

    const parsed = JSON.parse(cleaned) as unknown as PPTSlideJSON;

    if (!parsed.slides || !Array.isArray(parsed.slides) || parsed.slides.length < 3) {
      console.error(
        "[parsePPTJSON] Invalid structure, slides count:",
        (parsed as any).slides?.length
      );
      return null;
    }

    console.log("[ppt] Successfully parsed", parsed.slides.length, "slides");
    return parsed;
  } catch (err) {
    console.error(
      "[parsePPTJSON] Parse error:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export function parseOutlineResponse(rawText: string): SlideOutline | null {
  try {
    let cleaned = rawText.trim();
    cleaned = cleaned
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first === -1 || last === -1) return null;
    cleaned = cleaned.slice(first, last + 1);
    const parsed = JSON.parse(cleaned) as SlideOutline;
    if (!parsed.outline || !Array.isArray(parsed.outline)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseBatchContent(rawText: string): SlideContent[] | null {
  try {
    let cleaned = rawText.trim();

    // Strip markdown fences
    cleaned = cleaned.replace(/^```json\s*/i, "");
    cleaned = cleaned.replace(/^```\s*/i, "");
    cleaned = cleaned.replace(/\s*```$/i, "");
    cleaned = cleaned.trim();

    // Find the JSON array boundaries
    const firstBracket = cleaned.indexOf("[");
    const lastBracket = cleaned.lastIndexOf("]");

    if (firstBracket === -1 || lastBracket === -1) {
      console.error("[parseBatchContent] No JSON array found");
      return null;
    }

    cleaned = cleaned.slice(firstBracket, lastBracket + 1);

    // Attempt 1: direct parse
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as SlideContent[];
      }
    } catch {
      // Try repair strategies
    }

    // Attempt 2: fix trailing commas
    const fixedTrailing = cleaned.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
    try {
      const parsed = JSON.parse(fixedTrailing);
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log("[parseBatchContent] Recovered via trailing comma fix");
        return parsed as SlideContent[];
      }
    } catch {}

    // Attempt 3: truncation recovery
    // If JSON is cut off mid-way, try to salvage complete objects
    try {
      // Find all complete slide objects by counting braces
      let depth = 0;
      let inString = false;
      let escape = false;
      let lastCompleteIndex = 1; // after opening [

      for (let i = 1; i < cleaned.length; i++) {
        const char = cleaned[i];

        if (escape) {
          escape = false;
          continue;
        }
        if (char === "\\" && inString) {
          escape = true;
          continue;
        }
        if (char === '"' && !escape) {
          inString = !inString;
          continue;
        }
        if (inString) continue;

        if (char === "{") depth++;
        if (char === "}") {
          depth--;
          if (depth === 0) lastCompleteIndex = i + 1;
        }
      }

      if (lastCompleteIndex > 1) {
        // Reconstruct array with only complete objects
        const partial =
          "[" +
          cleaned
            .slice(1, lastCompleteIndex)
            .replace(/,\s*$/, "") +
          "]";
        const parsed = JSON.parse(partial);
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.log(
            "[parseBatchContent] Recovered",
            parsed.length,
            "slides from truncated JSON"
          );
          return parsed as SlideContent[];
        }
      }
    } catch {}

    console.error("[parseBatchContent] All recovery attempts failed");
    return null;
  } catch (err) {
    console.error("[parseBatchContent] Outer error:", err);
    return null;
  }
}
