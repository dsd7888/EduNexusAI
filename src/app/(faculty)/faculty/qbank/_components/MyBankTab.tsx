"use client";

/**
 * Tab 1 — "My Bank": stats, filters, search, an infinite-scroll question list
 * (50 per page via the list API), a collapsible staging panel ("Paper
 * Builder") whose contents can be reordered and handed to the Q-paper builder,
 * and an "Add Question" form for manual question entry with optional image.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CheckSquare,
  ChevronDown,
  ChevronUp,
  FileOutput,
  GripVertical,
  Library,
  Loader2,
  Pencil,
  PlusCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import type { BankQuestion, MCQOption } from "@/lib/qbank/types";
import { BankQuestionCard } from "./BankQuestionCard";
import {
  EMPTY_FILTERS,
  QUESTION_TYPES,
  SOURCE_LABELS,
  TYPE_LABELS,
  addManualQuestion,
  bulkVerifyQuestions,
  formatCo,
  listQuestionIds,
  listQuestions,
  type BankFilters,
  type BankStats,
  type CourseOutcomeRef,
  type ManualQuestionPayload,
  type ModuleRef,
  type StagedQuestion,
} from "./shared";

const PER_PAGE = 50;

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const OPT_LABELS: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"];

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
  options: OPT_LABELS.map((label, i) => ({
    label,
    text: "",
    is_correct: i === 0,
  })),
};

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function MyBankTab({
  subjectId,
  modules,
  courseOutcomes,
  stats,
  statsLoading,
  refreshStats,
  staged,
  onStage,
  onUnstage,
  onReorder,
  onExportPaper,
  onGoGenerate,
  onGoImport,
}: {
  subjectId: string;
  modules: ModuleRef[];
  courseOutcomes: CourseOutcomeRef[];
  stats: BankStats | null;
  statsLoading: boolean;
  refreshStats: () => void;
  staged: StagedQuestion[];
  onStage: (q: BankQuestion) => void;
  onUnstage: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onExportPaper: () => void;
  onGoGenerate: () => void;
  onGoImport: () => void;
}) {
  const [filters, setFilters] = useState<BankFilters>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [items, setItems] = useState<BankQuestion[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [verifying, setVerifying] = useState(false);

  // Add Question form state
  const [showAddForm, setShowAddForm] = useState(false);

  const handleAdded = useCallback(
    (newQ: BankQuestion) => {
      setItems((prev) => [newQ, ...prev]);
      refreshStats();
      setShowAddForm(false);
    },
    [refreshStats]
  );

  // Debounce the search box into the filter set.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput }));
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  const load = useCallback(
    async (pageNum: number, replace: boolean) => {
      if (!subjectId) return;
      setLoading(true);
      try {
        const res = await listQuestions({
          subject_id: subjectId,
          page: pageNum,
          per_page: PER_PAGE,
          ...filters,
        });
        setItems((prev) => (replace ? res.questions : [...prev, ...res.questions]));
        setTotalPages(res.total_pages);
        setPage(res.page);
        setLoadedOnce(true);
      } catch (err) {
        console.error("[qbank] list failed", err);
      } finally {
        setLoading(false);
      }
    },
    [subjectId, filters]
  );

  // Reset + load page 1 whenever subject or filters change.
  useEffect(() => {
    setItems([]);
    setPage(1);
    setTotalPages(1);
    setLoadedOnce(false);
    setSelectedIds(new Set());
    if (subjectId) load(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId, filterKey]);

  // Infinite scroll: a sentinel near the list bottom pulls the next page.
  const stateRef = useRef({ page, totalPages, loading });
  stateRef.current = { page, totalPages, loading };
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      const { page: p, totalPages: tp, loading: l } = stateRef.current;
      if (entries[0].isIntersecting && !l && p < tp) load(p + 1, false);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [load]);

  const handleUpdated = (updated: BankQuestion) => {
    setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
    refreshStats();
  };
  const handleDeleted = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    onUnstage(id);
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    refreshStats();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    const allVisibleIds = items.map((it) => it.id);
    const allSelected = allVisibleIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        allVisibleIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => new Set([...prev, ...allVisibleIds]));
    }
  };

  const selectAllMatching = async () => {
    try {
      const ids = await listQuestionIds({ subject_id: subjectId, ...filters });
      setSelectedIds(new Set(ids));
    } catch (err) {
      console.error("[qbank] selectAllMatching failed", err);
    }
  };

  const handleVerifySelected = async () => {
    if (selectedIds.size === 0) return;
    setVerifying(true);
    try {
      const { verified, skipped } = await bulkVerifyQuestions([...selectedIds]);
      const verifiedSet = new Set([...selectedIds].filter(
        (id) => !skipped.find((s) => s.id === id)
      ));
      setItems((prev) =>
        prev.map((it) => (verifiedSet.has(it.id) ? { ...it, is_verified: true } : it))
      );
      setSelectedIds(new Set());
      refreshStats();
      const msg =
        skipped.length === 0
          ? `${verified} question${verified === 1 ? "" : "s"} verified`
          : `${verified} verified, ${skipped.length} skipped (missing CO or BTL)`;
      if (skipped.length === 0) {
        toast.success(msg);
      } else {
        toast.warning(msg, {
          description: skipped.map((s) => `• ${s.question_text.slice(0, 60)}…`).join("\n"),
          duration: 6000,
        });
      }
    } catch (err) {
      console.error("[qbank] bulkVerify failed", err);
      toast.error("Bulk verify failed");
    } finally {
      setVerifying(false);
    }
  };

  const stagedIds = useMemo(() => new Set(staged.map((s) => s.id)), [staged]);

  const hasActiveFilters =
    !!filters.question_type ||
    !!filters.marks ||
    !!filters.co_code ||
    !!filters.btl_level ||
    !!filters.source ||
    filters.needs_review ||
    !!filters.search;

  // ── Empty bank (no filters) → onboarding state ─────────────────────────
  if (!statsLoading && stats && stats.total === 0) {
    return (
      <div className="space-y-4">
        {showAddForm && (
          <AddQuestionForm
            subjectId={subjectId}
            modules={modules}
            courseOutcomes={courseOutcomes}
            onAdded={handleAdded}
            onClose={() => setShowAddForm(false)}
          />
        )}
        <Card className="p-10 text-center space-y-4">
          <Library className="size-10 mx-auto text-muted-foreground" />
          <div className="space-y-1">
            <h3 className="font-semibold">Your question bank is empty.</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Generate questions from your syllabus, import your existing
              questions, or add one manually to get started.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button onClick={() => setShowAddForm(true)}>
              <PlusCircle className="size-4 mr-2" />
              Add Question
            </Button>
            <Button variant="outline" onClick={onGoGenerate}>
              <Sparkles className="size-4 mr-2" />
              Generate Questions
            </Button>
            <Button variant="outline" onClick={onGoImport}>
              <Upload className="size-4 mr-2" />
              Import Questions
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      {/* ── Left: stats + filters + list ──────────────────────────────── */}
      <div className="space-y-3 min-w-0">
        {/* Add Question form (inline, above stats when open) */}
        {showAddForm && (
          <AddQuestionForm
            subjectId={subjectId}
            modules={modules}
            courseOutcomes={courseOutcomes}
            onAdded={handleAdded}
            onClose={() => setShowAddForm(false)}
          />
        )}

        {/* Stats */}
        <Card className="p-3">
          {statsLoading || !stats ? (
            <div className="text-xs text-muted-foreground">Loading stats…</div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <Stat label="Total" value={stats.total} />
              <Stat label="Verified" value={stats.verified} tone="text-emerald-500" />
              <Stat
                label="Needs Review"
                value={stats.needsReview}
                tone="text-amber-500"
              />
              <span className="text-muted-foreground text-xs">
                By Type: MCQ {stats.byType.mcq} · Short {stats.byType.short_answer} ·
                Long {stats.byType.long_answer} · Num {stats.byType.numerical}
              </span>
              <div className="ml-auto">
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setShowAddForm((v) => !v)}
                >
                  {showAddForm ? (
                    <>
                      <X className="size-3 mr-1" />
                      Close Form
                    </>
                  ) : (
                    <>
                      <PlusCircle className="size-3 mr-1" />
                      Add Question
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Filters */}
        <Card className="p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              value={filters.question_type}
              onChange={(v) => setFilters({ ...filters, question_type: v })}
              placeholder="All Types"
              options={QUESTION_TYPES.map((t) => [t, TYPE_LABELS[t]])}
            />
            <FilterSelect
              value={filters.marks}
              onChange={(v) => setFilters({ ...filters, marks: v })}
              placeholder="All Marks"
              options={(stats?.marks ?? []).map((m) => [String(m), `${m}M`])}
            />
            <FilterSelect
              value={filters.co_code}
              onChange={(v) => setFilters({ ...filters, co_code: v })}
              placeholder="All COs"
              options={courseOutcomes.map((c) => [c.co_code, formatCo(c.co_code)])}
            />
            <FilterSelect
              value={filters.btl_level}
              onChange={(v) => setFilters({ ...filters, btl_level: v })}
              placeholder="All BTL"
              options={[1, 2, 3, 4, 5, 6].map((n) => [String(n), `BTL ${n}`])}
            />
            <FilterSelect
              value={filters.source}
              onChange={(v) => setFilters({ ...filters, source: v })}
              placeholder="All Sources"
              options={(
                ["ai_generated", "faculty_imported", "pyq_inspired"] as const
              ).map((s) => [s, SOURCE_LABELS[s]])}
            />
            <button
              type="button"
              onClick={() =>
                setFilters({ ...filters, needs_review: !filters.needs_review })
              }
              className={cn(
                "px-2.5 py-1 rounded-md border text-xs font-medium transition-colors",
                filters.needs_review
                  ? "bg-amber-500/15 border-amber-400/40 text-amber-400"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              Needs Review only
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setSearchInput("");
                }}
                className="text-xs text-primary hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search question text…"
              className="h-8 pl-7 text-sm"
            />
          </div>
          {/* Selection toolbar — shown once questions are loaded */}
          {loadedOnce && items.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40">
              <button
                type="button"
                onClick={selectAllVisible}
                className="flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                <CheckSquare className="size-3.5" />
                {items.every((it) => selectedIds.has(it.id)) && selectedIds.size > 0
                  ? "Deselect visible"
                  : `Select visible (${items.length})`}
              </button>
              {page < totalPages && (
                <button
                  type="button"
                  onClick={selectAllMatching}
                  className="flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  <CheckSquare className="size-3.5" />
                  Select all matching filter
                </button>
              )}
              {selectedIds.size > 0 && (
                <>
                  <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                    {selectedIds.size} selected
                  </span>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleVerifySelected}
                    disabled={verifying}
                  >
                    {verifying ? (
                      <Loader2 className="size-3 mr-1 animate-spin" />
                    ) : (
                      <ShieldCheck className="size-3 mr-1" />
                    )}
                    Verify Selected
                  </Button>
                </>
              )}
            </div>
          )}
        </Card>

        {/* List */}
        <div className="space-y-2">
          {items.map((q) => (
            <BankQuestionCard
              key={q.id}
              question={q}
              onUpdated={handleUpdated}
              onDeleted={handleDeleted}
              onStage={onStage}
              isStaged={stagedIds.has(q.id)}
              isSelected={selectedIds.has(q.id)}
              onToggleSelect={toggleSelect}
            />
          ))}

          {loadedOnce && items.length === 0 && !loading && (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              No questions match these filters.
            </Card>
          )}

          {loading && (
            <div className="flex justify-center py-4">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
          <div ref={sentinelRef} className="h-1" />
          {loadedOnce && page >= totalPages && items.length > 0 && (
            <p className="text-center text-[11px] text-muted-foreground py-2">
              {items.length} question{items.length === 1 ? "" : "s"} loaded
            </p>
          )}
        </div>
      </div>

      {/* ── Right: staging panel ──────────────────────────────────────── */}
      <StagingPanel
        staged={staged}
        onUnstage={onUnstage}
        onReorder={onReorder}
        onExportPaper={onExportPaper}
      />
    </div>
  );
}

// ─── Add Question Form ───────────────────────────────────────────────────────

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

      {/* Question type selector — comes first so the MCQ options field knows when to show */}
      <div>
        <span className="text-[10px] text-muted-foreground">Type</span>
        <Select
          value={draft.question_type}
          onValueChange={(v) => setDraft({ ...draft, question_type: v })}
        >
          <SelectTrigger className="h-7 text-xs mt-0.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QUESTION_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Question text — same Textarea pattern as BankQuestionCard draft */}
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

      {/* MCQ options — same inline button + Input pattern as BankQuestionCard */}
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
                onClick={() =>
                  setDraft({
                    ...draft,
                    options: draft.options.map((o, j) => ({
                      ...o,
                      is_correct: j === i,
                    })),
                  })
                }
                className={cn(
                  "size-5 shrink-0 rounded-full border text-[10px] font-bold",
                  opt.is_correct
                    ? "bg-emerald-500 text-white border-emerald-500"
                    : "text-muted-foreground"
                )}
              >
                {opt.label}
              </button>
              <Input
                value={opt.text}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    options: draft.options.map((o, j) =>
                      j === i ? { ...o, text: e.target.value } : o
                    ),
                  })
                }
                className="h-7 text-xs"
                placeholder={`Option ${opt.label}`}
              />
            </div>
          ))}
        </div>
      )}

      {/* Marks / CO / BTL / Difficulty — same grid pattern as BankQuestionCard */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <FormField label="Marks">
          <Input
            type="number"
            value={draft.marks}
            onChange={(e) => setDraft({ ...draft, marks: e.target.value })}
            className="h-7 text-xs"
          />
        </FormField>

        <FormField label="CO">
          <Select
            value={draft.co_code || "none"}
            onValueChange={(v) =>
              setDraft({ ...draft, co_code: v === "none" ? "" : v })
            }
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {courseOutcomes.map((c) => (
                <SelectItem key={c.co_code} value={c.co_code}>
                  {formatCo(c.co_code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField label="BTL">
          <Select
            value={draft.btl_level || "none"}
            onValueChange={(v) =>
              setDraft({ ...draft, btl_level: v === "none" ? "" : v })
            }
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  BTL {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField label="Difficulty">
          <Select
            value={draft.difficulty || "none"}
            onValueChange={(v) =>
              setDraft({ ...draft, difficulty: v === "none" ? "" : v })
            }
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {["easy", "medium", "hard"].map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>

      {/* Module (optional) */}
      {modules.length > 0 && (
        <FormField label="Module (optional)">
          <Select
            value={draft.module_id || "none"}
            onValueChange={(v) =>
              setDraft({ ...draft, module_id: v === "none" ? "" : v })
            }
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {modules.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  M{m.module_number} — {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}

      {/* Image upload (optional) */}
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
        {imageError && (
          <p className="text-xs text-destructive">{imageError}</p>
        )}
        {imagePreviewUrl && (
          <div className="relative inline-block">
            <img
              src={imagePreviewUrl}
              alt="Preview"
              className="rounded-md max-h-40 object-contain border border-border/40"
            />
            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(imagePreviewUrl);
                setImageFile(null);
                setImagePreviewUrl(null);
              }}
              className="absolute top-1 right-1 rounded-full bg-background/80 p-0.5 text-muted-foreground hover:text-destructive"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        {(() => {
          const isAiImageMode = imageFile !== null && !draft.question_text.trim();
          return (
            <Button size="sm" className="h-7 text-xs" onClick={handleSubmit} disabled={adding}>
              {adding ? (
                <Loader2 className="size-3 mr-1 animate-spin" />
              ) : isAiImageMode ? (
                <Sparkles className="size-3 mr-1" />
              ) : (
                <PlusCircle className="size-3 mr-1" />
              )}
              {isAiImageMode ? "Generate & Add" : "Add to Bank"}
            </Button>
          );
        })()}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={onClose}
          disabled={adding}
        >
          <X className="size-3 mr-1" />
          Cancel
        </Button>
      </div>
    </Card>
  );
}

// ─── Small helpers ───────────────────────────────────────────────────────────

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-muted-foreground text-xs">{label}:</span>
      <span className={cn("font-semibold tabular-nums", tone)}>{value}</span>
    </span>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: Array<[string, string]>;
}) {
  return (
    <Select
      value={value || "all"}
      onValueChange={(v) => onChange(v === "all" ? "" : v)}
    >
      <SelectTrigger className="h-8 w-auto min-w-28 text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{placeholder}</SelectItem>
        {options.map(([val, label]) => (
          <SelectItem key={val} value={val}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Staging panel ──────────────────────────────────────────────────────────

function StagingPanel({
  staged,
  onUnstage,
  onReorder,
  onExportPaper,
}: {
  staged: StagedQuestion[];
  onUnstage: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onExportPaper: () => void;
}) {
  const [open, setOpen] = useState(true);
  const sensors = useSensors(useSensor(PointerSensor));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = staged.findIndex((s) => s.id === active.id);
    const newIdx = staged.findIndex((s) => s.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    onReorder(arrayMove(staged, oldIdx, newIdx).map((s) => s.id));
  };

  return (
    <Card className="p-3 h-fit lg:sticky lg:top-2 space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <FileOutput className="size-4" />
          Paper Builder ({staged.length})
        </span>
        {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </button>

      {open && (
        <>
          {staged.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              Use "Save to Paper" on questions to stage them here, then export to
              the Q-paper builder.
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={staged.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-1.5">
                  {staged.map((s, i) => (
                    <StagedRow
                      key={s.id}
                      item={s}
                      index={i}
                      onRemove={() => onUnstage(s.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          <Button
            className="w-full"
            size="sm"
            disabled={staged.length === 0}
            onClick={onExportPaper}
          >
            <FileOutput className="size-4 mr-2" />
            Export Selected as Q Paper
          </Button>
        </>
      )}
    </Card>
  );
}

function StagedRow({
  item,
  index,
  onRemove,
}: {
  item: StagedQuestion;
  index: number;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="flex items-center gap-1.5 rounded border bg-background p-1.5 text-xs"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
      >
        <GripVertical className="size-3.5" />
      </button>
      <span className="text-muted-foreground w-4 shrink-0">{index + 1}.</span>
      <Badge variant="outline" className="text-[9px] shrink-0">
        {TYPE_LABELS[item.question_type]} {item.marks}M
      </Badge>
      <span className="flex-1 truncate">{item.question_text}</span>
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive shrink-0"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
