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

import { useState } from "react";
import { Flag, Library, Loader2, Pencil, RefreshCw, Save, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  type QuestionPart,
  type SubQuestion,
  type TagValidation,
  type TemplateQuestionPayload,
} from "./shared";
import {
  isPoolItemMcqLike,
  poolItemToPart,
  poolItemToSubQuestion,
  poolMarksPerItem,
} from "@/lib/qpaper/poolRender";

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
  return (
    <div className="relative inline-block">
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

/** Read-only MCQ / true-false sub-part row (shared by MCQ blocks and pool items). */
function SubPartDisplay({ sub }: { sub: SubQuestion }) {
  return (
    <div className="ml-3 space-y-1">
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
    </div>
  );
}

/** Read-only descriptive / attempt-any option row (shared by those blocks and pool items). */
function PartDisplay({ part }: { part: QuestionPart }) {
  const labelClean = part.label
    ? String(part.label).replace(/^\(/, "").replace(/\)$/, "")
    : null;
  return (
    <div>
      <div className="ml-3 flex items-start justify-between gap-3">
        <div className="flex-1">
          {labelClean && (
            <span className="font-semibold mr-1">({labelClean})</span>
          )}
          <RichQuestionText text={part.question} />
        </div>
        <Badge variant="outline" className="text-[10px] shrink-0">
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
      </div>
      <QuestionImage url={part.image_url} />
    </div>
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
  const [regenSubKey, setRegenSubKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [savingBankKey, setSavingBankKey] = useState<string | null>(null);
  // Which tag-mismatch flag panel is currently open (key: sIdx-qIdx-kind-idx).
  const [flagKey, setFlagKey] = useState<string | null>(null);

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
    const sectionRange = moduleRangeForSection(
      sIdx,
      modules,
      selectedModuleIds
    );
    const sectionModulesForServer = modules
      .filter(
        (m) =>
          m.module_number >= sectionRange[0] &&
          m.module_number <= sectionRange[1]
      )
      .map((m) => ({
        module_number: m.module_number,
        name: m.name,
      }));

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
          section_modules: sectionModulesForServer,
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
    const sectionRange = moduleRangeForSection(
      sIdx,
      modules,
      selectedModuleIds
    );
    const sectionModulesForServer = modules
      .filter(
        (m) =>
          m.module_number >= sectionRange[0] &&
          m.module_number <= sectionRange[1]
      )
      .map((m) => ({
        module_number: m.module_number,
        name: m.name,
      }));

    const key = `${sIdx}-${qIdx}-${subIdx}`;
    setRegenSubKey(key);

    try {
      const res = await fetch("/api/generate/qpaper/regenerate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_question: templateQuestion,
          section_modules: sectionModulesForServer,
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
      setRegenSubKey(null);
    }
  };

  // ─── Apply a suggested CO/BTL tag (instant relabel, no API call) ────────
  // Updates the sub-part/part's co/btl to the validator's suggestion and clears
  // its `validation` so the amber flag disappears.
  const applySuggestedTag = (
    sIdx: number,
    qIdx: number,
    kind: "sub" | "part",
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
    kind: "sub" | "part",
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
      });
    } else {
      const part = q.parts?.[innerIdx];
      setEditDraft({
        question: part?.question ?? "",
        model_answer: part?.model_answer ?? "",
      });
    }
    setEditingKey(`${sIdx}-${qIdx}-${kind}-${innerIdx}`);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditDraft(null);
  };

  const saveEdit = (
    sIdx: number,
    qIdx: number,
    kind: "sub" | "part",
    innerIdx: number
  ) => {
    const draft = editDraft;
    if (!draft) return cancelEdit();
    setPaper((prev) => {
      if (!prev) return prev;
      const next = { ...prev, sections: prev.sections.map((s) => ({ ...s })) };
      const q = { ...next.sections[sIdx].questions[qIdx] };
      if (kind === "sub" && q.sub_parts) {
        q.sub_parts = q.sub_parts.map((s, i) =>
          i === innerIdx
            ? {
                ...s,
                question: draft.question,
                options: draft.options ? { ...draft.options } : s.options,
                correct_option: draft.correct_option ?? s.correct_option,
                model_answer: draft.model_answer || null,
              }
            : s
        );
      } else if (kind === "part" && q.parts) {
        q.parts = q.parts.map((p, i) =>
          i === innerIdx
            ? {
                ...p,
                question: draft.question,
                model_answer: draft.model_answer || null,
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
  };

  // ─── Save an (edited) question into the faculty Q Bank ──────────────────
  const saveQuestionToBank = async (
    sIdx: number,
    qIdx: number,
    kind: "sub" | "part",
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
        co_code: sub.co ?? undefined,
        btl_level: sub.btl ?? undefined,
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
        co_code: part.co ?? undefined,
        btl_level: part.btl ?? undefined,
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
                              disabled={regenSubKey === `${sIdx}-${qIdx}-${si}`}
                              onClick={() =>
                                regenerateSubPart(sIdx, qIdx, si)
                              }
                            >
                              {regenSubKey === `${sIdx}-${qIdx}-${si}` ? (
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
                q.items?.map((item, ii) =>
                  isPoolItemMcqLike(item.itemType) ? (
                    <SubPartDisplay
                      key={ii}
                      sub={poolItemToSubQuestion(item, ii)}
                    />
                  ) : (
                    <PartDisplay
                      key={ii}
                      part={poolItemToPart(item, ii, poolMarksPerItem(q))}
                    />
                  )
                )}

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
