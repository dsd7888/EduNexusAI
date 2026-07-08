"use client";

/**
 * One question row in the Q Bank. Shows academic badges + source + verified
 * state, MCQ options (with the correct one ticked), an expandable model answer,
 * and inline editing (Edit → save PATCHes the question and marks it verified).
 * Actions: Edit, Save to Paper (staging), Delete (confirm).
 */

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FilePlus,
  Loader2,
  Pencil,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { RichQuestionText } from "@/components/RichQuestionText";
import { toast } from "sonner";
import type { BankQuestion, MCQOption, QuestionType } from "@/lib/qbank/types";
import {
  DIFFICULTY_CLASSES,
  QUESTION_TYPES,
  SOURCE_LABELS,
  TYPE_LABELS,
  formatCo,
  deleteQuestion,
  patchQuestion,
} from "./shared";

const OPT_LABELS: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"];

interface Draft {
  question_text: string;
  question_type: QuestionType;
  marks: string;
  co_code: string;
  btl_level: string;
  difficulty: string;
  model_answer: string;
  options: MCQOption[];
}

function toDraft(q: BankQuestion): Draft {
  const options: MCQOption[] =
    q.question_type === "mcq"
      ? OPT_LABELS.map((label) => {
          const found = q.options?.find((o) => o.label === label);
          return {
            label,
            text: found?.text ?? "",
            is_correct: found?.is_correct ?? false,
          };
        })
      : [];
  return {
    question_text: q.question_text,
    question_type: q.question_type,
    marks: String(q.marks),
    co_code: q.co_code ?? "",
    btl_level: q.btl_level != null ? String(q.btl_level) : "",
    difficulty: q.difficulty ?? "",
    model_answer: q.model_answer ?? "",
    options,
  };
}

export function BankQuestionCard({
  question,
  onUpdated,
  onDeleted,
  onStage,
  isStaged,
  isSelected,
  onToggleSelect,
}: {
  question: BankQuestion;
  onUpdated: (q: BankQuestion) => void;
  onDeleted: (id: string) => void;
  onStage?: (q: BankQuestion) => void;
  isStaged?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const q = question;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const beginEdit = () => {
    setDraft(toDraft(q));
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setDraft(null);
  };

  const save = async () => {
    if (!draft) return;
    const marks = Number(draft.marks);
    if (!Number.isFinite(marks) || marks <= 0) {
      toast.error("Marks must be a positive number");
      return;
    }
    setSaving(true);
    try {
      const patch: Partial<BankQuestion> = {
        question_text: draft.question_text.trim(),
        question_type: draft.question_type,
        marks,
        co_code: draft.co_code.trim() || null,
        btl_level: draft.btl_level ? Number(draft.btl_level) : null,
        difficulty:
          (draft.difficulty as BankQuestion["difficulty"]) || null,
        model_answer: draft.model_answer.trim() || null,
        is_verified: true, // editing == reviewing
      };
      if (draft.question_type === "mcq") {
        patch.options = draft.options.filter((o) => o.text.trim());
      } else if (q.question_type === "mcq") {
        // Switched away from MCQ: clear now-orphaned stored options.
        patch.options = [];
      }
      const updated = await patchQuestion(q.id, patch);
      onUpdated(updated);
      toast.success("Saved & verified");
      cancel();
    } catch (err) {
      console.error(err);
      toast.error("Failed to save question");
    } finally {
      setSaving(false);
    }
  };

  const quickApprove = async () => {
    setApproving(true);
    try {
      const updated = await patchQuestion(q.id, { is_verified: true });
      onUpdated(updated);
      toast.success("Approved");
    } catch (err) {
      console.error(err);
      toast.error("Failed to approve question");
    } finally {
      setApproving(false);
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await deleteQuestion(q.id);
      onDeleted(q.id);
      toast.success("Question deleted");
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete");
      setDeleting(false);
    }
  };

  // ── Edit mode ──────────────────────────────────────────────────────────
  if (editing && draft) {
    return (
      <Card className="p-3 space-y-2 border-primary/40">
        <Textarea
          value={draft.question_text}
          onChange={(e) => setDraft({ ...draft, question_text: e.target.value })}
          rows={2}
          className="text-sm"
          placeholder="Question text"
        />
        {draft.question_type === "mcq" && (
          <div className="space-y-1">
            {draft.options.map((opt, i) => (
              <div key={opt.label} className="flex items-center gap-2">
                <button
                  type="button"
                  title="Mark correct"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      options: draft.options.map((o, j) => ({
                        ...o,
                        is_correct: j === i,
                      })),
                    })
                  }
                  className={cn(
                    "size-5 shrink-0 rounded-full border text-[10px] font-bold",
                    opt.is_correct
                      ? "bg-emerald-500 text-white border-emerald-500"
                      : "text-muted-foreground"
                  )}
                >
                  {opt.label}
                </button>
                <Input
                  value={opt.text}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      options: draft.options.map((o, j) =>
                        j === i ? { ...o, text: e.target.value } : o
                      ),
                    })
                  }
                  className="h-7 text-xs"
                  placeholder={`Option ${opt.label}`}
                />
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div>
            <span className="text-[10px] text-muted-foreground">Type</span>
            <Select
              value={draft.question_type}
              onValueChange={(v) =>
                setDraft({
                  ...draft,
                  question_type: v as QuestionType,
                  options:
                    v === "mcq" && draft.options.length === 0
                      ? OPT_LABELS.map((label) => ({
                          label,
                          text: "",
                          is_correct: false,
                        }))
                      : draft.options,
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
            <span className="text-[10px] text-muted-foreground">BTL</span>
            <Select
              value={draft.btl_level || "none"}
              onValueChange={(v) =>
                setDraft({ ...draft, btl_level: v === "none" ? "" : v })
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
            <span className="text-[10px] text-muted-foreground">Difficulty</span>
            <Select
              value={draft.difficulty || "none"}
              onValueChange={(v) =>
                setDraft({ ...draft, difficulty: v === "none" ? "" : v })
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
        </div>
        <Textarea
          value={draft.model_answer}
          onChange={(e) => setDraft({ ...draft, model_answer: e.target.value })}
          rows={2}
          className="text-xs"
          placeholder="Model answer (optional)"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-7 text-xs" onClick={save} disabled={saving}>
            {saving ? (
              <Loader2 className="size-3 mr-1 animate-spin" />
            ) : (
              <Save className="size-3 mr-1" />
            )}
            Save &amp; Verify
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={cancel}
            disabled={saving}
          >
            <X className="size-3 mr-1" />
            Cancel
          </Button>
        </div>
      </Card>
    );
  }

  // ── Read mode ──────────────────────────────────────────────────────────
  return (
    <Card className={cn("p-3 space-y-2", isSelected && "ring-1 ring-primary/50")}>
      <div className="flex items-start gap-2">
        {onToggleSelect && (
          <Checkbox
            checked={isSelected ?? false}
            onCheckedChange={() => onToggleSelect(question.id)}
            className="mt-0.5 shrink-0"
            aria-label="Select question"
          />
        )}
      <div className="flex-1 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="text-[10px]">
          {TYPE_LABELS[q.question_type]}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {q.marks}M
        </Badge>
        {q.co_code && (
          <Badge variant="outline" className="text-[10px]">
            {formatCo(q.co_code)}
          </Badge>
        )}
        {q.btl_level != null && (
          <Badge variant="outline" className="text-[10px]">
            BTL{q.btl_level}
          </Badge>
        )}
        {q.difficulty && (
          <Badge
            variant="outline"
            className={cn("text-[10px]", DIFFICULTY_CLASSES[q.difficulty])}
          >
            {q.difficulty}
          </Badge>
        )}
        <div className="flex-1 min-w-2" />
        <span className="text-[10px] text-muted-foreground">
          {SOURCE_LABELS[q.source]}
        </span>
        {q.is_verified ? (
          <CheckCircle2 className="size-4 text-emerald-500" aria-label="Verified" />
        ) : (
          <AlertTriangle className="size-4 text-amber-500" aria-label="Needs review" />
        )}
      </div>

      {q.image_url && (
        <img
          src={q.image_url}
          alt="Question illustration"
          className="rounded-md max-h-48 w-auto object-contain border border-border/40"
        />
      )}

      <RichQuestionText text={q.question_text} className="text-sm" />

      {q.question_type === "mcq" && q.options && q.options.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
          {q.options.map((o) => (
            <div
              key={o.label}
              className={cn(
                "flex items-center gap-1",
                o.is_correct && "text-emerald-500 font-medium"
              )}
            >
              <span>
                ({o.label.toLowerCase()}) {o.text}
              </span>
              {o.is_correct && <CheckCircle2 className="size-3" />}
            </div>
          ))}
        </div>
      )}

      {q.model_answer && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          Model answer
        </button>
      )}
      {expanded && q.model_answer && (
        <div className="text-xs text-muted-foreground border-l-2 border-emerald-500/40 pl-2">
          <RichQuestionText text={q.model_answer} />
        </div>
      )}

      <div className="flex items-center justify-end gap-1 pt-1">
        {!q.is_verified && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-emerald-500 hover:text-emerald-500"
            onClick={quickApprove}
            disabled={approving}
          >
            {approving ? (
              <Loader2 className="size-3 mr-1 animate-spin" />
            ) : (
              <ShieldCheck className="size-3 mr-1" />
            )}
            Approve
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={beginEdit}>
          <Pencil className="size-3 mr-1" />
          Edit
        </Button>
        {onStage && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => onStage(q)}
            disabled={isStaged}
            title={isStaged ? "Already in paper builder" : "Add to paper builder"}
          >
            <FilePlus className="size-3 mr-1" />
            {isStaged ? "Added" : "Save to Paper"}
          </Button>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-destructive hover:text-destructive"
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="size-3 mr-1 animate-spin" />
              ) : (
                <Trash2 className="size-3 mr-1" />
              )}
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this question?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the question from your bank. This action
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      </div>{/* flex-1 space-y-2 */}
      </div>{/* flex items-start gap-2 */}
    </Card>
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
