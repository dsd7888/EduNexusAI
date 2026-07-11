"use client";

/** One editable practical card — same zone structure as SessionCard. */

import { useState } from "react";
import {
  RefreshCw,
  Loader2,
  FlaskConical,
  ClipboardCheck,
  MessageCircleQuestion,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PracticalSession } from "./shared";

interface PracticalCardProps {
  practical: PracticalSession;
  subjectCoCodes: string[];
  onChange: (p: PracticalSession) => void;
  onRegenerate: (instruction: string) => void;
  regenerating: boolean;
}

export function PracticalCard({
  practical,
  subjectCoCodes,
  onChange,
  onRegenerate,
  regenerating,
}: PracticalCardProps) {
  const [showRegen, setShowRegen] = useState(false);
  const [regenInstruction, setRegenInstruction] = useState("");

  const toggleCo = (co: string) => {
    const has = practical.coCodes.includes(co);
    onChange({
      ...practical,
      coCodes: has
        ? practical.coCodes.filter((c) => c !== co)
        : [...practical.coCodes, co],
    });
  };

  return (
    <div className="rounded-md border border-border bg-card overflow-hidden shadow-xs">
      {/* header */}
      <div className="flex items-center gap-2 border-b bg-muted/40 px-2.5 py-1">
        <Badge variant="secondary" className="shrink-0 text-[11px]">
          P{practical.practicalNo}
        </Badge>
        <span className="text-xs font-semibold flex-1 truncate">
          {practical.title}
        </span>
        <Badge variant="outline" className="shrink-0 text-[11px]">
          {practical.hours}h
        </Badge>
        <button
          type="button"
          onClick={() => setShowRegen((v) => !v)}
          disabled={regenerating}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          title="Regenerate this practical with AI"
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
            placeholder="Optional instruction for this practical…"
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

      {/* classification: CO */}
      <div className="flex items-center gap-1.5 border-b bg-muted/15 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          CO
        </span>
        <div className="flex flex-wrap gap-1">
          {subjectCoCodes.length === 0 && (
            <span className="text-[11px] text-muted-foreground italic">none</span>
          )}
          {subjectCoCodes.map((co) => {
            const on = practical.coCodes.includes(co);
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

      {/* body */}
      <div className="px-3 py-2.5 space-y-3">
        <Field icon={<FlaskConical className="size-3.5 text-emerald-600" />} label="Prep note">
          <Textarea
            value={practical.prepNote}
            onChange={(e) => onChange({ ...practical, prepNote: e.target.value })}
            className="min-h-[40px] text-sm resize-none"
            placeholder="Setup / dataset / pitfall…"
          />
        </Field>
        <Field icon={<ClipboardCheck className="size-3.5 text-sky-600" />} label="Assessment (10-mark rubric)">
          <Input
            value={practical.assessmentHint}
            onChange={(e) => onChange({ ...practical, assessmentHint: e.target.value })}
            className="h-8 text-sm"
            placeholder="What to evaluate…"
          />
        </Field>
        <Field icon={<MessageCircleQuestion className="size-3.5 text-violet-600" />} label="Viva question">
          <Textarea
            value={practical.vivaSeed}
            onChange={(e) => onChange({ ...practical, vivaSeed: e.target.value })}
            className="min-h-[40px] text-sm resize-none"
            placeholder="One representative viva question…"
          />
        </Field>
      </div>
    </div>
  );
}

function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}
