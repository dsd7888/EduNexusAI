"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileText,
  GripVertical,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { createBrowserClient } from "@/lib/db/supabase-browser";
import {
  useFacultySubjects,
  type SubjectRow,
} from "@/hooks/useSupabaseData";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────────────────────

type ContentType = "mcq" | "truefalse" | "short" | "long" | "numerical";

interface BuilderQuestion {
  id: string;
  displayLabel: string;
  contentType: ContentType;
  instruction: string;
  /** MCQ/True-False: number of sub-part rows (e.g. 6 mini MCQs). */
  subPartsCount: number;
  /** MCQ: marks per sub-part. Other types: ignored. */
  marksPerPart: number;
  /** Total marks for a single descriptive question. */
  marks: number;
  /** Has "OR" alternative — adds a mirrored block. */
  hasOr: boolean;
  /** Primary parts count (1 = single, 2 = a+b, etc.). Used with hasOr. */
  partsCount: number;
  /** Marks per part (descriptive_with_or / multi-part). */
  marksPerSubPart: number;
  /** "Attempt any N of M" modifier. */
  hasAttemptAny: boolean;
  attemptAnyTake: number;
  attemptAnyOfTotal: number;
  /** Per option marks for attempt-any. */
  attemptAnyMarks: number;
}

interface BuilderSection {
  id: string;
  name: string;
  questions: BuilderQuestion[];
}

interface InstructionItem {
  id: string;
  text: string;
}

interface PaperMetadata {
  examTitle: string;
  semester: string;
  date: string;
  time: string;
  universityName: string;
  instructions: InstructionItem[];
}

type PyqMode = "fresh" | "pyq_mix" | "pyq_pattern";

interface ModuleRow {
  id: string;
  name: string;
  module_number: number;
  section_number: number | null;
  weightage_percent: number | null;
}

// ─── Server payload (returned from /api/generate/qpaper) ────────────────────

interface SubQuestion {
  label: string;
  question: string;
  options?: Record<string, string>;
  correct_option?: string;
  co?: string | null;
  btl?: number | null;
  po?: string | null;
}

interface QuestionPart {
  label?: string | null;
  question: string;
  marks: number;
  co?: string | null;
  btl?: number | null;
  po?: string | null;
  is_or_alternative?: boolean;
}

interface GeneratedQuestion {
  q_number: number;
  display_label?: string;
  type: string;
  instruction?: string | null;
  total_marks: number;
  attempt_logic?: string | null;
  sub_parts?: SubQuestion[];
  parts?: QuestionPart[];
}

interface GeneratedSection {
  section_name: string;
  module_range?: [number, number];
  total_marks?: number;
  questions: GeneratedQuestion[];
}

interface AssembledPaper {
  paperTitle?: string;
  universityName: string;
  examTitle?: string | null;
  courseCode: string;
  courseName: string;
  date?: string | null;
  duration: number;
  totalMarks: number;
  instructions: string[];
  sections: GeneratedSection[];
  courseOutcomes?: Array<{ co_code: string; description: string }>;
  hasCoPoData?: boolean;
}

// ─── Template payload (sent to /api/qpaper/templates) ───────────────────────

interface TemplateQuestionPayload {
  q_number: number;
  display_label: string;
  type: "mcq" | "descriptive" | "descriptive_with_or" | "attempt_any_one";
  instruction: string | null;
  total_marks: number;
  sub_parts?: number;
  marks_per_part?: number;
  parts?: string[];
  has_numerical?: boolean;
  attempt_logic: string | null;
}

interface TemplateSectionPayload {
  section_name: string;
  module_range: [number, number];
  total_marks: number;
  questions: TemplateQuestionPayload[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  mcq: "MCQ",
  truefalse: "True / False",
  short: "Short Answer",
  long: "Long Answer",
  numerical: "Numerical",
};

const DEFAULT_INSTRUCTIONS = [
  "All questions of Section I and Section II must be attempted in separate answer sheets.",
  "Make suitable assumptions and draw neat figures wherever required.",
  "Use of scientific calculator is allowed.",
  "Figures to the right indicate full marks.",
];

const QUIZ_INSTRUCTIONS = [
  "All questions are compulsory.",
  "Each question carries 1 mark.",
  "No negative marking.",
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function makeInstruction(text = ""): InstructionItem {
  return { id: uid(), text };
}

function defaultMetadata(): PaperMetadata {
  return {
    examTitle: "",
    semester: "",
    date: "",
    time: "150 Minutes",
    universityName: "P P Savani University",
    instructions: DEFAULT_INSTRUCTIONS.map(makeInstruction),
  };
}

function newQuestion(
  contentType: ContentType = "long",
  patch: Partial<BuilderQuestion> = {}
): BuilderQuestion {
  const defaults: Record<ContentType, Partial<BuilderQuestion>> = {
    mcq: { subPartsCount: 5, marksPerPart: 1, marks: 5 },
    truefalse: { subPartsCount: 5, marksPerPart: 1, marks: 5 },
    short: { subPartsCount: 1, marksPerPart: 1, marks: 3 },
    long: { subPartsCount: 1, marksPerPart: 1, marks: 5 },
    numerical: { subPartsCount: 1, marksPerPart: 1, marks: 5 },
  };
  return {
    id: uid(),
    displayLabel: "Q - ?",
    contentType,
    instruction: "",
    subPartsCount: 1,
    marksPerPart: 1,
    marks: 5,
    hasOr: false,
    partsCount: 1,
    marksPerSubPart: 6,
    hasAttemptAny: false,
    attemptAnyTake: 1,
    attemptAnyOfTotal: 2,
    attemptAnyMarks: 6,
    ...defaults[contentType],
    ...patch,
  };
}

function effectiveMarks(q: BuilderQuestion): number {
  if (q.contentType === "mcq" || q.contentType === "truefalse") {
    return q.subPartsCount * q.marksPerPart;
  }
  if (q.hasAttemptAny) {
    return q.attemptAnyTake * q.attemptAnyMarks;
  }
  if (q.hasOr) {
    return q.partsCount * q.marksPerSubPart;
  }
  return q.marks;
}

function sectionTotal(s: BuilderSection): number {
  return s.questions.reduce((sum, q) => sum + effectiveMarks(q), 0);
}

function paperTotal(sections: BuilderSection[]): number {
  return sections.reduce((sum, s) => sum + sectionTotal(s), 0);
}

const PART_LETTERS = "abcdefghijklmnopqrstuvwxyz";

function toTemplateQuestion(
  q: BuilderQuestion,
  qNumber: number
): TemplateQuestionPayload {
  const display_label = q.displayLabel?.trim() || `Q - ${qNumber}`;
  const instruction = q.instruction.trim() ? q.instruction.trim() : null;

  if (q.contentType === "mcq" || q.contentType === "truefalse") {
    return {
      q_number: qNumber,
      display_label,
      type: "mcq",
      instruction:
        instruction ??
        (q.contentType === "truefalse"
          ? "True / False"
          : "MCQ/Short Question/Fill in the Blanks"),
      total_marks: q.subPartsCount * q.marksPerPart,
      sub_parts: q.subPartsCount,
      marks_per_part: q.marksPerPart,
      attempt_logic: null,
    };
  }

  if (q.hasAttemptAny) {
    return {
      q_number: qNumber,
      display_label,
      type: "attempt_any_one",
      instruction:
        instruction ?? `Attempt any ${q.attemptAnyTake} of ${q.attemptAnyOfTotal}.`,
      total_marks: q.attemptAnyTake * q.attemptAnyMarks,
      sub_parts: q.attemptAnyOfTotal,
      attempt_logic:
        q.attemptAnyTake === 1 ? "any_one" : `any_${q.attemptAnyTake}`,
    };
  }

  if (q.hasOr) {
    return {
      q_number: qNumber,
      display_label,
      type: "descriptive_with_or",
      instruction,
      total_marks: q.partsCount * q.marksPerSubPart,
      marks_per_part: q.marksPerSubPart,
      parts: Array.from({ length: q.partsCount }, (_, i) => PART_LETTERS[i]),
      attempt_logic: null,
    };
  }

  return {
    q_number: qNumber,
    display_label,
    type: "descriptive",
    instruction,
    total_marks: q.marks,
    has_numerical: q.contentType === "numerical",
    attempt_logic: null,
  };
}

function moduleRangeForSection(
  sectionIdx: number,
  modules: ModuleRow[],
  selectedModuleIds: string[]
): [number, number] {
  const sectionNumber = sectionIdx + 1;
  const inSection = modules.filter(
    (m) =>
      selectedModuleIds.includes(m.id) &&
      (m.section_number == null || m.section_number === sectionNumber)
  );
  if (inSection.length === 0) {
    const all = modules.filter((m) => selectedModuleIds.includes(m.id));
    if (all.length === 0) return [1, 999];
    return [
      Math.min(...all.map((m) => m.module_number)),
      Math.max(...all.map((m) => m.module_number)),
    ];
  }
  return [
    Math.min(...inSection.map((m) => m.module_number)),
    Math.max(...inSection.map((m) => m.module_number)),
  ];
}

// ─── Prefill templates ──────────────────────────────────────────────────────

function eseStandardSections(): BuilderSection[] {
  const build = (name: string): BuilderSection => ({
    id: uid(),
    name,
    questions: [
      newQuestion("mcq", {
        displayLabel: "Q - 1",
        instruction: "MCQ/Short Question/Fill in the Blanks",
        subPartsCount: 6,
        marksPerPart: 1,
      }),
      newQuestion("numerical", {
        displayLabel: "Q - 2",
        marks: 6,
      }),
      newQuestion("long", {
        displayLabel: "Q - 3",
        hasOr: true,
        partsCount: 2,
        marksPerSubPart: 6,
      }),
      newQuestion("long", {
        displayLabel: "Q - 4",
        instruction: "Attempt any one.",
        hasAttemptAny: true,
        attemptAnyTake: 1,
        attemptAnyOfTotal: 2,
        attemptAnyMarks: 6,
      }),
    ],
  });
  return [build("Section I"), build("Section II")];
}

function quizSection(): BuilderSection[] {
  return [
    {
      id: uid(),
      name: "Section A",
      questions: [
        newQuestion("mcq", {
          displayLabel: "Q - 1",
          instruction: "Answer all questions.",
          subPartsCount: 10,
          marksPerPart: 1,
        }),
      ],
    },
  ];
}

function eseMetadata(): PaperMetadata {
  return {
    examTitle: "Fifth Semester of B. Tech. Examination",
    semester: "Fifth Semester of B. Tech. Examination",
    date: "",
    time: "150 Minutes",
    universityName: "P P Savani University",
    instructions: DEFAULT_INSTRUCTIONS.map(makeInstruction),
  };
}

function quizMetadata(): PaperMetadata {
  return {
    examTitle: "Continuous Evaluation Quiz",
    semester: "",
    date: "",
    time: "20 Minutes",
    universityName: "P P Savani University",
    instructions: QUIZ_INSTRUCTIONS.map(makeInstruction),
  };
}

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

// ─── Sortable question card ─────────────────────────────────────────────────

function SortableQuestion({
  question,
  qNumber,
  onUpdate,
  onRemove,
  onDuplicate,
}: {
  question: BuilderQuestion;
  qNumber: number;
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
          {isMcqLike ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Sub-parts</span>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={question.subPartsCount}
                  onChange={(e) =>
                    onUpdate({
                      ...question,
                      subPartsCount: Math.max(
                        1,
                        parseInt(e.target.value, 10) || 1
                      ),
                    })
                  }
                  className="h-7 w-16 text-center text-xs"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Marks / part</span>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={question.marksPerPart}
                  onChange={(e) =>
                    onUpdate({
                      ...question,
                      marksPerPart: Math.max(
                        1,
                        parseInt(e.target.value, 10) || 1
                      ),
                    })
                  }
                  className="h-7 w-16 text-center text-xs"
                />
              </div>
            </div>
          ) : question.hasAttemptAny ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-muted-foreground">Attempt any</span>
              <Input
                type="number"
                min={1}
                max={question.attemptAnyOfTotal}
                value={question.attemptAnyTake}
                onChange={(e) =>
                  onUpdate({
                    ...question,
                    attemptAnyTake: Math.max(
                      1,
                      Math.min(
                        question.attemptAnyOfTotal,
                        parseInt(e.target.value, 10) || 1
                      )
                    ),
                  })
                }
                className="h-7 w-16 text-center text-xs"
              />
              <span className="text-muted-foreground">of</span>
              <Input
                type="number"
                min={Math.max(2, question.attemptAnyTake)}
                max={10}
                value={question.attemptAnyOfTotal}
                onChange={(e) =>
                  onUpdate({
                    ...question,
                    attemptAnyOfTotal: Math.max(
                      Math.max(2, question.attemptAnyTake),
                      parseInt(e.target.value, 10) || 2
                    ),
                  })
                }
                className="h-7 w-16 text-center text-xs"
              />
              <span className="text-muted-foreground ml-2">
                Marks / option
              </span>
              <Input
                type="number"
                min={1}
                max={50}
                value={question.attemptAnyMarks}
                onChange={(e) =>
                  onUpdate({
                    ...question,
                    attemptAnyMarks: Math.max(
                      1,
                      parseInt(e.target.value, 10) || 1
                    ),
                  })
                }
                className="h-7 w-16 text-center text-xs"
              />
            </div>
          ) : question.hasOr ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-muted-foreground">Parts</span>
              <Input
                type="number"
                min={1}
                max={6}
                value={question.partsCount}
                onChange={(e) =>
                  onUpdate({
                    ...question,
                    partsCount: Math.max(
                      1,
                      Math.min(6, parseInt(e.target.value, 10) || 1)
                    ),
                  })
                }
                className="h-7 w-16 text-center text-xs"
              />
              <span className="text-muted-foreground">Marks / part</span>
              <Input
                type="number"
                min={1}
                max={50}
                value={question.marksPerSubPart}
                onChange={(e) =>
                  onUpdate({
                    ...question,
                    marksPerSubPart: Math.max(
                      1,
                      parseInt(e.target.value, 10) || 1
                    ),
                  })
                }
                className="h-7 w-16 text-center text-xs"
              />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-muted-foreground">Marks</span>
              <Input
                type="number"
                min={1}
                max={100}
                value={question.marks}
                onChange={(e) =>
                  onUpdate({
                    ...question,
                    marks: Math.max(1, parseInt(e.target.value, 10) || 1),
                  })
                }
                className="h-7 w-20 text-center text-xs"
              />
            </div>
          )}

          {/* ── Toggles ──────────────────────────────────────────────── */}
          {!isMcqLike && (
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
                        ? Math.max(1, question.marksPerSubPart)
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
          onChange={(e) =>
            setMeta({ ...meta, universityName: e.target.value })
          }
          className="h-8 text-sm"
        />
      </div>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function QpaperPage() {
  const { subjects, isLoading: isLoadingSubjects } = useFacultySubjects();
  const [selectedSubjectId, setSelectedSubjectId] = useState("");

  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [selectedModuleIds, setSelectedModuleIds] = useState<string[]>([]);

  const [meta, setMeta] = useState<PaperMetadata>(defaultMetadata());
  const [metaOpen, setMetaOpen] = useState(false);

  const [sections, setSections] = useState<BuilderSection[]>(
    eseStandardSections()
  );
  const [targetMarks, setTargetMarks] = useState<number>(60);
  const [pyqMode, setPyqMode] = useState<PyqMode>("fresh");
  const [pyqPercent, setPyqPercent] = useState(50);

  const [paper, setPaper] = useState<AssembledPaper | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [answerKeyUrl, setAnswerKeyUrl] = useState<string | null>(null);
  const [isGeneratingAnswerKey, setIsGeneratingAnswerKey] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReExporting, setIsReExporting] = useState(false);
  const [regenKey, setRegenKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [progressMsg, setProgressMsg] = useState("");

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Hydration gate: @dnd-kit assigns aria IDs from a global counter
  // (DndDescribedBy-N) that drifts between SSR and client hydration. Also,
  // our builder state uses uid() (Math.random) for section/question IDs which
  // differ across server/client. Rendering nothing until mount eliminates
  // both mismatches in one go. Faculty page — no SEO concern.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const selectedSubject = subjects.find((s) => s.id === selectedSubjectId);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // ─── Subject autoselect ─────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedSubjectId && subjects.length > 0) {
      setSelectedSubjectId(subjects[0].id);
    }
  }, [subjects, selectedSubjectId]);

  // ─── Modules load (need section_number + weightage_percent) ─────────────
  useEffect(() => {
    if (!selectedSubjectId) {
      setModules([]);
      setSelectedModuleIds([]);
      return;
    }
    const supabase = createBrowserClient();
    supabase
      .from("modules")
      .select("id, name, module_number, section_number, weightage_percent")
      .eq("subject_id", selectedSubjectId)
      .order("module_number")
      .then(({ data }) => {
        const rows = (data ?? []) as ModuleRow[];
        setModules(rows);
        setSelectedModuleIds(rows.map((m) => m.id));
      });
  }, [selectedSubjectId]);

  // ─── Beforeunload during generation ─────────────────────────────────────
  useEffect(() => {
    if (!isGenerating) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Question paper is being generated. Please wait.";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isGenerating]);

  // ─── Live total ─────────────────────────────────────────────────────────
  const totalMarksLive = useMemo(() => paperTotal(sections), [sections]);

  // ─── Modules grouped by section_number ──────────────────────────────────
  const moduleGroups = useMemo(() => {
    const groups = new Map<number, ModuleRow[]>();
    for (const m of modules) {
      const k = m.section_number ?? 0;
      const arr = groups.get(k) ?? [];
      arr.push(m);
      groups.set(k, arr);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  }, [modules]);

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

  // ─── Template prefill actions ──────────────────────────────────────────
  const applyEse = () => {
    setSections(eseStandardSections());
    setMeta(eseMetadata());
    setTargetMarks(60);
    setPaper(null);
    setDownloadUrl(null);
    setAnswerKeyUrl(null);
    toast.success("ESE Standard template loaded");
  };

  const applyQuiz = () => {
    setSections(quizSection());
    setMeta(quizMetadata());
    setTargetMarks(10);
    setPaper(null);
    setDownloadUrl(null);
    setAnswerKeyUrl(null);
    toast.success("Quiz template loaded");
  };

  const clearBuilder = () => {
    setSections([
      {
        id: uid(),
        name: "Section I",
        questions: [newQuestion("long", { displayLabel: "Q - 1" })],
      },
    ]);
    setMeta(defaultMetadata());
    setTargetMarks(60);
    setPaper(null);
    setDownloadUrl(null);
    setAnswerKeyUrl(null);
    toast.message("Builder cleared");
  };

  // ─── Build template payload ────────────────────────────────────────────
  const buildTemplatePayload = useCallback(
    (name: string) => {
      let qCounter = 0;
      const apiSections: TemplateSectionPayload[] = sections.map((s, sIdx) => {
        const range = moduleRangeForSection(
          sIdx,
          modules,
          selectedModuleIds
        );
        const apiQuestions = s.questions.map((q) => {
          qCounter += 1;
          return toTemplateQuestion(q, qCounter);
        });
        return {
          section_name: s.name,
          module_range: range,
          total_marks: sectionTotal(s),
          questions: apiQuestions,
        };
      });

      return {
        subject_id: selectedSubjectId,
        name,
        university_name: meta.universityName,
        exam_title: meta.examTitle || meta.semester || null,
        duration_minutes: Number(meta.time.replace(/\D+/g, "")) || 150,
        total_marks: totalMarksLive,
        instructions: meta.instructions
          .map((i) => i.text.trim())
          .filter(Boolean),
        structure: { sections: apiSections },
        is_default: false,
      };
    },
    [
      sections,
      modules,
      selectedModuleIds,
      meta,
      totalMarksLive,
      selectedSubjectId,
    ]
  );

  // ─── Save template (explicit) ──────────────────────────────────────────
  const saveTemplate = async () => {
    if (!selectedSubjectId) {
      toast.error("Select a subject first");
      return;
    }
    const name = saveName.trim();
    if (!name) {
      toast.error("Enter a template name");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/qpaper/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTemplatePayload(name)),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(`Saved "${name}"`);
      setSaveOpen(false);
      setSaveName("");
    } catch (err) {
      console.error(err);
      toast.error("Failed to save template");
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Generate ──────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!selectedSubjectId) {
      toast.error("Select a subject first");
      return;
    }
    if (sections.length === 0 || sections.every((s) => s.questions.length === 0)) {
      toast.error("Add at least one question first");
      return;
    }
    setIsGenerating(true);
    setPaper(null);
    setDownloadUrl(null);
    setAnswerKeyUrl(null);
    try {
      setProgressMsg("Saving paper structure...");
      const draftName = `Draft ${new Date().toLocaleString()}`;
      const tplRes = await fetch("/api/qpaper/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildTemplatePayload(draftName)),
      });
      if (!tplRes.ok) throw new Error(await tplRes.text());
      const tplData = (await tplRes.json()) as {
        template?: { id: string };
      };
      const templateId = tplData.template?.id;
      if (!templateId) throw new Error("Template save returned no ID");

      setProgressMsg(
        sections.length > 1
          ? "Generating Section I..."
          : "Generating questions..."
      );
      const res = await fetch("/api/generate/qpaper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: selectedSubjectId,
          templateId,
          pyqMode,
          pyqPercent: pyqMode === "pyq_mix" ? pyqPercent : null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        paper: AssembledPaper;
        downloadUrl?: string;
      };
      setPaper(data.paper);
      setDownloadUrl(data.downloadUrl ?? null);
      toast.success("Question paper generated!");
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate. Please try again.");
    } finally {
      setIsGenerating(false);
      setProgressMsg("");
    }
  };

  // ─── Regenerate single question ────────────────────────────────────────
  const regenerateQuestion = async (sIdx: number, qIdx: number) => {
    if (!paper) return;
    const tplQ = sections[sIdx]?.questions[qIdx];
    if (!tplQ) return;
    const templateQuestion = toTemplateQuestion(tplQ, qIdx + 1);
    const sectionRange = moduleRangeForSection(
      sIdx,
      modules,
      selectedModuleIds
    );
    const sectionModulesForServer = modules
      .filter(
        (m) =>
          m.module_number >= sectionRange[0] &&
          m.module_number <= sectionRange[1]
      )
      .map((m) => ({
        module_number: m.module_number,
        name: m.name,
      }));

    const existing = paper.sections[sIdx]?.questions[qIdx];
    const existingText = JSON.stringify(existing ?? {});
    const key = `${sIdx}-${qIdx}`;
    setRegenKey(key);

    try {
      const res = await fetch("/api/generate/qpaper/regenerate-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_question: templateQuestion,
          section_modules: sectionModulesForServer,
          pyq_context: "",
          co_po_data: { courseOutcomes: paper.courseOutcomes ?? [] },
          question_context: existingText,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { question: GeneratedQuestion };
      setPaper((prev) => {
        if (!prev) return prev;
        const next = { ...prev, sections: prev.sections.map((s) => ({ ...s })) };
        next.sections[sIdx] = {
          ...next.sections[sIdx],
          questions: next.sections[sIdx].questions.map((q, i) =>
            i === qIdx ? data.question : q
          ),
        };
        return next;
      });
      toast.success("Question regenerated");
    } catch (err) {
      console.error(err);
      toast.error("Failed to regenerate question");
    } finally {
      setRegenKey(null);
    }
  };

  // ─── Inline edit ───────────────────────────────────────────────────────
  const beginEdit = (
    sIdx: number,
    qIdx: number,
    kind: "sub" | "part",
    innerIdx: number
  ) => {
    const q = paper?.sections[sIdx]?.questions[qIdx];
    if (!q) return;
    const text =
      kind === "sub"
        ? q.sub_parts?.[innerIdx]?.question ?? ""
        : q.parts?.[innerIdx]?.question ?? "";
    setEditingKey(`${sIdx}-${qIdx}-${kind}-${innerIdx}`);
    setEditValue(text);
  };

  const saveEdit = (
    sIdx: number,
    qIdx: number,
    kind: "sub" | "part",
    innerIdx: number
  ) => {
    setPaper((prev) => {
      if (!prev) return prev;
      const next = { ...prev, sections: prev.sections.map((s) => ({ ...s })) };
      const q = { ...next.sections[sIdx].questions[qIdx] };
      if (kind === "sub" && q.sub_parts) {
        q.sub_parts = q.sub_parts.map((s, i) =>
          i === innerIdx ? { ...s, question: editValue } : s
        );
      } else if (kind === "part" && q.parts) {
        q.parts = q.parts.map((p, i) =>
          i === innerIdx ? { ...p, question: editValue } : p
        );
      }
      next.sections[sIdx].questions = next.sections[sIdx].questions.map(
        (orig, i) => (i === qIdx ? q : orig)
      );
      return next;
    });
    setEditingKey(null);
    setEditValue("");
  };

  // ─── Generate answer key ───────────────────────────────────────────────
  const handleGenerateAnswerKey = async () => {
    if (!paper || !selectedSubjectId) return;
    setIsGeneratingAnswerKey(true);
    setAnswerKeyUrl(null);
    try {
      const res = await fetch("/api/generate/qpaper/answer-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_id: selectedSubjectId,
          paper,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        downloadUrl: string;
        warnings?: string[];
      };
      setAnswerKeyUrl(data.downloadUrl);
      if (data.warnings && data.warnings.length > 0) {
        toast.warning(
          `Answer key ready (with ${data.warnings.length} warning${
            data.warnings.length === 1 ? "" : "s"
          })`
        );
      } else {
        toast.success("Answer key generated!");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate answer key");
    } finally {
      setIsGeneratingAnswerKey(false);
    }
  };

  // ─── Re-export PDF ─────────────────────────────────────────────────────
  const reExportPdf = async () => {
    if (!paper) return;
    setIsReExporting(true);
    try {
      const res = await fetch("/api/generate/qpaper/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paper }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { downloadUrl: string };
      setDownloadUrl(data.downloadUrl);
      toast.success("Updated PDF ready");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update PDF");
    } finally {
      setIsReExporting(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────
  // Pre-mount: render the header only so the page reserves layout space and
  // doesn't flash blank. DnD-bearing children stay out until hydration done.
  if (!mounted) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="size-6" />
            Question Paper Generator
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Build your paper structure — AI generates the questions
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="size-6" />
          Question Paper Generator
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Build your paper structure — AI generates the questions
        </p>
      </div>

      {/* ── Setup: Subject + Modules + Question Source ───────────────── */}
      <Card className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
          <div>
            <Label className="text-xs mb-1 block">Subject</Label>
            <Select
              value={selectedSubjectId}
              onValueChange={setSelectedSubjectId}
              disabled={isLoadingSubjects || subjects.length === 0}
            >
              <SelectTrigger className="h-9">
                <SelectValue
                  placeholder={
                    isLoadingSubjects
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
          <div>
            <Label className="text-xs mb-1 block">Target Marks</Label>
            <Input
              type="number"
              min={1}
              max={500}
              value={targetMarks}
              onChange={(e) =>
                setTargetMarks(Math.max(1, parseInt(e.target.value, 10) || 1))
              }
              className="h-9 text-sm font-semibold"
            />
          </div>
        </div>

        {modules.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs">Modules</Label>
            <div className="space-y-2">
              {moduleGroups.map(([sectionNum, mods]) => {
                const allSelected = mods.every((m) =>
                  selectedModuleIds.includes(m.id)
                );
                const groupLabel =
                  sectionNum > 0
                    ? `Section ${
                        ["I", "II", "III", "IV", "V"][sectionNum - 1] ??
                        sectionNum
                      }`
                    : "All";
                return (
                  <div
                    key={sectionNum}
                    className="flex flex-wrap items-center gap-1.5"
                  >
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mr-1">
                      {groupLabel}
                    </span>
                    {mods.map((mod) => {
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
                            "px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
                            selected
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background text-muted-foreground border-border hover:border-primary/50"
                          )}
                          title={
                            mod.weightage_percent != null
                              ? `${mod.weightage_percent}% weightage`
                              : undefined
                          }
                        >
                          M{mod.module_number}: {mod.name}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        const ids = mods.map((m) => m.id);
                        setSelectedModuleIds((prev) => {
                          if (allSelected) {
                            return prev.filter((id) => !ids.includes(id));
                          }
                          const set = new Set(prev);
                          ids.forEach((id) => set.add(id));
                          return Array.from(set);
                        });
                      }}
                      className="text-[10px] text-primary hover:underline ml-1"
                    >
                      {allSelected ? "Clear" : "All"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">Question source</Label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border overflow-hidden text-xs font-medium">
              {(
                [
                  ["fresh", "Fresh Only"],
                  ["pyq_mix", "PYQ + Fresh"],
                  ["pyq_pattern", "PYQ Style"],
                ] as const
              ).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setPyqMode(val)}
                  className={cn(
                    "px-3 py-1.5 transition-colors",
                    pyqMode === val
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted text-muted-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {pyqMode === "pyq_mix" && (
              <div className="flex items-center gap-2 flex-1 min-w-48">
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
                <span className="text-[11px] font-medium w-28 text-right">
                  {pyqPercent}% PYQ · {100 - pyqPercent}% Fresh
                </span>
              </div>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            PYQ content is always used as a style reference. This controls
            whether actual PYQs can be reused verbatim.
          </p>
        </div>
      </Card>

      {/* ── SECTION 1: Paper Details metadata form ───────────────────── */}
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
            {totalMarksLive} marks · {sections.length} section
            {sections.length === 1 ? "" : "s"}
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

      {/* ── SECTION 2: Template selector ─────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground mr-1">Quick start:</span>
        <Button variant="outline" size="sm" onClick={applyEse}>
          ESE Standard — 60M
        </Button>
        <Button variant="outline" size="sm" onClick={applyQuiz}>
          Quiz — 10M
        </Button>
        <button
          type="button"
          onClick={clearBuilder}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1"
        >
          Start from scratch
        </button>
      </div>

      {/* ── SECTION 3: Drag-drop builder ─────────────────────────────── */}
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

        {sections.map((section, sIdx) => (
          <div key={section.id} className="space-y-3">
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
                      onUpdate={(updated) =>
                        updateQuestion(section.id, updated)
                      }
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

        <Button
          variant="ghost"
          size="sm"
          onClick={addSection}
          className="text-muted-foreground"
        >
          <Plus className="size-4 mr-1" />
          Add section
        </Button>
      </div>

      {/* ── SECTION 5: Generate / Save / Download ───────────────────── */}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button
          onClick={handleGenerate}
          disabled={isGenerating || !selectedSubjectId}
          size="lg"
          className="flex-1 min-w-48"
        >
          {isGenerating ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              {progressMsg || "Generating..."}
            </>
          ) : (
            "Generate Question Paper"
          )}
        </Button>

        <Button
          variant="outline"
          size="lg"
          onClick={() => {
            setSaveName("");
            setSaveOpen(true);
          }}
          disabled={!selectedSubjectId}
        >
          <Save className="mr-2 size-4" />
          Save as template
        </Button>

        {downloadUrl && (
          <Button
            size="lg"
            onClick={() => window.open(downloadUrl, "_blank")}
          >
            <Download className="mr-2 size-4" />
            Download Question Paper
          </Button>
        )}

        {paper && !answerKeyUrl && (
          <Button
            variant="outline"
            size="lg"
            onClick={handleGenerateAnswerKey}
            disabled={isGeneratingAnswerKey}
          >
            {isGeneratingAnswerKey ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Lock className="mr-2 size-4" />
            )}
            {isGeneratingAnswerKey
              ? "Generating answer key..."
              : "Generate Answer Key"}
          </Button>
        )}

        {answerKeyUrl && (
          <Button
            variant="outline"
            size="lg"
            onClick={() => window.open(answerKeyUrl, "_blank")}
          >
            <Lock className="mr-2 size-4" />
            Download Answer Key
          </Button>
        )}

        {paper && (
          <Button
            variant="outline"
            size="lg"
            onClick={reExportPdf}
            disabled={isReExporting}
          >
            {isReExporting ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            Update PDF
          </Button>
        )}
      </div>

      {paper && (
        <p className="text-xs text-muted-foreground -mt-1">
          Answer key includes marking scheme and model answers for all
          questions including OR alternatives.
        </p>
      )}

      {/* ── Generated paper preview ─────────────────────────────────── */}
      {paper && (
        <Card className="p-6 space-y-4 font-serif">
          <div className="text-center space-y-1">
            <div className="text-lg font-bold">{paper.universityName}</div>
            {paper.examTitle && (
              <div className="text-sm">{paper.examTitle}</div>
            )}
            <div className="text-base font-semibold">
              {paper.courseCode} — {paper.courseName}
            </div>
            <div className="flex justify-between text-xs px-2 pt-1">
              <span>Time: {paper.duration} Minutes</span>
              <span className="font-semibold">
                Maximum Marks: {paper.totalMarks}
              </span>
            </div>
          </div>

          {paper.instructions.length > 0 && (
            <div className="text-xs border rounded p-3">
              <div className="font-semibold mb-1">Instructions:</div>
              <ol className="list-decimal pl-5 space-y-0.5">
                {paper.instructions.map((ins, i) => (
                  <li key={i}>{ins}</li>
                ))}
              </ol>
            </div>
          )}

          {paper.sections.map((section, sIdx) => (
            <div key={sIdx} className="space-y-3">
              <div className="text-center font-bold underline">
                {section.section_name.toUpperCase()}
              </div>

              {section.questions.map((q, qIdx) => (
                <div
                  key={qIdx}
                  className="border rounded p-3 space-y-2 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-semibold">
                      {q.display_label ?? `Q - ${q.q_number}`}
                      {q.instruction ? (
                        <span className="font-normal ml-2">{q.instruction}</span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="secondary" className="text-[10px]">
                        [{String(q.total_marks).padStart(2, "0")}]
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={regenKey === `${sIdx}-${qIdx}`}
                        onClick={() => regenerateQuestion(sIdx, qIdx)}
                        title="Regenerate this question"
                      >
                        {regenKey === `${sIdx}-${qIdx}` ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="size-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {q.sub_parts?.map((sub, si) => {
                    const k = `${sIdx}-${qIdx}-sub-${si}`;
                    return (
                      <div key={si} className="ml-3 space-y-1">
                        <div className="flex items-start justify-between gap-3">
                          {editingKey === k ? (
                            <Textarea
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="text-xs flex-1"
                              rows={2}
                            />
                          ) : (
                            <div className="flex-1">
                              <span className="font-mono mr-1">
                                {sub.label}
                              </span>
                              {sub.question}
                            </div>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-6"
                            onClick={() =>
                              editingKey === k
                                ? saveEdit(sIdx, qIdx, "sub", si)
                                : beginEdit(sIdx, qIdx, "sub", si)
                            }
                          >
                            <Pencil className="size-3" />
                          </Button>
                        </div>
                        {sub.options && (
                          <div className="ml-4 grid grid-cols-2 gap-x-4 text-xs text-muted-foreground">
                            {(["a", "b", "c", "d"] as const).map(
                              (kk) =>
                                sub.options?.[kk] && (
                                  <div key={kk}>
                                    {kk}) {sub.options[kk]}
                                  </div>
                                )
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {q.parts?.map((part, pi) => {
                    const k = `${sIdx}-${qIdx}-part-${pi}`;
                    const isOrAlternative = part.is_or_alternative;
                    const showOrSeparator =
                      isOrAlternative &&
                      (pi === 0 ||
                        !q.parts?.[pi - 1]?.is_or_alternative);
                    const labelClean = part.label
                      ? String(part.label)
                          .replace(/^\(/, "")
                          .replace(/\)$/, "")
                      : null;
                    return (
                      <div key={pi}>
                        {showOrSeparator && (
                          <div className="text-center text-xs italic my-2">
                            OR
                          </div>
                        )}
                        <div className="ml-3 flex items-start justify-between gap-3">
                          {editingKey === k ? (
                            <Textarea
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="text-xs flex-1"
                              rows={3}
                            />
                          ) : (
                            <div className="flex-1">
                              {labelClean && (
                                <span className="font-semibold mr-1">
                                  ({labelClean})
                                </span>
                              )}
                              {part.question}
                            </div>
                          )}
                          <Badge
                            variant="outline"
                            className="text-[10px] shrink-0"
                          >
                            [{String(part.marks).padStart(2, "0")}]
                          </Badge>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-6"
                            onClick={() =>
                              editingKey === k
                                ? saveEdit(sIdx, qIdx, "part", pi)
                                : beginEdit(sIdx, qIdx, "part", pi)
                            }
                          >
                            <Pencil className="size-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </Card>
      )}

      {/* ── Save-as-template dialog ─────────────────────────────────── */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="tpl-name" className="text-xs">
              Template name
            </Label>
            <Input
              id="tpl-name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="My ESE template"
              className="h-9 text-sm"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              Saves the current structure and metadata. Reuse later from the
              templates list.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setSaveOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={saveTemplate}
              disabled={isSaving || !saveName.trim()}
            >
              {isSaving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Save className="mr-2 size-4" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
