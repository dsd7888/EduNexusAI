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

  const slideCountGuide = {
    basic: isModule ? "22–28" : "14–18",
    intermediate: isModule ? "28–35" : "18–24",
    advanced: isModule ? "35–45" : "24–32",
  }[depth];

  return `You are a senior university professor designing a slide deck for ${subjectName} (${subjectCode}).

SYLLABUS CONTENT:
${syllabusContent}

TASK: Create a slide OUTLINE (titles + types only, no content yet) for: ${topic}
Depth: ${depth} | Target slide count: ${slideCountGuide}

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

const MAX_BULLETS_PER_SLIDE = 6;
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

function chunkBullets(bullets: string[]): string[][] {
  if (!bullets.length) return [[]];

  const MAX = 6;
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
      const chunks = chunkBullets(s.bullets ?? []);
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

        addPageNumber(slide, slideNum, totalSlides);
        slideNum += 1;
        break;
      }

      case "overview": {
        const slide = pptx.addSlide();
        addHeader(pptx, slide, `Overview — ${data.topic}`, C.primary);
        addAccentBar(slide, "60A5FA");

        const bullets = slideData.bullets ?? [];
        const half = Math.ceil(bullets.length / 2);
        const col1 = bullets.slice(0, half);
        const col2 = bullets.slice(half);

        slide.addText(
          col1.map((b) => ({
            text: cap(b),
            options: {
              bullet: { type: "bullet", indent: 10 },
              color: C.textDark,
              fontSize: 13,
            },
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
            lineSpacingMultiple: 1.4,
          }
        );

        if (col2.length > 0) {
          slide.addText(
            col2.map((b) => ({
              text: cap(b),
              options: {
                bullet: { type: "bullet", indent: 10 },
                color: C.textDark,
                fontSize: 13,
              },
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
              lineSpacingMultiple: 1.4,
            }
          );
        }

        addPageNumber(slide, slideNum, totalSlides);
        slideNum += 1;
        break;
      }

      case "concept": {
        const chunks = chunkBullets(slideData.bullets ?? []);
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

          const bulletFontSize =
            chunk.length <= 4 ? 15 : chunk.length <= 6 ? 14 : 13;
          const hasNote = Boolean(slideData.note) && idx === chunks.length - 1;
          const bodyHeight = hasNote ? ZONE.body.h - 0.7 : ZONE.body.h - 0.1;

          slide.addText(
            chunk
              .filter(Boolean)
              .map((b) => ({
                text: `  ${cap(b)}\n`,
                options: {
                  color: C.textDark,
                  fontSize: bulletFontSize,
                  bullet: { type: "bullet", indent: 15, marginPt: 4 },
                },
              })),
            {
              x: ZONE.body.x + 0.1,
              y: ZONE.body.y + 0.1,
              w: ZONE.body.w - 0.2,
              h: bodyHeight,
              fontFace: "Calibri",
              valign: "top",
              wrap: true,
              autoFit: true,
              lineSpacingMultiple: 1.5,
            }
          );

          if (slideData.note && idx === chunks.length - 1) {
            slide.addShape("rect", {
              x: 0,
              y: SLIDE_H - 0.5,
              w: SLIDE_W,
              h: 0.5,
              fill: { color: C.accent },
              line: { color: C.accent },
            });
            slide.addText(`💡 ${cap(slideData.note, 120)}`, {
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

        if (slideData.svgCode) {
          const svgBase64 = Buffer.from(slideData.svgCode).toString(
            "base64"
          );
          const dataUrl = `data:image/svg+xml;base64,${svgBase64}`;
          const hasCaption = Boolean(slideData.diagramCaption);
          const imgH = hasCaption ? 3.6 : 4.1;

          slide.addImage({
            data: dataUrl,
            x: 0.4,
            y: ZONE.body.y,
            w: 9.2,
            h: imgH,
            sizing: { type: "contain", w: 9.2, h: imgH },
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
        } else if (slideData.diagramCaption) {
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
          const stepCount = (ex.steps ?? []).length;
          const stepFontSize =
            stepCount <= 4 ? 13 : stepCount <= 6 ? 12 : 11;

          slide.addShape("rect", {
            x: 0.35,
            y: ZONE.header.h + 0.08,
            w: 9.3,
            h: problemBoxH,
            fill: { color: "DCFCE7" },
            line: { color: C.success, width: 1.5 },
          });
          slide.addText(`Problem: ${cap(ex.problem, 180)}`, {
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

          const stepsText = (ex.steps ?? [])
            .map((s, i) => `Step ${i + 1}: ${cap(s, 130)}`)
            .join("\n");

          slide.addText(stepsText, {
            x: 0.35,
            y: ZONE.header.h + problemBoxH + 0.1,
            w: 9.3,
            h: availableH,
            fontSize: stepFontSize,
            color: C.textDark,
            fontFace: "Calibri",
            valign: "top",
            wrap: true,
            autoFit: true,
            lineSpacingMultiple: 1.5,
          });

          slide.addShape("rect", {
            x: 0,
            y: SLIDE_H - answerBarH,
            w: SLIDE_W,
            h: answerBarH,
            fill: { color: C.success },
            line: { color: C.success },
          });
          slide.addText(`✓  ${cap(ex.answer, 150)}`, {
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
              .map(
                (o, i) => `${labels[i] ?? i + 1}. ${cap(o, 120)}`
              )
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
            ? `Answer: ${cap(q.answer, 80)}${
                q.explanation
                  ? `  —  ${cap(q.explanation, 100)}`
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

        const bullets = slideData.bullets ?? [];
        slide.addText(
          (bullets.length ? bullets : ["No key takeaways provided."]).map(
            (b) => ({
              text: `✓  ${cap(b)}\n`,
              options: { color: C.white, fontSize: 14 },
            })
          ),
          {
            x: 0.7,
            y: 1.0,
            w: 8.6,
            h: 3.9,
            fontFace: "Calibri",
            valign: "top",
            wrap: true,
            autoFit: true,
            lineSpacingMultiple: 1.6,
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
