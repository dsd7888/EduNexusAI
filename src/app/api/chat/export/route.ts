import type { NextRequest } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { createAdminClient, createServerClient } from "@/lib/db/supabase-server";

function sanitizeForPDF(text: string): string {
  if (!text) return "";
  return text
    // Greek letters
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
    // Math / symbols
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
    // Arrows and bullets
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/↑/g, "^")
    .replace(/↓/g, "v")
    .replace(/•/g, "-")
    .replace(/…/g, "...")
    // Strip simple markdown markers
    .replace(/[*_`]/g, "")
    // Remove remaining non-WinAnsi
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

    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile || profile.role !== "student") {
      return new Response(JSON.stringify({ error: "Forbidden: Students only" }), {
        status: 403,
      });
    }

    const body = await request.json().catch(() => ({} as any));
    const sessionId = String(body?.sessionId ?? "").trim();

    if (!sessionId) {
      return new Response(JSON.stringify({ error: "sessionId is required" }), {
        status: 400,
      });
    }

    // Verify session belongs to student and get subject
    const { data: sessionRow, error: sessionError } = await adminClient
      .from("chat_sessions")
      .select("id, created_at, subject_id, subjects(name)")
      .eq("id", sessionId)
      .eq("student_id", user.id)
      .single();

    if (sessionError || !sessionRow) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 403,
      });
    }

    const subjectName: string =
      (Array.isArray((sessionRow as any).subjects)
        ? (sessionRow as any).subjects[0]?.name
        : (sessionRow as any).subjects?.name) ?? "Subject";

    const { data: messages, error: messagesError } = await adminClient
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (messagesError || !messages || messages.length === 0) {
      return new Response(JSON.stringify({ error: "No messages to export" }), {
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

    const drawText = (
      textRaw: string,
      opts: {
        bold?: boolean;
        size?: number;
        color?: [number, number, number];
        align?: "left" | "center" | "right";
        gap?: number;
      } = {}
    ) => {
      const text = sanitizeForPDF(textRaw);
      const {
        bold,
        size = 12,
        color = [0, 0, 0],
        align = "left",
        gap = 16,
      } = opts;
      const font = bold ? fontBold : fontRegular;
      if (y - gap < 80) {
        newPage();
      }
      const maxWidth = width - margin * 2;
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
        if (y - gap < 80) {
          newPage();
        }
        const textWidth = font.widthOfTextAtSize(l, size);
        let x = margin;
        if (align === "center") {
          x = margin + (maxWidth - textWidth) / 2;
        } else if (align === "right") {
          x = width - margin - textWidth;
        }
        page.drawText(l, {
          x,
          y: y - gap,
          size,
          font,
          color: rgb(color[0], color[1], color[2]),
        });
        y -= gap;
      }
    };

    // Header
    drawText("EduNexus AI — Chat Export", {
      bold: true,
      size: 16,
      align: "center",
    });
    y -= 4;
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      color: rgb(0.7, 0.7, 0.7),
      thickness: 1,
    });
    y -= 10;
    drawText(`Subject: ${subjectName}`, { size: 13 });
    drawText(
      `Date: ${new Date(sessionRow.created_at as string).toLocaleString(
        "en-IN"
      )}`,
      { size: 12 }
    );
    drawText(`${messages.length} messages`, { size: 12 });
    y -= 4;
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      color: rgb(0.7, 0.7, 0.7),
      thickness: 1,
    });
    y -= 10;

    // Messages
    for (const m of messages as {
      role: "user" | "assistant";
      content: string;
      created_at: string;
    }[]) {
      const isUser = m.role === "user";
      drawText(isUser ? "You:" : "EduNexus AI:", {
        bold: true,
        size: 11,
        color: isUser ? [0.15, 0.4, 0.9] : [0.12, 0.16, 0.23],
      });
      drawText(m.content, {
        size: 11,
        color: [0, 0, 0],
        gap: 14,
      });
      const timeStr = new Date(m.created_at).toLocaleTimeString("en-IN");
      drawText(timeStr, {
        size: 9,
        color: [0.4, 0.4, 0.4],
        align: "right",
        gap: 10,
      });
      y -= 8;
    }

    const pdfBytes = await pdfDoc.save();
    const buffer = Buffer.from(pdfBytes);

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="chat-export.pdf"`,
      },
    });
  } catch (err) {
    console.error("[chat/export] POST error:", err);
    const msg =
      err instanceof Error ? err.message : "Failed to export chat";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}

