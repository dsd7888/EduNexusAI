"use client";

/**
 * One practical in the REVIEW stage. Every field is editable inline.
 *
 * FACULTY-ONLY SEPARATION: `solution` and `conductGuide` live in their own
 * visually distinct, collapsed, amber-labelled editors — never interleaved with
 * the student blocks. That is a data-path decision as much as a visual one: the
 * student export must never carry them (§8), and keeping the two groups apart
 * here means the export builder's variant filter has an obvious seam to cut on.
 *
 * EDIT-UNREVIEWS: this component never writes state directly — every change goes
 * through the `onChange` handler, which the page uses as the single place to flip
 * `reviewed` back to false. See page.tsx.
 */

import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Eye,
  Loader2,
  Lock,
  Plus,
  RotateCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  SCAFFOLD_KIND_LABELS,
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

const MONO = "font-mono text-xs leading-relaxed";

interface Props {
  section: PracticalManualSection;
  state: PracticalState;
  warnings: LabManualWarning[];
  regenerating: boolean;
  onChange: (patch: Partial<PracticalManualSection>) => void;
  onStateChange: (patch: Partial<PracticalState>) => void;
  onRegenerate: (difficulty: Difficulty, instruction?: string) => void;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Label className="text-muted-foreground text-xs">{children}</Label>;
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

  // The badge shows what was actually GENERATED. The select shows what the
  // faculty has asked for. When they diverge we offer a regen rather than
  // silently relabelling content that was written at the old difficulty.
  const requested = state.difficulty;
  const pendingDifficulty = requested !== section.difficulty;

  return (
    <Card
      className={
        state.reviewed ? "border-emerald-300 dark:border-emerald-900" : undefined
      }
    >
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                Practical {section.practicalNo}
              </span>
              <Badge variant="secondary">{section.hours}h</Badge>
              <Badge variant="outline">
                {DIFFICULTY_LABELS[section.difficulty]}
              </Badge>
              <Badge variant="outline">
                {SCAFFOLD_KIND_LABELS[section.scaffold.kind]}
                {section.scaffold.language ? ` · ${section.scaffold.language}` : ""}
              </Badge>
              {section.coCodes.map((co) => (
                <Badge key={co} variant="outline">
                  {co}
                </Badge>
              ))}
              <Badge variant="outline">BTL {section.btl}</Badge>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">{section.title}</p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={regenerating}
              onClick={() => setRegenOpen((v) => !v)}
            >
              {regenerating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCw className="size-4" />
              )}
            </Button>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={state.reviewed}
                disabled={!reviewable}
                onCheckedChange={(c) => onStateChange({ reviewed: c === true })}
              />
              Reviewed
            </label>
          </div>
        </div>

        {warnings.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {warnings.map((w, i) => (
              <span
                key={i}
                title={w.message}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
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
          <p className="text-destructive mt-2 text-xs">
            The rubric must total {RUBRIC_TOTAL_MARKS} before this practical can be
            marked reviewed (currently {sum}).
          </p>
        )}

        {regenOpen && (
          <div className="bg-muted/50 mt-2 space-y-2 rounded-md p-3">
            <div className="space-y-1">
              <FieldLabel>Difficulty to generate at</FieldLabel>
              <Select
                value={requested}
                onValueChange={(v) => onStateChange({ difficulty: v as Difficulty })}
              >
                <SelectTrigger className="h-8">
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
                className="text-xs"
              />
            </div>
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
          </div>
        )}

        {pendingDifficulty && !regenOpen && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40">
            <p className="text-xs text-amber-800 dark:text-amber-300">
              This content was written at{" "}
              <strong>{DIFFICULTY_LABELS[section.difficulty]}</strong>. You asked
              for <strong>{DIFFICULTY_LABELS[requested]}</strong>.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={regenerating}
              onClick={() => onRegenerate(requested)}
            >
              Regenerate at {DIFFICULTY_LABELS[requested]}
            </Button>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── STUDENT-FACING BLOCKS ─────────────────────────────────────── */}
        <div className="space-y-1">
          <FieldLabel>Aim</FieldLabel>
          <Textarea
            rows={2}
            value={section.aim}
            onChange={(e) => onChange({ aim: e.target.value })}
          />
        </div>

        <ListEditor
          label="Objectives"
          values={section.objectives}
          onChange={(objectives) => onChange({ objectives })}
          placeholder="A measurable student outcome"
        />

        <ListEditor
          label="Prerequisite checks"
          values={section.prereqChecks}
          onChange={(prereqChecks) => onChange({ prereqChecks })}
          placeholder="A recall question"
        />

        <div className="space-y-1">
          <FieldLabel>Theory ({section.theory.length}/1800)</FieldLabel>
          <Textarea
            rows={5}
            value={section.theory}
            onChange={(e) => onChange({ theory: e.target.value })}
          />
        </div>

        <div className="space-y-1">
          <FieldLabel>
            Worked example ({section.workedExample.length}/1500)
          </FieldLabel>
          <Textarea
            rows={5}
            value={section.workedExample}
            onChange={(e) => onChange({ workedExample: e.target.value })}
            className={MONO}
          />
        </div>

        <div className="space-y-1">
          <FieldLabel>Scaffold — what the student receives</FieldLabel>
          <Textarea
            rows={12}
            value={section.scaffold.body}
            onChange={(e) =>
              onChange({ scaffold: { ...section.scaffold, body: e.target.value } })
            }
            className={MONO}
            spellCheck={false}
          />
          <p className="text-muted-foreground text-xs">
            Mark each blank as TODO(1), TODO(2)… and give every one a row below.
          </p>
        </div>

        <div className="space-y-1.5">
          <FieldLabel>Gaps ({section.scaffold.gaps.length})</FieldLabel>
          {section.scaffold.gaps.map((g, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-muted-foreground w-8 shrink-0 pt-2 text-xs tabular-nums">
                ({g.n})
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
                className="size-8 shrink-0"
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
                      n:
                        Math.max(0, ...section.scaffold.gaps.map((x) => x.n)) + 1,
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

        <div className="space-y-1">
          <FieldLabel>Expected output</FieldLabel>
          <Textarea
            rows={3}
            value={section.expectedOutput}
            onChange={(e) => onChange({ expectedOutput: e.target.value })}
            className={MONO}
            spellCheck={false}
          />
        </div>

        <div className="space-y-1.5">
          <FieldLabel>Common errors (3)</FieldLabel>
          {section.commonErrors.map((e, i) => (
            <div key={i} className="grid gap-1.5 sm:grid-cols-2">
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

        <div className="space-y-1.5">
          <FieldLabel>Extension problems</FieldLabel>
          {section.extensions.map((x, i) => (
            <div key={i} className="flex items-start gap-2">
              <Select
                value={x.level}
                onValueChange={(v) => {
                  const extensions = [...section.extensions];
                  extensions[i] = {
                    ...x,
                    level: v as typeof x.level,
                  };
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
              <div className="flex-1 space-y-1">
                <Textarea
                  rows={2}
                  value={x.statement}
                  placeholder="Self-contained problem statement"
                  className="text-xs"
                  onChange={(e) => {
                    const extensions = [...section.extensions];
                    extensions[i] = { ...x, statement: e.target.value };
                    onChange({ extensions });
                  }}
                />
                <Input
                  value={x.expected}
                  placeholder="Expected result"
                  className="text-xs"
                  onChange={(e) => {
                    const extensions = [...section.extensions];
                    extensions[i] = { ...x, expected: e.target.value };
                    onChange({ extensions });
                  }}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label="Remove extension"
                onClick={() =>
                  onChange({
                    extensions: section.extensions.filter((_, j) => j !== i),
                  })
                }
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <FieldLabel>Viva questions (6)</FieldLabel>
          {section.viva.map((v, i) => (
            <div key={i} className="grid gap-1.5 sm:grid-cols-2">
              <Input
                value={v.q}
                placeholder="Question"
                className="text-xs"
                onChange={(e) => {
                  const viva = [...section.viva];
                  viva[i] = { ...v, q: e.target.value };
                  onChange({ viva });
                }}
              />
              <Input
                value={v.hint}
                placeholder="Hint (a nudge)"
                className="text-xs italic"
                onChange={(e) => {
                  const viva = [...section.viva];
                  viva[i] = { ...v, hint: e.target.value };
                  onChange({ viva });
                }}
              />
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <FieldLabel>Rubric</FieldLabel>
            <span
              className={`text-xs font-medium tabular-nums ${
                rubricValid ? "text-emerald-600" : "text-destructive"
              }`}
            >
              {sum} / {RUBRIC_TOTAL_MARKS}
            </span>
          </div>
          {section.rubric.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={r.criterion}
                className="flex-1 text-xs"
                onChange={(e) => {
                  const rubric = [...section.rubric];
                  rubric[i] = { ...r, criterion: e.target.value };
                  onChange({ rubric });
                }}
              />
              <Input
                type="number"
                value={r.marks}
                className="w-20 text-xs"
                onChange={(e) => {
                  const rubric = [...section.rubric];
                  rubric[i] = { ...r, marks: Number(e.target.value) || 0 };
                  onChange({ rubric });
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
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
                onChange({
                  rubric: [...section.rubric, { criterion: "", marks: 0 }],
                })
              }
            >
              <Plus className="size-3.5" />
              Add criterion
            </Button>
          )}
        </div>

        {/* ── FACULTY-ONLY BLOCKS — never in a student export (§8) ───────── */}
        <Collapsible>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-left dark:border-amber-900 dark:bg-amber-950/30"
            >
              <span className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-300">
                <Lock className="size-3.5" />
                Model solution — faculty only, separate download
              </span>
              <ChevronDown className="size-4 text-amber-700 dark:text-amber-400" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <Textarea
              rows={12}
              value={section.solution}
              onChange={(e) => onChange({ solution: e.target.value })}
              className={MONO}
              spellCheck={false}
            />
            <p className="text-muted-foreground mt-1 text-xs">
              Never appears in the student or instructor manual — it downloads as
              its own Model Solutions document.
            </p>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-left dark:border-amber-900 dark:bg-amber-950/30"
            >
              <span className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-300">
                <Eye className="size-3.5" />
                Conducting this practical — faculty only
              </span>
              <ChevronDown className="size-4 text-amber-700 dark:text-amber-400" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2">
            <div className="space-y-1">
              <FieldLabel>Opener</FieldLabel>
              <Textarea
                rows={3}
                value={section.conductGuide.opener}
                onChange={(e) =>
                  onChange({
                    conductGuide: {
                      ...section.conductGuide,
                      opener: e.target.value,
                    },
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <FieldLabel>Hint release</FieldLabel>
              <Textarea
                rows={3}
                value={section.conductGuide.hintRelease}
                onChange={(e) =>
                  onChange({
                    conductGuide: {
                      ...section.conductGuide,
                      hintRelease: e.target.value,
                    },
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>Checkpoints (2)</FieldLabel>
              {section.conductGuide.checkpoints.map((c, i) => (
                <Textarea
                  key={i}
                  rows={2}
                  value={c}
                  className="text-xs"
                  onChange={(e) => {
                    const checkpoints = [...section.conductGuide.checkpoints];
                    checkpoints[i] = e.target.value;
                    onChange({
                      conductGuide: { ...section.conductGuide, checkpoints },
                    });
                  }}
                />
              ))}
            </div>
            <div className="space-y-1">
              <FieldLabel>Deliberate mistake to allow</FieldLabel>
              <Textarea
                rows={2}
                value={section.conductGuide.deliberateMistake}
                onChange={(e) =>
                  onChange({
                    conductGuide: {
                      ...section.conductGuide,
                      deliberateMistake: e.target.value,
                    },
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <FieldLabel>Wrap-up</FieldLabel>
              <Textarea
                rows={2}
                value={section.conductGuide.wrapUp}
                onChange={(e) =>
                  onChange({
                    conductGuide: {
                      ...section.conductGuide,
                      wrapUp: e.target.value,
                    },
                  })
                }
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function ListEditor({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-1.5">
      <FieldLabel>{label}</FieldLabel>
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={v}
            placeholder={placeholder}
            className="flex-1 text-xs"
            onChange={(e) => {
              const next = [...values];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={`Remove ${label} item`}
            onClick={() => onChange(values.filter((_, j) => j !== i))}
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
