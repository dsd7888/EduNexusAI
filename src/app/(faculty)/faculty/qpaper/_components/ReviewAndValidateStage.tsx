"use client";

/**
 * Stage — "Review & Validate": renders the assembled paper preview once it has
 * been generated. Each sub-part / part is inline-editable, can be regenerated,
 * or saved back into the faculty Q Bank.
 *
 * Owns the local edit/regenerate UI state (editing key + draft, in-flight keys);
 * the assembled `paper` itself is shared state owned by the parent so it can be
 * exported elsewhere.
 */

import { useEffect, useRef, useState } from "react";
import { Flag, Library, Loader2, Pencil, RefreshCw, Save, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { RichQuestionText } from "@/components/RichQuestionText";
import { toast } from "sonner";
import {
  moduleRangeForSection,
  toTemplateQuestion,
  type AssembledPaper,
  type BuilderSection,
  type EditDraft,
  type GeneratedQuestion,
  type ModuleRow,
  type PoolItem,
  type QuestionPart,
  type SubQuestion,
  type TagValidation,
  type TemplatePoolQuestionPayload,
  type TemplateQuestionPayload,
} from "./shared";
import { BLOOMS_LEGEND } from "@/lib/qpaper/templates";
import {
  isPoolItemMcqLike,
  poolItemLabel,
  poolMarksPerItem,
} from "@/lib/qpaper/poolRender";

// ─── CO / BTL editable Selects (shared by every unit-level edit form) ────────
// PO stays display-only — it is derived server-side from CO and has no
// client-side option list, so it is intentionally not editable here.

const NONE_TAG = "__none__";

/** Atomic editable/regenerable unit within a question block. */
type UnitKind = "sub" | "part" | "pool";

function TagSelects({
  co,
  btl,
  coOptions,
  onChange,
}: {
  co: string | null | undefined;
  btl: number | null | undefined;
  /** Valid CO codes for the subject, plus the current value if it's off-list. */
  coOptions: string[];
  onChange: (patch: { co?: string | null; btl?: number | null }) => void;
}) {
  const coValue = co ?? NONE_TAG;
  const btlValue = btl != null ? String(btl) : NONE_TAG;
  return (
    <div className="flex items-center gap-2">
      <Select
        value={coValue}
        onValueChange={(v) => onChange({ co: v === NONE_TAG ? null : v })}
      >
        <SelectTrigger className="h-7 w-24 text-xs">
          <SelectValue placeholder="CO" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_TAG} className="text-xs">
            No CO
          </SelectItem>
          {coOptions.map((c) => (
            <SelectItem key={c} value={c} className="text-xs">
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={btlValue}
        onValueChange={(v) =>
          onChange({ btl: v === NONE_TAG ? null : Number(v) })
        }
      >
        <SelectTrigger className="h-7 w-32 text-xs">
          <SelectValue placeholder="BTL" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_TAG} className="text-xs">
            No BTL
          </SelectItem>
          {BLOOMS_LEGEND.map((b) => (
            <SelectItem key={b.level} value={String(b.level)} className="text-xs">
              BTL-{b.level} · {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Inline-edit action buttons (Save / Save to Bank / Cancel) ──────────────

function EditActions({
  onSave,
  onCancel,
  onSaveToBank,
  savingBank,
}: {
  onSave: () => void;
  onCancel: () => void;
  onSaveToBank: () => void;
  savingBank: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" className="h-7 text-xs" onClick={onSave}>
        <Save className="size-3 mr-1" />
        Save
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={onSaveToBank}
        disabled={savingBank}
      >
        {savingBank ? (
          <Loader2 className="size-3 mr-1 animate-spin" />
        ) : (
          <Library className="size-3 mr-1" />
        )}
        Save to Bank
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs"
        onClick={onCancel}
      >
        <X className="size-3 mr-1" />
        Cancel
      </Button>
    </div>
  );
}

// ─── CO/BTL tag-mismatch flag (amber) ───────────────────────────────────────
// Rendered only when a sub-part/part has a `validation` (i.e. matches===false).
// The flag toggles an inline panel with the judge's reasoning and two actions:
// instant relabel to the suggestion, or regenerate the whole question toward it.

function ValidationFlag({
  validation,
  open,
  onToggle,
  onUseSuggestion,
  onRegenerate,
  regenerating,
}: {
  validation: TagValidation;
  open: boolean;
  onToggle: () => void;
  onUseSuggestion: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const hasSuggestion =
    validation.suggestedCO != null || validation.suggestedBTL != null;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        onToggle();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onToggle]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        title="This tag may not match the question — click for details"
        onClick={onToggle}
        className="inline-flex items-center"
      >
        <Flag className="size-3.5 text-amber-500 fill-amber-400" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-md border bg-popover p-3 text-left shadow-md font-sans">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 mb-1">
            <Flag className="size-3.5" /> Tag may not match content
          </div>
          {validation.reasoning && (
            <p className="text-xs text-muted-foreground mb-2">
              {validation.reasoning}
            </p>
          )}
          {hasSuggestion && (
            <div className="text-[11px] mb-2">
              <span className="text-muted-foreground">Suggested: </span>
              {validation.suggestedCO && (
                <span className="font-mono">{validation.suggestedCO}</span>
              )}
              {validation.suggestedCO && validation.suggestedBTL != null && " · "}
              {validation.suggestedBTL != null && (
                <span className="font-mono">BTL-{validation.suggestedBTL}</span>
              )}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {hasSuggestion && (
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={onUseSuggestion}
              >
                Use suggested tag
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={onRegenerate}
              disabled={regenerating}
            >
              {regenerating ? (
                <Loader2 className="size-3 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="size-3 mr-1" />
              )}
              Regenerate instead
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Attached question image (bank-sourced); mirrors the PDF/Word export surfaces. */
function QuestionImage({ url }: { url?: string | null }) {
  if (!url) return null;
  return (
    <img
      src={url}
      alt="Question illustration"
      className="mt-1 ml-3 rounded-md max-h-48 w-auto object-contain border border-border/40"
    />
  );
}

// ─── Stage ──────────────────────────────────────────────────────────────────

interface ReviewAndValidateStageProps {
  paper: AssembledPaper | null;
  setPaper: React.Dispatch<React.SetStateAction<AssembledPaper | null>>;
  sections: BuilderSection[];
  modules: ModuleRow[];
  selectedModuleIds: string[];
  selectedSubjectId: string;
  /** Called after a question is saved into the bank (so the parent can bump its count). */
  onSavedToBank: () => void;
}

export function ReviewAndValidateStage({
  paper,
  setPaper,
  sections,
  modules,
  selectedModuleIds,
  selectedSubjectId,
  onSavedToBank,
}: ReviewAndValidateStageProps) {
  const [regenKey, setRegenKey] = useState<string | null>(null);
  // In-flight single-unit regenerations (keys: sIdx-qIdx-kind-idx). This is a
  // SET, not a single key, so several units can regenerate concurrently — each
  // is locked and unlocked independently (faculty routinely fire regen on a
  // few items back-to-back without waiting). `regenInFlight` mirrors it as a
  // ref for a synchronous double-click guard before React re-renders.
  const [regenUnitKeys, setRegenUnitKeys] = useState<Set<string>>(new Set());
  const regenInFlight = useRef<Set<string>>(new Set());
  /** Claim a unit's regen lock; returns false if it is already in flight. */
  const beginUnitRegen = (key: string): boolean => {
    if (regenInFlight.current.has(key)) return false;
    regenInFlight.current.add(key);
    setRegenUnitKeys((prev) => new Set(prev).add(key));
    return true;
  };
  const endUnitRegen = (key: string) => {
    regenInFlight.current.delete(key);
    setRegenUnitKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [savingBankKey, setSavingBankKey] = useState<string | null>(null);
  // Which tag-mismatch flag panel is currently open (key: sIdx-qIdx-kind-idx).
  const [flagKey, setFlagKey] = useState<string | null>(null);

  // ─── Shared per-section server context (modules for regen / validation) ──
  const sectionModulesForServer = (sIdx: number) => {
    const range = moduleRangeForSection(sIdx, modules, selectedModuleIds);
    return modules
      .filter(
        (m) => m.module_number >= range[0] && m.module_number <= range[1]
      )
      .map((m) => ({ module_number: m.module_number, name: m.name }));
  };
  const moduleContentForSection = (sIdx: number) =>
    sectionModulesForServer(sIdx)
      .map((m) => `Module ${m.module_number}: ${m.name}`)
      .join("\n");

  // ─── Regenerate single question ────────────────────────────────────────
  // `targetTags` (optional) steers the new question toward a specific CO/BTL —
  // used by the tag-mismatch flag's "Regenerate instead" action.
  const regenerateQuestion = async (
    sIdx: number,
    qIdx: number,
    targetTags?: { co?: string | null; btl?: number | null }
  ) => {
    if (!paper) return;
    const tplQ = sections[sIdx]?.questions[qIdx];
    if (!tplQ) return;
    const templateQuestion = toTemplateQuestion(tplQ, qIdx + 1);

    const existing = paper.sections[sIdx]?.questions[qIdx];
    const existingText = JSON.stringify(existing ?? {});
    const key = `${sIdx}-${qIdx}`;
    setRegenKey(key);

    try {
      const res = await fetch("/api/generate/qpaper/regenerate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_question: templateQuestion,
          section_modules: sectionModulesForServer(sIdx),
          pyq_context: "",
          co_po_data: { courseOutcomes: paper.courseOutcomes ?? [] },
          question_context: existingText,
          ...(targetTags ? { target_tags: targetTags } : {}),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { question: GeneratedQuestion };
      setPaper((prev) => {
        if (!prev) return prev;
        const next = { ...prev, sections: prev.sections.map((s) => ({ ...s })) };
        next.sections[sIdx] = {
          ...next.sections[sIdx],
          questions: next.sections[sIdx].questions.map((q, i) =>
            i === qIdx ? data.question : q
          ),
        };
        return next;
      });
      toast.success("Question regenerated");
    } catch (err) {
      console.error(err);
      toast.error("Failed to regenerate question");
    } finally {
      setRegenKey(null);
    }
  };

  // ─── Regenerate a single MCQ sub-part ───────────────────────────────────
  // Reuses the same route as regenerateQuestion, but asks for a single
  // sub_part (sub_parts: 1) and splices only that one item back in — the
  // other 5 sub-items and the question's own instruction/marks are untouched.
  const regenerateSubPart = async (
    sIdx: number,
    qIdx: number,
    subIdx: number
  ) => {
    if (!paper) return;
    const tplQ = sections[sIdx]?.questions[qIdx];
    const question = paper.sections[sIdx]?.questions[qIdx];
    if (!tplQ || !question || question.type !== "mcq") return;
    const sub = question.sub_parts?.[subIdx];
    if (!sub) return;

    const baseTemplate = toTemplateQuestion(tplQ, qIdx + 1) as TemplateQuestionPayload;
    const templateQuestion: TemplateQuestionPayload = {
      ...baseTemplate,
      sub_parts: 1,
      total_marks: baseTemplate.marks_per_part ?? baseTemplate.total_marks,
    };

    const key = `${sIdx}-${qIdx}-sub-${subIdx}`;
    if (!beginUnitRegen(key)) return;

    try {
      const res = await fetch("/api/generate/qpaper/regenerate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_question: templateQuestion,
          section_modules: sectionModulesForServer(sIdx),
          pyq_context: "",
          co_po_data: { courseOutcomes: paper.courseOutcomes ?? [] },
          question_context: JSON.stringify(question),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { question: GeneratedQuestion };
      const newSub = data.question.sub_parts?.[0];
      if (!newSub) throw new Error("No sub-question returned");
      setPaper((prev) => {
        if (!prev) return prev;
        const next = { ...prev, sections: prev.sections.map((s) => ({ ...s })) };
        const q = { ...next.sections[sIdx].questions[qIdx] };
        if (q.sub_parts) {
          // Keep this sub-item's original label (i)/(ii)/… — the route
          // always numbers a freshly generated sub_parts array from (i).
          q.sub_parts = q.sub_parts.map((s, i) =>
            i === subIdx ? { ...newSub, label: s.label } : s
          );
        }
        next.sections[sIdx].questions = next.sections[sIdx].questions.map(
          (orig, i) => (i === qIdx ? q : orig)
        );
        return next;
      });
      toast.success("Sub-question regenerated");
    } catch (err) {
      console.error(err);
      toast.error("Failed to regenerate sub-question");
    } finally {
      endUnitRegen(key);
    }
  };

  // ─── Regenerate a single descriptive / attempt-any part ─────────────────
  // Generalizes the MCQ sub-part pattern to q.parts: asks the route for ONE
  // fresh unit (a synthetic single-part "descriptive" template) and splices it
  // into parts[partIdx], preserving that part's label, marks, and OR-alternative
  // flag. Siblings and the block instruction stay byte-for-byte unchanged.
  const regeneratePart = async (
    sIdx: number,
    qIdx: number,
    partIdx: number
  ) => {
    if (!paper) return;
    const tplQ = sections[sIdx]?.questions[qIdx];
    const question = paper.sections[sIdx]?.questions[qIdx];
    if (!tplQ || !question) return;
    const part = question.parts?.[partIdx];
    if (!part) return;

    const baseTemplate = toTemplateQuestion(tplQ, qIdx + 1) as TemplateQuestionPayload;
    // Single-part descriptive template → route returns `parts: [one]`.
    const templateQuestion: TemplateQuestionPayload = {
      ...baseTemplate,
      type: "descriptive",
      sub_parts: undefined,
      parts: undefined,
      attempt_logic: null,
      total_marks: part.marks,
    };

    const key = `${sIdx}-${qIdx}-part-${partIdx}`;
    if (!beginUnitRegen(key)) return;

    try {
      const res = await fetch("/api/generate/qpaper/regenerate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_question: templateQuestion,
          section_modules: sectionModulesForServer(sIdx),
          pyq_context: "",
          co_po_data: { courseOutcomes: paper.courseOutcomes ?? [] },
          question_context: JSON.stringify(question),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { question: GeneratedQuestion };
      const newPart = data.question.parts?.[0];
      if (!newPart) throw new Error("No part returned");
      setPaper((prev) => {
        if (!prev) return prev;
        const next = { ...prev, sections: prev.sections.map((s) => ({ ...s })) };
        const q = { ...next.sections[sIdx].questions[qIdx] };
        if (q.parts) {
          q.parts = q.parts.map((p, i) =>
            i === partIdx
              ? {
                  // New content + tags, but keep this part's structural fields.
                  ...newPart,
                  label: p.label,
                  marks: p.marks,
                  is_or_alternative: p.is_or_alternative,
                }
              : p
          );
          // attempt_any_one shortfall self-heal: recompute how many options now
          // carry real content, capped at the configured total (mirrors pool).
          if (q.attempt_expected_count != null) {
            const nonBlank = q.parts.filter(
              (p) => (p.question ?? "").trim().length > 0
            ).length;
            q.attempt_returned_count = Math.min(q.attempt_expected_count, nonBlank);
          }
        }
        next.sections[sIdx].questions = next.sections[sIdx].questions.map(
          (orig, i) => (i === qIdx ? q : orig)
        );
        return next;
      });
      toast.success("Part regenerated");
    } catch (err) {
      console.error(err);
      toast.error("Failed to regenerate part");
    } finally {
      endUnitRegen(key);
    }
  };

  // ─── Regenerate a single pool item ──────────────────────────────────────
  // Sends a pool template with a single-row composition of this item's type;
  // the route returns a one-item pool, which we splice into items[itemIdx].
  // Positional labels ((i)/(ii)/…) are render-derived, so nothing to preserve.
  // Marks-per-item, the block instruction, attempt_logic, and sibling items are
  // untouched. Afterwards the shortfall (BUG-2) count is recomputed live.
  const regeneratePoolItem = async (
    sIdx: number,
    qIdx: number,
    itemIdx: number
  ) => {
    if (!paper) return;
    const tplQ = sections[sIdx]?.questions[qIdx];
    const question = paper.sections[sIdx]?.questions[qIdx];
    if (!tplQ || !question || question.type !== "pool") return;
    const item = question.items?.[itemIdx];
    if (!item) return;

    const baseTemplate = toTemplateQuestion(
      tplQ,
      qIdx + 1
    ) as TemplatePoolQuestionPayload;
    const perItem = poolMarksPerItem(question);
    const templateQuestion: TemplatePoolQuestionPayload = {
      ...baseTemplate,
      type: "pool",
      composition: [{ itemType: item.itemType, count: 1 }],
      attemptCount: 1,
      marksPerItem: perItem,
      total_marks: perItem,
    };

    const key = `${sIdx}-${qIdx}-pool-${itemIdx}`;
    if (!beginUnitRegen(key)) return;

    try {
      const res = await fetch("/api/generate/qpaper/regenerate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_question: templateQuestion,
          section_modules: sectionModulesForServer(sIdx),
          pyq_context: "",
          co_po_data: { courseOutcomes: paper.courseOutcomes ?? [] },
          question_context: JSON.stringify(question),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { question: GeneratedQuestion };
      const newItem = data.question.items?.[0];
      if (!newItem) throw new Error("No pool item returned");
      setPaper((prev) => {
        if (!prev) return prev;
        const next = { ...prev, sections: prev.sections.map((s) => ({ ...s })) };
        const q = { ...next.sections[sIdx].questions[qIdx] };
        if (q.items) {
          // Force the template item type — the block composition is authoritative.
          q.items = q.items.map((it, i) =>
            i === itemIdx ? { ...newItem, itemType: it.itemType } : it
          );
          // Recompute shortfall: how many items now carry real content, capped
          // at the expected count (so filling a padded blank clears the warning).
          const nonBlank = q.items.filter(
            (it) => (it.question_text ?? "").trim().length > 0
          ).length;
          if (q.pool_expected_count != null) {
            q.pool_returned_count = Math.min(q.pool_expected_count, nonBlank);
          }
        }
        next.sections[sIdx].questions = next.sections[sIdx].questions.map(
          (orig, i) => (i === qIdx ? q : orig)
        );
        return next;
      });
      toast.success("Pool item regenerated");
    } catch (err) {
      console.error(err);
      toast.error("Failed to regenerate pool item");
    } finally {
      endUnitRegen(key);
    }
  };

  // ─── Apply a suggested CO/BTL tag (instant relabel, no API call) ────────
  // Updates the sub-part/part's co/btl to the validator's suggestion and clears
  // its `validation` so the amber flag disappears.
  const applySuggestedTag = (
    sIdx: number,
    qIdx: number,
    kind: UnitKind,
    innerIdx: number
  ) => {
    setPaper((prev) => {
      if (!prev) return prev;
      const next = { ...prev, sections: prev.sections.map((s) => ({ ...s })) };
      const q = { ...next.sections[sIdx].questions[qIdx] };
      const relabel = <T extends { co?: string | null; btl?: number | null; validation?: TagValidation }>(
        u: T
      ): T => {
        const v = u.validation;
        if (!v) return u;
        return {
          ...u,
          co: v.suggestedCO != null ? v.suggestedCO : u.co,
          btl: v.suggestedBTL != null ? v.suggestedBTL : u.btl,
          validation: undefined,
        };
      };
      if (kind === "sub" && q.sub_parts) {
        q.sub_parts = q.sub_parts.map((s, i) => (i === innerIdx ? relabel(s) : s));
      } else if (kind === "part" && q.parts) {
        q.parts = q.parts.map((p, i) => (i === innerIdx ? relabel(p) : p));
      } else if (kind === "pool" && q.items) {
        q.items = q.items.map((it, i) => (i === innerIdx ? relabel(it) : it));
      }
      next.sections[sIdx].questions = next.sections[sIdx].questions.map(
        (orig, i) => (i === qIdx ? q : orig)
      );
      return next;
    });
    setFlagKey(null);
  };

  // ─── Inline edit ───────────────────────────────────────────────────────
  const beginEdit = (
    sIdx: number,
    qIdx: number,
    kind: UnitKind,
    innerIdx: number
  ) => {
    const q = paper?.sections[sIdx]?.questions[qIdx];
    if (!q) return;
    if (kind === "sub") {
      const sub = q.sub_parts?.[innerIdx];
      setEditDraft({
        question: sub?.question ?? "",
        options: sub?.options
          ? { ...sub.options }
          : { a: "", b: "", c: "", d: "" },
        correct_option: sub?.correct_option,
        model_answer: sub?.model_answer ?? "",
        co: sub?.co ?? null,
        btl: sub?.btl ?? null,
      });
    } else if (kind === "pool") {
      const item = q.items?.[innerIdx];
      setEditDraft({
        question: item?.question_text ?? "",
        options: item?.options
          ? { ...item.options }
          : { a: "", b: "", c: "", d: "" },
        model_answer: item?.model_answer ?? "",
        co: item?.co ?? null,
        btl: item?.btl ?? null,
      });
    } else {
      const part = q.parts?.[innerIdx];
      setEditDraft({
        question: part?.question ?? "",
        model_answer: part?.model_answer ?? "",
        co: part?.co ?? null,
        btl: part?.btl ?? null,
      });
    }
    setEditingKey(`${sIdx}-${qIdx}-${kind}-${innerIdx}`);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditDraft(null);
  };

  const saveEdit = async (
    sIdx: number,
    qIdx: number,
    kind: UnitKind,
    innerIdx: number
  ) => {
    const draft = editDraft;
    if (!draft || !paper) return cancelEdit();

    // Snapshot the pre-edit unit so we can tell what actually changed.
    const q0 = paper.sections[sIdx]?.questions[qIdx];
    const origUnit =
      kind === "sub"
        ? q0?.sub_parts?.[innerIdx]
        : kind === "pool"
          ? q0?.items?.[innerIdx]
          : q0?.parts?.[innerIdx];
    const origText =
      kind === "pool"
        ? (origUnit as PoolItem | undefined)?.question_text ?? ""
        : (origUnit as SubQuestion | QuestionPart | undefined)?.question ?? "";
    const origModel = origUnit?.model_answer ?? "";
    const origCO = origUnit?.co ?? null;
    const origBTL = origUnit?.btl ?? null;

    const newText = draft.question;
    const newModel = draft.model_answer || null;
    const newCO = draft.co ?? null;
    const newBTL = draft.btl ?? null;

    // Manual tag edit wins: skip auto re-validation and clear any stale flag.
    const tagsTouchedManually = newCO !== origCO || newBTL !== origBTL;
    const textChanged =
      newText !== origText || (newModel ?? "") !== (origModel ?? "");

    setPaper((prev) => {
      if (!prev) return prev;
      const next = { ...prev, sections: prev.sections.map((s) => ({ ...s })) };
      const q = { ...next.sections[sIdx].questions[qIdx] };
      if (kind === "sub" && q.sub_parts) {
        q.sub_parts = q.sub_parts.map((s, i) =>
          i === innerIdx
            ? {
                ...s,
                question: newText,
                options: draft.options ? { ...draft.options } : s.options,
                correct_option: draft.correct_option ?? s.correct_option,
                model_answer: newModel,
                co: newCO,
                btl: newBTL,
                validation: tagsTouchedManually ? undefined : s.validation,
              }
            : s
        );
      } else if (kind === "pool" && q.items) {
        q.items = q.items.map((it, i) =>
          i === innerIdx
            ? {
                ...it,
                question_text: newText,
                options:
                  isPoolItemMcqLike(it.itemType) && draft.options
                    ? { ...draft.options }
                    : it.options,
                model_answer: newModel,
                co: newCO,
                btl: newBTL,
                validation: tagsTouchedManually ? undefined : it.validation,
              }
            : it
        );
      } else if (kind === "part" && q.parts) {
        q.parts = q.parts.map((p, i) =>
          i === innerIdx
            ? {
                ...p,
                question: newText,
                model_answer: newModel,
                co: newCO,
                btl: newBTL,
                validation: tagsTouchedManually ? undefined : p.validation,
              }
            : p
        );
      }
      next.sections[sIdx].questions = next.sections[sIdx].questions.map(
        (orig, i) => (i === qIdx ? q : orig)
      );
      return next;
    });
    cancelEdit();

    // Re-validate tags only when the content changed and the faculty did NOT
    // manually set tags in this same edit. Non-blocking and fail-safe: on any
    // error we leave the (manually or previously) set tags untouched.
    if (!tagsTouchedManually && textChanged && newCO != null && newBTL != null) {
      try {
        const res = await fetch("/api/generate/qpaper/validate-tag", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionText: newText,
            claimedCO: newCO,
            claimedBTL: newBTL,
            courseOutcomes: paper.courseOutcomes ?? [],
            moduleContent: moduleContentForSection(sIdx),
          }),
        });
        if (!res.ok) return;
        const result = (await res.json()) as {
          co: string | null;
          btl: number | null;
          validation?: TagValidation;
        };
        setPaper((prev) => {
          if (!prev) return prev;
          const next = {
            ...prev,
            sections: prev.sections.map((s) => ({ ...s })),
          };
          const q = { ...next.sections[sIdx].questions[qIdx] };
          const apply = <
            T extends {
              co?: string | null;
              btl?: number | null;
              validation?: TagValidation;
            }
          >(
            u: T
          ): T => ({
            ...u,
            co: result.co,
            btl: result.btl,
            validation: result.validation,
          });
          if (kind === "sub" && q.sub_parts) {
            q.sub_parts = q.sub_parts.map((s, i) =>
              i === innerIdx ? apply(s) : s
            );
          } else if (kind === "pool" && q.items) {
            q.items = q.items.map((it, i) => (i === innerIdx ? apply(it) : it));
          } else if (kind === "part" && q.parts) {
            q.parts = q.parts.map((p, i) => (i === innerIdx ? apply(p) : p));
          }
          next.sections[sIdx].questions = next.sections[sIdx].questions.map(
            (orig, i) => (i === qIdx ? q : orig)
          );
          return next;
        });
      } catch (err) {
        console.error("[saveEdit] tag re-validation failed:", err);
      }
    }
  };

  // ─── Save an (edited) question into the faculty Q Bank ──────────────────
  const saveQuestionToBank = async (
    sIdx: number,
    qIdx: number,
    kind: UnitKind,
    innerIdx: number
  ) => {
    if (!selectedSubjectId) {
      toast.error("Select a subject first");
      return;
    }
    const q = paper?.sections[sIdx]?.questions[qIdx];
    if (!q) return;
    const key = `${sIdx}-${qIdx}-${kind}-${innerIdx}`;
    // Prefer the live draft when this unit is being edited.
    const editing = editingKey === key && editDraft ? editDraft : null;

    let payload: Record<string, unknown>;
    if (kind === "sub") {
      const sub = q.sub_parts?.[innerIdx];
      if (!sub) return;
      const opts = editing?.options ?? sub.options ?? {};
      const correct = (editing?.correct_option ?? sub.correct_option ?? "")
        .toString()
        .toUpperCase();
      const options = (["a", "b", "c", "d"] as const)
        .filter((k) => opts[k]?.trim())
        .map((k) => ({
          label: k.toUpperCase(),
          text: opts[k],
          is_correct: k.toUpperCase() === correct,
        }));
      payload = {
        subject_id: selectedSubjectId,
        question_text: editing?.question ?? sub.question,
        question_type: "mcq",
        marks: 1,
        options,
        model_answer: editing?.model_answer ?? sub.model_answer ?? "",
        co_code: editing?.co ?? sub.co ?? undefined,
        btl_level: editing?.btl ?? sub.btl ?? undefined,
      };
    } else if (kind === "pool") {
      const item = q.items?.[innerIdx];
      if (!item) return;
      const mcqLike = isPoolItemMcqLike(item.itemType);
      const opts = editing?.options ?? item.options ?? {};
      const options = mcqLike
        ? (["a", "b", "c", "d"] as const)
            .filter((k) => opts[k]?.trim())
            .map((k) => ({ label: k.toUpperCase(), text: opts[k] }))
        : undefined;
      payload = {
        subject_id: selectedSubjectId,
        question_text: editing?.question ?? item.question_text,
        // mcq-like pool items save as "mcq"; others map by their item type.
        question_type: mcqLike ? "mcq" : item.itemType,
        marks: poolMarksPerItem(q),
        ...(options ? { options } : {}),
        model_answer: editing?.model_answer ?? item.model_answer ?? "",
        co_code: editing?.co ?? item.co ?? undefined,
        btl_level: editing?.btl ?? item.btl ?? undefined,
      };
    } else {
      const part = q.parts?.[innerIdx];
      if (!part) return;
      payload = {
        subject_id: selectedSubjectId,
        question_text: editing?.question ?? part.question,
        question_type: q.type,
        marks: part.marks,
        model_answer: editing?.model_answer ?? part.model_answer ?? "",
        co_code: editing?.co ?? part.co ?? undefined,
        btl_level: editing?.btl ?? part.btl ?? undefined,
      };
    }

    setSavingBankKey(key);
    try {
      const res = await fetch("/api/qbank/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Saved to your Question Bank");
      // Reflect that the bank now has at least one question for this subject.
      onSavedToBank();
    } catch (err) {
      console.error(err);
      toast.error("Failed to save to bank");
    } finally {
      setSavingBankKey(null);
    }
  };

  if (!paper) return null;

  // Valid CO codes for the subject's edit-form Select. A unit's current CO is
  // appended when it's off-list, so an existing tag is never silently dropped.
  const baseCoOptions = (paper.courseOutcomes ?? [])
    .map((c) => c.co_code)
    .filter(Boolean);
  const coOptionsWith = (current?: string | null): string[] => {
    if (current && !baseCoOptions.includes(current)) {
      return [...baseCoOptions, current];
    }
    return baseCoOptions;
  };

  return (
    <Card className="p-6 space-y-4 font-serif">
      <div className="text-center space-y-1">
        <div className="text-lg font-bold">{paper.universityName}</div>
        {paper.examTitle && <div className="text-sm">{paper.examTitle}</div>}
        <div className="text-base font-semibold">
          {paper.courseCode} — {paper.courseName}
        </div>
        <div className="flex justify-between text-xs px-2 pt-1">
          <span>Date: {paper.date ?? "______________"}&nbsp;&nbsp;&nbsp;&nbsp;Time: {paper.duration} Minutes</span>
          <span className="font-semibold">
            Maximum Marks: {paper.totalMarks}
          </span>
        </div>
      </div>

      {paper.instructions.length > 0 && (
        <div className="text-xs border rounded p-3">
          <div className="font-semibold mb-1">Instructions:</div>
          <ol className="list-decimal pl-5 space-y-0.5">
            {paper.instructions.map((ins, i) => (
              <li key={i}>{ins}</li>
            ))}
          </ol>
        </div>
      )}

      {paper.sections.map((section, sIdx) => (
        <div key={sIdx} className="space-y-3">
          <div className="text-center font-bold underline">
            {section.section_name.toUpperCase()}
          </div>

          {section.questions.map((q, qIdx) => (
            <div key={qIdx} className="border rounded p-3 space-y-2 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="font-semibold">
                  {q.display_label ?? `Q - ${q.q_number}`}
                  {q.instruction ? (
                    <span className="font-normal ml-2">{q.instruction}</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {q.from_bank && (
                    <Badge
                      variant="outline"
                      className="text-[10px] border-emerald-300 bg-emerald-50 text-emerald-700"
                      title="Sourced from your Question Bank"
                    >
                      📚 From Bank
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-[10px]">
                    [{String(q.total_marks).padStart(2, "0")}]
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={regenKey === `${sIdx}-${qIdx}`}
                    onClick={() => regenerateQuestion(sIdx, qIdx)}
                    title="Regenerate this question"
                  >
                    {regenKey === `${sIdx}-${qIdx}` ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                  </Button>
                </div>
              </div>

              {q.sub_parts?.map((sub, si) => {
                const k = `${sIdx}-${qIdx}-sub-${si}`;
                const isEditing = editingKey === k && editDraft;
                return (
                  <div key={si} className="ml-3 space-y-1">
                    {isEditing ? (
                      <div className="space-y-2 border rounded p-2 bg-muted/30">
                        <Textarea
                          value={editDraft.question}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              question: e.target.value,
                            })
                          }
                          className="text-xs"
                          rows={2}
                          placeholder="Question text"
                        />
                        <div className="space-y-1">
                          {(["a", "b", "c", "d"] as const).map((kk) => (
                            <div key={kk} className="flex items-center gap-2">
                              <button
                                type="button"
                                title="Mark correct option"
                                onClick={() =>
                                  setEditDraft({
                                    ...editDraft,
                                    correct_option: kk,
                                  })
                                }
                                className={cn(
                                  "size-5 shrink-0 rounded-full border text-[10px] font-bold",
                                  (editDraft.correct_option ?? "")
                                    .toString()
                                    .toLowerCase() === kk
                                    ? "bg-emerald-500 text-white border-emerald-500"
                                    : "text-muted-foreground"
                                )}
                              >
                                {kk.toUpperCase()}
                              </button>
                              <Input
                                value={editDraft.options?.[kk] ?? ""}
                                onChange={(e) =>
                                  setEditDraft({
                                    ...editDraft,
                                    options: {
                                      ...(editDraft.options ?? {}),
                                      [kk]: e.target.value,
                                    },
                                  })
                                }
                                className="h-7 text-xs"
                                placeholder={`Option ${kk.toUpperCase()}`}
                              />
                            </div>
                          ))}
                        </div>
                        <Textarea
                          value={editDraft.model_answer}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              model_answer: e.target.value,
                            })
                          }
                          className="text-xs"
                          rows={2}
                          placeholder="Model answer (optional, used in answer key)"
                        />
                        <TagSelects
                          co={editDraft.co}
                          btl={editDraft.btl}
                          coOptions={coOptionsWith(editDraft.co ?? sub.co)}
                          onChange={(patch) =>
                            setEditDraft({ ...editDraft, ...patch })
                          }
                        />
                        <EditActions
                          onSave={() => saveEdit(sIdx, qIdx, "sub", si)}
                          onCancel={cancelEdit}
                          onSaveToBank={() =>
                            saveQuestionToBank(sIdx, qIdx, "sub", si)
                          }
                          savingBank={savingBankKey === k}
                        />
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <span className="font-mono mr-1">{sub.label}</span>
                            <RichQuestionText text={sub.question} />
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {sub.co && (
                              <Badge
                                variant="outline"
                                className="text-[10px] border-blue-300 bg-blue-50 text-blue-700"
                              >
                                {sub.co}
                              </Badge>
                            )}
                            {sub.btl != null && (
                              <Badge
                                variant="outline"
                                className="text-[10px] border-violet-300 bg-violet-50 text-violet-700"
                              >
                                BTL-{sub.btl}
                              </Badge>
                            )}
                            {sub.po && (
                              <Badge
                                variant="outline"
                                className="text-[10px] border-amber-300 bg-amber-50 text-amber-700"
                              >
                                {sub.po}
                              </Badge>
                            )}
                            {sub.validation && (
                              <ValidationFlag
                                validation={sub.validation}
                                open={flagKey === k}
                                onToggle={() =>
                                  setFlagKey((cur) => (cur === k ? null : k))
                                }
                                onUseSuggestion={() =>
                                  applySuggestedTag(sIdx, qIdx, "sub", si)
                                }
                                onRegenerate={() => {
                                  setFlagKey(null);
                                  regenerateQuestion(sIdx, qIdx, {
                                    co: sub.validation?.suggestedCO ?? sub.co,
                                    btl: sub.validation?.suggestedBTL ?? sub.btl,
                                  });
                                }}
                                regenerating={regenKey === `${sIdx}-${qIdx}`}
                              />
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-6"
                              title="Edit"
                              onClick={() => beginEdit(sIdx, qIdx, "sub", si)}
                            >
                              <Pencil className="size-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-6"
                              title="Save to Q Bank"
                              disabled={savingBankKey === k}
                              onClick={() =>
                                saveQuestionToBank(sIdx, qIdx, "sub", si)
                              }
                            >
                              {savingBankKey === k ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Library className="size-3" />
                              )}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-6"
                              title="Regenerate this sub-question"
                              disabled={regenUnitKeys.has(k)}
                              onClick={() =>
                                regenerateSubPart(sIdx, qIdx, si)
                              }
                            >
                              {regenUnitKeys.has(k) ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <RefreshCw className="size-3" />
                              )}
                            </Button>
                          </div>
                        </div>
                        {sub.options && (
                          <div className="ml-4 grid grid-cols-2 gap-x-4 text-xs text-muted-foreground">
                            {(["a", "b", "c", "d"] as const).map(
                              (kk) =>
                                sub.options?.[kk] && (
                                  <div key={kk}>
                                    {kk}) {sub.options[kk]}
                                  </div>
                                )
                            )}
                          </div>
                        )}
                        <QuestionImage url={sub.image_url} />
                      </>
                    )}
                  </div>
                );
              })}

              {q.type === "pool" &&
                q.items?.map((item, ii) => {
                  const k = `${sIdx}-${qIdx}-pool-${ii}`;
                  const isEditing = editingKey === k && editDraft;
                  const mcqLike = isPoolItemMcqLike(item.itemType);
                  const label = poolItemLabel(ii);
                  const marks = poolMarksPerItem(q);
                  // Shortfall (BUG-2): a padded blank item the AI never
                  // generated. Render a distinct "Generate this item" affordance
                  // instead of an empty editable row so it reads as ungenerated,
                  // not as an empty edit. Regenerating fills it in place.
                  const isBlank = (item.question_text ?? "").trim().length === 0;
                  return (
                    <div key={ii} className="ml-3 space-y-1">
                      {isEditing ? (
                        <div className="space-y-2 border rounded p-2 bg-muted/30">
                          <Textarea
                            value={editDraft.question}
                            onChange={(e) =>
                              setEditDraft({
                                ...editDraft,
                                question: e.target.value,
                              })
                            }
                            className="text-xs"
                            rows={2}
                            placeholder="Question text"
                          />
                          {item.itemType === "mcq" && (
                            <div className="space-y-1">
                              {(["a", "b", "c", "d"] as const).map((kk) => (
                                <Input
                                  key={kk}
                                  value={editDraft.options?.[kk] ?? ""}
                                  onChange={(e) =>
                                    setEditDraft({
                                      ...editDraft,
                                      options: {
                                        ...(editDraft.options ?? {}),
                                        [kk]: e.target.value,
                                      },
                                    })
                                  }
                                  className="h-7 text-xs"
                                  placeholder={`Option ${kk.toUpperCase()}`}
                                />
                              ))}
                            </div>
                          )}
                          <Textarea
                            value={editDraft.model_answer}
                            onChange={(e) =>
                              setEditDraft({
                                ...editDraft,
                                model_answer: e.target.value,
                              })
                            }
                            className="text-xs"
                            rows={2}
                            placeholder="Model answer (optional, used in answer key)"
                          />
                          <TagSelects
                            co={editDraft.co}
                            btl={editDraft.btl}
                            coOptions={coOptionsWith(editDraft.co ?? item.co)}
                            onChange={(patch) =>
                              setEditDraft({ ...editDraft, ...patch })
                            }
                          />
                          <EditActions
                            onSave={() => saveEdit(sIdx, qIdx, "pool", ii)}
                            onCancel={cancelEdit}
                            onSaveToBank={() =>
                              saveQuestionToBank(sIdx, qIdx, "pool", ii)
                            }
                            savingBank={savingBankKey === k}
                          />
                        </div>
                      ) : isBlank ? (
                        <div className="flex items-center justify-between gap-3 rounded border border-dashed border-amber-300 bg-amber-50/50 px-3 py-2">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">{label}</span>
                            <span className="italic">
                              Not generated yet — this item came up short.
                            </span>
                            <Badge variant="outline" className="text-[10px]">
                              [{String(marks).padStart(2, "0")}]
                            </Badge>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 text-xs"
                            disabled={regenUnitKeys.has(k)}
                            onClick={() => regeneratePoolItem(sIdx, qIdx, ii)}
                          >
                            {regenUnitKeys.has(k) ? (
                              <Loader2 className="size-3 mr-1 animate-spin" />
                            ) : (
                              <RefreshCw className="size-3 mr-1" />
                            )}
                            Generate this item
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <span className="font-mono mr-1">{label}</span>
                              <RichQuestionText text={item.question_text} />
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Badge variant="outline" className="text-[10px]">
                                [{String(marks).padStart(2, "0")}]
                              </Badge>
                              {item.co && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-blue-300 bg-blue-50 text-blue-700"
                                >
                                  {item.co}
                                </Badge>
                              )}
                              {item.btl != null && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-violet-300 bg-violet-50 text-violet-700"
                                >
                                  BTL-{item.btl}
                                </Badge>
                              )}
                              {item.po && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-amber-300 bg-amber-50 text-amber-700"
                                >
                                  {item.po}
                                </Badge>
                              )}
                              {item.validation && (
                                <ValidationFlag
                                  validation={item.validation}
                                  open={flagKey === k}
                                  onToggle={() =>
                                    setFlagKey((cur) => (cur === k ? null : k))
                                  }
                                  onUseSuggestion={() =>
                                    applySuggestedTag(sIdx, qIdx, "pool", ii)
                                  }
                                  onRegenerate={() => {
                                    setFlagKey(null);
                                    regeneratePoolItem(sIdx, qIdx, ii);
                                  }}
                                  regenerating={regenUnitKeys.has(k)}
                                />
                              )}
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-6"
                                title="Edit"
                                onClick={() => beginEdit(sIdx, qIdx, "pool", ii)}
                              >
                                <Pencil className="size-3" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-6"
                                title="Save to Q Bank"
                                disabled={savingBankKey === k}
                                onClick={() =>
                                  saveQuestionToBank(sIdx, qIdx, "pool", ii)
                                }
                              >
                                {savingBankKey === k ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  <Library className="size-3" />
                                )}
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-6"
                                title="Regenerate this pool item"
                                disabled={regenUnitKeys.has(k)}
                                onClick={() =>
                                  regeneratePoolItem(sIdx, qIdx, ii)
                                }
                              >
                                {regenUnitKeys.has(k) ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  <RefreshCw className="size-3" />
                                )}
                              </Button>
                            </div>
                          </div>
                          {mcqLike && item.options && (
                            <div className="ml-4 grid grid-cols-2 gap-x-4 text-xs text-muted-foreground">
                              {(["a", "b", "c", "d"] as const).map(
                                (kk) =>
                                  item.options?.[kk] && (
                                    <div key={kk}>
                                      {kk}) {item.options[kk]}
                                    </div>
                                  )
                              )}
                            </div>
                          )}
                          <QuestionImage url={item.image_url} />
                        </>
                      )}
                    </div>
                  );
                })}

              {q.type !== "pool" &&
                q.parts?.map((part, pi) => {
                const k = `${sIdx}-${qIdx}-part-${pi}`;
                const isOrAlternative = part.is_or_alternative;
                const showOrSeparator =
                  isOrAlternative &&
                  (pi === 0 || !q.parts?.[pi - 1]?.is_or_alternative);
                const labelClean = part.label
                  ? String(part.label).replace(/^\(/, "").replace(/\)$/, "")
                  : null;
                const isEditing = editingKey === k && editDraft;
                return (
                  <div key={pi}>
                    {showOrSeparator && (
                      <div className="text-center text-xs italic my-2">OR</div>
                    )}
                    {isEditing ? (
                      <div className="ml-3 space-y-2 border rounded p-2 bg-muted/30">
                        <Textarea
                          value={editDraft.question}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              question: e.target.value,
                            })
                          }
                          className="text-xs"
                          rows={3}
                          placeholder="Question text"
                        />
                        <Textarea
                          value={editDraft.model_answer}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              model_answer: e.target.value,
                            })
                          }
                          className="text-xs"
                          rows={2}
                          placeholder="Model answer (optional, used in answer key)"
                        />
                        <TagSelects
                          co={editDraft.co}
                          btl={editDraft.btl}
                          coOptions={coOptionsWith(editDraft.co ?? part.co)}
                          onChange={(patch) =>
                            setEditDraft({ ...editDraft, ...patch })
                          }
                        />
                        <EditActions
                          onSave={() => saveEdit(sIdx, qIdx, "part", pi)}
                          onCancel={cancelEdit}
                          onSaveToBank={() =>
                            saveQuestionToBank(sIdx, qIdx, "part", pi)
                          }
                          savingBank={savingBankKey === k}
                        />
                      </div>
                    ) : (
                      <div className="ml-3 flex items-start justify-between gap-3">
                        <div className="flex-1">
                          {labelClean && (
                            <span className="font-semibold mr-1">
                              ({labelClean})
                            </span>
                          )}
                          <RichQuestionText text={part.question} />
                        </div>
                        <Badge
                          variant="outline"
                          className="text-[10px] shrink-0"
                        >
                          [{String(part.marks).padStart(2, "0")}]
                        </Badge>
                        {part.co && (
                          <Badge
                            variant="outline"
                            className="text-[10px] shrink-0 border-blue-300 bg-blue-50 text-blue-700"
                          >
                            {part.co}
                          </Badge>
                        )}
                        {part.btl != null && (
                          <Badge
                            variant="outline"
                            className="text-[10px] shrink-0 border-violet-300 bg-violet-50 text-violet-700"
                          >
                            BTL-{part.btl}
                          </Badge>
                        )}
                        {part.po && (
                          <Badge
                            variant="outline"
                            className="text-[10px] shrink-0 border-amber-300 bg-amber-50 text-amber-700"
                          >
                            {part.po}
                          </Badge>
                        )}
                        {part.validation && (
                          <ValidationFlag
                            validation={part.validation}
                            open={flagKey === k}
                            onToggle={() =>
                              setFlagKey((cur) => (cur === k ? null : k))
                            }
                            onUseSuggestion={() =>
                              applySuggestedTag(sIdx, qIdx, "part", pi)
                            }
                            onRegenerate={() => {
                              setFlagKey(null);
                              regenerateQuestion(sIdx, qIdx, {
                                co: part.validation?.suggestedCO ?? part.co,
                                btl: part.validation?.suggestedBTL ?? part.btl,
                              });
                            }}
                            regenerating={regenKey === `${sIdx}-${qIdx}`}
                          />
                        )}
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-6"
                            title="Edit"
                            onClick={() => beginEdit(sIdx, qIdx, "part", pi)}
                          >
                            <Pencil className="size-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-6"
                            title="Save to Q Bank"
                            disabled={savingBankKey === k}
                            onClick={() =>
                              saveQuestionToBank(sIdx, qIdx, "part", pi)
                            }
                          >
                            {savingBankKey === k ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Library className="size-3" />
                            )}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-6"
                            title="Regenerate this part"
                            disabled={regenUnitKeys.has(k)}
                            onClick={() => regeneratePart(sIdx, qIdx, pi)}
                          >
                            {regenUnitKeys.has(k) ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <RefreshCw className="size-3" />
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                    {!isEditing && <QuestionImage url={part.image_url} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </Card>
  );
}
