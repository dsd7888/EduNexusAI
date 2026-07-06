"use client";

/**
 * Stage — "Builder": the drag-and-drop section/question structure editor. Shows
 * the sticky live-marks progress bar against the target, then each section with
 * its sortable question cards and add-section / add-question controls.
 *
 * Owns the builder mutations (they only touch `sections` via the passed setter);
 * the parent owns the `sections` state itself.
 */

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumericField } from "./NumericField";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  CONTENT_TYPE_LABELS,
  PART_LETTERS,
  POOL_ITEM_TYPE_LABELS,
  POOL_ITEM_TYPES,
  defaultPoolInstruction,
  effectiveMarks,
  newQuestion,
  poolTotalCount,
  sectionTotal,
  uid,
  type BuilderPoolCompositionRow,
  type BuilderQuestion,
  type BuilderSection,
  type ContentType,
  type ModuleRow,
  type PoolItemType,
} from "./shared";

// ─── Sortable question card ─────────────────────────────────────────────────

function SortableQuestion({
  question,
  qNumber,
  modules,
  onUpdate,
  onRemove,
  onDuplicate,
}: {
  question: BuilderQuestion;
  qNumber: number;
  modules: ModuleRow[];
  onUpdate: (q: BuilderQuestion) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: question.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isMcqLike =
    question.contentType === "mcq" || question.contentType === "truefalse";
  const isPool = question.contentType === "pool";
  const poolN = isPool ? poolTotalCount(question.poolComposition) : 0;

  const updatePoolComposition = (rows: BuilderPoolCompositionRow[]) => {
    const n = poolTotalCount(rows);
    const k = Math.min(
      Math.max(1, question.poolAttemptCount),
      Math.max(1, n)
    );
    onUpdate({
      ...question,
      poolComposition: rows,
      poolAttemptCount: k,
      instruction: defaultPoolInstruction(k, n),
    });
  };

  const previewParts = question.hasOr
    ? Array.from({ length: question.partsCount }, (_, i) => PART_LETTERS[i])
    : [];

  return (
    <div ref={setNodeRef} style={style}>
      <Card className="p-4 space-y-3">
        {/* ── Top row: handle, label, type, marks, actions ──────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none shrink-0"
            title="Drag to reorder"
          >
            <GripVertical className="size-5" />
          </button>

          <Input
            value={question.displayLabel}
            onChange={(e) =>
              onUpdate({ ...question, displayLabel: e.target.value })
            }
            className="h-8 text-sm font-semibold w-24"
            placeholder={`Q - ${qNumber}`}
          />

          <Select
            value={question.contentType}
            onValueChange={(val) => {
              const ct = val as ContentType;
              if (ct === "pool") {
                onUpdate({
                  ...newQuestion("pool"),
                  id: question.id,
                  displayLabel: question.displayLabel,
                });
                return;
              }
              onUpdate({
                ...question,
                contentType: ct,
                // Reset MCQ-specific fields when switching away
                ...(ct === "mcq" || ct === "truefalse"
                  ? { subPartsCount: Math.max(1, question.subPartsCount) }
                  : {}),
              });
            }}
          >
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CONTENT_TYPE_LABELS).map(([val, label]) => (
                <SelectItem key={val} value={val} className="text-xs">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex-1 min-w-2" />

          <Badge variant="secondary" className="text-xs shrink-0">
            {effectiveMarks(question)}M
          </Badge>

          <button
            type="button"
            onClick={onDuplicate}
            className="text-muted-foreground hover:text-foreground"
            title="Duplicate question"
          >
            <Copy className="size-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:text-destructive"
            title="Delete question"
          >
            <Trash2 className="size-4" />
          </button>
        </div>

        {/* ── Instruction text ──────────────────────────────────────────── */}
        <div className="ml-8">
          <Input
            value={question.instruction}
            onChange={(e) =>
              onUpdate({ ...question, instruction: e.target.value })
            }
            className="h-7 text-xs"
            placeholder="Instruction (optional, shown above question in PDF)"
          />
        </div>

        {/* ── Configurable rows ────────────────────────────────────────── */}
        <div className="ml-8 space-y-2 text-xs">
          {isPool ? (
            <div className="space-y-3">
              <div className="space-y-2">
                {question.poolComposition.map((row) => (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <Select
                      value={row.itemType}
                      onValueChange={(val) => {
                        updatePoolComposition(
                          question.poolComposition.map((r) =>
                            r.id === row.id
                              ? { ...r, itemType: val as PoolItemType }
                              : r
                          )
                        );
                      }}
                    >
                      <SelectTrigger className="h-7 w-36 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {POOL_ITEM_TYPES.map((t) => (
                          <SelectItem key={t} value={t} className="text-xs">
                            {POOL_ITEM_TYPE_LABELS[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">Count</span>
                      <NumericField
                        min={1}
                        max={50}
                        value={row.count}
                        onChange={(n) =>
                          updatePoolComposition(
                            question.poolComposition.map((r) =>
                              r.id === row.id ? { ...r, count: n } : r
                            )
                          )
                        }
                        className="h-7 w-16 text-center text-xs"
                      />
                    </div>
                    <Select
                      value={row.pinnedModuleId ?? "auto"}
                      onValueChange={(val) => {
                        updatePoolComposition(
                          question.poolComposition.map((r) =>
                            r.id === row.id
                              ? { ...r, pinnedModuleId: val === "auto" ? null : val }
                              : r
                          )
                        );
                      }}
                    >
                      <SelectTrigger className="h-7 w-44 text-xs text-muted-foreground">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto" className="text-xs">
                          — Auto
                        </SelectItem>
                        {modules.map((m) => (
                          <SelectItem key={m.id} value={m.id} className="text-xs">
                            {`M${m.module_number}: ${m.name}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      onClick={() => {
                        if (question.poolComposition.length <= 1) return;
                        updatePoolComposition(
                          question.poolComposition.filter((r) => r.id !== row.id)
                        );
                      }}
                      disabled={question.poolComposition.length <= 1}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:hover:text-muted-foreground"
                      title="Remove item type"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs border-dashed"
                onClick={() => {
                  updatePoolComposition([
                    ...question.poolComposition,
                    { id: uid(), itemType: "mcq", count: 1 },
                  ]);
                }}
              >
                <Plus className="size-3 mr-1" />
                Add item type
              </Button>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Marks per item</span>
                  <NumericField
                    min={1}
                    max={50}
                    value={question.poolMarksPerItem}
                    onChange={(n) =>
                      onUpdate({ ...question, poolMarksPerItem: n })
                    }
                    className="h-7 w-16 text-center text-xs"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span className="text-muted-foreground">Attempt any</span>
                <NumericField
                  min={1}
                  max={Math.max(1, poolN)}
                  value={question.poolAttemptCount}
                  onChange={(k) =>
                    onUpdate({
                      ...question,
                      poolAttemptCount: k,
                      instruction: defaultPoolInstruction(k, poolN),
                    })
                  }
                  className="h-7 w-16 text-center text-xs"
                />
                <span className="text-muted-foreground">of</span>
                <span className="font-medium tabular-nums w-8 text-center">
                  {poolN}
                </span>
              </div>

              <div className="text-muted-foreground">
                Total marks:{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {effectiveMarks(question)}M
                </span>
              </div>
            </div>
          ) : isMcqLike ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Sub-parts</span>
                <NumericField
                  min={1}
                  max={50}
                  value={question.subPartsCount}
                  onChange={(n) => onUpdate({ ...question, subPartsCount: n })}
                  className="h-7 w-16 text-center text-xs"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Marks / part</span>
                <NumericField
                  min={1}
                  max={20}
                  value={question.marksPerPart}
                  onChange={(n) => onUpdate({ ...question, marksPerPart: n })}
                  className="h-7 w-16 text-center text-xs"
                />
              </div>
            </div>
          ) : question.hasAttemptAny ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-muted-foreground">Attempt any</span>
              <NumericField
                min={1}
                max={question.attemptAnyOfTotal}
                value={question.attemptAnyTake}
                onChange={(n) => onUpdate({ ...question, attemptAnyTake: n })}
                className="h-7 w-16 text-center text-xs"
              />
              <span className="text-muted-foreground">of</span>
              <NumericField
                min={Math.max(2, question.attemptAnyTake)}
                max={10}
                value={question.attemptAnyOfTotal}
                onChange={(n) =>
                  onUpdate({ ...question, attemptAnyOfTotal: n })
                }
                className="h-7 w-16 text-center text-xs"
              />
              <span className="text-muted-foreground ml-2">
                Marks / option
              </span>
              <NumericField
                min={1}
                max={50}
                value={question.attemptAnyMarks}
                onChange={(n) =>
                  onUpdate({ ...question, attemptAnyMarks: n })
                }
                className="h-7 w-16 text-center text-xs"
              />
            </div>
          ) : question.hasOr ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-muted-foreground">Parts</span>
              <NumericField
                min={1}
                max={6}
                value={question.partsCount}
                onChange={(n) => onUpdate({ ...question, partsCount: n })}
                className="h-7 w-16 text-center text-xs"
              />
              <span className="text-muted-foreground">Marks / part</span>
              <NumericField
                min={1}
                max={50}
                value={question.marksPerSubPart}
                onChange={(n) =>
                  onUpdate({ ...question, marksPerSubPart: n })
                }
                className="h-7 w-16 text-center text-xs"
              />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-muted-foreground">Marks</span>
              <NumericField
                min={1}
                max={100}
                value={question.marks}
                onChange={(n) => onUpdate({ ...question, marks: n })}
                className="h-7 w-20 text-center text-xs"
              />
            </div>
          )}

          {/* ── Toggles ──────────────────────────────────────────────── */}
          {!isMcqLike && !isPool && (
            <div className="flex flex-wrap items-center gap-4 pt-1">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Switch
                  checked={question.hasOr}
                  onCheckedChange={(v) =>
                    onUpdate({
                      ...question,
                      hasOr: v,
                      hasAttemptAny: v ? false : question.hasAttemptAny,
                      partsCount: v ? Math.max(1, question.partsCount) : 1,
                      marksPerSubPart: v
                        ? Math.max(1, question.marks)
                        : question.marksPerSubPart,
                    })
                  }
                />
                <span>Has OR alternative</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Switch
                  checked={question.hasAttemptAny}
                  onCheckedChange={(v) =>
                    onUpdate({
                      ...question,
                      hasAttemptAny: v,
                      hasOr: v ? false : question.hasOr,
                    })
                  }
                />
                <span>Attempt any</span>
              </label>
            </div>
          )}

          {/* ── Module pin (optional, advanced) — basic descriptive/MCQ only ── */}
          {!isPool && !question.hasAttemptAny && !question.hasOr && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-muted-foreground">Module (optional)</span>
              <Select
                value={question.pinnedModuleId ?? "auto"}
                onValueChange={(val) =>
                  onUpdate({
                    ...question,
                    pinnedModuleId: val === "auto" ? null : val,
                  })
                }
              >
                <SelectTrigger className="h-7 w-52 text-xs text-muted-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto" className="text-xs">
                    — Auto
                  </SelectItem>
                  {modules.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {`M${m.module_number}: ${m.name}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* ── OR alternative mirror block (visual indicator) ──────────── */}
        {question.hasOr && (
          <div className="ml-12 border-l-2 border-dashed border-muted-foreground/40 pl-4 space-y-1">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground italic">
              OR — mirrored alternative ({question.partsCount} parts ×{" "}
              {question.marksPerSubPart}M)
            </div>
            {previewParts.map((label) => (
              <div key={label} className="text-xs text-muted-foreground">
                ({label}) AI will generate an alternative on the same module —
                attempt either side.
              </div>
            ))}
          </div>
        )}

        {question.hasAttemptAny && (
          <div className="ml-12 border-l-2 border-dashed border-muted-foreground/40 pl-4 text-[11px] text-muted-foreground italic">
            {question.attemptAnyOfTotal} options listed, student attempts{" "}
            {question.attemptAnyTake}.
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Stage ──────────────────────────────────────────────────────────────────

interface BuilderSectionsEditorProps {
  sections: BuilderSection[];
  setSections: React.Dispatch<React.SetStateAction<BuilderSection[]>>;
  targetMarks: number;
  totalMarksLive: number;
  flatLayout?: boolean;
  modules: ModuleRow[];
}

export function BuilderSectionsEditor({
  sections,
  setSections,
  targetMarks,
  totalMarksLive,
  flatLayout = false,
  modules,
}: BuilderSectionsEditorProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // ─── Builder mutations ──────────────────────────────────────────────────
  const addSection = () => {
    setSections((prev) => [
      ...prev,
      {
        id: uid(),
        name: `Section ${
          prev.length === 0
            ? "I"
            : ["II", "III", "IV", "V", "VI"][prev.length - 1] ?? `${prev.length + 1}`
        }`,
        questions: [newQuestion("long", { displayLabel: "Q - 1" })],
      },
    ]);
  };

  const removeSection = (id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id));
  };

  const updateSection = (id: string, patch: Partial<BuilderSection>) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
    );
  };

  const addQuestion = (sectionId: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              questions: [
                ...s.questions,
                newQuestion("long", {
                  displayLabel: `Q - ${s.questions.length + 1}`,
                }),
              ],
            }
          : s
      )
    );
  };

  const duplicateQuestion = (sectionId: string, qId: string) => {
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== sectionId) return s;
        const idx = s.questions.findIndex((q) => q.id === qId);
        if (idx === -1) return s;
        const src = s.questions[idx];
        const dup: BuilderQuestion = {
          ...src,
          id: uid(),
          displayLabel: `${src.displayLabel} (copy)`,
        };
        const next = [...s.questions];
        next.splice(idx + 1, 0, dup);
        return { ...s, questions: next };
      })
    );
  };

  const removeQuestion = (sectionId: string, qId: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? { ...s, questions: s.questions.filter((q) => q.id !== qId) }
          : s
      )
    );
  };

  const updateQuestion = (sectionId: string, updated: BuilderQuestion) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              questions: s.questions.map((q) =>
                q.id === updated.id ? updated : q
              ),
            }
          : s
      )
    );
  };

  const handleQuestionDragEnd = (sectionId: string, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== sectionId) return s;
        const oldIdx = s.questions.findIndex((q) => q.id === active.id);
        const newIdx = s.questions.findIndex((q) => q.id === over.id);
        if (oldIdx === -1 || newIdx === -1) return s;
        return { ...s, questions: arrayMove(s.questions, oldIdx, newIdx) };
      })
    );
  };

  return (
    <div className="space-y-4">
      {(() => {
        const diff = totalMarksLive - targetMarks;
        const status =
          diff === 0
            ? { label: "On target", tone: "text-emerald-600 bg-emerald-50 border-emerald-200" }
            : diff < 0
              ? {
                  label: `${Math.abs(diff)} marks left`,
                  tone: "text-amber-700 bg-amber-50 border-amber-200",
                }
              : {
                  label: `${diff} over target`,
                  tone: "text-rose-700 bg-rose-50 border-rose-200",
                };
        const pct = Math.min(100, Math.round((totalMarksLive / Math.max(1, targetMarks)) * 100));
        return (
          <div className="sticky top-2 z-10 rounded-lg border bg-background/95 backdrop-blur p-3 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold tabular-nums">
                  {totalMarksLive}
                </span>
                <span className="text-xs text-muted-foreground">
                  of {targetMarks} marks
                </span>
              </div>
              <span
                className={cn(
                  "text-[11px] font-medium px-2 py-0.5 rounded-full border",
                  status.tone
                )}
              >
                {status.label}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all",
                  diff === 0
                    ? "bg-emerald-500"
                    : diff < 0
                      ? "bg-amber-500"
                      : "bg-rose-500"
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })()}

      {sections.map((section) => (
        <div key={section.id} className="space-y-3">
          {!flatLayout && (
            <div className="flex items-center gap-3">
              <Input
                value={section.name}
                onChange={(e) =>
                  updateSection(section.id, { name: e.target.value })
                }
                className="font-semibold w-44 h-8 text-sm"
              />
              <span className="text-xs text-muted-foreground">
                {sectionTotal(section)}M
              </span>
              <div className="flex-1 h-px bg-border" />
              {sections.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSection(section.id)}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Remove section
                </button>
              )}
            </div>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(e) => handleQuestionDragEnd(section.id, e)}
          >
            <SortableContext
              items={section.questions.map((q) => q.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {section.questions.map((q, qIdx) => (
                  <SortableQuestion
                    key={q.id}
                    question={q}
                    qNumber={qIdx + 1}
                    modules={modules}
                    onUpdate={(updated) => updateQuestion(section.id, updated)}
                    onRemove={() => removeQuestion(section.id, q.id)}
                    onDuplicate={() => duplicateQuestion(section.id, q.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <Button
            variant="outline"
            size="sm"
            onClick={() => addQuestion(section.id)}
            className="w-full border-dashed"
          >
            <Plus className="size-4 mr-2" />
            Add question to {section.name}
          </Button>
        </div>
      ))}

      {!flatLayout && (
        <Button
          variant="ghost"
          size="sm"
          onClick={addSection}
          className="text-muted-foreground"
        >
          <Plus className="size-4 mr-1" />
          Add section
        </Button>
      )}
    </div>
  );
}
