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

export interface SlideContent {
  type: SlideType;
  title: string;
  bullets?: string[];
  svgCode?: string;
  diagramCaption?: string;
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
  outline: { index: number; type: SlideType; title: string }[];
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

  return `You are an expert educator creating a professional slide deck for ${subjectName} (${subjectCode}).

Adapt slide types to this subject's nature:
- If STEM/Engineering: use derivations, worked numericals, process diagrams
- If Medical/Health: use clinical cases, anatomical diagrams, diagnostic criteria
- If Architecture/Design: use design principles, spatial diagrams, case studies
- If Management/Commerce: use frameworks, data tables, case analyses
- If Humanities: use thematic analysis, examples, comparative studies

Choose slide types that a domain expert would actually use.

FULL SUBJECT SYLLABUS (for context and cross-referencing):
${syllabusContext}

YOUR FOCUS MODULE: "${focusLabel}"
${moduleDescription.trim() ? `Module description: ${moduleDescription.trim()}` : ""}

Use the full syllabus to:
1. Understand where this module fits in the subject
2. Reference prerequisite concepts correctly
3. Avoid duplicating content from other modules
4. Include cross-references like "As we saw in Unit 1..." where appropriate
${refInline}
TASK: Create a slide OUTLINE (titles + types only, no content yet) for: ${focusLabel}
Depth: ${depth} | Target slide count: ${slideCountGuide}

IMPORTANT: Every slide must be completable in a single batch.
Concept slides: max 7 tight bullets.
Example slides: max 6 calculation steps.
Prefer quality over quantity — fewer slides, richer content.

When the syllabus includes a topic that is explicitly listed with sub-points (derivation, assumptions, applications), that topic MUST get its own dedicated concept slide, not be merged into another topic's slide.
Example: 'Bernoulli's equation' listed with derivation, assumptions, applications → must be its own slide.

MANDATORY TEACHING SEQUENCE — in this exact order:

EULER'S EQUATION IS MANDATORY when syllabus mentions 'Euler' in the dynamics section (NOT the Lagrangian/Eulerian kinematics section — those are different):

Add a concept slide titled exactly:
'Euler's Equation of Motion: Derivation'

This slide must include:
- Newton's 2nd law for fluid element along streamline
- Result: -∂P/∂s - ρg(∂z/∂s) = ρ(DV/Dt)
- For steady flow: -dP/ρ - g·dz = V·dV
- Integration gives Bernoulli's equation (bridge to next slide)

This slide MUST appear BEFORE the Bernoulli slide.
Without it, Bernoulli has no derivation context.

When syllabus includes Bernoulli (fluid dynamics, after Euler above):
2. CONCEPT slide: 'Bernoulli's Equation: Derivation & Assumptions'
   Must derive from Euler's equation by integrating along streamline
   Result: P/γ + V²/2g + z = constant = H (total head)
   Assumptions (ALL must appear): steady, inviscid, incompressible,
   along a streamline, no shaft work, no heat transfer

3. EXAMPLE slide: 'Worked Example: Applying Bernoulli's Equation'
   Use a pipe flow or nozzle problem with numbers
   Show how each assumption is satisfied

These 3 slides are NON-NEGOTIABLE when Bernoulli is in the syllabus.

PRACTICE QUESTION DISTRIBUTION:
Generate one practice question per major topic group:
- One on continuity/flow classification
- One on Bernoulli's equation (MUST include this)
- One on energy equation OR momentum equation
- One on flow measurement (venturimeter OR Pitot tube)

NEVER have all practice questions test the same topic area.

HGL/TEL rule: If HGL/TEL diagram is included,
add a CONCEPT slide BEFORE the diagram explaining:
what HGL represents (P/γ + z), what TEL represents (P/γ + V²/2g + z),
and the vertical distance V²/2g between them.

Pitot tube: If included in syllabus, generate:
1. CONCEPT slide: 'Pitot Tube: Measuring Local Velocity'
   Stagnation vs static pressure, formula: V = √(2ΔP/ρ)
2. DIAGRAM slide showing the tube in a pipe

A diagram without a concept slide teaches nothing.

THERMODYNAMICS SPECIFIC:
If module covers Second Law or Heat Engines:
- MUST include a diagram slide: 'Carnot Cycle: P-V and T-S Diagrams'
  Show 4 processes on P-V plane:
  1→2 Isothermal expansion (at T_H)
  2→3 Adiabatic expansion
  3→4 Isothermal compression (at T_L)
  4→1 Adiabatic compression

This diagram IS the Second Law in visual form.

MANDATORY STRUCTURE per major concept:
  1. concept slide — definition, properties, mathematical basis
  2. concept slide — deeper treatment, derivations, edge cases  
  3. diagram slide — visual that genuinely aids understanding
  4. example slide — numerical or theoretical worked example
  5. example slide — second worked example (different application)

GLOBAL REQUIREMENTS:
  - Start with: 1 title slide + 1 overview slide
  - End with: 2–3 practice slides + 1 summary slide
  - Every formula-heavy concept gets a dedicated diagram slide
  - Comparison slides where 2+ concepts are contrasted
  - Do NOT add filler — every slide must serve a clear purpose
  - Do NOT skip concepts from the syllabus content

SLIDE TYPE RULES:
  title    — opening slide only (1 total)
  overview — agenda only (1 total)
  concept  — any explanatory content, theory, derivations, comparisons
  diagram  — SVG visual only (equations, processes, structures, cycles)
  example  — worked problem with full solution
  practice — student practice question with answer
  summary  — final takeaways only (1 total)

OUTPUT: Return ONLY valid JSON, no markdown, no backticks:
{
  "presentationTitle": "string",
  "subject": "string",
  "topic": "string",
  "outline": [
    { "index": 0, "type": "title", "title": "string" },
    ...
  ]
}
Indexes must start at 0 and increment sequentially with no gaps.`;
}

export function buildBatchContentPrompt(options: {
  subjectName: string;
  /** Full subject syllabus; first 3000 chars used for batch context. */
  fullSyllabus: string;
  depth: string;
  slides: { index: number; type: SlideType; title: string }[];
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
    })),
    null,
    2
  );

  return `CRITICAL OUTPUT RULES — VIOLATION WILL CAUSE SYSTEM FAILURE:
1. Return ONLY a valid JSON array. Nothing else.
2. Start your response with [ and end with ]
3. No text before the [
4. No text after the ]
5. No markdown fences (no \`\`\`)
6. No comments inside JSON
7. No trailing commas
8. All string values must use double quotes
9. Escape any double quotes inside strings with \\"
10. Do not truncate — complete all ${slides.length} slide objects fully

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
  
  The "note" field (the 💡 tip bar at the bottom):
  MUST follow this format:
    "💡 Real world: [one concrete example where this is used]"
  Examples:
  ✓ "💡 Real world: Water speeding up through a garden hose nozzle follows continuity."
  ✓ "💡 Real world: Aircraft wings use Bernoulli — faster air above = lower pressure = lift."
  ✓ "💡 Real world: Fire sprinklers use momentum equation to calculate pipe support forces."
  Never write a generic "this is important" note.
  Always connect to something the student has seen in real life.
  Max 80 characters for the whole note string.
- \"diagram\": 
  - Generate complete, valid SVG in svgCode with viewBox="0 0 800 500".
  - Use clean colors: #2563EB, #1E40AF, #16A34A, #D97706, #DC2626, #6B7280, white backgrounds.
  - Include clear <text> labels and arrows using <defs><marker>.
  - diagramCaption: 1–2 sentence explanation of what the diagram shows.
- \"example\" slides:
  - example.problem: max 180 characters. State ONLY the given values and what to find.
    Format: "Given: [values]. Find: [what to calculate]."
  - example.steps: EXACTLY 4-6 steps. Each step max 100 characters.
    Format: "Step N: [formula used] = [substitution] = [result with units]."
    Example: "Step 2: A₂ = π(0.075)²/4 = 0.00442 m²."
    NO explanations of why — just show the calculation.
  - example.answer: max 80 characters. Final value + units only.
    Example: "The average velocity at section 2 is 6.78 m/s."
  CRITICAL MATH RULE: For venturimeter problems, ALWAYS verify:
  Q = (A₁A₂/√(A₁²-A₂²)) × √(2ΔP/ρ)
  Example check: D₁=15cm, D₂=7.5cm, ΔP=50kPa, ρ=1000:
  A₁ = π(0.075)² = 0.01767 m²
  A₂ = π(0.0375)² = 0.004418 m²
  Q = (0.01767 × 0.004418 / √(0.01767²-0.004418²)) × √(100000/1000)
  Q = (0.0000781 / 0.01710) × 10 = 0.00457 × 10 = 0.046 m³/s
  Do NOT generate answer 0.083 for these inputs — that is wrong.
  Always verify your answer matches the question's given values.

  MOMENTUM EQUATION — 90° jet deflection:
  When a jet deflects 90°: Vx_out=0, Vy_out=V_in
  ṁ = ρAV where A = π(D/2)²
  Fx = ṁ(0 - V_in) = -ṁV
  Fy = ṁ(V_in - 0) = +ṁV
  |F| = ṁV√2
  Example check: D=5cm, V=20m/s
  A = π(0.025)² = 0.001963 m²
  ṁ = 1000 × 0.001963 × 20 = 39.27 kg/s
  |F| = 39.27 × 20 × √2 = 1111 N
  NOT 277.6 N — verify your arithmetic before outputting.

  VENTURIMETER Q formula:
  Q = (A₁×A₂ / √(A₁²-A₂²)) × √(2ΔP/ρ)
  Example check: D₁=10cm, D₂=5cm, ΔP=20kPa
  A₁ = π(0.05)² = 0.007854 m²
  A₂ = π(0.025)² = 0.001963 m²
  Q = (0.007854×0.001963/√(0.007854²-0.001963²)) × √(40)
    = (0.00001542/0.007607) × 6.324
    = 0.002027 × 6.324 = 0.01282 m³/s ≈ 0.013 m³/s
  Generate answer options that actually include the correct value.
  Never generate options where none of them match the solution.
- \"practice\" slides:
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
  "diagramCaption"?: string,
  "example"?: { "problem": string, "steps": string[], "answer": string },
  "question"?: { "text": string, "options"?: string[], "answer": string, "explanation": string },
  "note"?: string
}

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

  // Estimate total slides (concept slides may fan out)
  let estimatedTotal = 0;
  for (const s of data.slides) {
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
            count <= 4 ? 16 : count <= 5 ? 15 : count <= 6 ? 14 : 13;
          const paraSpaceBefore =
            count <= 4 ? 20 : count <= 5 ? 16 : count <= 6 ? 12 : 8;
          const paraSpaceAfter =
            count <= 4 ? 6 : count <= 5 ? 4 : count <= 6 ? 3 : 2;
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
        const svgRaw = slideData.svgCode ?? "";

        if (isValidSVG(svgRaw)) {
          slide.addImage({
            data: svgToBase64(svgRaw),
            x: ZONE.body.x,
            y: ZONE.body.y,
            w: ZONE.body.w,
            h: ZONE.body.h - (hasCaption ? 0.7 : 0.1),
            sizing: {
              type: "contain",
              w: ZONE.body.w,
              h: ZONE.body.h - 0.5,
            },
          });

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
        } else if (!svgRaw.trim() && slideData.diagramCaption) {
          slide.addShape("rect", {
            x: 0.5,
            y: ZONE.body.y,
            w: 9,
            h: ZONE.body.h,
            fill: { color: "E0F2FE" },
            line: { color: "7DD3FC", width: 1 },
          });
          slide.addText(`📊 ${cap(slideData.diagramCaption, 400)}`, {
            x: 0.7,
            y: ZONE.body.y + 0.2,
            w: 8.6,
            h: ZONE.body.h - 0.4,
            fontSize: 14,
            color: "075985",
            fontFace: "Calibri",
            valign: "middle",
            wrap: true,
            autoFit: true,
            lineSpacingMultiple: 1.6,
          });
        } else {
          slide.addShape("rect", {
            x: ZONE.body.x,
            y: ZONE.body.y,
            w: ZONE.body.w,
            h: ZONE.body.h - 0.5,
            fill: { color: "F1F5F9" },
            line: { color: "CBD5E1", width: 1 },
          });
          slide.addText(`[ Visual diagram for: ${capTitle(slideData.title, 50)} ]`, {
            x: ZONE.body.x,
            y: ZONE.body.y + 1.5,
            w: ZONE.body.w,
            h: 0.6,
            fontSize: 13,
            color: "94A3B8",
            align: "center",
            fontFace: "Calibri",
          });

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
