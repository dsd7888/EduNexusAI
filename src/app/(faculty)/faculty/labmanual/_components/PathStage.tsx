"use client";

/**
 * The PATH stage — the faculty-expertise moment (§7).
 *
 * The AI proposes a grouping; this screen exists so a lab instructor can
 * overrule it before a rupee is spent on content. Practicals are draggable
 * between and within units (dnd-kit), unit names and per-practical difficulty
 * are editable, and bridges can be dropped.
 */

import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronLeft,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  DIFFICULTY_HINTS,
  WARNING_LABELS,
  type Difficulty,
  type LearningPath,
  type PathUnit,
  type LabManualWarning,
  type UiPractical,
  type PracticalState,
} from "./shared";

interface Props {
  path: LearningPath;
  practicals: UiPractical[];
  warnings: LabManualWarning[];
  practicalStates: Record<number, PracticalState>;
  onPathChange: (p: LearningPath) => void;
  onStateChange: (practicalNo: number, patch: Partial<PracticalState>) => void;
  onBack: () => void;
  onApprove: () => void;
  onGenerateAll: () => void;
  onGenerateUnit: (unitNo: number) => void;
  generating: boolean;
}

function PracticalChip({
  practicalNo,
  title,
  reviewedBadge,
}: {
  practicalNo: number;
  title: string;
  reviewedBadge?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `p-${practicalNo}` });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`bg-background flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm ${
        isDragging ? "opacity-50 shadow-lg" : ""
      }`}
    >
      <button
        type="button"
        className="text-muted-foreground cursor-grab touch-none active:cursor-grabbing"
        {...attributes}
        {...listeners}
        aria-label={`Reorder practical ${practicalNo}`}
      >
        <GripVertical className="size-3.5" />
      </button>
      <span className="text-muted-foreground shrink-0 tabular-nums">
        #{practicalNo}
      </span>
      <span className="flex-1 truncate">{title}</span>
      {reviewedBadge && <Check className="size-3.5 text-emerald-600" />}
    </div>
  );
}

function UnitDropZone({
  unit,
  children,
}: {
  unit: PathUnit;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `unit-${unit.unitNo}` });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-14 space-y-1.5 rounded-md border border-dashed p-2 transition-colors ${
        isOver ? "border-primary bg-primary/5" : "border-muted"
      }`}
    >
      {children}
      {unit.practicalNos.length === 0 && (
        <p className="text-muted-foreground px-1 py-2 text-xs">
          Drop practicals here — empty units are removed on approve.
        </p>
      )}
    </div>
  );
}

export function PathStage({
  path,
  practicals,
  warnings,
  practicalStates,
  onPathChange,
  onStateChange,
  onBack,
  onApprove,
  onGenerateAll,
  onGenerateUnit,
  generating,
}: Props) {
  const [editingUnit, setEditingUnit] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const titleOf = useMemo(() => {
    const m = new Map(practicals.map((p) => [p.practicalNo, p.title]));
    return (n: number) => m.get(n) ?? `Practical #${n}`;
  }, [practicals]);

  const unitOfPractical = (n: number) =>
    path.units.find((u) => u.practicalNos.includes(n));

  function handleDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId || activeId === overId) return;

    const practicalNo = Number(activeId.replace("p-", ""));
    const from = unitOfPractical(practicalNo);
    if (!from) return;

    // Dropped onto a unit's empty area → move to the end of that unit.
    if (overId.startsWith("unit-")) {
      const toNo = Number(overId.replace("unit-", ""));
      if (from.unitNo === toNo) return;
      onPathChange({
        ...path,
        units: path.units.map((u) => {
          if (u.unitNo === from.unitNo) {
            return {
              ...u,
              practicalNos: u.practicalNos.filter((n) => n !== practicalNo),
            };
          }
          if (u.unitNo === toNo) {
            return { ...u, practicalNos: [...u.practicalNos, practicalNo] };
          }
          return u;
        }),
      });
      return;
    }

    // Dropped onto another chip → reorder within, or insert into that unit.
    const overNo = Number(overId.replace("p-", ""));
    const to = unitOfPractical(overNo);
    if (!to) return;

    if (from.unitNo === to.unitNo) {
      const oldIndex = from.practicalNos.indexOf(practicalNo);
      const newIndex = from.practicalNos.indexOf(overNo);
      onPathChange({
        ...path,
        units: path.units.map((u) =>
          u.unitNo === from.unitNo
            ? { ...u, practicalNos: arrayMove(u.practicalNos, oldIndex, newIndex) }
            : u,
        ),
      });
      return;
    }

    const insertAt = to.practicalNos.indexOf(overNo);
    onPathChange({
      ...path,
      units: path.units.map((u) => {
        if (u.unitNo === from.unitNo) {
          return {
            ...u,
            practicalNos: u.practicalNos.filter((n) => n !== practicalNo),
          };
        }
        if (u.unitNo === to.unitNo) {
          const next = [...u.practicalNos];
          next.splice(insertAt, 0, practicalNo);
          return { ...u, practicalNos: next };
        }
        return u;
      }),
    });
  }

  function addUnit() {
    const nextNo = Math.max(0, ...path.units.map((u) => u.unitNo)) + 1;
    onPathChange({
      ...path,
      units: [
        ...path.units,
        { unitNo: nextNo, name: `Unit ${nextNo}`, practicalNos: [], rationale: "" },
      ],
    });
  }

  const pathWarnings = warnings.filter((w) => w.practicalNo === null);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="size-4" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          {path.approved ? (
            <Badge className="bg-emerald-600">Path approved</Badge>
          ) : (
            <Badge variant="secondary">Draft path</Badge>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Learning path</h2>
        <p className="text-muted-foreground text-sm">
          The AI proposed this grouping. Rearrange it to match how you actually
          teach the lab — drag practicals between units, rename units, and set the
          difficulty for each practical before generating.
        </p>
      </div>

      {pathWarnings.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          {pathWarnings.map((w, i) => (
            <p
              key={i}
              className="text-sm text-amber-800 dark:text-amber-300"
              title={w.message}
            >
              <span className="font-medium">{WARNING_LABELS[w.kind]}:</span>{" "}
              {w.message}
            </p>
          ))}
        </div>
      )}

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="space-y-3">
          {path.units.map((unit) => (
            <Card key={unit.unitNo}>
              <CardHeader className="pb-2">
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="mt-0.5 shrink-0">
                    Unit {unit.unitNo}
                  </Badge>
                  <div className="min-w-0 flex-1 space-y-1">
                    <Input
                      value={unit.name}
                      onChange={(e) =>
                        onPathChange({
                          ...path,
                          units: path.units.map((u) =>
                            u.unitNo === unit.unitNo
                              ? { ...u, name: e.target.value }
                              : u,
                          ),
                        })
                      }
                      className="h-8 font-medium"
                      aria-label={`Unit ${unit.unitNo} name`}
                    />
                    {unit.rationale && (
                      <p className="text-muted-foreground text-xs">
                        {unit.rationale}
                      </p>
                    )}
                  </div>
                  {path.approved && unit.practicalNos.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={generating}
                      onClick={() => onGenerateUnit(unit.unitNo)}
                    >
                      Generate unit
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <SortableContext
                  items={unit.practicalNos.map((n) => `p-${n}`)}
                  strategy={rectSortingStrategy}
                >
                  <UnitDropZone unit={unit}>
                    {unit.practicalNos.map((n) => (
                      <div key={n} className="space-y-1">
                        <PracticalChip practicalNo={n} title={titleOf(n)} />
                        <Collapsible
                          open={editingUnit === n}
                          onOpenChange={(o) => setEditingUnit(o ? n : null)}
                        >
                          <CollapsibleTrigger asChild>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground ml-7 flex items-center gap-1 text-xs"
                            >
                              <Pencil className="size-3" />
                              {DIFFICULTY_LABELS[
                                practicalStates[n]?.difficulty ?? "standard"
                              ]}
                              {practicalStates[n]?.customInstruction
                                ? " · has instruction"
                                : ""}
                            </button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="bg-muted/40 ml-7 mt-1 space-y-2 rounded-md p-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Difficulty</Label>
                              <Select
                                value={practicalStates[n]?.difficulty ?? "standard"}
                                onValueChange={(v) =>
                                  onStateChange(n, { difficulty: v as Difficulty })
                                }
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
                              <p className="text-muted-foreground text-xs">
                                {
                                  DIFFICULTY_HINTS[
                                    practicalStates[n]?.difficulty ?? "standard"
                                  ]
                                }
                              </p>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">
                                Instruction for this practical
                              </Label>
                              <Textarea
                                rows={2}
                                value={practicalStates[n]?.customInstruction ?? ""}
                                onChange={(e) =>
                                  onStateChange(n, {
                                    customInstruction: e.target.value,
                                  })
                                }
                                placeholder="e.g. Use the apparatus we actually have: a 3-layer plate, no thermal paste."
                                className="text-xs"
                              />
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      </div>
                    ))}
                  </UnitDropZone>
                </SortableContext>
              </CardContent>
            </Card>
          ))}
        </div>
      </DndContext>

      <Button variant="outline" size="sm" onClick={addUnit}>
        <Plus className="size-4" />
        Add unit
      </Button>

      {path.bridges.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Supplementary exercises</h3>
          {path.bridges.map((b, i) => (
            <Card
              key={i}
              className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
            >
              <CardContent className="flex items-start gap-3 p-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="border-amber-400 text-amber-700 dark:text-amber-400"
                    >
                      Supplementary
                    </Badge>
                    <span className="text-sm font-medium">{b.title}</span>
                    <span className="text-muted-foreground text-xs">
                      after #{b.afterPracticalNo}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs">{b.statement}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  onClick={() =>
                    onPathChange({
                      ...path,
                      bridges: path.bridges.filter((_, j) => j !== i),
                    })
                  }
                  aria-label="Remove bridge exercise"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="bg-background sticky bottom-0 flex items-center justify-end gap-2 border-t py-3">
        {!path.approved ? (
          <Button onClick={onApprove}>
            <Check className="size-4" />
            Approve path
          </Button>
        ) : (
          <Button onClick={onGenerateAll} disabled={generating}>
            {generating ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Generating…
              </>
            ) : (
              "Generate all practicals"
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
