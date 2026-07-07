"use client";

/**
 * MathToolbar + MathTextarea — shared manual-entry helpers for typing math and
 * chemistry into any question-text / model-answer field.
 *
 * `MathToolbar` is a strip of buttons that insert LaTeX / `\ce{}` snippet
 * templates at the textarea's cursor (wrapping the current selection when there
 * is one). `MathTextarea` bundles the toolbar + a textarea + a live KaTeX
 * preview into one drop-in control.
 *
 * Notation source of truth: every snippet follows the convention taught in
 * {@link MATH_CHEM_NOTATION_GUIDE} — inline math in `$…$`, block math in
 * `$$…$$`, chemistry as a BARE `\ce{…}` (never dollar-wrapped). The button set
 * is a set of *templates* for that convention, not a second copy of the guide's
 * prose; the guide remains the single place the convention itself is defined.
 *
 * Live preview reuses the exact screen-render path from Sub-pass A —
 * {@link RichQuestionText} (its math-extraction + KaTeX rendering) — so faculty
 * see the same rendering the rest of the app produces, with no separate preview
 * step.
 *
 * Non-regression: the control is fully controlled via `value`/`onChange`. When a
 * field contains no math, the preview simply does not render and nothing about
 * the toolbar touches the surrounding save/validate/regenerate logic — a plain
 * text entry behaves exactly as a bare textarea did before.
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { hasLatex } from "@/lib/text/latexSegments";
import { RichQuestionText } from "@/components/RichQuestionText";

/**
 * A single insert template.
 *
 * Two shapes:
 *  - `wrap: true` (the two delimiter buttons only) — `prefix`/`suffix` wrap the
 *    current selection (or sit empty around the caret), for faculty wrapping
 *    their own freeform content in `$…$` / `$$…$$`.
 *  - everything else — `prefix` holds a COMPLETE worked example (e.g.
 *    `$\sqrt{2}$`, `\ce{H2O}`) that replaces the current selection outright,
 *    so clicking the button always shows a real rendered result immediately.
 *    Faculty then edits the placeholder values (a, b, 2, …) to their own
 *    content — same replace-the-sample pattern as the CSV template.
 */
interface Snippet {
  /** Short human-readable name shown as the button's primary label. */
  name: string;
  /** Full text shown under the name — identical to what gets inserted. */
  example: string;
  title: string;
  /** Inserted before the selection / caret (or the full template, if not `wrap`). */
  prefix: string;
  /** Inserted after the selection / caret. Only meaningful when `wrap` is true. */
  suffix?: string;
  /** True only for the inline/display math delimiter buttons. */
  wrap?: boolean;
}

// Shared shadcn textarea classes (kept in sync with components/ui/textarea.tsx),
// inlined here because MathTextarea renders a native <textarea> so it can hold a
// ref for cursor-position inserts (the ui/Textarea does not forward a ref).
const TEXTAREA_CLASS =
  "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

const MATH_SNIPPETS: Snippet[] = [
  { name: "Inline math", example: "$…$", title: "Inline math", prefix: "$", suffix: "$", wrap: true },
  { name: "Display math", example: "$$…$$", title: "Block / display math", prefix: "$$", suffix: "$$", wrap: true },
  { name: "Superscript", example: "$x^2$", title: "Superscript / power", prefix: "$x^2$" },
  { name: "Subscript", example: "$x_n$", title: "Subscript / index", prefix: "$x_n$" },
  { name: "Fraction", example: "$\\frac{a}{b}$", title: "Fraction", prefix: "$\\frac{a}{b}$" },
  { name: "Square root", example: "$\\sqrt{2}$", title: "Square root", prefix: "$\\sqrt{2}$" },
  { name: "Less / equal", example: "$a \\leq b$", title: "Less than or equal", prefix: "$a \\leq b$" },
  { name: "Greater / equal", example: "$a \\geq b$", title: "Greater than or equal", prefix: "$a \\geq b$" },
  { name: "Not equal", example: "$a \\neq b$", title: "Not equal", prefix: "$a \\neq b$" },
  { name: "Plus-minus", example: "$a \\pm b$", title: "Plus-minus", prefix: "$a \\pm b$" },
  { name: "Delta", example: "$\\Delta x$", title: "Delta", prefix: "$\\Delta x$" },
  { name: "Pi", example: "$\\pi$", title: "Pi", prefix: "$\\pi$" },
  { name: "Sum", example: "$\\sum_{n=1}^{\\infty} n$", title: "Summation", prefix: "$\\sum_{n=1}^{\\infty} n$" },
  { name: "Integral", example: "$\\int_0^1 x^2\\,dx$", title: "Integral", prefix: "$\\int_0^1 x^2\\,dx$" },
];

const CHEM_SNIPPETS: Snippet[] = [
  { name: "Chemistry", example: "\\ce{H2O}", title: "Chemistry span (no dollar signs)", prefix: "\\ce{H2O}" },
  { name: "Reaction", example: "\\ce{2H2 + O2 -> 2H2O}", title: "Reaction arrow", prefix: "\\ce{2H2 + O2 -> 2H2O}" },
  { name: "Equilibrium", example: "\\ce{N2 + 3H2 <=> 2NH3}", title: "Equilibrium arrow", prefix: "\\ce{N2 + 3H2 <=> 2NH3}" },
  { name: "Ion charge", example: "\\ce{SO4^{2-}}", title: "Charge / ion notation", prefix: "\\ce{SO4^{2-}}" },
];

const SYNTAX_TIP =
  "Math: wrap in $…$ (e.g. $x^2$). Chemistry: use \\ce{...} directly (e.g. \\ce{H2O}). Preview updates as you type.";

/**
 * A row of insert buttons bound to a specific textarea via `targetRef`. Callers
 * that manage their own textarea can use this directly; most callers use
 * {@link MathTextarea}, which wires it up for them.
 */
export function MathToolbar({
  targetRef,
  value,
  onChange,
  disabled,
}: {
  targetRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  // Collapsed by default — per-mount only (not persisted across sessions), so
  // it stays put while the faculty is actively using this field but resets on
  // next visit. The syntax tip below is NOT gated by this — it's cheap and
  // always useful; only the 18-button grid is the actual visual weight.
  const [expanded, setExpanded] = useState(false);

  // Caret target to restore after the controlled re-render commits.
  const pendingCaret = useRef<{ start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    const el = targetRef.current;
    const caret = pendingCaret.current;
    if (el && caret) {
      el.focus();
      el.setSelectionRange(caret.start, caret.end);
      pendingCaret.current = null;
    }
  });

  const insert = useCallback(
    (snip: Snippet) => {
      const el = targetRef.current;
      // Fall back to appending when the textarea isn't focused/available.
      const start = el ? el.selectionStart : value.length;
      const end = el ? el.selectionEnd : value.length;

      if (snip.wrap) {
        // Delimiter buttons ($…$ / $$…$$): wrap the current selection, or sit
        // empty around the caret so the faculty can type their own content.
        const suffix = snip.suffix ?? "";
        const selected = value.slice(start, end);
        const next =
          value.slice(0, start) + snip.prefix + selected + suffix + value.slice(end);
        // Caret sits just after the prefix when nothing was selected; after
        // the whole inserted block when text was wrapped.
        const caretPos =
          selected.length > 0
            ? start + snip.prefix.length + selected.length + suffix.length
            : start + snip.prefix.length;
        pendingCaret.current = { start: caretPos, end: caretPos };
        onChange(next);
        return;
      }

      // Every other button is a complete worked example — it replaces any
      // current selection outright (it isn't a wrapper for arbitrary content).
      // Faculty edits the placeholder values in place after insertion, same
      // as filling in the CSV template.
      const template = snip.prefix;
      const next = value.slice(0, start) + template + value.slice(end);
      const caretPos = start + template.length;
      pendingCaret.current = { start: caretPos, end: caretPos };
      onChange(next);
    },
    [targetRef, value, onChange],
  );

  const renderGroup = (snips: Snippet[]) =>
    snips.map((s) => (
      <button
        key={s.name}
        type="button"
        title={`${s.title} — e.g. ${s.example}`}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()} // keep textarea focus/selection
        onClick={() => insert(s)}
        className="flex flex-col items-center rounded border border-border bg-muted/60 px-1.5 py-0.5 leading-tight text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="text-[10px] font-medium whitespace-nowrap">{s.name}</span>
        <span className="text-[10px] font-mono text-muted-foreground">{s.example}</span>
      </button>
    ));

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">{SYNTAX_TIP}</p>
        <button
          type="button"
          disabled={disabled}
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-1 text-[11px] font-medium text-foreground shadow-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
            expanded && "rounded-b-none border-b-transparent bg-muted"
          )}
        >
          Math &amp; Chemistry symbols
          {expanded ? (
            <ChevronUp className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )}
        </button>
      </div>
      {expanded && (
        <div className="flex flex-wrap items-center gap-1 rounded-md rounded-tr-none border border-border bg-muted/30 p-2">
          {renderGroup(MATH_SNIPPETS)}
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          {renderGroup(CHEM_SNIPPETS)}
        </div>
      )}
    </div>
  );
}

/**
 * Drop-in controlled textarea with the math/chem toolbar above and a live KaTeX
 * preview below (shown only when the value actually contains math). Accepts the
 * usual textarea props so it can replace a bare `<Textarea>` at a call site.
 */
export function MathTextarea({
  value,
  onChange,
  className,
  rows,
  placeholder,
  disabled,
  showPreview = true,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  showPreview?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);

  return (
    <div className="space-y-1">
      <MathToolbar
        targetRef={ref}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
      <textarea
        ref={ref}
        data-slot="textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(TEXTAREA_CLASS, className)}
      />
      {showPreview && hasLatex(value) && (
        <div className="rounded border border-border/60 bg-muted/30 px-2 py-1.5">
          <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            Preview{focused ? " (live)" : ""}
          </p>
          <div className="text-sm">
            <RichQuestionText text={value} />
          </div>
        </div>
      )}
    </div>
  );
}

export default MathTextarea;
