"use client";

import { useCallback, useEffect, useState } from "react";
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
import {
  Download,
  FileText,
  GripVertical,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createBrowserClient } from "@/lib/db/supabase-browser";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────

type QuestionType = "mcq" | "truefalse" | "short" | "long" | "numerical";

type QuestionSource = "fresh" | "pyq_mix" | "pyq_pattern";

interface SubPart {
  id: string;
  marks: number;
  type: QuestionType;
}

interface Question {
  id: string;
  parts: SubPart[];
  attemptAny?: number;
  /** Optional — omit or "any" for no specific module */
  moduleId?: string;
}

interface Section {
  id: string;
  name: string;
  questions: Question[];
}

interface SubjectRow {
  id: string;
  name: string;
  code: string;
}

interface ModuleRow {
  id: string;
  name: string;
  module_number: number;
}

// ── Helpers ──────────────────────────────────────────────────

const TYPE_LABELS: Record<QuestionType, string> = {
  mcq: "MCQ (4 options)",
  truefalse: "MCQ True/False",
  short: "Short Answer (2-5M)",
  long: "Long Answer (5M+)",
  numerical: "Numerical",
};

const TYPE_DEFAULT_MARKS: Record<QuestionType, number> = {
  mcq: 1,
  truefalse: 1,
  short: 3,
  long: 5,
  numerical: 5,
};

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function makeQuestion(type: QuestionType = "long"): Question {
  return {
    id: uid(),
    parts: [
      { id: uid(), marks: TYPE_DEFAULT_MARKS[type], type },
      { id: uid(), marks: TYPE_DEFAULT_MARKS[type], type },
    ],
  };
}

/** Marks counted toward the paper when attempt-any is set: first N parts. */
function effectiveMarks(question: Question): number {
  if (question.attemptAny !== undefined) {
    return question.parts
      .slice(0, question.attemptAny)
      .reduce((s, p) => s + p.marks, 0);
  }
  return question.parts.reduce((s, p) => s + p.marks, 0);
}

function totalMarks(sections: Section[]): number {
  return sections.reduce(
    (sum, sec) =>
      sum + sec.questions.reduce((qs, q) => qs + effectiveMarks(q), 0),
    0
  );
}

function sectionTotal(section: Section): number {
  return section.questions.reduce((qs, q) => qs + effectiveMarks(q), 0);
}

function partTypeHint(t: QuestionType): string {
  switch (t) {
    case "mcq":
      return "4 options, 1 correct";
    case "truefalse":
      return "True or False";
    case "short":
      return "concise answer, 2-5 marks";
    case "long":
      return "detailed answer, 5+ marks";
    case "numerical":
      return "step-by-step solution";
    default:
      return "";
  }
}

const PART_LABELS = "abcdefghijklmnopqrstuvwxyz";

// ── Sortable Question Card ───────────────────────────────────

function SortableQuestion({
  question,
  qNumber,
  onUpdate,
  onRemove,
  modules,
  selectedModuleIds,
}: {
  question: Question;
  qNumber: number;
  onUpdate: (q: Question) => void;
  onRemove: () => void;
  modules: ModuleRow[];
  selectedModuleIds: string[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: question.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const lastPartType =
    question.parts[question.parts.length - 1]?.type ?? "long";

  const addPart = () => {
    const newParts = [
      ...question.parts,
      {
        id: uid(),
        marks: TYPE_DEFAULT_MARKS[lastPartType],
        type: lastPartType,
      },
    ];
    let attemptAny = question.attemptAny;
    if (attemptAny !== undefined && newParts.length > 1) {
      attemptAny = Math.max(1, Math.min(attemptAny, newParts.length - 1));
    }
    onUpdate({
      ...question,
      parts: newParts,
      attemptAny,
    });
  };

  const removePart = (partId: string) => {
    if (question.parts.length <= 1) return;
    const newParts = question.parts.filter((p) => p.id !== partId);
    let attemptAny = question.attemptAny;
    if (newParts.length <= 1) attemptAny = undefined;
    else if (attemptAny !== undefined) {
      attemptAny = Math.max(1, Math.min(attemptAny, newParts.length - 1));
    }
    onUpdate({
      ...question,
      parts: newParts,
      attemptAny,
    });
  };

  const rawTotal = question.parts.reduce((s, p) => s + p.marks, 0);

  return (
    <div ref={setNodeRef} style={style}>
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap w-full">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none shrink-0"
            title="Drag to reorder"
          >
            <GripVertical className="size-5" />
          </button>

          <span className="font-semibold text-sm w-8 shrink-0">Q.{qNumber}</span>

          {modules.length > 1 && (
            <Select
              value={question.moduleId ?? "any"}
              onValueChange={(val) =>
                onUpdate({
                  ...question,
                  moduleId: val === "any" ? undefined : val,
                })
              }
            >
              <SelectTrigger className="h-7 w-36 text-xs shrink-0">
                <SelectValue placeholder="Any module" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any" className="text-xs">
                  Any module
                </SelectItem>
                {modules
                  .filter((m) => selectedModuleIds.includes(m.id))
                  .map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      M{m.module_number}: {m.name.slice(0, 20)}
                      {m.name.length > 20 ? "…" : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}

          <div className="flex-1 min-w-2" />

          <Badge
            variant="secondary"
            className="text-xs flex items-center gap-1 flex-wrap justify-end max-w-[min(100%,14rem)] shrink-0"
          >
            <span>{effectiveMarks(question)}M</span>
            {question.attemptAny !== undefined && (
              <span className="text-muted-foreground font-normal">
                (of {rawTotal}M)
              </span>
            )}
          </Badge>

          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
            title="Remove question"
          >
            <Trash2 className="size-4" />
          </button>
        </div>

        <div className="ml-8 space-y-2">
          {question.parts.map((part, idx) => (
            <div
              key={part.id}
              className="flex items-center gap-2 text-sm flex-wrap"
            >
              <span className="text-muted-foreground w-6 shrink-0">
                ({PART_LABELS[idx]})
              </span>

              <Select
                value={part.type}
                onValueChange={(val) => {
                  const type = val as QuestionType;
                  onUpdate({
                    ...question,
                    parts: question.parts.map((p) =>
                      p.id === part.id
                        ? { ...p, type, marks: TYPE_DEFAULT_MARKS[type] }
                        : p
                    ),
                  });
                }}
              >
                <SelectTrigger className="w-40 h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val} className="text-xs">
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={part.marks}
                  onChange={(e) =>
                    onUpdate({
                      ...question,
                      parts: question.parts.map((p) =>
                        p.id === part.id
                          ? {
                              ...p,
                              marks: Math.max(
                                1,
                                parseInt(e.target.value, 10) || 1
                              ),
                            }
                          : p
                      ),
                    })
                  }
                  className="w-14 h-7 text-center text-xs"
                />
                <span className="text-xs text-muted-foreground">M</span>
              </div>

              <span className="text-xs text-muted-foreground italic flex-1 min-w-[8rem]">
                {partTypeHint(part.type)}
              </span>

              {question.parts.length > 1 && (
                <button
                  type="button"
                  onClick={() => removePart(part.id)}
                  className="text-muted-foreground hover:text-destructive ml-auto shrink-0"
                >
                  <Trash2 className="size-3" />
                </button>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={addPart}
            className="flex items-center gap-1 text-xs text-primary hover:underline mt-1"
          >
            <Plus className="size-3" /> Add part
          </button>
        </div>

        <div className="ml-8 mt-2">
          {question.attemptAny === undefined ? (
            <button
              type="button"
              onClick={() =>
                onUpdate({
                  ...question,
                  attemptAny: Math.max(1, question.parts.length - 1),
                })
              }
              className="text-[11px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
            >
              <Plus className="size-3" />
              Add &quot;attempt any X&quot; instruction
            </button>
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Attempt any</span>
              <Input
                type="number"
                min={1}
                max={question.parts.length}
                value={question.attemptAny}
                onChange={(e) =>
                  onUpdate({
                    ...question,
                    attemptAny: Math.min(
                      question.parts.length,
                      Math.max(1, parseInt(e.target.value, 10) || 1)
                    ),
                  })
                }
                className="w-14 h-6 text-center text-xs"
              />
              <span className="text-muted-foreground">
                out of {question.parts.length}
              </span>
              <button
                type="button"
                onClick={() => onUpdate({ ...question, attemptAny: undefined })}
                className="text-muted-foreground hover:text-destructive ml-1"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────

export default function QpaperPage() {
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [duration, setDuration] = useState(180);
  const [questionSource, setQuestionSource] =
    useState<QuestionSource>("fresh");
  const [pyqPercent, setPyqPercent] = useState(50);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [selectedModuleIds, setSelectedModuleIds] = useState<string[]>([]);
  const [sections, setSections] = useState<Section[]>([
    {
      id: uid(),
      name: "Section A",
      questions: [
        {
          id: uid(),
          parts: Array.from({ length: 5 }, () => ({
            id: uid(),
            marks: 1,
            type: "mcq" as QuestionType,
          })),
        },
        makeQuestion("long"),
        makeQuestion("long"),
      ],
    },
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const loadSubjects = useCallback(async () => {
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setIsLoading(false);
      return;
    }
    const { data: assignments } = await supabase
      .from("faculty_assignments")
      .select("subject_id, subjects(id, name, code)")
      .eq("faculty_id", user.id);

    const subjs: SubjectRow[] = [];
    const seen = new Set<string>();
    for (const row of assignments ?? []) {
      const rel = row.subjects as SubjectRow | SubjectRow[] | null | undefined;
      const list = Array.isArray(rel) ? rel : rel ? [rel] : [];
      for (const s of list) {
        if (s?.id && !seen.has(s.id)) {
          seen.add(s.id);
          subjs.push(s);
        }
      }
    }

    setSubjects(subjs);
    if (subjs.length > 0) setSelectedSubjectId(subjs[0].id);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadSubjects();
  }, [loadSubjects]);

  useEffect(() => {
    if (!selectedSubjectId) {
      setModules([]);
      setSelectedModuleIds([]);
      return;
    }
    const load = async () => {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("modules")
        .select("id, name, module_number")
        .eq("subject_id", selectedSubjectId)
        .order("module_number");
      const rows = (data ?? []) as ModuleRow[];
      setModules(rows);
      setSelectedModuleIds(rows.map((m) => m.id));
    };
    void load();
  }, [selectedSubjectId]);

  useEffect(() => {
    if (!isGenerating) return;
    const block = (e: PopStateEvent) => {
      e.preventDefault();
      window.history.pushState(null, "", window.location.href);
    };
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Q Paper is being generated. Please wait.";
    };
    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", block);
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("popstate", block);
      window.removeEventListener("beforeunload", warn);
    };
  }, [isGenerating]);

  const addSection = () => {
    setSections((prev) => [
      ...prev,
      {
        id: uid(),
        name: `Section ${String.fromCharCode(65 + prev.length)}`,
        questions: [makeQuestion("long")],
      },
    ]);
  };

  const removeSection = (sectionId: string) => {
    if (sections.length <= 1) return;
    setSections((prev) => prev.filter((s) => s.id !== sectionId));
  };

  const updateSectionName = (sectionId: string, name: string) => {
    setSections((prev) =>
      prev.map((s) => (s.id === sectionId ? { ...s, name } : s))
    );
  };

  const addQuestion = (sectionId: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? { ...s, questions: [...s.questions, makeQuestion()] }
          : s
      )
    );
  };

  const removeQuestion = (sectionId: string, questionId: string) => {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? { ...s, questions: s.questions.filter((q) => q.id !== questionId) }
          : s
      )
    );
  };

  const updateQuestion = (sectionId: string, updated: Question) => {
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

  const handleDragEnd = (sectionId: string, event: DragEndEvent) => {
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

  const totalMarksComputed = totalMarks(sections);

  const handleGenerate = async () => {
    if (!selectedSubjectId) {
      toast.error("Select a subject first");
      return;
    }
    setIsGenerating(true);
    setDownloadUrl(null);
    try {
      const res = await fetch("/api/generate/qpaper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: selectedSubjectId,
          sections,
          totalMarks: totalMarksComputed,
          duration,
          questionSource,
          selectedModuleIds,
          pyqPercent: questionSource === "pyq_mix" ? pyqPercent : null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { downloadUrl?: string };
      if (data.downloadUrl) setDownloadUrl(data.downloadUrl);
      toast.success("Question paper generated!");
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="size-6" />
          Question Paper Generator
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Build your paper structure — AI generates the questions
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-48">
          <Label className="text-xs mb-1 block">Subject</Label>
          <Select
            value={selectedSubjectId}
            onValueChange={setSelectedSubjectId}
            disabled={isLoading || subjects.length === 0}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  isLoading
                    ? "Loading subjects..."
                    : subjects.length === 0
                      ? "No subjects assigned"
                      : "Select subject"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {subjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {modules.length > 0 && (
          <div className="w-full basis-full">
            <Label className="text-xs mb-2 block">
              Modules to include
              <span className="text-muted-foreground font-normal ml-1">
                (uncheck to exclude from this paper)
              </span>
            </Label>
            <div className="flex flex-wrap gap-2">
              {modules.map((mod) => {
                const selected = selectedModuleIds.includes(mod.id);
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() =>
                      setSelectedModuleIds((prev) =>
                        selected
                          ? prev.filter((id) => id !== mod.id)
                          : [...prev, mod.id]
                      )
                    }
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                      selected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-primary/50"
                    )}
                  >
                    Module {mod.module_number}: {mod.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div>
          <Label className="text-xs mb-1 block">Duration (min)</Label>
          <Input
            type="number"
            value={duration}
            onChange={(e) => setDuration(parseInt(e.target.value, 10) || 60)}
            className="w-28"
            min={15}
            max={300}
          />
        </div>
        <div>
          <Label className="text-xs mb-1 block">Question Source</Label>
          <div className="flex rounded-md border overflow-hidden text-xs font-medium">
            {(
              [
                ["fresh", "All Fresh"],
                ["pyq_mix", "PYQ + Fresh Mix"],
                ["pyq_pattern", "PYQ Style Only"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setQuestionSource(val)}
                className={cn(
                  "px-3 py-2 transition-colors",
                  questionSource === val
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-muted-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {questionSource === "pyq_mix" && (
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={10}
                  max={90}
                  step={10}
                  value={pyqPercent}
                  onChange={(e) =>
                    setPyqPercent(parseInt(e.target.value, 10))
                  }
                  className="flex-1 accent-primary"
                />
                <span className="text-xs font-medium w-24 text-right">
                  {pyqPercent}% PYQ · {100 - pyqPercent}% Fresh
                </span>
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>More fresh</span>
                <span>More PYQ</span>
              </div>
            </div>
          )}
          {questionSource === "pyq_pattern" && (
            <p className="text-[10px] text-muted-foreground mt-1">
              New questions matching PYQ difficulty and style
            </p>
          )}
        </div>
        <div className="flex items-end">
          <div className="rounded-lg border px-4 py-2 bg-muted/30 text-center">
            <p className="text-2xl font-bold text-primary">
              {totalMarksComputed}M
            </p>
            <p className="text-xs text-muted-foreground">Total Marks</p>
          </div>
        </div>
      </div>

      {sections.map((section, sIdx) => (
        <div key={section.id} className="space-y-3">
          <div className="flex items-center gap-3">
            <Input
              value={section.name}
              onChange={(e) => updateSectionName(section.id, e.target.value)}
              className="font-semibold w-40 h-8 text-sm"
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

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(e) => handleDragEnd(section.id, e)}
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
                    qNumber={
                      sections
                        .slice(0, sIdx)
                        .reduce((acc, s) => acc + s.questions.length, 0) +
                      qIdx +
                      1
                    }
                    onUpdate={(updated) => updateQuestion(section.id, updated)}
                    onRemove={() => removeQuestion(section.id, q.id)}
                    modules={modules}
                    selectedModuleIds={selectedModuleIds}
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
            Add Question to {section.name}
          </Button>
        </div>
      ))}

      <Button
        variant="ghost"
        size="sm"
        onClick={addSection}
        className="text-muted-foreground"
      >
        <Plus className="size-4 mr-1" />
        Add Section
      </Button>

      <div className="flex gap-3 pt-2">
        <Button
          onClick={handleGenerate}
          disabled={isGenerating || !selectedSubjectId}
          className="flex-1"
          size="lg"
        >
          {isGenerating ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Generating...
            </>
          ) : (
            "Generate Question Paper"
          )}
        </Button>

        {downloadUrl && (
          <Button
            variant="outline"
            size="lg"
            onClick={() => window.open(downloadUrl, "_blank")}
          >
            <Download className="mr-2 size-4" />
            Download PDF
          </Button>
        )}
      </div>

      {isGenerating && (
        <p className="text-xs text-center text-muted-foreground">
          Generating questions... please don&apos;t close this page.
        </p>
      )}
    </div>
  );
}
