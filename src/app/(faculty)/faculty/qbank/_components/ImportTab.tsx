"use client";

/**
 * "Add Questions" tab — three sub-modes:
 *   CSV Import  — existing drag-drop CSV/TXT flow, untouched
 *   Single      — AddQuestionForm (one question, optional AI image)
 *   Bulk Images — pick ≤20 images, get independent AI-generated cards,
 *                 edit metadata per card, then "Add All to Bank"
 */

import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileWarning,
  ImageIcon,
  Loader2,
  Pencil,
  PlusCircle,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { BankQuestion, MCQOption } from "@/lib/qbank/types";
import { BankQuestionCard } from "./BankQuestionCard";
import {
  addManualQuestion,
  formatCo,
  importFile,
  QUESTION_TYPES,
  TYPE_LABELS,
  type CourseOutcomeRef,
  type ImportResponse,
  type ManualQuestionPayload,
  type ModuleRef,
} from "./shared";

// ─── shared image constants ──────────────────────────────────────────────────

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const OPT_LABELS: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"];
const MAX_BULK_IMAGES = 20;

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── CSV mode helpers ────────────────────────────────────────────────────────

const CSV_MAX_BYTES = 2 * 1024 * 1024;
type RowStatus = "ready" | "review" | "error";

interface PreviewRow {
  status: RowStatus;
  question: string;
  type: string;
  marks: string;
  co: string;
  btl: string;
  module: string;
  note: string;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const HEADERS: Record<string, string> = {
  question: "question_text", question_text: "question_text", text: "question_text",
  type: "question_type", question_type: "question_type",
  marks: "marks",
  co: "co_code", co_code: "co_code",
  btl: "btl_level", btl_level: "btl_level",
  module: "module_name", module_name: "module_name",
};

function previewCsv(text: string): PreviewRow[] {
  const rows = parseCsvRows(text);
  if (rows.length < 1) return [];
  const header = rows[0].map((h) => HEADERS[h.toLowerCase().trim()] ?? "");
  const col = (name: string) => header.indexOf(name);
  const ci = { q: col("question_text"), t: col("question_type"), m: col("marks"), co: col("co_code"), btl: col("btl_level"), mod: col("module_name") };
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  return rows.slice(1).map((r) => {
    const question = cell(r, ci.q);
    const marksRaw = cell(r, ci.m);
    const marks = marksRaw.match(/\d+(\.\d+)?/)?.[0] ?? "";
    const co = cell(r, ci.co);
    const btl = cell(r, ci.btl);
    let status: RowStatus = "ready";
    let note = "";
    if (!question || !(Number(marks) > 0)) {
      status = "error"; note = !question ? "Missing question" : "Invalid marks";
    } else if (!co || !btl) {
      status = "review"; note = "CO/BTL will be inferred";
    }
    return { status, question, type: cell(r, ci.t) || "short_answer", marks: marks ? `${marks}M` : "—", co: co || "(infer)", btl: btl || "(infer)", module: cell(r, ci.mod) || "—", note };
  });
}

function previewTxt(text: string): PreviewRow[] {
  return text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const marks = line.match(/\[(\d+(?:\.\d+)?)\s*m\]/i)?.[1] ?? "1";
    const co = line.match(/\[(CO\s*\d+)\]/i)?.[1]?.replace(/\s+/g, "") ?? "";
    const question = line.replace(/\[[^\]]*\]/g, "").replace(/^\s*\d+[.)]\s*/, "").trim();
    return {
      status: question ? ("review" as RowStatus) : ("error" as RowStatus),
      question, type: "short_answer", marks: `${marks}M`,
      co: co || "(infer)", btl: "(infer)", module: "—",
      note: question ? "CO/BTL will be inferred" : "Empty line",
    };
  });
}

const STATUS_META: Record<RowStatus, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  ready: { label: "Ready", cls: "text-emerald-500", icon: CheckCircle2 },
  review: { label: "Review", cls: "text-amber-500", icon: AlertTriangle },
  error: { label: "Error", cls: "text-rose-500", icon: FileWarning },
};

// ─── Single mode — AddQuestionForm ──────────────────────────────────────────

interface AddFormDraft {
  question_text: string;
  question_type: string;
  marks: string;
  co_code: string;
  btl_level: string;
  difficulty: string;
  module_id: string;
  model_answer: string;
  options: MCQOption[];
}

const INIT_DRAFT: AddFormDraft = {
  question_text: "",
  question_type: "short_answer",
  marks: "2",
  co_code: "",
  btl_level: "",
  difficulty: "",
  module_id: "",
  model_answer: "",
  options: OPT_LABELS.map((label, i) => ({ label, text: "", is_correct: i === 0 })),
};

function AddQuestionForm({
  subjectId,
  modules,
  courseOutcomes,
  onAdded,
  onClose,
}: {
  subjectId: string;
  modules: ModuleRef[];
  courseOutcomes: CourseOutcomeRef[];
  onAdded: (q: BankQuestion) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AddFormDraft>(INIT_DRAFT);
  const [adding, setAdding] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setImageError(null);
    setImageFile(null);
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImagePreviewUrl(null);
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setImageError("Only JPEG, PNG, GIF, and WebP images are accepted.");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("Image must be under 5 MB.");
      e.target.value = "";
      return;
    }
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
  };

  const handleSubmit = async () => {
    const isAiImageMode = imageFile !== null && !draft.question_text.trim();
    if (!isAiImageMode && !draft.question_text.trim()) {
      toast.error("Question text is required");
      return;
    }
    const marks = Number(draft.marks);
    if (!Number.isFinite(marks) || marks <= 0) {
      toast.error("Marks must be a positive number");
      return;
    }
    setAdding(true);
    try {
      const payload: ManualQuestionPayload = {
        subject_id: subjectId,
        question_text: draft.question_text.trim(),
        question_type: draft.question_type as ManualQuestionPayload["question_type"],
        marks,
        co_code: draft.co_code.trim() || undefined,
        btl_level: draft.btl_level ? Number(draft.btl_level) : undefined,
        difficulty: (draft.difficulty || undefined) as ManualQuestionPayload["difficulty"],
        module_id: draft.module_id || undefined,
      };
      if (draft.question_type === "mcq" && !isAiImageMode) {
        payload.options = draft.options.filter((o) => o.text.trim());
      }
      if (imageFile) {
        payload.image_base64 = await readFileAsBase64(imageFile);
        payload.image_mime = imageFile.type;
      }
      const newQ = await addManualQuestion(payload);
      onAdded(newQ);
      toast.success(isAiImageMode ? "Question generated and added" : "Question added");
    } catch (err) {
      console.error("[qbank add-manual]", err);
      toast.error("Failed to add question");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Card className="p-3 space-y-3 border-primary/40">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold flex items-center gap-1.5">
          <Pencil className="size-3.5" />
          Add Question
        </span>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>

      <div>
        <span className="text-[10px] text-muted-foreground">Type</span>
        <Select value={draft.question_type} onValueChange={(v) => setDraft({ ...draft, question_type: v })}>
          <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue /></SelectTrigger>
          <SelectContent>
            {QUESTION_TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Textarea
          value={draft.question_text}
          onChange={(e) => setDraft({ ...draft, question_text: e.target.value })}
          rows={3}
          className="text-sm"
          placeholder="Question text"
        />
        {imageFile && !draft.question_text.trim() && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Sparkles className="size-3 shrink-0 text-primary" />
            AI will write this question from your image — or type it yourself to author it manually.
          </p>
        )}
      </div>

      {draft.question_type === "mcq" && (
        <div className="space-y-1">
          {imageFile && !draft.question_text.trim() && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Sparkles className="size-3 shrink-0 text-primary" />
              AI will generate the options — leave blank or fill in to override.
            </p>
          )}
          {draft.options.map((opt, i) => (
            <div key={opt.label} className="flex items-center gap-2">
              <button
                type="button"
                title="Mark correct"
                onClick={() => setDraft({ ...draft, options: draft.options.map((o, j) => ({ ...o, is_correct: j === i })) })}
                className={cn("size-5 shrink-0 rounded-full border text-[10px] font-bold",
                  opt.is_correct ? "bg-emerald-500 text-white border-emerald-500" : "text-muted-foreground")}
              >
                {opt.label}
              </button>
              <Input
                value={opt.text}
                onChange={(e) => setDraft({ ...draft, options: draft.options.map((o, j) => j === i ? { ...o, text: e.target.value } : o) })}
                className="h-7 text-xs"
                placeholder={`Option ${opt.label}`}
              />
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <FormField label="Marks">
          <Input type="number" value={draft.marks} onChange={(e) => setDraft({ ...draft, marks: e.target.value })} className="h-7 text-xs" />
        </FormField>
        <FormField label="CO">
          <Select value={draft.co_code || "none"} onValueChange={(v) => setDraft({ ...draft, co_code: v === "none" ? "" : v })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {courseOutcomes.map((c) => <SelectItem key={c.co_code} value={c.co_code}>{formatCo(c.co_code)}</SelectItem>)}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="BTL">
          <Select value={draft.btl_level || "none"} onValueChange={(v) => setDraft({ ...draft, btl_level: v === "none" ? "" : v })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {[1, 2, 3, 4, 5, 6].map((n) => <SelectItem key={n} value={String(n)}>BTL {n}</SelectItem>)}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Difficulty">
          <Select value={draft.difficulty || "none"} onValueChange={(v) => setDraft({ ...draft, difficulty: v === "none" ? "" : v })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {["easy", "medium", "hard"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </FormField>
      </div>

      {modules.length > 0 && (
        <FormField label="Module (optional)">
          <Select value={draft.module_id || "none"} onValueChange={(v) => setDraft({ ...draft, module_id: v === "none" ? "" : v })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {modules.map((m) => <SelectItem key={m.id} value={m.id}>M{m.module_number} — {m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </FormField>
      )}

      <div className="space-y-1.5">
        <span className="text-[10px] text-muted-foreground block">
          Image (optional — JPEG, PNG, GIF, or WebP, max 5 MB)
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          onChange={handleImageChange}
          className="block w-full text-xs text-muted-foreground file:mr-3 file:py-1 file:px-2 file:rounded file:border file:border-border file:text-xs file:bg-muted file:text-foreground hover:file:bg-muted/80 cursor-pointer"
        />
        {imageError && <p className="text-xs text-destructive">{imageError}</p>}
        {imagePreviewUrl && (
          <div className="relative inline-block">
            <img src={imagePreviewUrl} alt="Preview" className="rounded-md max-h-40 object-contain border border-border/40" />
            <button
              type="button"
              onClick={() => { URL.revokeObjectURL(imagePreviewUrl); setImageFile(null); setImagePreviewUrl(null); }}
              className="absolute top-1 right-1 rounded-full bg-background/80 p-0.5 text-muted-foreground hover:text-destructive"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        {(() => {
          const isAiImageMode = imageFile !== null && !draft.question_text.trim();
          return (
            <Button size="sm" className="h-7 text-xs" onClick={handleSubmit} disabled={adding}>
              {adding ? <Loader2 className="size-3 mr-1 animate-spin" /> : isAiImageMode ? <Sparkles className="size-3 mr-1" /> : <PlusCircle className="size-3 mr-1" />}
              {isAiImageMode ? "Generate & Add" : "Add to Bank"}
            </Button>
          );
        })()}
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClose} disabled={adding}>
          <X className="size-3 mr-1" />
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

// ─── Bulk Images mode ────────────────────────────────────────────────────────

interface BulkCardMeta {
  question_type: string;
  marks: string;
  co_code: string;
  btl_level: string;
  difficulty: string;
  module_id: string;
}

interface BulkCard {
  id: string;
  file: File;
  previewUrl: string;
  meta: BulkCardMeta;
  status: "idle" | "loading" | "done" | "error";
  result?: BankQuestion;
  errorMsg?: string;
}

const DEFAULT_BULK_META: BulkCardMeta = {
  question_type: "short_answer",
  marks: "2",
  co_code: "",
  btl_level: "",
  difficulty: "",
  module_id: "",
};

function BulkImagesMode({
  subjectId,
  modules,
  courseOutcomes,
  onImported,
}: {
  subjectId: string;
  modules: ModuleRef[];
  courseOutcomes: CourseOutcomeRef[];
  onImported: () => void;
}) {
  const [cards, setCards] = useState<BulkCard[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const remaining = MAX_BULK_IMAGES - cards.length;
    if (remaining <= 0) {
      toast.error(`Maximum ${MAX_BULK_IMAGES} images per batch`);
      return;
    }
    const newCards: BulkCard[] = [];
    let skipped = 0;
    Array.from(files).slice(0, remaining).forEach((file) => {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) { skipped++; return; }
      if (file.size > MAX_IMAGE_BYTES) { skipped++; return; }
      newCards.push({
        id: `${Date.now()}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
        meta: { ...DEFAULT_BULK_META },
        status: "idle",
      });
    });
    if (skipped > 0) toast.warning(`${skipped} file(s) skipped — must be JPEG/PNG/GIF/WebP under 5 MB`);
    if (newCards.length > 0) setCards((prev) => [...prev, ...newCards]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeCard = (id: string) => {
    setCards((prev) => {
      const card = prev.find((c) => c.id === id);
      if (card) URL.revokeObjectURL(card.previewUrl);
      return prev.filter((c) => c.id !== id);
    });
  };

  const updateMeta = (id: string, patch: Partial<BulkCardMeta>) => {
    setCards((prev) => prev.map((c) => c.id === id ? { ...c, meta: { ...c.meta, ...patch } } : c));
  };

  const idleCards = cards.filter((c) => c.status === "idle");
  const anyLoading = cards.some((c) => c.status === "loading");

  const handleAddAll = async () => {
    if (idleCards.length === 0) return;

    // Mark all idle cards as loading immediately
    setCards((prev) => prev.map((c) => c.status === "idle" ? { ...c, status: "loading" } : c));

    let successCount = 0;

    await Promise.all(
      idleCards.map(async (card) => {
        try {
          const base64 = await readFileAsBase64(card.file);
          const marks = Number(card.meta.marks);
          const payload: ManualQuestionPayload = {
            subject_id: subjectId,
            question_text: "",
            question_type: card.meta.question_type as ManualQuestionPayload["question_type"],
            marks: Number.isFinite(marks) && marks > 0 ? marks : 2,
            co_code: card.meta.co_code || undefined,
            btl_level: card.meta.btl_level ? Number(card.meta.btl_level) : undefined,
            difficulty: (card.meta.difficulty || undefined) as ManualQuestionPayload["difficulty"],
            module_id: card.meta.module_id || undefined,
            image_base64: base64,
            image_mime: card.file.type,
          };
          const q = await addManualQuestion(payload);
          setCards((prev) => prev.map((c) => c.id === card.id ? { ...c, status: "done", result: q } : c));
          successCount++;
        } catch (err) {
          console.error("[qbank bulk]", card.file.name, err);
          setCards((prev) => prev.map((c) => c.id === card.id ? { ...c, status: "error", errorMsg: "Generation failed" } : c));
        }
      })
    );

    if (successCount > 0) {
      onImported();
      toast.success(`${successCount} question${successCount === 1 ? "" : "s"} added to bank`);
    }
  };

  const clearDone = () => {
    setCards((prev) => {
      prev.filter((c) => c.status === "done").forEach((c) => URL.revokeObjectURL(c.previewUrl));
      return prev.filter((c) => c.status !== "done");
    });
  };

  const doneCount = cards.filter((c) => c.status === "done").length;

  return (
    <div className="space-y-4">
      {/* File picker */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm font-medium">Select images</p>
            <p className="text-xs text-muted-foreground">JPEG, PNG, GIF, or WebP · max 5 MB each · up to {MAX_BULK_IMAGES} per batch</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={anyLoading || cards.length >= MAX_BULK_IMAGES}
          >
            <ImageIcon className="size-4 mr-2" />
            {cards.length === 0 ? "Choose Images" : "Add More"}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        {cards.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {cards.length} image{cards.length === 1 ? "" : "s"} selected
            {cards.length >= MAX_BULK_IMAGES && " (maximum reached)"}
          </p>
        )}
      </Card>

      {/* Cards */}
      {cards.length > 0 && (
        <div className="space-y-3">
          {cards.map((card) => (
            <BulkCardRow
              key={card.id}
              card={card}
              modules={modules}
              courseOutcomes={courseOutcomes}
              onRemove={() => removeCard(card.id)}
              onMetaChange={(patch) => updateMeta(card.id, patch)}
            />
          ))}
        </div>
      )}

      {/* Actions */}
      {cards.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            onClick={handleAddAll}
            disabled={idleCards.length === 0 || anyLoading}
          >
            {anyLoading ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <PlusCircle className="size-4 mr-2" />
            )}
            Add All to Bank
            {idleCards.length > 0 && ` (${idleCards.length})`}
          </Button>
          {doneCount > 0 && (
            <Button variant="outline" size="sm" onClick={clearDone}>
              Clear Done ({doneCount})
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function BulkCardRow({
  card,
  modules,
  courseOutcomes,
  onRemove,
  onMetaChange,
}: {
  card: BulkCard;
  modules: ModuleRef[];
  courseOutcomes: CourseOutcomeRef[];
  onRemove: () => void;
  onMetaChange: (patch: Partial<BulkCardMeta>) => void;
}) {
  const isEditable = card.status === "idle";

  return (
    <Card className={cn("p-3 space-y-3", card.status === "done" && "border-emerald-500/30", card.status === "error" && "border-rose-500/30")}>
      <div className="flex gap-3">
        {/* Thumbnail */}
        <div className="shrink-0">
          <img
            src={card.previewUrl}
            alt={card.file.name}
            className="w-20 h-20 object-cover rounded-md border border-border/40"
          />
        </div>

        {/* Meta fields */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-muted-foreground truncate">{card.file.name}</p>
            {(card.status === "idle" || card.status === "error") && (
              <button
                type="button"
                onClick={onRemove}
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <FormField label="Type">
              <Select
                value={card.meta.question_type}
                onValueChange={(v) => onMetaChange({ question_type: v })}
                disabled={!isEditable}
              >
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {QUESTION_TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Marks">
              <Input
                type="number"
                value={card.meta.marks}
                onChange={(e) => onMetaChange({ marks: e.target.value })}
                className="h-7 text-xs"
                disabled={!isEditable}
              />
            </FormField>

            <FormField label="CO">
              <Select
                value={card.meta.co_code || "none"}
                onValueChange={(v) => onMetaChange({ co_code: v === "none" ? "" : v })}
                disabled={!isEditable}
              >
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {courseOutcomes.map((c) => <SelectItem key={c.co_code} value={c.co_code}>{formatCo(c.co_code)}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="BTL">
              <Select
                value={card.meta.btl_level || "none"}
                onValueChange={(v) => onMetaChange({ btl_level: v === "none" ? "" : v })}
                disabled={!isEditable}
              >
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {[1, 2, 3, 4, 5, 6].map((n) => <SelectItem key={n} value={String(n)}>BTL {n}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Difficulty">
              <Select
                value={card.meta.difficulty || "none"}
                onValueChange={(v) => onMetaChange({ difficulty: v === "none" ? "" : v })}
                disabled={!isEditable}
              >
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {["easy", "medium", "hard"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>

            {modules.length > 0 && (
              <FormField label="Module">
                <Select
                  value={card.meta.module_id || "none"}
                  onValueChange={(v) => onMetaChange({ module_id: v === "none" ? "" : v })}
                  disabled={!isEditable}
                >
                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {modules.map((m) => <SelectItem key={m.id} value={m.id}>M{m.module_number} — {m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          </div>
        </div>
      </div>

      {/* Status row */}
      {card.status === "loading" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1 border-t border-border/30">
          <Loader2 className="size-3.5 animate-spin" />
          Generating question from image…
        </div>
      )}
      {card.status === "done" && card.result && (
        <div className="pt-1 border-t border-border/30 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-emerald-500 font-medium">
            <CheckCircle2 className="size-3.5" />
            Added to bank
          </div>
          <p className="text-xs text-foreground leading-relaxed">{card.result.question_text}</p>
          {card.result.options && card.result.options.length > 0 && (
            <div className="space-y-0.5">
              {card.result.options.map((opt) => (
                <p key={opt.label} className={cn("text-xs pl-2", opt.is_correct ? "text-emerald-400 font-medium" : "text-muted-foreground")}>
                  {opt.label}. {opt.text}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      {card.status === "error" && (
        <div className="flex items-center gap-2 text-xs text-rose-400 pt-1 border-t border-border/30">
          <FileWarning className="size-3.5 shrink-0" />
          {card.errorMsg ?? "Failed to generate — remove and try again"}
        </div>
      )}
    </Card>
  );
}

// ─── main component ──────────────────────────────────────────────────────────

type SubMode = "csv" | "single" | "bulk";

export function ImportTab({
  subjectId,
  modules,
  courseOutcomes,
  onImported,
}: {
  subjectId: string;
  modules: ModuleRef[];
  courseOutcomes: CourseOutcomeRef[];
  onImported: () => void;
}) {
  const [subMode, setSubMode] = useState<SubMode>("csv");
  const [singleKey, setSingleKey] = useState(0);

  // CSV state
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [filter, setFilter] = useState<"all" | RowStatus>("all");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const acceptCsv = (f: File | undefined | null) => {
    if (!f) return;
    const name = f.name.toLowerCase();
    if (!name.endsWith(".csv") && !name.endsWith(".txt")) {
      toast.error("Only .csv or .txt files are accepted");
      return;
    }
    if (f.size > CSV_MAX_BYTES) {
      toast.error("File exceeds 2MB");
      return;
    }
    setResult(null);
    setFile(f);
    f.text().then((text) => {
      setPreview(name.endsWith(".csv") ? previewCsv(text) : previewTxt(text));
    });
  };

  const doImport = async () => {
    if (!subjectId) { toast.error("Select a subject first"); return; }
    if (!file) return;
    setImporting(true);
    try {
      const res = await importFile(subjectId, file);
      setResult(res);
      onImported();
      toast.success(`Added ${res.added} question${res.added === 1 ? "" : "s"}. ${res.needs_review} need review.`);
    } catch (err) {
      console.error(err);
      toast.error("Import failed. Check the file format.");
    } finally {
      setImporting(false);
    }
  };

  const resetCsv = () => { setFile(null); setPreview(null); setResult(null); setFilter("all"); };

  const counts = {
    all: preview?.length ?? 0,
    ready: preview?.filter((r) => r.status === "ready").length ?? 0,
    review: preview?.filter((r) => r.status === "review").length ?? 0,
    error: preview?.filter((r) => r.status === "error").length ?? 0,
  };
  const visible = (preview ?? []).filter((r) => filter === "all" || r.status === filter);
  const importable = counts.all - counts.error;

  return (
    <div className="space-y-4">
      {/* Sub-mode switcher */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        {(["csv", "single", "bulk"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setSubMode(mode)}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              subMode === mode
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {mode === "csv" ? "CSV Import" : mode === "single" ? "Single" : "Bulk Images"}
          </button>
        ))}
      </div>

      {/* ── CSV Import ── */}
      {subMode === "csv" && (
        <>
          {result ? (
            <div className="space-y-3">
              <Card className="p-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  Added <span className="font-semibold">{result.added}</span> ·{" "}
                  <span className="text-amber-500">{result.needs_review} need review</span>
                  {result.skipped > 0 && <span className="text-muted-foreground"> · {result.skipped} skipped</span>}
                </div>
                <Button size="sm" onClick={resetCsv}>
                  <Upload className="size-4 mr-2" />
                  Import Another File
                </Button>
              </Card>

              {result.errors.length > 0 && (
                <Card className="p-3 border-rose-400/40">
                  <div className="text-xs font-semibold text-rose-500 mb-1">{result.errors.length} row(s) skipped</div>
                  <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-0.5 max-h-32 overflow-auto">
                    {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </Card>
              )}

              <div className="space-y-2">
                {result.questions.map((q: BankQuestion) => (
                  <BankQuestionCard key={q.id} question={q} onUpdated={() => onImported()} onDeleted={() => onImported()} />
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Upload drop zone */}
                <Card
                  className={cn("p-6 flex flex-col items-center justify-center text-center gap-3 border-2 border-dashed transition-colors",
                    dragOver ? "border-primary bg-primary/5" : "border-border")}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); acceptCsv(e.dataTransfer.files?.[0]); }}
                >
                  <Upload className="size-8 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{file ? file.name : "Drag & drop a CSV or TXT file"}</p>
                    <p className="text-xs text-muted-foreground">CSV or TXT · max 2MB</p>
                  </div>
                  <input ref={inputRef} type="file" accept=".csv,.txt" className="hidden" onChange={(e) => acceptCsv(e.target.files?.[0])} />
                  <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>Choose file</Button>
                  <button type="button" onClick={() => window.open("/api/qbank/sample-csv", "_blank")} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <Download className="size-3" />
                    Download Sample CSV Template
                  </button>
                  <p className="text-[11px] text-muted-foreground max-w-xs">
                    Not sure about the format? Download our template, fill it in, and upload. CO and BTL are optional — we&apos;ll infer them automatically.
                  </p>
                </Card>

                {/* Instructions */}
                <Card className="p-4 space-y-3 text-xs">
                  <div>
                    <p className="font-semibold mb-1">What we accept:</p>
                    <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                      <li>CSV files with our template format</li>
                      <li>Plain text files with one question per line</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-semibold mb-1">What happens after upload:</p>
                    <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                      <li>We parse your questions</li>
                      <li>Missing CO/BTL tags are automatically inferred by AI</li>
                      <li>You can review and correct all tags before finalizing</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-semibold mb-1">Tips:</p>
                    <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                      <li>For MCQ: fill all 4 options and mark the correct one</li>
                      <li>Module name doesn&apos;t need to be exact — we fuzzy match</li>
                    </ul>
                  </div>
                </Card>
              </div>

              {/* Preview */}
              {preview && (
                <Card className="p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(["all", "ready", "review", "error"] as const).map((k) => (
                      <button key={k} type="button" onClick={() => setFilter(k)}
                        className={cn("px-2.5 py-1 rounded-md border text-xs font-medium capitalize transition-colors",
                          filter === k ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground hover:bg-muted")}
                      >
                        {k === "review" ? "Needs Review" : k === "error" ? "Errors" : k} ({counts[k]})
                      </button>
                    ))}
                    <div className="flex-1" />
                    <span className="text-[11px] text-muted-foreground">Preview only — final tags are inferred on import</span>
                  </div>

                  <div className="max-h-80 overflow-auto rounded border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr className="text-left">
                          <th className="p-2 font-medium">Status</th>
                          <th className="p-2 font-medium">Question</th>
                          <th className="p-2 font-medium">Type</th>
                          <th className="p-2 font-medium">Marks</th>
                          <th className="p-2 font-medium">CO</th>
                          <th className="p-2 font-medium">BTL</th>
                          <th className="p-2 font-medium">Module</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((r, i) => {
                          const meta = STATUS_META[r.status];
                          const Icon = meta.icon;
                          return (
                            <tr key={i} className="border-t">
                              <td className="p-2">
                                <span className={cn("flex items-center gap-1", meta.cls)}>
                                  <Icon className="size-3" />{meta.label}
                                </span>
                              </td>
                              <td className="p-2 max-w-xs truncate" title={r.question}>{r.question || <span className="italic">{r.note}</span>}</td>
                              <td className="p-2">{r.type}</td>
                              <td className="p-2">{r.marks}</td>
                              <td className="p-2 text-muted-foreground">{r.co}</td>
                              <td className="p-2 text-muted-foreground">{r.btl}</td>
                              <td className="p-2 text-muted-foreground">{r.module}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {importable} importable{counts.error > 0 && ` · ${counts.error} will be skipped`}
                    </span>
                    <Button onClick={doImport} disabled={importing || importable === 0}>
                      {importing ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Upload className="size-4 mr-2" />}
                      Import {importable} Question{importable === 1 ? "" : "s"}
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Single ── */}
      {subMode === "single" && (
        <AddQuestionForm
          key={singleKey}
          subjectId={subjectId}
          modules={modules}
          courseOutcomes={courseOutcomes}
          onAdded={() => { onImported(); setSingleKey((k) => k + 1); }}
          onClose={() => setSingleKey((k) => k + 1)}
        />
      )}

      {/* ── Bulk Images ── */}
      {subMode === "bulk" && (
        <BulkImagesMode
          subjectId={subjectId}
          modules={modules}
          courseOutcomes={courseOutcomes}
          onImported={onImported}
        />
      )}
    </div>
  );
}
