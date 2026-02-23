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
  const isModule = Boolean(moduleName);
  const targetRange = isModule ? "20-25" : "12-15";

  return `You are an expert university lecturer designing a slide outline for ${subjectName} (${subjectCode}).

SYLLABUS CONTENT:
${syllabusContent}

TASK:
- Create a slide OUTLINE only (no content yet) for: ${topic}
- Target approximately ${targetRange} slides (this is a guideline, not a hard limit).
- Depth level: ${depth}.

RULES:
- Do NOT generate any actual slide content yet.
- Only decide slide TYPES and TITLES.
- Every major concept should get:
  - At least one concept slide
  - At least one worked example slide
- Add diagram slides only for concepts that truly benefit from a visual.
- Avoid filler slides; but do not skip important concepts.

OUTPUT FORMAT:
Return ONLY a valid JSON object with this exact structure. No markdown. No backticks.
{
  "presentationTitle": "string - overall title for the deck",
  "subject": "string - subject name",
  "topic": "string - topic or module name",
  "outline": [
    { "index": 0, "type": "title", "title": "string" },
    { "index": 1, "type": "overview", "title": "string" },
    { "index": 2, "type": "concept", "title": "string" },
    { "index": 3, "type": "example", "title": "string" },
    { "index": 4, "type": "diagram", "title": "string" },
    { "index": 5, "type": "practice", "title": "string" },
    { "index": 6, "type": "summary", "title": "string" }
  ]
}

NOTES:
- type must always be one of: "title" | "overview" | "concept" | "diagram" | "example" | "practice" | "summary".
- index must start at 0 and increase sequentially with no gaps.`;
}

export function buildBatchContentPrompt(options: {
  subjectName: string;
  syllabusContent: string;
  depth: string;
  slides: { index: number; type: SlideType; title: string }[];
}): string {
  const { subjectName, syllabusContent, depth, slides } = options;

  const slidesJson = JSON.stringify(
    slides.map((s) => ({
      index: s.index,
      type: s.type,
      title: s.title,
    })),
    null,
    2
  );

  return `You are an expert university lecturer creating detailed slide content for ${subjectName}.

SYLLABUS CONTENT:
${syllabusContent}

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

REQUIREMENTS BY TYPE:
- \"title\": Use the title string as main heading; you may also include a short subtitle in bullets.
- \"overview\": bullets should list the main concepts/topics.
- \"concept\": bullets must be complete sentences explaining the concept, properties, and relevance.
- \"diagram\": 
  - Generate complete, valid SVG in svgCode with viewBox="0 0 800 500".
  - Use clean colors: #2563EB, #1E40AF, #16A34A, #D97706, #DC2626, #6B7280, white backgrounds.
  - Include clear <text> labels and arrows using <defs><marker>.
  - diagramCaption: 1–2 sentence explanation of what the diagram shows.
- \"example\": 
  - example.problem: clear problem statement.
  - example.steps: array of full-sentence steps showing the COMPLETE solution.
  - example.answer: final numerical or conceptual answer.
- \"practice\": 
  - question.text: the question.
  - question.options: optional MCQ options (A/B/C/D) when appropriate.
  - question.answer: correct answer (or option letter).
  - question.explanation: short explanation of why it is correct.
- \"summary\": bullets should list the key takeaways as complete sentences.

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
- Do NOT include any text before or after the JSON array.`;
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

export async function generatePPTXBuffer(data: PPTSlideJSON): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = data.presentationTitle;
  pptx.subject = data.subject;

  data.slides.forEach((slideContent, slideIndex) => {
    const slide = pptx.addSlide();

    switch (slideContent.type) {
      case "title": {
        slide.addShape(pptx.ShapeType.rect, {
          x: 0,
          y: 0,
          w: 10,
          h: 7.5,
          fill: { color: C.primary },
        });
        slide.addShape(pptx.ShapeType.rect, {
          x: 0,
          y: 6.8,
          w: 10,
          h: 0.7,
          fill: { color: C.dark },
        });
        slide.addText(stripMd(slideContent.title), {
          x: 0.5,
          y: 1.5,
          w: 9,
          h: 2.5,
          fontSize: 40,
          bold: true,
          color: C.white,
          align: "center",
          fontFace: "Calibri",
        });
        slide.addText(`${data.subject} — ${data.topic}`, {
          x: 0.5,
          y: 4,
          w: 9,
          h: 1,
          fontSize: 22,
          color: C.accent,
          align: "center",
        });
        slide.addText(stripMd(data.subject), {
          x: 0.5,
          y: 6.9,
          w: 9,
          h: 0.5,
          fontSize: 14,
          color: C.white,
          align: "center",
        });
        break;
      }

      case "overview": {
        slide.addShape(pptx.ShapeType.rect, {
          x: 0,
          y: 0,
          w: 0.08,
          h: 7.5,
          fill: { color: C.primary },
        });
        addHeaderBar(pptx, slide, `Agenda — ${data.topic}`, C.primary);
        const bulletText =
          (slideContent.bullets ?? [])
            .map((b) => stripMd(b))
            .join("\n") || "No agenda items.";
        slide.addText(bulletText, {
          x: 0.5,
          y: 1.3,
          w: 9,
          h: 5.8,
          fontSize: 18,
          color: C.textDark,
          bullet: { type: "bullet" },
        });
        break;
      }

      case "concept": {
        addHeaderBar(pptx, slide, stripMd(slideContent.title), C.primary);
        slide.addShape(pptx.ShapeType.rect, {
          x: 0,
          y: 1.1,
          w: 0.06,
          h: 6.4,
          fill: { color: C.accent },
        });
        const conceptBullets =
          (slideContent.bullets ?? []).map((b) => stripMd(b)).join("\n") ||
          stripMd(slideContent.title);
        slide.addText(conceptBullets, {
          x: 0.4,
          y: 1.3,
          w: 9.3,
          h: 5.5,
          fontSize: 16,
          color: C.textDark,
          lineSpacingMultiple: 1.3,
          bullet: { type: "bullet", indent: 15 },
        });
        if (slideContent.note) {
          slide.addShape(pptx.ShapeType.rect, {
            x: 0,
            y: 6.8,
            w: 10,
            h: 0.7,
            fill: { color: C.accent },
          });
          slide.addText(stripMd(slideContent.note), {
            x: 0.3,
            y: 6.85,
            w: 9.4,
            h: 0.6,
            fontSize: 12,
            italic: true,
            color: C.textMuted,
          });
        }
        break;
      }

      case "diagram": {
        addHeaderBar(pptx, slide, slideContent.title, C.dark);
        if (slideContent.svgCode) {
          const svgBase64 = Buffer.from(slideContent.svgCode).toString("base64");
          const dataUrl = `data:image/svg+xml;base64,${svgBase64}`;
          slide.addImage({
            x: 0.3,
            y: 1.2,
            w: 9.4,
            h: 5.3,
            data: dataUrl,
          });
        }
        if (slideContent.diagramCaption) {
          slide.addShape(pptx.ShapeType.rect, {
            x: 0,
            y: 6.7,
            w: 10,
            h: 0.8,
            fill: { color: C.accent },
          });
          slide.addText(stripMd(slideContent.diagramCaption), {
            x: 0.3,
            y: 6.75,
            w: 9.4,
            h: 0.65,
            fontSize: 13,
            italic: true,
            color: C.textMuted,
          });
        }
        break;
      }

      case "example": {
        slide.addShape(pptx.ShapeType.rect, {
          x: 0,
          y: 0,
          w: 10,
          h: 7.5,
          fill: { color: C.lightGray },
        });
        addHeaderBar(
          pptx,
          slide,
          `📝 Worked Example — ${stripMd(slideContent.title)}`,
          C.success
        );
        const ex = slideContent.example;
        if (ex) {
          slide.addShape(pptx.ShapeType.rect, {
            x: 0.3,
            y: 1.2,
            w: 9.4,
            h: 1.1,
            fill: { color: "DCFCE7" },
          });
          slide.addText(`Problem: ${stripMd(ex.problem)}`, {
            x: 0.5,
            y: 1.25,
            w: 9,
            h: 1,
            fontSize: 15,
            bold: true,
            color: C.textDark,
          });
          const stepsText = ex.steps
            .map((s, i) => `Step ${i + 1}: ${stripMd(s)}`)
            .join("\n");
          slide.addText(stepsText, {
            x: 0.3,
            y: 2.4,
            w: 9.4,
            h: 3.5,
            fontSize: 14,
            color: C.textDark,
            lineSpacingMultiple: 1.4,
          });
          slide.addShape(pptx.ShapeType.rect, {
            x: 0.3,
            y: 6.1,
            w: 9.4,
            h: 0.8,
            fill: { color: C.success },
          });
          slide.addText(`✓ Answer: ${stripMd(ex.answer)}`, {
            x: 0.5,
            y: 6.15,
            w: 9,
            h: 0.65,
            fontSize: 15,
            bold: true,
            color: C.white,
          });
        }
        break;
      }

      case "practice": {
        addHeaderBar(
          pptx,
          slide,
          `✏️ Practice Question ${slideIndex + 1}`,
          C.warning
        );
        const q = slideContent.question;
        if (q) {
          slide.addText(stripMd(q.text), {
            x: 0.3,
            y: 1.2,
            w: 9.4,
            h: 2,
            fontSize: 18,
            bold: true,
            color: C.textDark,
          });
          if (q.options && q.options.length > 0) {
            const optsText = q.options
              .map(
                (o, i) =>
                  `${String.fromCharCode(65 + i)}) ${stripMd(o)}`
              )
              .join("\n");
            slide.addText(optsText, {
              x: 0.5,
              y: 3.3,
              w: 9,
              h: 2.4,
              fontSize: 15,
              color: C.textDark,
              lineSpacingMultiple: 1.5,
            });
          }
          slide.addShape(pptx.ShapeType.rect, {
            x: 0.3,
            y: 6.5,
            w: 9.4,
            h: 0.7,
            fill: { color: C.accent },
          });
          slide.addText(
            `Answer: ${stripMd(q.answer)} — ${stripMd(q.explanation)}`,
            {
              x: 0.5,
              y: 6.55,
              w: 9,
              h: 0.6,
              fontSize: 13,
              color: C.dark,
            }
          );
        }
        break;
      }

      case "summary": {
        slide.addShape(pptx.ShapeType.rect, {
          x: 0,
          y: 0,
          w: 10,
          h: 7.5,
          fill: { color: C.dark },
        });
        slide.addText("Key Takeaways ✓", {
          x: 0.5,
          y: 0.3,
          w: 9,
          h: 1,
          fontSize: 34,
          bold: true,
          color: C.white,
          align: "center",
        });
        slide.addShape(pptx.ShapeType.rect, {
          x: 1,
          y: 1.4,
          w: 8,
          h: 0.05,
          fill: { color: C.accent },
        });
        const summaryBullets = (slideContent.bullets ?? [])
          .map((b) => `✓ ${stripMd(b)}`)
          .join("\n");
        if (summaryBullets) {
          slide.addText(summaryBullets, {
            x: 0.8,
            y: 1.6,
            w: 8.5,
            h: 5.2,
            fontSize: 18,
            color: C.white,
            lineSpacingMultiple: 1.5,
          });
        }
        slide.addText(`End of ${data.topic}`, {
          x: 0.5,
          y: 7.0,
          w: 9,
          h: 0.4,
          fontSize: 13,
          color: C.accent,
          align: "center",
          italic: true,
        });
        break;
      }

      default:
        addHeaderBar(pptx, slide, slideContent.title, C.primary);
        if (slideContent.bullets?.length) {
          slide.addText(
            slideContent.bullets.map((b) => stripMd(b)).join("\n"),
            {
            x: 0.5,
            y: 1.3,
            w: 9,
            h: 5.5,
            fontSize: 16,
            color: C.textDark,
            bullet: { type: "bullet" },
            }
          );
        }
    }
  });

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
    cleaned = cleaned
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const first = cleaned.indexOf("[");
    const last = cleaned.lastIndexOf("]");
    if (first === -1 || last === -1) return null;
    cleaned = cleaned.slice(first, last + 1);
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return null;
    return parsed as SlideContent[];
  } catch {
    return null;
  }
}
