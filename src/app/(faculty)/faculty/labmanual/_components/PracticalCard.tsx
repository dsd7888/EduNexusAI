"use client";

/**
 * One practical in the REVIEW stage. Every field is editable inline, but grouped
 * into collapsible sections so the card reads as a document, not a wall of
 * identical grey boxes. Math/chemistry renders via RichQuestionText.
 *
 * FACULTY-ONLY SEPARATION: `solution` and `conductGuide` live in their own
 * amber, lock-labelled, collapsed sections — never interleaved with the student
 * blocks. A data-path decision as much as a visual one: the student export must
 * never carry them (§8), and the seam here is where the export filter cuts.
 *
 * EDIT-UNREVIEWS: this component never writes state directly — every content
 * change goes through `onChange`, which the page uses as the single place to flip
 * `reviewed` back to false. See page.tsx.
 */

import { useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Eye,
  FlaskConical,
  Lightbulb,
  Loader2,
  Lock,
  Plus,
  RotateCw,
  Target,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { FieldLabel, ListEditor, MathField, MathInput, SectionHeading } from "./fields";
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  DIFFICULTY_BADGE,
  SCAFFOLD_KIND_LABELS,
  SCAFFOLD_KIND_BADGE,
  WARNING_LABELS,
  RUBRIC_TOTAL_MARKS,
  isSeriousWarning,
  rubricSum,
  canReview,
  type Difficulty,
  type LabManualWarning,
  type PracticalManualSection,
  type PracticalState,
} from "./shared";

interface Props {
  section: PracticalManualSection;
  state: PracticalState;
  warnings: LabManualWarning[];
  regenerating: boolean;
  onChange: (patch: Partial<PracticalManualSection>) => void;
  onStateChange: (patch: Partial<PracticalState>) => void;
  onRegenerate: (difficulty: Difficulty, instruction?: string) => void;
}

/** A collapsible titled section — the unit of structure inside the card. */
function Section({
  title,
  icon,
  accent,
  defaultOpen = false,
  right,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  accent?: "amber";
  defaultOpen?: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const amber = accent === "amber";
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors ${
            amber
              ? "border-amber-300 bg-amber-50 hover:bg-amber-100/70 dark:border-amber-900 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
              : "bg-muted/40 hover:bg-muted border-transparent"
          }`}
        >
          <span
            className={`flex items-center gap-2 text-sm font-semibold ${
              amber ? "text-amber-900 dark:text-amber-300" : ""
            }`}
          >
            {icon}
            {title}
          </span>
          <span className="flex items-center gap-2">
            {right}
            <ChevronDown
              className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""} ${
                amber ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
              }`}
            />
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 px-1 pb-2 pt-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function PracticalCard({
  section,
  state,
  warnings,
  regenerating,
  onChange,
  onStateChange,
  onRegenerate,
}: Props) {
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenInstruction, setRegenInstruction] = useState("");

  const sum = rubricSum(section.rubric);
  const rubricValid = sum === RUBRIC_TOTAL_MARKS;
  const reviewable = canReview(section);
  const requested = state.difficulty;
  const pendingDifficulty = requested !== section.difficulty;

  return (
    <Card
      className={`overflow-hidden py-0 ${
        state.reviewed
          ? "border-emerald-300 shadow-sm dark:border-emerald-800"
          : "border-border"
      }`}
    >
      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <div
        className={`flex flex-wrap items-start gap-3 border-b px-4 py-3 ${
          state.reviewed
            ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20"
            : "border-border bg-muted/30"
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-base font-bold">
              Practical {section.practicalNo}
            </span>
            <Badge variant="secondary" className="font-normal">
              {section.hours}h
            </Badge>
            <Badge variant="outline" className={DIFFICULTY_BADGE[section.difficulty]}>
              {DIFFICULTY_LABELS[section.difficulty]}
            </Badge>
            <Badge
              variant="outline"
              className={SCAFFOLD_KIND_BADGE[section.scaffold.kind]}
            >
              {SCAFFOLD_KIND_LABELS[section.scaffold.kind]}
              {section.scaffold.language ? ` · ${section.scaffold.language}` : ""}
            </Badge>
            {section.coCodes.map((co) => (
              <Badge key={co} variant="outline" className="font-normal">
                {co}
              </Badge>
            ))}
            <Badge variant="outline" className="font-normal">
              BTL {section.btl}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1.5 text-sm font-medium">
            {section.title}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={regenerating}
            onClick={() => setRegenOpen((v) => !v)}
          >
            {regenerating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCw className="size-4" />
            )}
            Regenerate
          </Button>
          <Button
            variant={state.reviewed ? "default" : "outline"}
            size="sm"
            disabled={!reviewable}
            className={
              state.reviewed
                ? "bg-emerald-600 hover:bg-emerald-700"
                : "border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400"
            }
            onClick={() => onStateChange({ reviewed: !state.reviewed })}
          >
            <CheckCircle2 className="size-4" />
            {state.reviewed ? "Reviewed" : "Mark reviewed"}
          </Button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {/* ── Warnings ──────────────────────────────────────────────────── */}
        {warnings.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {warnings.map((w, i) => (
              <span
                key={i}
                title={w.message}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
                  isSeriousWarning(w.kind)
                    ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                    : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                }`}
              >
                <AlertTriangle className="size-3" />
                {WARNING_LABELS[w.kind]}
              </span>
            ))}
          </div>
        )}

        {!reviewable && (
          <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            <AlertTriangle className="size-3.5 shrink-0" />
            The rubric must total {RUBRIC_TOTAL_MARKS} before this practical can be
            marked reviewed — it currently totals {sum}.
          </div>
        )}

        {pendingDifficulty && !regenOpen && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40">
            <p className="text-xs text-amber-800 dark:text-amber-300">
              Written at <strong>{DIFFICULTY_LABELS[section.difficulty]}</strong>,
              but you asked for <strong>{DIFFICULTY_LABELS[requested]}</strong>.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={regenerating}
              className="border-amber-400 text-amber-800 hover:bg-amber-100 dark:text-amber-300"
              onClick={() => onRegenerate(requested)}
            >
              Regenerate at {DIFFICULTY_LABELS[requested]}
            </Button>
          </div>
        )}

        {regenOpen && (
          <div className="bg-muted/50 space-y-3 rounded-lg border p-3">
            <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
              <div className="space-y-1">
                <FieldLabel>Difficulty</FieldLabel>
                <Select
                  value={requested}
                  onValueChange={(v) => onStateChange({ difficulty: v as Difficulty })}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIFFICULTIES.map((d) => (
                      <SelectItem key={d} value={d}>
                        {DIFFICULTY_LABELS[d]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <FieldLabel>Instruction (optional)</FieldLabel>
                <Textarea
                  rows={2}
                  value={regenInstruction}
                  onChange={(e) => setRegenInstruction(e.target.value)}
                  placeholder="e.g. Gap the pointer updates instead of the comparison."
                  className="text-sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={regenerating}
                onClick={() => {
                  onRegenerate(requested, regenInstruction.trim() || undefined);
                  setRegenOpen(false);
                  setRegenInstruction("");
                }}
              >
                Regenerate this practical
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRegenOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* ── 1. Overview ───────────────────────────────────────────────── */}
        <Section title="Aim & objectives" icon={<Target className="size-4" />} defaultOpen>
          <MathField label="Aim" value={section.aim} onChange={(aim) => onChange({ aim })} rows={2} />
          <ListEditor
            label="Objectives"
            values={section.objectives}
            onChange={(objectives) => onChange({ objectives })}
            placeholder="A measurable student outcome"
            math
          />
          <ListEditor
            label="Prerequisite checks"
            values={section.prereqChecks}
            onChange={(prereqChecks) => onChange({ prereqChecks })}
            placeholder="A recall question"
            math
          />
        </Section>

        {/* ── 2. Theory ─────────────────────────────────────────────────── */}
        <Section title="Theory & worked example" icon={<BookOpen className="size-4" />} defaultOpen>
          <MathField
            label="Theory"
            value={section.theory}
            onChange={(theory) => onChange({ theory })}
            rows={6}
            counter={1800}
          />
          <MathField
            label="Worked example"
            value={section.workedExample}
            onChange={(workedExample) => onChange({ workedExample })}
            rows={6}
            counter={1500}
          />
        </Section>

        {/* ── 3. Lab task ───────────────────────────────────────────────── */}
        <Section title="Lab task — what the student receives" icon={<FlaskConical className="size-4" />} defaultOpen>
          <MathField
            label="Scaffold"
            value={section.scaffold.body}
            onChange={(body) => onChange({ scaffold: { ...section.scaffold, body } })}
            rows={12}
            mono
            hint="Mark each blank as TODO(1), TODO(2)… and give every one a row below."
          />

          <div className="space-y-2">
            <FieldLabel>Gaps ({section.scaffold.gaps.length})</FieldLabel>
            {section.scaffold.gaps.map((g, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-md border bg-muted/30 p-2"
              >
                <span className="mt-2 shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                  {g.n}
                </span>
                <div className="grid flex-1 gap-1.5 sm:grid-cols-2">
                  <Input
                    value={g.hint}
                    placeholder="Hint — the reasoning, not the answer"
                    className="text-xs"
                    onChange={(e) => {
                      const gaps = [...section.scaffold.gaps];
                      gaps[i] = { ...g, hint: e.target.value };
                      onChange({ scaffold: { ...section.scaffold, gaps } });
                    }}
                  />
                  <Input
                    value={g.learn}
                    placeholder="What this gap proves they understand"
                    className="text-xs"
                    onChange={(e) => {
                      const gaps = [...section.scaffold.gaps];
                      gaps[i] = { ...g, learn: e.target.value };
                      onChange({ scaffold: { ...section.scaffold, gaps } });
                    }}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive size-9 shrink-0"
                  aria-label={`Remove gap ${g.n}`}
                  onClick={() =>
                    onChange({
                      scaffold: {
                        ...section.scaffold,
                        gaps: section.scaffold.gaps.filter((_, j) => j !== i),
                      },
                    })
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onChange({
                  scaffold: {
                    ...section.scaffold,
                    gaps: [
                      ...section.scaffold.gaps,
                      {
                        n: Math.max(0, ...section.scaffold.gaps.map((x) => x.n)) + 1,
                        hint: "",
                        learn: "",
                      },
                    ],
                  },
                })
              }
            >
              <Plus className="size-3.5" />
              Add gap
            </Button>
          </div>

          <MathField
            label="Expected output"
            value={section.expectedOutput}
            onChange={(expectedOutput) => onChange({ expectedOutput })}
            rows={3}
            mono
          />
        </Section>

        {/* ── 4. Assessment ─────────────────────────────────────────────── */}
        <Section title="Assessment" icon={<ClipboardCheck className="size-4" />}>
          <div className="space-y-2">
            <FieldLabel>Common errors (3)</FieldLabel>
            {section.commonErrors.map((e, i) => (
              <div key={i} className="grid gap-1.5 rounded-md border bg-muted/30 p-2 sm:grid-cols-2">
                <Input
                  value={e.error}
                  placeholder="The error a student hits"
                  className="text-xs"
                  onChange={(ev) => {
                    const commonErrors = [...section.commonErrors];
                    commonErrors[i] = { ...e, error: ev.target.value };
                    onChange({ commonErrors });
                  }}
                />
                <Input
                  value={e.meaning}
                  placeholder="What it means"
                  className="text-xs"
                  onChange={(ev) => {
                    const commonErrors = [...section.commonErrors];
                    commonErrors[i] = { ...e, meaning: ev.target.value };
                    onChange({ commonErrors });
                  }}
                />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <FieldLabel>Extension problems</FieldLabel>
            {section.extensions.map((x, i) => (
              <div key={i} className="flex items-start gap-2 rounded-md border bg-muted/30 p-2">
                <Select
                  value={x.level}
                  onValueChange={(v) => {
                    const extensions = [...section.extensions];
                    extensions[i] = { ...x, level: v as typeof x.level };
                    onChange({ extensions });
                  }}
                >
                  <SelectTrigger className="h-8 w-32 shrink-0 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">basic</SelectItem>
                    <SelectItem value="intermediate">intermediate</SelectItem>
                    <SelectItem value="stretch">stretch</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex-1 space-y-1.5">
                  <MathField
                    value={x.statement}
                    onChange={(statement) => {
                      const extensions = [...section.extensions];
                      extensions[i] = { ...x, statement };
                      onChange({ extensions });
                    }}
                    rows={2}
                  />
                  <MathInput
                    value={x.expected}
                    onChange={(expected) => {
                      const extensions = [...section.extensions];
                      extensions[i] = { ...x, expected };
                      onChange({ extensions });
                    }}
                    placeholder="Expected result"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive size-9 shrink-0"
                  aria-label="Remove extension"
                  onClick={() =>
                    onChange({ extensions: section.extensions.filter((_, j) => j !== i) })
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <FieldLabel>Viva questions (6, easy → hard)</FieldLabel>
            {section.viva.map((v, i) => (
              <div key={i} className="flex items-start gap-2 rounded-md border bg-muted/30 p-2">
                <span className="text-muted-foreground mt-2 w-5 shrink-0 text-xs tabular-nums">
                  {i + 1}.
                </span>
                <div className="grid flex-1 gap-1.5 sm:grid-cols-2">
                  <MathInput
                    value={v.q}
                    onChange={(q) => {
                      const viva = [...section.viva];
                      viva[i] = { ...v, q };
                      onChange({ viva });
                    }}
                    placeholder="Question"
                  />
                  <MathInput
                    value={v.hint}
                    onChange={(hint) => {
                      const viva = [...section.viva];
                      viva[i] = { ...v, hint };
                      onChange({ viva });
                    }}
                    placeholder="Hint (a nudge)"
                    italic
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <SectionHeading
              right={
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                    rubricValid
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                      : "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300"
                  }`}
                >
                  {sum} / {RUBRIC_TOTAL_MARKS}
                </span>
              }
            >
              Rubric
            </SectionHeading>
            {section.rubric.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={r.criterion}
                  className="flex-1 text-sm"
                  onChange={(e) => {
                    const rubric = [...section.rubric];
                    rubric[i] = { ...r, criterion: e.target.value };
                    onChange({ rubric });
                  }}
                />
                <Input
                  type="number"
                  value={r.marks}
                  className="w-16 text-center text-sm"
                  onChange={(e) => {
                    const rubric = [...section.rubric];
                    rubric[i] = { ...r, marks: Number(e.target.value) || 0 };
                    onChange({ rubric });
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive size-9 shrink-0"
                  aria-label="Remove rubric row"
                  onClick={() =>
                    onChange({ rubric: section.rubric.filter((_, j) => j !== i) })
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            {section.rubric.length < 5 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  onChange({ rubric: [...section.rubric, { criterion: "", marks: 0 }] })
                }
              >
                <Plus className="size-3.5" />
                Add criterion
              </Button>
            )}
          </div>
        </Section>

        {/* ── 5. Faculty-only: model solution ───────────────────────────── */}
        <Section
          title="Model solution — faculty only, separate download"
          icon={<Lock className="size-4" />}
          accent="amber"
        >
          <Textarea
            rows={12}
            value={section.solution}
            onChange={(e) => onChange({ solution: e.target.value })}
            className="border-slate-300 bg-slate-50 font-mono text-xs leading-relaxed dark:border-slate-700 dark:bg-slate-900/60"
            spellCheck={false}
          />
          <p className="text-muted-foreground text-xs">
            Never appears in the student or instructor manual — it downloads as its
            own Model Solutions document.
          </p>
        </Section>

        {/* ── 6. Faculty-only: conduct guide ────────────────────────────── */}
        <Section
          title="Conducting this practical — faculty only"
          icon={<Eye className="size-4" />}
          accent="amber"
        >
          <MathField
            label="Opener"
            value={section.conductGuide.opener}
            onChange={(opener) =>
              onChange({ conductGuide: { ...section.conductGuide, opener } })
            }
            rows={3}
          />
          <MathField
            label="Hint release"
            value={section.conductGuide.hintRelease}
            onChange={(hintRelease) =>
              onChange({ conductGuide: { ...section.conductGuide, hintRelease } })
            }
            rows={3}
          />
          <div className="space-y-2">
            <FieldLabel>Checkpoints (2, with a minute-mark trigger)</FieldLabel>
            {section.conductGuide.checkpoints.map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                <Lightbulb className="mt-2.5 size-3.5 shrink-0 text-amber-500" />
                <Textarea
                  rows={2}
                  value={c}
                  className="text-sm"
                  onChange={(e) => {
                    const checkpoints = [...section.conductGuide.checkpoints];
                    checkpoints[i] = e.target.value;
                    onChange({ conductGuide: { ...section.conductGuide, checkpoints } });
                  }}
                />
              </div>
            ))}
          </div>
          <MathField
            label="Deliberate mistake to allow"
            value={section.conductGuide.deliberateMistake}
            onChange={(deliberateMistake) =>
              onChange({ conductGuide: { ...section.conductGuide, deliberateMistake } })
            }
            rows={2}
          />
          <MathField
            label="Wrap-up"
            value={section.conductGuide.wrapUp}
            onChange={(wrapUp) =>
              onChange({ conductGuide: { ...section.conductGuide, wrapUp } })
            }
            rows={2}
          />
        </Section>
      </div>
    </Card>
  );
}
