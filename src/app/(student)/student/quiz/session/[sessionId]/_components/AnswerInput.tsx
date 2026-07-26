"use client";

/**
 * Per-type answer entry. One component, a branch per type — the three types
 * share the option-row visual language, and splitting them into three files
 * would make that shared language a copy in three places.
 *
 * KEYBOARD (the whole point of this component beyond correctness):
 *   MCQ / true_false — 1-4 or A-D selects and is a commit-ready answer
 *   MSQ              — 1-5 or A-E TOGGLES; nothing commits until the student says so
 *   NAT              — a focus-trapped numeric field; digits go to the field,
 *                      never to a shortcut
 *
 * Shortcut handling lives on the document rather than on the option buttons so
 * a student who has not clicked anything can still press "2". It is disabled
 * outright while `revealed` — after the answer is shown, "3" must not silently
 * re-answer a graded question.
 */

import { useEffect, useMemo, useRef } from "react";
import { Check } from "lucide-react";

import RichQuestionText from "@/components/RichQuestionText";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { LETTERS, letterFor, type SessionQuestion } from "./types";

/** Parse an MSQ value ("A|C") into a Set of letters. */
function parseMsq(value: string | null): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split("|")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  );
}

/** Serialise back to the pipe-separated, alphabetically ordered canonical form. */
function serialiseMsq(set: Set<string>): string | null {
  if (set.size === 0) return null;
  return Array.from(set).sort().join("|");
}

export default function AnswerInput({
  question,
  value,
  onChange,
  revealed,
  correctAnswer,
  disabled,
}: {
  question: SessionQuestion;
  value: string | null;
  onChange: (value: string | null) => void;
  /** Reveal state — locks input and paints the key. */
  revealed: boolean;
  /** Only meaningful when revealed. */
  correctAnswer?: string | null;
  disabled?: boolean;
}) {
  const isMulti = question.type === "msq" || question.type === "multiple_correct";
  const isNumeric = question.type === "nat";
  const options = question.options ?? [];
  const locked = revealed || disabled;

  const natRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => (isMulti ? parseMsq(value) : new Set(value ? [value.toUpperCase()] : [])),
    [value, isMulti]
  );

  const correctSet = useMemo(() => {
    if (!revealed || !correctAnswer) return new Set<string>();
    return new Set(
      correctAnswer
        .split(/[|,;\s]+/)
        .map((s) => s.replace(/[().]/g, "").trim().toUpperCase())
        .filter((s) => s.length === 1 && LETTERS.includes(s))
    );
  }, [revealed, correctAnswer]);

  // ── keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    if (locked || isNumeric || options.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      // Never hijack typing in an input, and never fight a modifier combo.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const k = e.key.toUpperCase();
      let index = -1;
      if (/^[1-9]$/.test(k)) index = Number(k) - 1;
      else if (/^[A-J]$/.test(k)) index = LETTERS.indexOf(k);
      if (index < 0 || index >= options.length) return;

      e.preventDefault();
      const letter = letterFor(index);
      if (isMulti) {
        const next = new Set(selected);
        if (next.has(letter)) next.delete(letter);
        else next.add(letter);
        onChange(serialiseMsq(next));
      } else {
        onChange(letter);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [locked, isNumeric, options.length, isMulti, selected, onChange]);

  // Focus the NAT field when the question mounts, so a numeric question is
  // immediately typeable without a click.
  useEffect(() => {
    if (isNumeric && !locked) natRef.current?.focus();
  }, [isNumeric, locked, question.slotId]);

  // ── NAT ───────────────────────────────────────────────────────────────────
  if (isNumeric) {
    return (
      <div className="space-y-2">
        <label
          htmlFor={`nat-${question.slotId}`}
          className="text-xs font-medium text-muted-foreground"
        >
          Your answer (numeric)
        </label>
        <Input
          id={`nat-${question.slotId}`}
          ref={natRef}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value ?? ""}
          disabled={locked}
          onChange={(e) => {
            // Permit digits, one sign, one point, and scientific notation —
            // rejecting everything else at entry rather than at grading, so a
            // student never submits a value that could not have been right.
            const raw = e.target.value;
            if (raw === "" || /^-?\d*\.?\d*(e-?\d*)?$/i.test(raw)) {
              onChange(raw === "" ? null : raw);
            }
          }}
          // Enter is handled by the runner (advance / submit), so it must not
          // also submit a form here.
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          placeholder="e.g. 12.5"
          className={cn(
            "max-w-xs font-mono text-base",
            revealed && "border-muted bg-muted/40"
          )}
        />
        {question.numericTolerance ? (
          <p className="text-[11px] text-muted-foreground">
            Answers within ±{question.numericTolerance}% are accepted.
          </p>
        ) : null}
      </div>
    );
  }

  // ── MCQ / MSQ / true_false ────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      {isMulti ? (
        <p className="text-[11px] font-medium text-muted-foreground">
          Select all that apply — press a number to toggle.
        </p>
      ) : null}
      <div className="space-y-2">
        {options.map((opt, i) => {
          const letter = letterFor(i);
          const isSelected = selected.has(letter);
          const isCorrectOption = correctSet.has(letter);
          // On reveal: emerald ring on the right answer, amber on a wrong
          // selection. NEVER red (§16) — a wrong answer is a step, not a fault.
          const revealTone = revealed
            ? isCorrectOption
              ? "border-emerald-500/70 bg-emerald-50 dark:bg-emerald-950/30"
              : isSelected
                ? "border-amber-500/70 bg-amber-50 dark:bg-amber-950/30"
                : "border-border opacity-70"
            : isSelected
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/50";

          return (
            <button
              key={`${question.slotId}-${letter}`}
              type="button"
              disabled={locked}
              aria-pressed={isSelected}
              onClick={() => {
                if (isMulti) {
                  const next = new Set(selected);
                  if (next.has(letter)) next.delete(letter);
                  else next.add(letter);
                  onChange(serialiseMsq(next));
                } else {
                  onChange(isSelected ? null : letter);
                }
              }}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg border-2 px-3 py-2.5 text-left transition-colors",
                revealTone,
                locked && "cursor-default"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-semibold",
                  isSelected
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground",
                  revealed && isCorrectOption && "border-transparent bg-emerald-600 text-white"
                )}
              >
                {revealed && isCorrectOption ? (
                  <Check className="size-3.5" />
                ) : (
                  letter
                )}
              </span>
              <span className="min-w-0 flex-1 pt-0.5 text-sm leading-relaxed">
                <RichQuestionText text={opt} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
