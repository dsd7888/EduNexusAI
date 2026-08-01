/**
 * Small drawing helpers shared by all three typed renderers — not one of the
 * four files the checkpoint names explicitly, but the PYQ badge line and the
 * multi-line math-aware paragraph helper are IDENTICAL across concept, formula,
 * and comparison, and a copy in each of the three files is a worse outcome than
 * one shared definition (the same call CP-N4's `shell.tsx` made for the client
 * cards). No AI calls; pure layout.
 */
import { rgb } from "pdf-lib";
import { COLORS, PDFBuilder } from "@/lib/pdf/builder";
import type { PyqSignal } from "@/lib/notes/pyq-frequency";

// Amber, never red — same rule PyqChip.tsx follows on screen: a student reading
// notes before an exam should read the signal as "worth your time", not alarm.
const AMBER_BG = rgb(0.992, 0.906, 0.541); // ~Tailwind amber-200
const AMBER_TEXT = rgb(0.573, 0.251, 0.055); // ~Tailwind amber-800

/**
 * The exam-frequency badge, mirroring PyqChip.tsx's two cases. Draws nothing
 * when `signal` is absent — there is no third "none" case (see pyq-frequency.ts).
 */
export function drawPyqLine(builder: PDFBuilder, signal: PyqSignal | undefined): void {
  if (!signal) return;
  const label =
    signal.kind === "rich"
      ? `Appeared in ${signal.coveredPapers} of ${signal.totalPapers} past papers`
      : "Appeared in past papers";
  if (signal.kind === "rich") {
    builder.badge(label, AMBER_BG, AMBER_TEXT);
  } else {
    builder.badge(label, COLORS.bgLight, COLORS.muted);
  }
}

/**
 * A block of prose that must keep its author's line breaks — mirrors the
 * `whitespace-pre-line` rule FormulaBlockCard.tsx documents for worked-example
 * solutions ("solutions are multi-step and the generator separates the steps
 * with newlines"). `PDFBuilder.text()` / `textOrMath()` collapse `\n` to a
 * space (needed for ordinary wrapped prose), which would run a multi-step
 * derivation into one sentence — so this splits first and draws each non-empty
 * line through `textOrMath` individually, math-aware per line.
 */
export function drawMultilineMathText(
  builder: PDFBuilder,
  content: string,
  opts: { size?: number; color?: ReturnType<typeof rgb> } = {}
): void {
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) {
      builder.space(4);
      continue;
    }
    builder.textOrMath(line, opts);
  }
}
