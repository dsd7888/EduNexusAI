"use client";

/**
 * One editable, drag-sortable theory session card. Laid out as scannable zones
 * rather than a flat stack of identical inputs:
 *   header bar → classification strip (method / BTL / CO) → primary content
 *   (topics, objective) → "watch-out" notes (how-to, misconception, exam).
 */

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  RefreshCw,
  X,
  Plus,
  Loader2,
  Target,
  Play,
  TriangleAlert,
  GraduationCap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  ALL_METHODS,
  METHOD_LABELS,
  type TeachingMethod,
  type TheorySession,
} from "./shared";

interface SessionCardProps {
  session: TheorySession;
  allowedBtl: number[];
  subjectCoCodes: string[];
  onChange: (s: TheorySession) => void;
  onRegenerate: (instruction: string) => void;
  regenerating: boolean;
}

export function SessionCard({
  session,
  allowedBtl,
  subjectCoCodes,
  onChange,
  onRegenerate,
  regenerating,
}: SessionCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `s-${session.sessionNo}` });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const [topicDraft, setTopicDraft] = useState("");
  const [regenInstruction, setRegenInstruction] = useState("");
  const [showRegen, setShowRegen] = useState(false);

  const addTopic = () => {
    const t = topicDraft.trim();
    if (!t || session.topics.includes(t) || session.topics.length >= 3) return;
    onChange({ ...session, topics: [...session.topics, t] });
    setTopicDraft("");
  };
  const removeTopic = (t: string) =>
    onChange({ ...session, topics: session.topics.filter((x) => x !== t) });
  const toggleCo = (co: string) => {
    const has = session.coCodes.includes(co);
    onChange({
      ...session,
      coCodes: has
        ? session.coCodes.filter((c) => c !== co)
        : [...session.coCodes, co],
    });
  };

  const btlOptions = allowedBtl.length ? allowedBtl : [1, 2, 3, 4, 5, 6];

  return (
    <div ref={setNodeRef} style={style}>
      <div className="rounded-md border border-border bg-card overflow-hidden shadow-xs">
        {/* ── header bar ── */}
        <div className="flex items-center gap-2 border-b bg-muted/40 pl-1.5 pr-2 py-1">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="text-muted-foreground/60 hover:text-foreground cursor-grab active:cursor-grabbing touch-none shrink-0"
            title="Drag to reorder within module"
          >
            <GripVertical className="size-4" />
          </button>
          <span className="text-xs font-semibold tabular-nums">
            Session {session.sessionNo}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setShowRegen((v) => !v)}
            disabled={regenerating}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            title="Regenerate this session with AI"
          >
            {regenerating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Regenerate
          </button>
        </div>

        {showRegen && (
          <div className="flex flex-wrap gap-2 items-center border-b bg-muted/20 px-3 py-2">
            <Input
              value={regenInstruction}
              onChange={(e) => setRegenInstruction(e.target.value)}
              placeholder="Optional instruction for this session…"
              className="h-7 text-xs flex-1 min-w-48"
              disabled={regenerating}
            />
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={regenerating}
              onClick={() => onRegenerate(regenInstruction.trim())}
            >
              {regenerating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Run
            </Button>
          </div>
        )}

        {/* ── classification strip: method / BTL / CO ── */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/15 px-3 py-2">
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Method
            </span>
            <Select
              value={session.method}
              onValueChange={(v) => onChange({ ...session, method: v as TeachingMethod })}
            >
              <SelectTrigger className="h-7 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_METHODS.map((m) => (
                  <SelectItem key={m} value={m} className="text-xs">
                    {METHOD_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              BTL
            </span>
            <Select
              value={String(session.btl)}
              onValueChange={(v) => onChange({ ...session, btl: Number(v) })}
            >
              <SelectTrigger className="h-7 w-16 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {btlOptions.map((b) => (
                  <SelectItem key={b} value={String(b)} className="text-xs">
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              CO
            </span>
            <div className="flex flex-wrap gap-1">
              {subjectCoCodes.length === 0 && (
                <span className="text-[11px] text-muted-foreground italic">none</span>
              )}
              {subjectCoCodes.map((co) => {
                const on = session.coCodes.includes(co);
                return (
                  <button
                    key={co}
                    type="button"
                    onClick={() => toggleCo(co)}
                    className={
                      "rounded px-1.5 py-0.5 text-[11px] font-medium border transition-colors " +
                      (on
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-transparent text-muted-foreground border-border hover:border-primary/60")
                    }
                  >
                    {co}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── primary content: topics + objective ── */}
        <div className="px-3 py-2.5 space-y-3">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {session.topics.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded bg-primary/10 text-primary text-xs font-medium px-1.5 py-0.5"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => removeTopic(t)}
                    className="hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              {session.topics.length === 0 && (
                <span className="text-xs text-destructive/80 italic">
                  No topics — add at least one.
                </span>
              )}
            </div>
            {session.topics.length < 3 && (
              <div className="flex gap-1.5">
                <Input
                  value={topicDraft}
                  onChange={(e) => setTopicDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTopic();
                    }
                  }}
                  placeholder="Add a topic…"
                  className="h-7 text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 px-2"
                  onClick={addTopic}
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
            )}
          </div>

          <LabeledField icon={<Target className="size-3.5 text-sky-600" />} label="Objective">
            <Textarea
              value={session.objective}
              onChange={(e) => onChange({ ...session, objective: e.target.value })}
              className="min-h-[46px] text-sm resize-none"
              placeholder="Measurable, student-outcome-phrased objective…"
            />
          </LabeledField>

          <LabeledField icon={<Play className="size-3.5 text-emerald-600" />} label="How to run">
            <Input
              value={session.methodNote}
              onChange={(e) => onChange({ ...session, methodNote: e.target.value })}
              className="h-8 text-sm"
              placeholder="Concrete classroom activity…"
            />
          </LabeledField>
        </div>

        {/* ── watch-outs: misconception (amber) + exam note (muted) ── */}
        <div className="border-t bg-muted/10 px-3 py-2.5 space-y-2.5">
          <div className="rounded-md border border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30 px-2.5 py-2">
            <div className="flex items-center gap-1.5 mb-1">
              <TriangleAlert className="size-3.5 text-amber-600" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Common misconception
              </span>
            </div>
            <Textarea
              value={session.misconception}
              onChange={(e) => onChange({ ...session, misconception: e.target.value })}
              className="min-h-[40px] text-sm resize-none border-amber-200/60 bg-transparent dark:border-amber-900/50"
              placeholder="One specific student misconception…"
            />
          </div>

          <LabeledField
            icon={<GraduationCap className="size-3.5 text-muted-foreground" />}
            label="Exam note"
            muted
          >
            <Input
              value={session.examNote ?? ""}
              onChange={(e) =>
                onChange({
                  ...session,
                  examNote: e.target.value.trim() ? e.target.value : null,
                })
              }
              className="h-7 text-xs"
              placeholder="PYQ / weightage note, if any…"
            />
          </LabeledField>
        </div>
      </div>
    </div>
  );
}

function LabeledField({
  icon,
  label,
  muted,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        {icon}
        <span
          className={
            "text-[10px] font-semibold uppercase tracking-wide " +
            (muted ? "text-muted-foreground/70" : "text-muted-foreground")
          }
        >
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}
