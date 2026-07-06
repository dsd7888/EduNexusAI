"use client";

/**
 * Card-by-card review dialog for verifying Q Bank questions. Steps through a
 * batch one at a time with inline tag editing, optional model-answer peek,
 * and approve / skip actions. Stateless per open — remounting restarts fresh.
 */

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { RichQuestionText } from "@/components/RichQuestionText";
import type { BankQuestion, QuestionType } from "@/lib/qbank/types";
import {
  QUESTION_TYPES,
  TYPE_LABELS,
  patchQuestion,
  type ModuleRef,
} from "./shared";

type QuestionStatus = "pending" | "approved" | "skipped";

interface TagDraft {
  question_type: QuestionType;
  marks: string;
  co_code: string;
  btl_level: string;
  difficulty: string;
  module_id: string;
}

function toTagDraft(q: BankQuestion): TagDraft {
  return {
    question_type: q.question_type,
    marks: String(q.marks),
    co_code: q.co_code ?? "",
    btl_level: q.btl_level != null ? String(q.btl_level) : "",
    difficulty: q.difficulty ?? "",
    module_id: q.module_id ?? "",
  };
}

function initStatuses(questions: BankQuestion[]): Map<string, QuestionStatus> {
  return new Map(questions.map((q) => [q.id, "pending"]));
}

export function ReviewFlowDialog({
  questions,
  modules,
  onClose,
  onQuestionUpdated,
  onQuestionApproved,
}: {
  questions: BankQuestion[];
  modules: ModuleRef[];
  onClose: (completed?: boolean) => void;
  onQuestionUpdated: (q: BankQuestion) => void;
  onQuestionApproved: (id: string) => void;
}) {
  const total = questions.length;
  const [index, setIndex] = useState(0);
  const [statuses, setStatuses] = useState<Map<string, QuestionStatus>>(() =>
    initStatuses(questions)
  );
  const [showSummary, setShowSummary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modelAnswerOpen, setModelAnswerOpen] = useState(false);
  const [draft, setDraft] = useState<TagDraft | null>(null);

  const approvedCount = useMemo(
    () => [...statuses.values()].filter((s) => s === "approved").length,
    [statuses]
  );
  const skippedCount = useMemo(
    () => [...statuses.values()].filter((s) => s === "skipped").length,
    [statuses]
  );
  const handledCount = approvedCount + skippedCount;

  const current = questions[Math.min(index, Math.max(0, total - 1))] ?? null;

  useEffect(() => {
    if (current) {
      setDraft(toTagDraft(current));
      setModelAnswerOpen(false);
    }
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const progressPct = total === 0 ? 0 : Math.round((handledCount / total) * 100);

  const goToNextPending = () => {
    const nextIdx = questions.findIndex(
      (q, i) => i > index && statuses.get(q.id) === "pending"
    );
    if (nextIdx !== -1) {
      setIndex(nextIdx);
      return;
    }
    const firstPending = questions.findIndex(
      (q) => statuses.get(q.id) === "pending"
    );
    if (firstPending !== -1) {
      setIndex(firstPending);
    }
  };

  const allHandled = handledCount >= total;

  const handleSkip = () => {
    if (!current) return;
    setStatuses((prev) => new Map(prev).set(current.id, "skipped"));
    goToNextPending();
  };

  const handleApproveAsIs = async () => {
    if (!current) return;
    setSaving(true);
    try {
      const updated = await patchQuestion(current.id, { is_verified: true });
      onQuestionUpdated(updated);
      onQuestionApproved(current.id);
      setStatuses((prev) => new Map(prev).set(current.id, "approved"));
      toast.success("Approved");
      goToNextPending();
    } catch (err) {
      console.error(err);
      toast.error("Failed to approve question");
    } finally {
      setSaving(false);
    }
  };

  const handleEditAndSave = async () => {
    if (!current || !draft) return;
    const marks = Number(draft.marks);
    if (!Number.isFinite(marks) || marks <= 0) {
      toast.error("Marks must be a positive number");
      return;
    }
    setSaving(true);
    try {
      const patch: Partial<BankQuestion> = {
        question_type: draft.question_type,
        marks,
        co_code: draft.co_code.trim() || null,
        btl_level: draft.btl_level ? Number(draft.btl_level) : null,
        difficulty: (draft.difficulty as BankQuestion["difficulty"]) || null,
        module_id: draft.module_id || null,
        is_verified: true,
      };
      const updated = await patchQuestion(current.id, patch);
      onQuestionUpdated(updated);
      onQuestionApproved(current.id);
      setStatuses((prev) => new Map(prev).set(current.id, "approved"));
      toast.success("Saved & approved");
      goToNextPending();
    } catch (err) {
      console.error(err);
      toast.error("Failed to save question");
    } finally {
      setSaving(false);
    }
  };

  if (total === 0) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose(false)}>
        <DialogContent className="max-w-md">
          <p className="text-sm text-muted-foreground py-4 text-center">
            No questions to review.
          </p>
          <DialogFooter>
            <Button onClick={() => onClose(true)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 p-0 overflow-hidden",
          "top-0 left-0 translate-x-0 translate-y-0 h-[100dvh] w-full max-w-none rounded-none",
          "sm:top-[50%] sm:left-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%]",
          "sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-lg sm:w-full"
        )}
      >
        {showSummary ? (
          <div className="p-6 space-y-4 text-center">
            <CheckCircle2 className="size-10 mx-auto text-emerald-500" />
            <p className="text-sm">
              Reviewed {handledCount} of {total}.{" "}
              <span className="text-emerald-500 font-medium">
                {approvedCount} approved
              </span>
              {skippedCount > 0 && (
                <>
                  ,{" "}
                  <span className="text-muted-foreground">
                    {skippedCount} skipped
                  </span>
                </>
              )}
              .
            </p>
            <Button onClick={() => onClose(true)}>Close</Button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="shrink-0 border-b px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <DialogHeader className="text-left space-y-0">
                  <DialogTitle className="text-base">
                    Reviewing {index + 1}/{total}
                  </DialogTitle>
                </DialogHeader>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    disabled={index === 0 || saving}
                    onClick={() => setIndex((i) => Math.max(0, i - 1))}
                    aria-label="Previous question"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    disabled={index >= total - 1 || saving}
                    onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
                    aria-label="Next question"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={saving}
                    onClick={handleSkip}
                  >
                    Skip this one
                  </Button>
                </div>
              </div>
              <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Body */}
            {current && draft && (
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
                {current.image_url && (
                  <img
                    src={current.image_url}
                    alt="Question illustration"
                    className="rounded-md max-h-48 w-auto object-contain border border-border/40"
                  />
                )}

                <RichQuestionText
                  text={current.question_text}
                  className="text-sm leading-relaxed"
                />

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div>
                    <span className="text-[10px] text-muted-foreground">
                      Type
                    </span>
                    <Select
                      value={draft.question_type}
                      onValueChange={(v) =>
                        setDraft({
                          ...draft,
                          question_type: v as QuestionType,
                        })
                      }
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {QUESTION_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {TYPE_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <LabeledInput
                    label="Marks"
                    value={draft.marks}
                    onChange={(v) => setDraft({ ...draft, marks: v })}
                    type="number"
                  />
                  <LabeledInput
                    label="CO"
                    value={draft.co_code}
                    onChange={(v) => setDraft({ ...draft, co_code: v })}
                    placeholder="CO2"
                  />
                  <div>
                    <span className="text-[10px] text-muted-foreground">
                      BTL
                    </span>
                    <Select
                      value={draft.btl_level || "none"}
                      onValueChange={(v) =>
                        setDraft({
                          ...draft,
                          btl_level: v === "none" ? "" : v,
                        })
                      }
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {[1, 2, 3, 4, 5, 6].map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            BTL {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground">
                      Difficulty
                    </span>
                    <Select
                      value={draft.difficulty || "none"}
                      onValueChange={(v) =>
                        setDraft({
                          ...draft,
                          difficulty: v === "none" ? "" : v,
                        })
                      }
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {["easy", "medium", "hard"].map((d) => (
                          <SelectItem key={d} value={d}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {modules.length > 0 && (
                    <div>
                      <span className="text-[10px] text-muted-foreground">
                        Module
                      </span>
                      <Select
                        value={draft.module_id || "none"}
                        onValueChange={(v) =>
                          setDraft({
                            ...draft,
                            module_id: v === "none" ? "" : v,
                          })
                        }
                      >
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {modules.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              M{m.module_number} — {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {current.question_type === "mcq" &&
                  current.options &&
                  current.options.length > 0 && (
                    <div className="space-y-1">
                      {current.options.map((o) => (
                        <div
                          key={o.label}
                          className={cn(
                            "flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs",
                            o.is_correct
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "text-muted-foreground"
                          )}
                        >
                          <span className="font-semibold shrink-0">
                            {o.label}.
                          </span>
                          <span className="flex-1">{o.text}</span>
                          {o.is_correct && (
                            <CheckCircle2 className="size-3.5 shrink-0 mt-0.5" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                {current.model_answer && (
                  <div className="border rounded-md">
                    <button
                      type="button"
                      onClick={() => setModelAnswerOpen((v) => !v)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-muted/50 transition-colors"
                    >
                      {modelAnswerOpen ? (
                        <ChevronDown className="size-3.5 shrink-0" />
                      ) : (
                        <ChevronRight className="size-3.5 shrink-0" />
                      )}
                      Model Answer
                    </button>
                    {modelAnswerOpen && (
                      <div className="px-3 pb-3 text-xs text-muted-foreground border-t">
                        <RichQuestionText
                          text={current.model_answer}
                          className="pt-2"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <DialogFooter className="shrink-0 border-t px-4 py-3 flex-col sm:flex-row gap-2">
              {allHandled ? (
                <Button
                  className="w-full sm:ml-auto sm:w-auto"
                  onClick={() => setShowSummary(true)}
                >
                  Finish review
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={saving}
                    onClick={handleSkip}
                  >
                    Skip
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-full sm:w-auto"
                    disabled={saving}
                    onClick={handleApproveAsIs}
                  >
                    {saving ? (
                      <Loader2 className="size-4 mr-1 animate-spin" />
                    ) : null}
                    Approve as-is
                  </Button>
                  <Button
                    className="w-full sm:w-auto"
                    disabled={saving}
                    onClick={handleEditAndSave}
                  >
                    {saving ? (
                      <Loader2 className="size-4 mr-1 animate-spin" />
                    ) : null}
                    Edit &amp; Save
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <Input
        value={value}
        type={type}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-xs"
      />
    </div>
  );
}
