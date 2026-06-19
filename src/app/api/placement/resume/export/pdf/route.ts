import type { NextRequest } from "next/server";
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { requireRole, apiError } from "@/lib/api/helpers";
import type { ResumeData } from "@/types/placement";

export const runtime = "nodejs";
export const maxDuration = 30;

const el = React.createElement;

const DARK = "#374151";
const BLACK = "#000000";

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 40,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: BLACK,
    lineHeight: 1.4,
  },
  name: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  contact: { fontSize: 9, color: DARK, marginTop: 2, marginBottom: 8 },
  section: { marginBottom: 8 },
  sectionHeader: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    borderBottomWidth: 1,
    borderBottomColor: BLACK,
    borderBottomStyle: "solid",
    paddingBottom: 2,
    marginBottom: 4,
  },
  entry: { marginBottom: 4 },
  body: { fontSize: 9 },
  bold: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  italic: { fontSize: 9, fontFamily: "Helvetica-Oblique", color: DARK },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  duration: { fontSize: 9, color: DARK },
  bullet: { fontSize: 9, marginLeft: 8, marginBottom: 1 },
});

type RNode = React.ReactNode;
type StyleValue = (typeof styles)[keyof typeof styles];

function text(content: string, style: StyleValue, key?: string | number): RNode {
  return el(Text, { style, key }, content);
}

function sectionHeader(label: string): RNode {
  return el(Text, { style: styles.sectionHeader }, label);
}

function bulletLines(bullets: string[], prefix: string): RNode[] {
  return bullets
    .filter((b) => b.trim())
    .map((b, i) => text(`• ${b}`, styles.bullet, `${prefix}-${i}`));
}

// ─── PDF document ─────────────────────────────────────────────────────────────

function buildResumeDocument(resume: ResumeData) {
  const ts = resume.technical_skills;
  const edu = resume.education[0];

  const contactBits = [
    resume.email,
    resume.phone,
    resume.linkedin_url,
    resume.github_url,
    resume.portfolio_url,
  ].filter((v): v is string => Boolean(v && v.trim()));

  const sections: RNode[] = [];

  // Header
  sections.push(
    el(
      View,
      { key: "header" },
      text(resume.full_name || "Your Name", styles.name, "name"),
      contactBits.length > 0
        ? text(contactBits.join("   |   "), styles.contact, "contact")
        : null
    )
  );

  // Education
  if (edu) {
    const eduBits = [
      [edu.degree, edu.branch].filter(Boolean).join(" "),
      edu.university,
      edu.cgpa ? `CGPA: ${edu.cgpa}` : "",
      edu.year_of_passing,
    ].filter((v) => v && v.trim());
    const eduChildren: RNode[] = [
      sectionHeader("Education"),
      text(eduBits.join("   |   "), styles.body, "edu-line"),
    ];
    if (edu.relevant_courses.length > 0) {
      eduChildren.push(
        text(
          `Relevant Coursework: ${edu.relevant_courses.join(", ")}`,
          styles.body,
          "edu-courses"
        )
      );
    }
    sections.push(el(View, { key: "education", style: styles.section }, eduChildren));
  }

  // Technical Skills
  const skillRows: Array<[string, string[]]> = [
    ["Languages", ts.languages],
    ["Frameworks", ts.frameworks],
    ["Tools", ts.tools],
    ["Concepts", ts.concepts],
  ];
  if (skillRows.some(([, list]) => list.length > 0)) {
    const skillChildren: RNode[] = [sectionHeader("Technical Skills")];
    for (const [label, list] of skillRows) {
      if (list.length === 0) continue;
      skillChildren.push(
        el(
          Text,
          { key: label, style: styles.body },
          el(Text, { style: styles.bold }, `${label}: `),
          list.join(", ")
        )
      );
    }
    sections.push(el(View, { key: "skills", style: styles.section }, skillChildren));
  }

  // Projects
  if (resume.projects.length > 0) {
    const projChildren: RNode[] = [sectionHeader("Projects")];
    resume.projects.forEach((p, idx) => {
      const entry: RNode[] = [
        el(
          View,
          { key: "title", style: styles.titleRow },
          el(Text, { style: styles.bold }, p.title || "Untitled Project"),
          p.duration ? el(Text, { style: styles.duration }, p.duration) : null
        ),
      ];
      if (p.tech_stack.length > 0) {
        entry.push(text(`Tech: ${p.tech_stack.join(", ")}`, styles.italic, "tech"));
      }
      entry.push(...bulletLines(p.bullets, "pb"));
      projChildren.push(el(View, { key: `proj-${idx}`, style: styles.entry }, entry));
    });
    sections.push(el(View, { key: "projects", style: styles.section }, projChildren));
  }

  // Internships
  if (resume.internships.length > 0) {
    const internChildren: RNode[] = [sectionHeader("Internships")];
    resume.internships.forEach((it, idx) => {
      const heading = [it.role, it.company].filter(Boolean).join(", ") || "Internship";
      const entry: RNode[] = [
        el(
          View,
          { key: "title", style: styles.titleRow },
          el(Text, { style: styles.bold }, heading),
          it.duration ? el(Text, { style: styles.duration }, it.duration) : null
        ),
      ];
      if (it.location) {
        entry.push(text(it.location, styles.italic, "loc"));
      }
      entry.push(...bulletLines(it.bullets, "ib"));
      internChildren.push(
        el(View, { key: `intern-${idx}`, style: styles.entry }, entry)
      );
    });
    sections.push(
      el(View, { key: "internships", style: styles.section }, internChildren)
    );
  }

  // Certifications
  if (resume.certifications.length > 0) {
    const certChildren: RNode[] = [sectionHeader("Certifications")];
    resume.certifications.forEach((c, idx) => {
      const bits = [c.name, c.issuer, c.year].filter((v) => v && v.trim());
      certChildren.push(text(bits.join("   |   "), styles.body, `cert-${idx}`));
    });
    sections.push(
      el(View, { key: "certifications", style: styles.section }, certChildren)
    );
  }

  // Achievements
  if (resume.achievements.length > 0) {
    const achChildren: RNode[] = [sectionHeader("Achievements")];
    achChildren.push(
      ...bulletLines(
        resume.achievements.map((a) => a.text),
        "ach"
      )
    );
    sections.push(
      el(View, { key: "achievements", style: styles.section }, achChildren)
    );
  }

  return el(
    Document,
    null,
    el(Page, { size: "A4", style: styles.page }, sections)
  );
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

    const buffer = await renderToBuffer(buildResumeDocument(resume));

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="resume_${safeFileName(
          resume.full_name
        )}.pdf"`,
      },
    });
  } catch (err) {
    console.error("[resume/export-pdf] error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to export PDF",
      500
    );
  }
}
