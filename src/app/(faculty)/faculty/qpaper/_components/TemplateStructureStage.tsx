"use client";

/**
 * Stage — "Template & Structure": the collapsible Paper Details metadata form
 * (header fields + drag-sortable instructions), the quick-start preset row
 * (ESE Standard / Quiz / start-from-scratch), and the saved template browser
 * (opened via a dialog, My Templates + Shared Templates, each with a Load action).
 */

import { useEffect, useState } from "react";
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
import { ChevronDown, ChevronRight, FolderOpen, GripVertical, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SubjectRow } from "@/hooks/useSupabaseData";
import type { PaperTemplateRow, SharedTemplateRow } from "@/lib/qpaper/templates";
import { makeInstruction, type InstructionItem, type PaperMetadata } from "./shared";

// ─── Sortable instruction row ───────────────────────────────────────────────

function SortableInstruction({
  item,
  index,
  onChange,
  onRemove,
}: {
  item: InstructionItem;
  index: number;
  onChange: (text: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
        title="Drag to reorder"
      >
        <GripVertical className="size-3.5" />
      </button>
      <span className="text-xs text-muted-foreground w-5">{index + 1}.</span>
      <Input
        value={item.text}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-xs flex-1"
        placeholder="Instruction text"
      />
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive"
        title="Remove"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

// ─── Course header field row ────────────────────────────────────────────────

function CourseHeaderRow({
  subject,
  meta,
  setMeta,
}: {
  subject: SubjectRow | undefined;
  meta: PaperMetadata;
  setMeta: (m: PaperMetadata) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>
        <Label className="text-xs mb-1 block">Subject</Label>
        <Input
          value={subject?.name ?? ""}
          readOnly
          className="h-8 text-sm bg-muted/40"
        />
      </div>
      <div>
        <Label className="text-xs mb-1 block">Course Code</Label>
        <Input
          value={subject?.code ?? ""}
          readOnly
          className="h-8 text-sm bg-muted/40"
        />
      </div>
      <div>
        <Label className="text-xs mb-1 block">Exam Title</Label>
        <Input
          value={meta.examTitle}
          onChange={(e) => setMeta({ ...meta, examTitle: e.target.value })}
          className="h-8 text-sm"
          placeholder="End Semester Examination"
        />
      </div>
      <div>
        <Label className="text-xs mb-1 block">Semester</Label>
        <Input
          value={meta.semester}
          onChange={(e) => setMeta({ ...meta, semester: e.target.value })}
          className="h-8 text-sm"
          placeholder="Fifth Semester of B. Tech. Examination"
        />
      </div>
      <div>
        <Label className="text-xs mb-1 block">Date</Label>
        <Input
          value={meta.date}
          onChange={(e) => setMeta({ ...meta, date: e.target.value })}
          className="h-8 text-sm"
          placeholder="DD / MM / YYYY"
        />
      </div>
      <div>
        <Label className="text-xs mb-1 block">Time</Label>
        <Input
          value={meta.time}
          onChange={(e) => setMeta({ ...meta, time: e.target.value })}
          className="h-8 text-sm"
          placeholder="150 Minutes"
        />
      </div>
      <div className="md:col-span-2">
        <Label className="text-xs mb-1 block">University Name</Label>
        <Input
          value={meta.universityName}
          onChange={(e) => setMeta({ ...meta, universityName: e.target.value })}
          className="h-8 text-sm"
        />
      </div>
    </div>
  );
}

// ─── Template card ──────────────────────────────────────────────────────────

function TemplateCard({
  tpl,
  byLine,
  onLoad,
  onDelete,
}: {
  tpl: PaperTemplateRow;
  byLine?: string;
  onLoad: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 px-3 rounded-md border bg-card hover:bg-accent/30 transition-colors">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">
          {tpl.name}
          {tpl.is_default && (
            <span className="ml-2 text-[10px] text-primary font-semibold uppercase tracking-wide">
              default
            </span>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {tpl.duration_minutes} min · {tpl.total_marks} marks
          {byLine ? ` · ${byLine}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {onDelete && tpl.is_owner && (
          <button
            type="button"
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive p-1"
            title="Delete template"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
        <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={onLoad}>
          Load
        </Button>
      </div>
    </div>
  );
}

// ─── Stage ──────────────────────────────────────────────────────────────────

interface TemplateStructureStageProps {
  selectedSubject: SubjectRow | undefined;
  meta: PaperMetadata;
  setMeta: React.Dispatch<React.SetStateAction<PaperMetadata>>;
  metaOpen: boolean;
  setMetaOpen: React.Dispatch<React.SetStateAction<boolean>>;
  totalMarksLive: number;
  sectionsCount: number;
  onApplyEse: () => void;
  onApplyQuiz: () => void;
  onClearBuilder: () => void;
  /** Increment to trigger a template list refetch (e.g. after saving). */
  refreshKey?: number;
  /** Called when the user clicks Load on a template row. */
  onLoadTemplate: (tpl: PaperTemplateRow) => void;
}

export function TemplateStructureStage({
  selectedSubject,
  meta,
  setMeta,
  metaOpen,
  setMetaOpen,
  totalMarksLive,
  sectionsCount,
  onApplyEse,
  onApplyQuiz,
  onClearBuilder,
  refreshKey,
  onLoadTemplate,
}: TemplateStructureStageProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // ─── Template list ────────────────────────────────────────────────────
  const [myTemplates, setMyTemplates] = useState<PaperTemplateRow[]>([]);
  const [sharedTemplates, setSharedTemplates] = useState<SharedTemplateRow[]>([]);
  const [loadingTpl, setLoadingTpl] = useState(false);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoadingTpl(true);
    fetch("/api/qpaper/templates")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: { myTemplates?: PaperTemplateRow[]; sharedTemplates?: SharedTemplateRow[] }) => {
        if (!cancelled) {
          setMyTemplates(data.myTemplates ?? []);
          setSharedTemplates(data.sharedTemplates ?? []);
        }
      })
      .catch(() => {
        /* silently ignore — templates are not critical path */
      })
      .finally(() => {
        if (!cancelled) setLoadingTpl(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, localRefreshKey]);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this template? This cannot be undone and will remove it for everyone it's shared with.")) return;
    const res = await fetch(`/api/qpaper/templates/${id}`, { method: "DELETE" });
    if (res.status === 403) {
      toast.error("You don't have permission to delete this template.");
      return;
    }
    if (!res.ok) {
      toast.error("Failed to delete template. Please try again.");
      return;
    }
    setLocalRefreshKey((k) => k + 1);
  };

  const handleInstructionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setMeta((prev) => {
      const oldIdx = prev.instructions.findIndex((i) => i.id === active.id);
      const newIdx = prev.instructions.findIndex((i) => i.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return prev;
      return {
        ...prev,
        instructions: arrayMove(prev.instructions, oldIdx, newIdx),
      };
    });
  };

  const q = search.toLowerCase();
  const filteredMy = myTemplates.filter((t) => t.name.toLowerCase().includes(q));
  const filteredShared = sharedTemplates.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      (t.creator_name ?? "").toLowerCase().includes(q)
  );

  return (
    <>
      {/* ── Paper Details metadata form ──────────────────────────────── */}
      <Card className="p-4 space-y-3">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setMetaOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setMetaOpen((v) => !v);
            }
          }}
          className="flex items-center justify-between cursor-pointer select-none"
        >
          <div className="flex items-center gap-2">
            {metaOpen ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            <h2 className="text-sm font-semibold">Paper Details</h2>
          </div>
          <span className="text-xs text-muted-foreground">
            {totalMarksLive} marks · {sectionsCount} section
            {sectionsCount === 1 ? "" : "s"}
          </span>
        </div>

        {metaOpen && (
          <div className="space-y-4 pt-2">
            <CourseHeaderRow
              subject={selectedSubject}
              meta={meta}
              setMeta={setMeta}
            />

            <div>
              <Label className="text-xs mb-2 block">Instructions</Label>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleInstructionDragEnd}
              >
                <SortableContext
                  items={meta.instructions.map((i) => i.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-1">
                    {meta.instructions.map((ins, idx) => (
                      <SortableInstruction
                        key={ins.id}
                        item={ins}
                        index={idx}
                        onChange={(text) =>
                          setMeta({
                            ...meta,
                            instructions: meta.instructions.map((x) =>
                              x.id === ins.id ? { ...x, text } : x
                            ),
                          })
                        }
                        onRemove={() =>
                          setMeta({
                            ...meta,
                            instructions: meta.instructions.filter(
                              (x) => x.id !== ins.id
                            ),
                          })
                        }
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
              <button
                type="button"
                onClick={() =>
                  setMeta({
                    ...meta,
                    instructions: [...meta.instructions, makeInstruction()],
                  })
                }
                className="text-xs text-primary hover:underline flex items-center gap-1 mt-2"
              >
                <Plus className="size-3" /> Add instruction
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* ── Quick-start template presets ─────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground mr-1">Quick start:</span>
        <Button variant="outline" size="sm" onClick={onApplyEse}>
          ESE Standard — 60M
        </Button>
        <Button variant="outline" size="sm" onClick={onApplyQuiz}>
          Quiz — 10M
        </Button>
        <button
          type="button"
          onClick={onClearBuilder}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1"
        >
          Start from scratch
        </button>

        {/* ── Browse Templates dialog trigger ─────────────────────── */}
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setSearch("");
          }}
        >
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="ml-auto gap-1.5">
              <FolderOpen className="size-3.5" />
              Browse Templates
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Browse Templates</DialogTitle>
            </DialogHeader>

            <Input
              placeholder="Search by name or creator…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm"
            />

            {loadingTpl ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                <Loader2 className="size-3 animate-spin" /> Loading…
              </div>
            ) : (
              <div className="space-y-4">
                {/* My Templates */}
                <div className="space-y-1.5">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    My Templates
                  </h3>
                  {filteredMy.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-1">
                      {search
                        ? "No matching templates."
                        : "No saved templates yet. Use “Save as template” below after building a structure."}
                    </p>
                  ) : (
                    <ScrollArea className="max-h-64">
                      <div className="space-y-1 pr-3">
                        {filteredMy.map((tpl) => (
                          <TemplateCard
                            key={tpl.id}
                            tpl={tpl}
                            onLoad={() => {
                              onLoadTemplate(tpl);
                              setDialogOpen(false);
                            }}
                            onDelete={() => handleDelete(tpl.id)}
                          />
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>

                {/* Shared Templates */}
                <div className="space-y-1.5">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Shared Templates
                  </h3>
                  {filteredShared.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-1">
                      {search ? "No matching templates." : "No shared templates yet."}
                    </p>
                  ) : (
                    <ScrollArea className="max-h-64">
                      <div className="space-y-1 pr-3">
                        {filteredShared.map((tpl) => (
                          <TemplateCard
                            key={tpl.id}
                            tpl={tpl}
                            byLine={`by ${tpl.creator_name ?? "Built-in"}`}
                            onLoad={() => {
                              onLoadTemplate(tpl);
                              setDialogOpen(false);
                            }}
                            onDelete={() => handleDelete(tpl.id)}
                          />
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
