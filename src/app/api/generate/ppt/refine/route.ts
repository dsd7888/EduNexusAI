import { routeAI } from "@/lib/ai/router";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

type Operation = "patch" | "insert";

// Shared responseSchema for both patch and insert. Covers every slide-type
// variant this endpoint can produce. Only `type` and `title` are required —
// `type` is an open enum (NOT pre-filled), so the model is free to change a
// slide's type when an instruction demands a different structure. Everything
// else is optional and populated per chosen type. With this passed as
// params.responseSchema, Gemini guarantees schema-conformant JSON, so the
// route no longer needs fence-stripping or completion-priming to parse.
const REFINE_SLIDE_SCHEMA = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: [
        "title",
        "overview",
        "concept",
        "diagram",
        "example",
        "practice",
        "summary",
      ],
    },
    title: { type: "string" },
    bullets: { type: "array", items: { type: "string" } },
    note: { type: "string" },
    renderHint: {
      type: "string",
      enum: ["svg", "mermaid", "imagen", "illustration"],
    },
    svg: { type: "string" },
    mermaid: { type: "string" },
    imagenPrompt: { type: "string" },
    question: { type: "string" },
    options: { type: "array", items: { type: "string" } },
    answer: { type: "string" },
    explanation: { type: "string" },
  },
  required: ["type", "title"],
} as const;

function stripHeavyFields(
  slide: Record<string, unknown>
): Record<string, unknown> {
  const stripped = { ...slide };
  if (stripped.svgCode)
    stripped.svgCode = "[existing SVG — regenerate completely]";
  if (stripped.svg) stripped.svg = "[existing SVG — regenerate completely]";
  if (stripped.mermaidCode)
    stripped.mermaidCode = "[existing mermaid — regenerate completely]";
  if (stripped.mermaid)
    stripped.mermaid = "[existing mermaid — regenerate completely]";
  if (stripped.imageBase64)
    stripped.imageBase64 = "[base64 image data removed]";
  return stripped;
}

// Reconcile schema drift between the AI's output and the consumers
// (build pipeline vs refine preview both read different field names).
function normalizeSlide(slide: Record<string, unknown>): Record<string, unknown> {
  // Normalize svg field
  if (slide.svgCode && !slide.svg) slide.svg = slide.svgCode;
  if (slide.mermaidCode && !slide.mermaid) slide.mermaid = slide.mermaidCode;

  // Normalize renderHint field
  if (!slide.renderHint) {
    slide.renderHint =
      slide.renderType ??
      slide.diagramRenderType ??
      (slide.svg || slide.svgCode
        ? "svg"
        : slide.mermaid || slide.mermaidCode
          ? "mermaid"
          : undefined);
  }

  // Normalize bullets field
  if (!slide.bullets && slide.steps) slide.bullets = slide.steps;
  if (!slide.bullets && slide.content && Array.isArray(slide.content)) {
    slide.bullets = slide.content;
  }

  return slide;
}

export async function POST(req: NextRequest) {
  try {
    // 1. Auth check — faculty or superadmin only
    const supabase = createAdminClient();
    const serverClient = await createServerClient();

    const {
      data: { user },
    } = await serverClient.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (
      !profile ||
      !["faculty", "superadmin", "dean", "hod"].includes((profile as { role: string }).role)
    ) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    // 2. Parse and validate body
    const body = await req
      .json()
      .catch(() => ({} as Record<string, unknown>));

    const operation = body?.operation as Operation | undefined;
    const slideIndex = body?.slideIndex as number | undefined;
    const instructionRaw = body?.instruction as string | undefined;
    const currentSlide = body?.currentSlide;
    const subjectName =
      typeof body?.subjectName === "string" && body.subjectName.trim()
        ? body.subjectName.trim()
        : "this subject";
    const depth =
      typeof body?.depth === "string" && body.depth.trim()
        ? body.depth.trim()
        : "intermediate";
    const topic =
      typeof body?.topic === "string" && body.topic.trim()
        ? body.topic.trim()
        : "";
    const neighboringSlides = Array.isArray(body?.neighboringSlides)
      ? (body.neighboringSlides as unknown[])
          .filter(
            (t): t is string => typeof t === "string" && t.trim().length > 0
          )
          .map((t) => t.trim())
          .slice(0, 4)
      : [];

    if (!operation || !["patch", "insert"].includes(operation)) {
      return Response.json({ error: "Invalid operation" }, { status: 400 });
    }
    if (typeof slideIndex !== "number" || slideIndex < 0) {
      return Response.json({ error: "Invalid slideIndex" }, { status: 400 });
    }
    if (!instructionRaw || instructionRaw.trim().length === 0) {
      return Response.json(
        { error: "Instruction is required" },
        { status: 400 }
      );
    }
    if (operation === "patch" && !currentSlide) {
      return Response.json(
        { error: "currentSlide required for patch" },
        { status: 400 }
      );
    }

    const instruction = instructionRaw.trim();

    // 3. Build prompt based on operation
    let systemPrompt: string;
    let prompt: string;

    const slideObj = currentSlide as Record<string, unknown> | undefined;
    const slideType = String(slideObj?.type ?? "concept");

    // Deck-level grounding context, shared by both operations. `topic` is the
    // deck's SPECIFIC topic (distinct from the broad subjectName); neighbors
    // give the model something concrete to ground vague instructions against.
    const topicLine = topic || "(not specified — infer from neighboring slides)";
    const neighborBlock =
      neighboringSlides.length > 0
        ? neighboringSlides.map((t) => `- ${t}`).join("\n")
        : "(none provided)";
    const groundingInstruction = `Ground your output in the SPECIFIC topic and \
neighboring slides above, not the general subject area. If the instruction is \
vague or unspecific about content, infer the most natural next sub-topic from \
the neighboring slide titles — never an unrelated topic from the broader subject.`;

    if (operation === "patch") {
      systemPrompt = `You are a senior educational content designer specializing in \
technical accuracy and visual clarity for university-level presentations. \
You refine individual slides without altering scientific facts or data relationships.`;

      const slideTitle = String(slideObj?.title ?? "");

      prompt = `
<persona>
Senior educational content designer with deep domain expertise in ${subjectName}.
You prioritize scientific accuracy above all else.
</persona>

<domain_context>
Subject: ${subjectName}
Slide title: ${slideTitle}

Identify the content domain from the above and apply
domain-appropriate standards:
- Engineering/Physics: SI units, standard notation, textbook conventions
- Medicine/Biology: anatomical accuracy, clinical standards, Gray's Anatomy conventions
- Chemistry: IUPAC notation, correct bond angles, standard structural formulas
- Computer Science: standard algorithm notation, correct complexity classes
- Mathematics: LaTeX-style notation where applicable, precise curve shapes
- Business/Management: standard framework conventions (Porter's 5 Forces format, etc.)
- History/Humanities: accurate timelines, correct chronological order
- Any other domain: apply the authoritative standards of that field

State-of-the-art means: what would appear in the best textbook
or peer-reviewed resource for this specific domain.
</domain_context>

<task>
Modify ONE presentation slide according to the faculty instruction.
Return the modified slide as a single JSON object.

The current slide type is ${slideType}. Change it if the instruction requires a
different structure — for example, an instruction to add a diagram/visual to a
non-diagram slide should result in type:"diagram" with the appropriate renderHint
and svg/mermaid/imagenPrompt populated. Only keep the original type if the
instruction doesn't require a structural change.
</task>

<context>
<subject>${subjectName}</subject>
<deck_topic>${topicLine}</deck_topic>
<slide_number>${slideIndex + 1}</slide_number>
<faculty_instruction>${instruction}</faculty_instruction>

<neighboring_slides>
${neighborBlock}
</neighboring_slides>
<grounding>
${groundingInstruction}
</grounding>

<current_slide_metadata>
${JSON.stringify(stripHeavyFields(slideObj ?? {}), null, 2)}
</current_slide_metadata>

<preservation_rules>
NEVER change these regardless of instruction:
- Scientific relationships (if curve A is above curve B, it stays above)
- Mathematical values, formulas, constants
- Physical laws and their direction/sense
- Axis labels and what they represent
- The number of distinct elements (curves, phases, components) unless explicitly asked
- Causal relationships between concepts

ONLY change what the instruction asks for:
- Visual styling (colors, thickness, fonts)
- Label clarity and positioning
- Layout and spacing
- Added annotations or callouts
- Descriptive text quality
</preservation_rules>

<instruction_priority>
The faculty instruction overrides visual defaults but never overrides
scientific facts. Apply this decision tree:

IF instruction asks to ADD new elements (new axis, new curve, new label):
  → Add them. They don't conflict with existing relationships.

IF instruction asks to CHANGE visual properties (color, size, font, layout):
  → Change only those properties. Preserve everything else.

IF instruction asks to CHANGE data/relationships explicitly
  (e.g. "make this curve steeper", "swap X and Y axis", "change threshold to 40%"):
  → Honor it exactly. Faculty has domain authority over their content.

IF instruction asks for quality improvement with no specific data change
  (e.g. "make it accurate", "improve this", "make it clearer", "fix it"):
  → Improve ONLY visual quality. Never infer data changes from quality words.

IF instruction is highly detailed and specific:
  → Follow every detail precisely. Detailed instructions signal expert faculty.
  → Do not simplify or second-guess specific measurements, values, or layouts.

IF instruction is vague (one or two words):
  → Apply conservative improvements. Ask nothing, infer nothing about data.
</instruction_priority>

<diagram_regeneration_rules>
When instruction involves diagram quality (accurate, precise, clear, better, fix labels):
1. AUDIT: List every scientific relationship in the current diagram mentally
2. PRESERVE: Every relationship must appear identically in the new SVG
3. IMPROVE: Only visual quality — label positions, colors, line clarity
4. VERIFY: After writing SVG, confirm each original relationship is intact

The canonical relationships are determined purely by the subject
matter of THIS slide. Identify what type of content this is
(graph, flowchart, anatomy, circuit, chemical structure, timeline,
mechanism, data visualization, etc.) and apply the preservation
rules appropriate to that content type:
- Graphs/plots: preserve curve shapes, relative positions, axis meanings
- Flowcharts/processes: preserve all nodes, edges, and flow direction
- Anatomy/biology: preserve spatial relationships and structure names
- Circuits/schematics: preserve component connections and signal flow
- Chemical structures: preserve bonds, groups, stereochemistry
- Timelines/sequences: preserve order and causality
- Any other type: preserve the core factual relationships
</diagram_regeneration_rules>
</context>

<few_shot_examples>
<example_1>
<domain>Any graph/plot</domain>
<instruction>The diagram isn't accurate, fix it</instruction>
<wrong>Redraw curves with different slopes or data points</wrong>
<correct>Keep all data relationships identical. Improve line smoothness,
label clarity, axis tick precision, and overall visual quality.</correct>
</example_1>

<example_2>
<domain>Biology/Anatomy</domain>
<instruction>Add labels to all structures and use better colors</instruction>
<wrong>Rearrange anatomical positions or change spatial relationships</wrong>
<correct>Keep all structures in exact positions. Add/improve labels with
leader lines. Apply a clear color scheme that distinguishes structures.</correct>
</example_2>

<example_3>
<domain>Computer Science/Algorithms</domain>
<instruction>Make the flowchart cleaner and add decision labels</instruction>
<wrong>Change the algorithm logic or reorder steps</wrong>
<correct>Keep all nodes, edges, and flow direction identical.
Improve spacing, add Yes/No labels on decision diamonds,
clean up arrow routing.</correct>
</example_3>

<example_4>
<domain>Chemistry</domain>
<instruction>Add a third reaction pathway and highlight the catalyst</instruction>
<wrong>Ignore the addition request because it changes the diagram</wrong>
<correct>Faculty explicitly asked to ADD content — draw the new pathway
accurately. Highlight the catalyst with a distinct color or callout box.
This is an instruction-driven addition, not a preservation violation.</correct>
</example_4>

<example_5>
<domain>Any domain — highly detailed instruction</domain>
<instruction>Add a dashed horizontal threshold line at y=70%,
label it "Critical Limit", color it red, and add a shaded region
above it in light red</instruction>
<wrong>Add a generic "threshold" line at an arbitrary position</wrong>
<correct>Draw the dashed line precisely at 70% of the y-axis height.
Label it exactly "Critical Limit". Color #DC2626. Add a semi-transparent
red fill (opacity 0.1) above the line. Every detail honored exactly.</correct>
</example_5>
</few_shot_examples>

<svg_quality_rules>
viewBox="0 0 800 400" always.
First element: <rect width="800" height="400" fill="#F8FAFC"/>.
Label positioning: text x = shape_center_x, y = shape_center_y,
  text-anchor="middle", dominant-baseline="middle".
Labels inside shapes: ALWAYS. Never adjacent/floating.
Arrow labels: max 3 words.
Line labels: position at midpoint, offset 12px from line, never overlapping.
Font sizes: axis labels 13px, data labels 14px, title 16px.
Colors: #2563EB blue, #16A34A green, #DC2626 red, #D97706 amber, #7C3AED purple.
Every element must have a <text> label. No unlabeled shapes.
Minimum contrast: text color must contrast with background.
</svg_quality_rules>

<format>
Return the modified slide as a single, complete, standalone JSON object.
Carry over every field that still applies, and include any new fields the
resulting slide type requires (e.g. svg + renderHint when type becomes diagram).
</format>`;
    } else {
      systemPrompt =
        "You are an expert curriculum designer. Generate exactly one new educational " +
        "slide as a JSON object. Return ONLY the JSON object, nothing else.";

      prompt = `<task>Generate a new slide to insert into an educational presentation.</task>
<subject>${subjectName}</subject>
<deck_topic>${topicLine}</deck_topic>
<depth>${depth}</depth>
<instruction>${instruction}</instruction>
<insert_position>After slide ${slideIndex + 1} (1-based)</insert_position>

<neighboring_slides>
${neighborBlock}
</neighboring_slides>
<grounding>
${groundingInstruction}
</grounding>

<field_guidance>
Choose the slide type that best fits the instruction, then populate only the
fields relevant to that type:
- concept: 4-6 bullets, plus a note (💡 prefix, max 90 chars, a specific insight
  not already in the bullets, naming a real system/tool/clinical fact).
- example: bullets as ordered worked steps.
- diagram: set renderHint and populate the matching field — svg (default),
  mermaid, or imagenPrompt (a narrative paragraph). Omit bullets.
- practice: question, exactly 4 options, answer (matching one option exactly),
  and explanation.
- title: a clear, specific title only (max 60 chars).
</field_guidance>
<rules>
1. Default renderHint to "svg" unless 3D/photorealistic content is needed (then "imagen").
2. SVG: viewBox="0 0 800 400", white background rect, every element labelled.
3. Mermaid: no () in edge labels, max 8 nodes.
</rules>`;
    }

    // 4. Call AI — size token budget based on whether a diagram is likely
    const needsDiagram = /diagram|visual|svg|chart|flow|draw/i.test(instruction);
    const maxTokens = needsDiagram ? 16384 : 8192;

    const result = await routeAI("ppt_gen", {
      messages: [{ role: "user", content: prompt }],
      systemPrompt,
      maxTokens,
      responseSchema: REFINE_SLIDE_SCHEMA,
    });

    // 5. Parse response — responseSchema guarantees schema-conformant JSON, so
    // a single JSON.parse is enough. The try/catch is a defensive last resort
    // (network/provider edge cases), not the old fence/prefix recovery path.
    const raw = String(result.content ?? "").trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error(
        "[ppt/refine] Parse error:",
        e,
        "Raw:",
        raw.slice(0, 500)
      );
      return Response.json(
        {
          error: "AI returned malformed JSON. Try rephrasing your instruction.",
          code: "PARSE_ERROR",
        },
        { status: 422 }
      );
    }

    if (!parsed.type || !parsed.title) {
      return Response.json(
        {
          error: "AI response missing required fields.",
          code: "INVALID_SCHEMA",
        },
        { status: 422 }
      );
    }

    parsed = normalizeSlide(parsed);

    // 6. Return
    if (operation === "patch") {
      return Response.json({
        operation: "patch",
        patchedSlide: parsed,
        slideIndex,
      });
    }

    return Response.json({
      operation: "insert",
      newSlide: parsed,
      insertAfterIndex: slideIndex,
    });
  } catch (err) {
    console.error("[ppt/refine] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to refine slide";
    return Response.json({ error: message }, { status: 500 });
  }
}
