import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";

// Brand colors
export const COLORS = {
  primary: rgb(0.145, 0.388, 0.922), // #2563EB
  dark: rgb(0.118, 0.251, 0.686), // #1E40AF
  success: rgb(0.086, 0.639, 0.29), // #16A34A
  text: rgb(0.118, 0.161, 0.235), // #1E293B
  muted: rgb(0.278, 0.337, 0.424), // #475569
  light: rgb(0.58, 0.635, 0.71), // #94A3B8
  bgLight: rgb(0.973, 0.98, 0.988), // #F8FAFC
  bgAccent: rgb(0.859, 0.906, 0.988), // #DBEAFE
  white: rgb(1, 1, 1),
  userBubble: rgb(0.231, 0.51, 0.965), // #3B82F6
  aiBubble: rgb(0.973, 0.98, 0.988), // #F8FAFC
  border: rgb(0.886, 0.914, 0.941), // #E2E8F0
} as const;

export const PAGE_W = 595; // A4 width in points
export const PAGE_H = 842; // A4 height in points
export const MARGIN = 48;
export const CONTENT_W = PAGE_W - MARGIN * 2;

type FontBundle = {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
};

export class PDFBuilder {
  private doc: PDFDocument;
  private pages: PDFPage[] = [];
  private fonts: FontBundle;
  private currentPage!: PDFPage;
  private y = 0; // current Y position from TOP

  constructor(doc: PDFDocument, fonts: FontBundle) {
    this.doc = doc;
    this.fonts = fonts;
    this.currentPage = doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.currentPage);
    this.y = MARGIN;
  }

  // Public accessor for fonts when needed externally
  getFont(name: keyof FontBundle): PDFFont {
    return this.fonts[name];
  }

  // Sanitize text for WinAnsi fonts (strip unsupported chars, replace common symbols)
  private sanitize(text: string): string {
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
      // Subscript digits (common in formulas)
      .replace(/₀/g, "0")
      .replace(/₁/g, "1")
      .replace(/₂/g, "2")
      .replace(/₃/g, "3")
      .replace(/₄/g, "4")
      .replace(/₅/g, "5")
      .replace(/₆/g, "6")
      .replace(/₇/g, "7")
      .replace(/₈/g, "8")
      .replace(/₉/g, "9")
      // Arrows and bullets
      .replace(/→/g, "->")
      .replace(/←/g, "<-")
      .replace(/↑/g, "^")
      .replace(/↓/g, "v")
      .replace(/•/g, "-")
      .replace(/…/g, "...")
      // Remove remaining non-WinAnsi
      .replace(/[^\x00-\xFF]/g, "?")
      .trim();
  }

  // Convert y-from-top to pdf-lib y-from-bottom
  private py(yFromTop: number): number {
    return PAGE_H - yFromTop;
  }

  // Check if we need a new page
  private checkNewPage(neededHeight: number) {
    if (this.y + neededHeight > PAGE_H - MARGIN) {
      this.currentPage = this.doc.addPage([PAGE_W, PAGE_H]);
      this.pages.push(this.currentPage);
      this.y = MARGIN;
    }
  }

  // Public helper so callers can request space
  ensureSpace(neededHeight: number) {
    this.checkNewPage(neededHeight);
  }

  // Add vertical space
  space(px: number) {
    this.y += px;
  }

  // Draw a horizontal line
  drawLine(color = COLORS.border, thickness = 0.5) {
    this.checkNewPage(4);
    this.currentPage.drawLine({
      start: { x: MARGIN, y: this.py(this.y) },
      end: { x: PAGE_W - MARGIN, y: this.py(this.y) },
      thickness,
      color,
    });
    this.y += 8;
  }

  // Draw a filled rectangle
  drawRect(x: number, y: number, w: number, h: number, color: any) {
    this.currentPage.drawRectangle({
      x,
      y: this.py(y) - h,
      width: w,
      height: h,
      color,
    });
  }

  // Simple text (no markdown)
  text(
    content: string,
    options: {
      font?: PDFFont;
      size?: number;
      color?: any;
      x?: number;
      maxWidth?: number;
      lineHeight?: number;
      align?: "left" | "center" | "right";
    } = {}
  ): number {
    const font = options.font ?? this.fonts.regular;
    const size = options.size ?? 11;
    const color = options.color ?? COLORS.text;
    const x = options.x ?? MARGIN;
    const maxWidth = options.maxWidth ?? CONTENT_W;
    const lineHeight = options.lineHeight ?? size * 1.5;
    const align = options.align ?? "left";

    const safeContent = this.sanitize(content);

    // Word wrap
    const words = safeContent.split(" ");
    const lines: string[] = [];
    let current = "";

    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      const testWidth = font.widthOfTextAtSize(test, size);
      if (testWidth > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);

    for (const line of lines) {
      this.checkNewPage(lineHeight + 4);

      let drawX = x;
      if (align === "center") {
        const lineW = font.widthOfTextAtSize(line, size);
        drawX = x + (maxWidth - lineW) / 2;
      } else if (align === "right") {
        const lineW = font.widthOfTextAtSize(line, size);
        drawX = x + maxWidth - lineW;
      }

      this.currentPage.drawText(line, {
        x: drawX,
        y: this.py(this.y + size),
        size,
        font,
        color,
      });
      this.y += lineHeight;
    }

    return lines.length * lineHeight;
  }

  // Parse and render markdown text
  // Handles: ### / ## / # headings, **bold**, bullet lists (- item), numbered (1. item)
  markdown(content: string, baseSize = 11) {
    if (!content) return;

    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line) {
        this.space(6);
        continue;
      }

      // H1 ###
      if (line.startsWith("### ")) {
        const txt = this.sanitize(line.replace(/^###\s+/, ""));
        this.space(6);
        this.text(txt, {
          font: this.fonts.bold,
          size: baseSize + 3,
          color: COLORS.primary,
        });
        this.drawLine(COLORS.bgAccent, 1);
        continue;
      }

      // H2 ##
      if (line.startsWith("## ")) {
        const txt = this.sanitize(line.replace(/^##\s+/, ""));
        this.space(4);
        this.text(txt, {
          font: this.fonts.bold,
          size: baseSize + 2,
          color: COLORS.dark,
        });
        this.space(2);
        continue;
      }

      // H3 #
      if (line.startsWith("# ")) {
        const txt = this.sanitize(line.replace(/^#\s+/, ""));
        this.space(4);
        this.text(txt, {
          font: this.fonts.bold,
          size: baseSize + 1,
          color: COLORS.text,
        });
        continue;
      }

      // Bullet list
      if (line.startsWith("- ") || line.startsWith("* ")) {
        const txt = this.stripInlineMarkdown(line.replace(/^[-*]\s+/, ""));
        this.checkNewPage(baseSize * 1.5 + 4);
        // Bullet dot
        // Use simple bullet compatible with WinAnsi
        this.currentPage.drawText("*", {
          x: MARGIN + 8,
          y: this.py(this.y + baseSize),
          size: baseSize,
          font: this.fonts.bold,
          color: COLORS.primary,
        });
        this.text(txt, {
          x: MARGIN + 22,
          maxWidth: CONTENT_W - 22,
          size: baseSize,
          lineHeight: baseSize * 1.5,
        });
        continue;
      }

      // Numbered list
      const numberedMatch = line.match(/^(\d+)\.\s+(.+)/);
      if (numberedMatch) {
        const num = numberedMatch[1];
        const txt = this.stripInlineMarkdown(numberedMatch[2]);
        this.checkNewPage(baseSize * 1.5 + 4);
        this.currentPage.drawText(`${num}.`, {
          x: MARGIN + 6,
          y: this.py(this.y + baseSize),
          size: baseSize,
          font: this.fonts.bold,
          color: COLORS.primary,
        });
        this.text(txt, {
          x: MARGIN + 24,
          maxWidth: CONTENT_W - 24,
          size: baseSize,
          lineHeight: baseSize * 1.5,
        });
        continue;
      }

      // Regular paragraph — strip inline markdown
      const cleaned = this.stripInlineMarkdown(line);
      this.text(cleaned, { size: baseSize, lineHeight: baseSize * 1.6 });
    }
  }

  // Remove inline markdown (bold, italic, code) for plain rendering
  stripInlineMarkdown(text: string): string {
    const cleaned = text
      .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/_(.+?)_/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .trim();
    return this.sanitize(cleaned);
  }

  // Page header with logo area and colored bar
  addPageHeader(title: string, subtitle: string, meta?: string) {
    // Top color bar
    this.drawRect(0, 0, PAGE_W, 56, COLORS.primary);

    // EduNexus AI text
    this.currentPage.drawText("EduNexus AI", {
      x: MARGIN,
      y: PAGE_H - 32,
      size: 18,
      font: this.fonts.bold,
      color: COLORS.white,
    });

    // Title
    this.currentPage.drawText(this.sanitize(title), {
      x: MARGIN,
      y: PAGE_H - 50,
      size: 11,
      font: this.fonts.regular,
      color: rgb(0.8, 0.88, 1.0),
    });

    this.y = 72; // below header bar

    // Subtitle block
    this.space(12);
    this.text(subtitle, {
      font: this.fonts.bold,
      size: 16,
      color: COLORS.text,
    });
    if (meta) {
      this.space(2);
      this.text(meta, {
        font: this.fonts.regular,
        size: 10,
        color: COLORS.muted,
      });
    }
    this.space(6);
    this.drawLine(COLORS.border, 1);
    this.space(4);
  }

  // Section heading (for quiz, notes sections)
  sectionHeading(label: string, color = COLORS.primary) {
    this.space(8);
    this.checkNewPage(32);

    // Left accent bar
    this.drawRect(MARGIN, this.y, 3, 20, color);

    this.text(label, {
      x: MARGIN + 10,
      font: this.fonts.bold,
      size: 12,
      color,
      maxWidth: CONTENT_W - 10,
    });
    this.space(4);
  }

  // Colored badge label
  badge(label: string, bgColor: any, textColor = COLORS.white) {
    const size = 9;
    const pad = 6;
    const safeLabel = this.sanitize(label);
    const w = this.fonts.bold.widthOfTextAtSize(safeLabel, size) + pad * 2;
    const h = 16;
    this.checkNewPage(h + 4);
    this.drawRect(MARGIN, this.y, w, h, bgColor);
    this.currentPage.drawText(safeLabel, {
      x: MARGIN + pad,
      y: this.py(this.y + size + 3),
      size,
      font: this.fonts.bold,
      color: textColor,
    });
    this.y += h + 4;
  }

  // Card-style left border accent for content block
  // Returns a function to call after adding content inside
  beginCard(bgColor = COLORS.bgLight, borderColor = COLORS.border) {
    const startY = this.y;
    this.y += 10; // inner top padding
    this.space(4);

    return (endY?: number) => {
      const cardY = startY;
      const end = endY ?? this.y;
      // Left border line indicating the card block
      this.currentPage.drawLine({
        start: { x: MARGIN + 2, y: this.py(cardY) },
        end: { x: MARGIN + 2, y: this.py(end + 10) },
        thickness: 3,
        color: borderColor,
      });
    };
  }

  async build(): Promise<Uint8Array> {
    return await this.doc.save();
  }
}

export async function createPDFBuilder(): Promise<{
  builder: PDFBuilder;
  doc: PDFDocument;
}> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const boldItalic = await doc.embedFont(StandardFonts.HelveticaBoldOblique);

  const builder = new PDFBuilder(doc, {
    regular,
    bold,
    italic,
    boldItalic,
  });
  return { builder, doc };
}

