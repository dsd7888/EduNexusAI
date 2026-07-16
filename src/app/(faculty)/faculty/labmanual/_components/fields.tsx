"use client";

/**
 * Shared field kit for the review card.
 *
 * The first cut of this screen was flat monochrome — textareas and static text
 * looked identical, so a faculty had to click around to find what was editable.
 * These components fix that with consistent labels, borders and spacing, and —
 * crucially — MathField renders KaTeX/mhchem so `Q = -kA(dT/dx)` and `\ce{...}`
 * read as equations, not source, while still being editable.
 */

import { useState } from "react";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RichQuestionText } from "@/components/RichQuestionText";
import { hasLatex } from "@/lib/text/latexSegments";

export function SectionHeading({
  children,
  accent = "slate",
  right,
}: {
  children: React.ReactNode;
  accent?: "slate" | "amber" | "sky";
  right?: React.ReactNode;
}) {
  const bar =
    accent === "amber"
      ? "bg-amber-400"
      : accent === "sky"
        ? "bg-sky-400"
        : "bg-slate-300 dark:bg-slate-600";
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`h-4 w-1 rounded-full ${bar}`} />
        <h4 className="text-sm font-semibold tracking-tight">{children}</h4>
      </div>
      {right}
    </div>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-muted-foreground text-xs font-medium">
      {children}
    </Label>
  );
}

/**
 * A textarea that also renders its math. Faculty type LaTeX/`\ce{}` source; when
 * the text contains math a rendered preview appears beneath so they can see the
 * equation without leaving the field. A monospace variant is offered for code.
 */
export function MathField({
  label,
  value,
  onChange,
  rows = 4,
  mono = false,
  hint,
  counter,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  mono?: boolean;
  hint?: string;
  counter?: number;
}) {
  const [showPreview, setShowPreview] = useState(true);
  const math = !mono && hasLatex(value);

  return (
    <div className="space-y-1.5">
      {(label || counter != null || math) && (
        <div className="flex items-center justify-between">
          {label ? <FieldLabel>{label}</FieldLabel> : <span />}
          <div className="flex items-center gap-2">
            {counter != null && (
              <span className="text-muted-foreground text-[10px] tabular-nums">
                {value.length}/{counter}
              </span>
            )}
            {math && (
              <button
                type="button"
                onClick={() => setShowPreview((v) => !v)}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[10px]"
              >
                {showPreview ? <Pencil className="size-3" /> : <Eye className="size-3" />}
                {showPreview ? "editing + preview" : "show preview"}
              </button>
            )}
          </div>
        </div>
      )}
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        spellCheck={!mono}
        className={
          mono
            ? "border-slate-300 bg-slate-50 font-mono text-xs leading-relaxed dark:border-slate-700 dark:bg-slate-900/60"
            : "leading-relaxed"
        }
      />
      {math && showPreview && (
        <div className="rounded-md border border-sky-200 bg-sky-50/60 px-3 py-2 text-sm dark:border-sky-900 dark:bg-sky-950/30">
          <RichQuestionText text={value} />
        </div>
      )}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

/** A one-line input with math preview (viva questions, prereq checks, hints). */
export function MathInput({
  value,
  onChange,
  placeholder,
  italic = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  italic?: boolean;
}) {
  const math = hasLatex(value);
  return (
    <div className="flex-1 space-y-1">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={italic ? "text-xs italic" : "text-xs"}
      />
      {math && (
        <div className="rounded border border-sky-200 bg-sky-50/60 px-2 py-1 text-xs dark:border-sky-900 dark:bg-sky-950/30">
          <RichQuestionText text={value} />
        </div>
      )}
    </div>
  );
}

/** A list of one-line editable strings with add/remove. */
export function ListEditor({
  label,
  values,
  onChange,
  placeholder,
  math = false,
  minRows,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  math?: boolean;
  minRows?: number;
}) {
  const set = (i: number, v: string) => {
    const next = [...values];
    next[i] = v;
    onChange(next);
  };
  return (
    <div className="space-y-2">
      <FieldLabel>{label}</FieldLabel>
      {values.map((v, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="text-muted-foreground w-5 shrink-0 pt-2 text-xs tabular-nums">
            {i + 1}.
          </span>
          {math ? (
            <MathInput value={v} onChange={(nv) => set(i, nv)} placeholder={placeholder} />
          ) : (
            <Input
              value={v}
              onChange={(e) => set(i, e.target.value)}
              placeholder={placeholder}
              className="flex-1 text-sm"
            />
          )}
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive size-9 shrink-0"
            aria-label={`Remove ${label} item ${i + 1}`}
            onClick={() => onChange(values.filter((_, j) => j !== i))}
            disabled={minRows != null && values.length <= minRows}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...values, ""])}>
        <Plus className="size-3.5" />
        Add
      </Button>
    </div>
  );
}
