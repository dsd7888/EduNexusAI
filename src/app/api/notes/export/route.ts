import type { NextRequest } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { createServerClient } from "@/lib/db/supabase-server";

function sanitizeForPDF(text: string): string {
  if (!text) return "";
  return text
    // Greek letters (common in engineering/science)
    .replace(/ρ/g, "rho")
    .replace(/μ/g, "mu")
    .replace(/σ/g, "sigma")
    .replace(/τ/g, "tau")
    .replace(/η/g, "eta")
    .replace(/θ/g, "theta")
    .replace(/α/g, "alpha")
    .replace(/β/g, "beta")
    .replace(/γ/g, "gamma")
    .replace(/δ/g, "delta")
    .replace(/λ/g, "lambda")
    .replace(/π/g, "pi")
    .replace(/ω/g, "omega")
    .replace(/Δ/g, "Delta")
    .replace(/Σ/g, "Sigma")
    .replace(/Ω/g, "Omega")
    // Math symbols
    .replace(/×/g, "x")
    .replace(/÷/g, "/")
    .replace(/≈/g, "~=")
    .replace(/≠/g, "!=")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/√/g, "sqrt")
    .replace(/∞/g, "infinity")
    .replace(/∑/g, "sum")
    .replace(/∫/g, "integral")
    .replace(/∂/g, "d")
    .replace(/°/g, " deg")
    // Arrows and special chars
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/↑/g, "^")
    .replace(/↓/g, "v")
    .replace(/•/g, "-")
    .replace(/…/g, "...")
    // Remove any remaining non-WinAnsi characters
    .replace(/[^\x00-\xFF]/g, "?")
    .trim();
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const body = await request.json().catch(() => ({} as any));
    const notesContent = String(body?.notesContent ?? "").trim();
    const subjectName = String(body?.subjectName ?? "").trim() || "Subject";
    const topicName = String(body?.topicName ?? "").trim() || subjectName;

    if (!notesContent) {
      return new Response(JSON.stringify({ error: "notesContent is required" }), {
        status: 400,
      });
    }

    const pdfDoc = await PDFDocument.create();
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let page = pdfDoc.addPage();
    let { width, height } = page.getSize();
    const margin = 50;
    let y = height - margin;

    const newPage = () => {
      page = pdfDoc.addPage();
      ({ width, height } = page.getSize());
      y = height - margin;
    };

    const drawWrappedText = (
      textRaw: string,
      opts: {
        bold?: boolean;
        size?: number;
        color?: [number, number, number];
        gap?: number;
        indent?: number;
      } = {}
    ) => {
      const text = sanitizeForPDF(textRaw);
      const {
        bold,
        size = 12,
        color = [0, 0, 0],
        gap = 16,
        indent = 0,
      } = opts;
      const font = bold ? fontBold : fontRegular;
      const maxWidth = width - margin * 2 - indent;
      const words = text.split(/\s+/);
      let line = "";
      const lines: string[] = [];
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        const w = font.widthOfTextAtSize(test, size);
        if (w > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);

      for (const l of lines) {
        if (y - gap < margin) {
          newPage();
        }
        page.drawText(l, {
          x: margin + indent,
          y: y - gap,
          size,
          font,
          color: rgb(color[0], color[1], color[2]),
        });
        y -= gap;
      }
    };

    // Header
    drawWrappedText("EduNexus AI — Quick Notes", {
      bold: true,
      size: 18,
    });
    drawWrappedText(`Subject: ${subjectName}`, { size: 12 });
    drawWrappedText(`Topic: ${topicName}`, { size: 12 });
    drawWrappedText(
      `Date generated: ${new Date().toLocaleString("en-IN")}`,
      { size: 12 }
    );
    y -= 8;
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      color: rgb(0.7, 0.7, 0.7),
      thickness: 1,
    });
    y -= 12;

    // Very simple markdown-ish rendering
    const lines = notesContent.split("\n");
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line) {
        y -= 4;
        continue;
      }
      if (line.startsWith("##")) {
        drawWrappedText(line.replace(/^##\s*/, ""), {
          bold: true,
          size: 14,
        });
      } else if (line.startsWith("#")) {
        drawWrappedText(line.replace(/^#\s*/, ""), {
          bold: true,
          size: 16,
        });
      } else if (line.startsWith("-")) {
        const text = "• " + line.replace(/^-\s*/, "");
        drawWrappedText(text, {
          size: 12,
          indent: 12,
        });
      } else {
        drawWrappedText(line, { size: 11 });
      }
    }

    const pdfBytes = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytes);
    const filename = `quick-notes-${new Date()
      .toISOString()
      .slice(0, 10)}.pdf`;

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("[notes/export] POST error:", err);
    const msg =
      err instanceof Error ? err.message : "Failed to export notes";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}

