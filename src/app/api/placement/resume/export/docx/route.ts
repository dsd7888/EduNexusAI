import type { NextRequest } from "next/server";
import {
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  TabStopPosition,
  TabStopType,
  TextRun,
} from "docx";
import { requireRole, apiError } from "@/lib/api/helpers";
import type { ResumeData } from "@/types/placement";

export const maxDuration = 30;

const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// docx `size` is in half-points: 9pt → 18, 10pt → 20, 11pt → 22, 16pt → 32.
const SIZE = { name: 32, section: 22, body: 18, small: 20 } as const;
const SPACE_AFTER = 120; // 6pt in twips
const MARGIN = 1080; // 0.75 inch in twips
const RULE = {
  bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000", space: 1 },
};

// ─── Paragraph builders ───────────────────────────────────────────────────────

function sectionHeader(label: string): Paragraph {
  return new Paragraph({
    spacing: { before: 160, after: 60 },
    border: RULE,
    children: [
      new TextRun({ text: label.toUpperCase(), bold: true, size: SIZE.section }),
    ],
  });
}

function bodyLine(runs: TextRun[]): Paragraph {
  return new Paragraph({ spacing: { after: SPACE_AFTER }, children: runs });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 40 },
    indent: { left: 240 },
    children: [new TextRun({ text: `• ${text}`, size: SIZE.body })],
  });
}

// Title (bold, left) with duration right-aligned on the same line.
function titleWithDuration(title: string, duration: string | null): Paragraph {
  const children = [new TextRun({ text: title, bold: true, size: SIZE.body })];
  if (duration) {
    children.push(new TextRun({ text: `\t${duration}`, size: SIZE.small }));
  }
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
    spacing: { before: 120, after: 20 },
    children,
  });
}

// ─── Document builder ─────────────────────────────────────────────────────────

function buildResumeDoc(resume: ResumeData): Document {
  const children: Paragraph[] = [];

  // 1. Header — name + contact line + rule
  children.push(
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: resume.full_name || "Your Name",
          bold: true,
          size: SIZE.name,
        }),
      ],
    })
  );

  const contactBits = [
    resume.email,
    resume.phone,
    resume.linkedin_url,
    resume.github_url,
    resume.portfolio_url,
  ].filter((v): v is string => Boolean(v && v.trim()));
  if (contactBits.length > 0) {
    children.push(
      new Paragraph({
        spacing: { after: 60 },
        border: RULE,
        children: [
          new TextRun({ text: contactBits.join("  |  "), size: SIZE.small }),
        ],
      })
    );
  }

  // 2. Education
  const edu = resume.education[0];
  if (edu) {
    children.push(sectionHeader("Education"));
    const eduBits = [
      [edu.degree, edu.branch].filter(Boolean).join(" "),
      edu.university,
      edu.cgpa ? `CGPA: ${edu.cgpa}` : "",
      edu.year_of_passing,
    ].filter((v) => v && v.trim());
    children.push(
      bodyLine([new TextRun({ text: eduBits.join("  |  "), size: SIZE.body })])
    );
    if (edu.relevant_courses.length > 0) {
      children.push(
        bodyLine([
          new TextRun({ text: "Relevant Coursework: ", bold: true, size: SIZE.body }),
          new TextRun({ text: edu.relevant_courses.join(", "), size: SIZE.body }),
        ])
      );
    }
  }

  // 3. Technical Skills
  const ts = resume.technical_skills;
  const skillRows: Array<[string, string[]]> = [
    ["Languages", ts.languages],
    ["Frameworks", ts.frameworks],
    ["Tools", ts.tools],
    ["Concepts", ts.concepts],
  ];
  if (skillRows.some(([, list]) => list.length > 0)) {
    children.push(sectionHeader("Technical Skills"));
    for (const [label, list] of skillRows) {
      if (list.length === 0) continue;
      children.push(
        bodyLine([
          new TextRun({ text: `${label}: `, bold: true, size: SIZE.body }),
          new TextRun({ text: list.join(", "), size: SIZE.body }),
        ])
      );
    }
  }

  // 4. Projects
  if (resume.projects.length > 0) {
    children.push(sectionHeader("Projects"));
    for (const p of resume.projects) {
      children.push(titleWithDuration(p.title || "Untitled Project", p.duration));
      if (p.tech_stack.length > 0) {
        children.push(
          new Paragraph({
            spacing: { after: 20 },
            children: [
              new TextRun({
                text: `Tech: ${p.tech_stack.join(", ")}`,
                italics: true,
                size: SIZE.small,
              }),
            ],
          })
        );
      }
      for (const b of p.bullets) {
        if (b.trim()) children.push(bullet(b));
      }
    }
  }

  // 5. Internships
  if (resume.internships.length > 0) {
    children.push(sectionHeader("Internships"));
    for (const it of resume.internships) {
      const heading = [it.role, it.company].filter(Boolean).join(", ");
      children.push(titleWithDuration(heading || "Internship", it.duration || null));
      if (it.location) {
        children.push(
          new Paragraph({
            spacing: { after: 20 },
            children: [
              new TextRun({ text: it.location, italics: true, size: SIZE.small }),
            ],
          })
        );
      }
      for (const b of it.bullets) {
        if (b.trim()) children.push(bullet(b));
      }
    }
  }

  // 6. Certifications
  if (resume.certifications.length > 0) {
    children.push(sectionHeader("Certifications"));
    for (const c of resume.certifications) {
      const bits = [c.name, c.issuer, c.year].filter((v) => v && v.trim());
      children.push(
        bodyLine([new TextRun({ text: bits.join("  |  "), size: SIZE.body })])
      );
    }
  }

  // 7. Achievements
  if (resume.achievements.length > 0) {
    children.push(sectionHeader("Achievements"));
    for (const a of resume.achievements) {
      if (a.text.trim()) children.push(bullet(a.text));
    }
  }

  return new Document({
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: SIZE.body },
          paragraph: { spacing: { after: SPACE_AFTER } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        children,
      },
    ],
  });
}

// ─── Route ────────────────────────────────────────────────────────────────────

function safeFileName(name: string): string {
  const cleaned = (name || "resume").trim().replace(/\s+/g, "_").replace(/[^\w-]/g, "");
  return cleaned || "resume";
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;

    let body: { resume?: ResumeData };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return apiError("Invalid JSON body", 400);
    }

    const resume = body.resume;
    if (!resume || typeof resume !== "object") {
      return apiError("resume payload required", 400);
    }

    const doc = buildResumeDoc(resume);
    const buffer = await Packer.toBuffer(doc);

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": DOCX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="resume_${safeFileName(
          resume.full_name
        )}.docx"`,
      },
    });
  } catch (err) {
    console.error("[resume/export-docx] error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to export Word document",
      500
    );
  }
}
