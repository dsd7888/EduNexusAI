"use client";

/**
 * Tab 2 — "Generate Questions": a dynamic slot builder that posts to
 * /api/qbank/generate (which also AI-tags anything missing CO/BTL and saves to
 * the bank), an in-progress state, and a results list with a "Review All"
 * stepper for walking the unverified questions one at a time.
 */

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { BankQuestion, GenerationSlot, QuestionType } from "@/lib/qbank/types";
import { BankQuestionCard } from "./BankQuestionCard";
import {
  QUESTION_TYPES,
  TYPE_LABELS,
  formatCo,
  generateQuestions,
  type CourseOutcomeRef,
  type ModuleRef,
} from "./shared";

const MAX_TOTAL = 60;
const MARK_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 10];

interface SlotRow {
  id: string;
  question_type: QuestionType;
  marks: number;
  count: number;
  module_id: string;
  co_code: string;
  btl_level: string;
  style: "fresh" | "pyq_inspired";
}

function newSlot(): SlotRow {
  return {
    id: Math.random().toString(36).slice(2, 9),
    question_type: "mcq",
    marks: 1,
    count: 5,
    module_id: "",
    co_code: "",
    btl_level: "",
    style: "fresh",
  };
}

export function GenerateTab({
  subjectId,
  modules,
  courseOutcomes,
  onAdded,
}: {
  subjectId: string;
  modules: ModuleRef[];
  courseOutcomes: CourseOutcomeRef[];
  onAdded: () => void;
}) {
  const [slots, setSlots] = useState<SlotRow[]>([newSlot()]);
  const [includePyq, setIncludePyq] = useState(true);
  const [autoTag, setAutoTag] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<BankQuestion[] | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const total = useMemo(
    () => slots.reduce((sum, s) => sum + (s.count || 0), 0),
    [slots]
  );
  const overLimit = total > MAX_TOTAL;

  const update = (id: string, patch: Partial<SlotRow>) =>
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const generate = async () => {
    if (!subjectId) {
      toast.error("Select a subject first");
      return;
    }
    if (total === 0) {
      toast.error("Set a count of at least 1");
      return;
    }
    if (overLimit) {
      toast.error(`Too many questions: ${total} (max ${MAX_TOTAL})`);
      return;
    }
    const payload: GenerationSlot[] = slots
      .filter((s) => s.count > 0)
      .map((s) => ({
        question_type: s.question_type,
        marks: s.marks,
        count: s.count,
        style: s.style,
        ...(s.module_id ? { module_id: s.module_id } : {}),
        ...(s.co_code ? { co_code: s.co_code } : {}),
        ...(s.btl_level ? { btl_level: Number(s.btl_level) } : {}),
      }));

    setGenerating(true);
    setResults(null);
    try {
      const res = await generateQuestions(subjectId, payload, includePyq);
      setResults(res.questions);
      onAdded();
      toast.success(`Added ${res.added} question${res.added === 1 ? "" : "s"} to your bank`);
    } catch (err) {
      console.error(err);
      toast.error("Generation failed. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  // ── In-progress ────────────────────────────────────────────────────────
  if (generating) {
    return (
      <Card className="p-10 text-center space-y-4">
        <Loader2 className="size-8 mx-auto animate-spin text-primary" />
        <div className="space-y-1">
          <h3 className="font-semibold">Generating {total} questions…</h3>
          <p className="text-sm text-muted-foreground">
            Drafting from your syllabus and auto-tagging CO/BTL. This can take a
            moment.
          </p>
        </div>
        <Progress value={66} className="max-w-sm mx-auto animate-pulse" />
      </Card>
    );
  }

  // ── Results ────────────────────────────────────────────────────────────
  if (results) {
    const unverified = results.filter((q) => !q.is_verified);
    return (
      <div className="space-y-3">
        <Card className="p-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm">
            <span className="font-semibold">{results.length}</span> question
            {results.length === 1 ? "" : "s"} added to your bank
            {unverified.length > 0 && (
              <span className="text-amber-500">
                {" "}
                · {unverified.length} need review
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unverified.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setReviewOpen(true)}>
                Review All ({unverified.length})
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => {
                setResults(null);
                setSlots([newSlot()]);
              }}
            >
              <Sparkles className="size-4 mr-2" />
              Generate More
            </Button>
          </div>
        </Card>

        <div className="space-y-2">
          {results.map((q) => (
            <BankQuestionCard
              key={q.id}
              question={q}
              onUpdated={(u) => {
                setResults((prev) =>
                  prev ? prev.map((it) => (it.id === u.id ? u : it)) : prev
                );
                onAdded();
              }}
              onDeleted={(id) => {
                setResults((prev) => (prev ? prev.filter((it) => it.id !== id) : prev));
                onAdded();
              }}
            />
          ))}
        </div>

        <ReviewAllDialog
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          questions={unverified}
          onUpdated={(u) => {
            setResults((prev) =>
              prev ? prev.map((it) => (it.id === u.id ? u : it)) : prev
            );
            onAdded();
          }}
          onDeleted={(id) => {
            setResults((prev) => (prev ? prev.filter((it) => it.id !== id) : prev));
            onAdded();
          }}
        />
      </div>
    );
  }

  // ── Slot builder form ──────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-semibold">What do you want to generate?</h3>

        <div className="space-y-2">
          {slots.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-end gap-2 rounded-md border p-2"
            >
              <Field label="Type">
                <Select
                  value={s.question_type}
                  onValueChange={(v) =>
                    update(s.id, { question_type: v as QuestionType })
                  }
                >
                  <SelectTrigger className="h-8 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QUESTION_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="text-xs">
                        {TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Marks">
                <Select
                  value={String(s.marks)}
                  onValueChange={(v) => update(s.id, { marks: Number(v) })}
                >
                  <SelectTrigger className="h-8 w-20 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MARK_OPTIONS.map((m) => (
                      <SelectItem key={m} value={String(m)} className="text-xs">
                        {m}M
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Count">
                <Input
                  type="number"
                  min={1}
                  max={MAX_TOTAL}
                  value={s.count}
                  onChange={(e) =>
                    update(s.id, {
                      count: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                  className="h-8 w-16 text-xs text-center"
                />
              </Field>
              <Field label="Module">
                <Select
                  value={s.module_id || "any"}
                  onValueChange={(v) =>
                    update(s.id, { module_id: v === "any" ? "" : v })
                  }
                >
                  <SelectTrigger className="h-8 w-36 text-xs">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any" className="text-xs">
                      Any module
                    </SelectItem>
                    {modules.map((m) => (
                      <SelectItem key={m.id} value={m.id} className="text-xs">
                        M{m.module_number}: {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="CO">
                <Select
                  value={s.co_code || "any"}
                  onValueChange={(v) =>
                    update(s.id, { co_code: v === "any" ? "" : v })
                  }
                >
                  <SelectTrigger className="h-8 w-24 text-xs">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any" className="text-xs">
                      Any CO
                    </SelectItem>
                    {courseOutcomes.map((c) => (
                      <SelectItem key={c.co_code} value={c.co_code} className="text-xs">
                        {formatCo(c.co_code)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="BTL">
                <Select
                  value={s.btl_level || "any"}
                  onValueChange={(v) =>
                    update(s.id, { btl_level: v === "any" ? "" : v })
                  }
                >
                  <SelectTrigger className="h-8 w-20 text-xs">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any" className="text-xs">
                      Any
                    </SelectItem>
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <SelectItem key={n} value={String(n)} className="text-xs">
                        BTL {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Style">
                <div className="inline-flex h-8 rounded-md border overflow-hidden text-[11px]">
                  {(["fresh", "pyq_inspired"] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => update(s.id, { style: st })}
                      className={cn(
                        "px-2 transition-colors",
                        s.style === st
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {st === "fresh" ? "Fresh" : "PYQ"}
                    </button>
                  ))}
                </div>
              </Field>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 text-muted-foreground hover:text-destructive"
                onClick={() =>
                  setSlots((prev) =>
                    prev.length > 1 ? prev.filter((x) => x.id !== s.id) : prev
                  )
                }
                disabled={slots.length === 1}
                title="Remove"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setSlots((prev) => [...prev, newSlot()])}
        >
          <Plus className="size-4 mr-1" />
          Add another type
        </Button>

        <div
          className={cn(
            "text-sm",
            overLimit ? "text-rose-500 font-medium" : "text-muted-foreground"
          )}
        >
          Will generate <span className="font-semibold">{total}</span> question
          {total === 1 ? "" : "s"} total
          {overLimit && ` — over the ${MAX_TOTAL} limit`}
        </div>

        <div className="flex flex-col gap-1.5 pt-1">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <Checkbox
              checked={includePyq}
              onCheckedChange={(v) => setIncludePyq(!!v)}
            />
            Include PYQ context for PYQ-Inspired questions
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <Checkbox checked={autoTag} onCheckedChange={(v) => setAutoTag(!!v)} />
            Auto-tag questions with CO/BTL
            <span className="text-[10px] text-muted-foreground">
              (missing tags are always inferred)
            </span>
          </label>
        </div>
      </Card>

      <Button size="lg" onClick={generate} disabled={overLimit || total === 0}>
        <Sparkles className="size-4 mr-2" />
        Generate &amp; Add to Bank
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

// ─── Review All stepper ─────────────────────────────────────────────────────

function ReviewAllDialog({
  open,
  onOpenChange,
  questions,
  onUpdated,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  questions: BankQuestion[];
  onUpdated: (q: BankQuestion) => void;
  onDeleted: (id: string) => void;
}) {
  const [idx, setIdx] = useState(0);
  const current = questions[Math.min(idx, Math.max(0, questions.length - 1))];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Review questions{" "}
            <Badge variant="secondary" className="ml-1">
              {questions.length === 0 ? 0 : Math.min(idx + 1, questions.length)} /{" "}
              {questions.length}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {current ? (
          <BankQuestionCard
            key={current.id}
            question={current}
            onUpdated={onUpdated}
            onDeleted={(id) => {
              onDeleted(id);
              setIdx((i) => Math.max(0, i - (i >= questions.length - 1 ? 1 : 0)));
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground py-6 text-center">
            All questions reviewed. 🎉
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            disabled={idx === 0}
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
          >
            <ArrowLeft className="size-4 mr-1" />
            Previous
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={idx >= questions.length - 1}
            onClick={() => setIdx((i) => Math.min(questions.length - 1, i + 1))}
          >
            Next
            <ArrowRight className="size-4 ml-1" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
