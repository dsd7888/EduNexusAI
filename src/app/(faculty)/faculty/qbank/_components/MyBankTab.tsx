"use client";

/**
 * Tab 1 — "My Bank": stats, filters, search, infinite-scroll question list,
 * and a collapsible staging panel ("Paper Builder"). Creation UI lives in the
 * "Add Questions" tab (ImportTab) — this tab is pure browse/manage/stage.
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
  FileText,
  GripVertical,
  Library,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { BankQuestion } from "@/lib/qbank/types";
import { BankQuestionCard } from "./BankQuestionCard";
import { ReviewFlowDialog } from "./ReviewFlowDialog";
import {
  EMPTY_FILTERS,
  QUESTION_TYPES,
  SOURCE_LABELS,
  TYPE_LABELS,
  deleteQuestion,
  formatCo,
  listQuestionIds,
  listQuestions,
  type BankFilters,
  type BankStats,
  type CourseOutcomeRef,
  type ModuleRef,
  type StagedQuestion,
} from "./shared";

const PER_PAGE = 50;

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
  const [reviewQuestions, setReviewQuestions] = useState<BankQuestion[] | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);

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

  const openReview = (questions: BankQuestion[]) => {
    if (questions.length === 0) return;
    setReviewQuestions(questions);
  };

  const handleVerifySelected = () => {
    const selected = items.filter((it) => selectedIds.has(it.id));
    openReview(selected);
  };

  const handleReviewNeedsReview = () => {
    const unverified = items.filter((it) => !it.is_verified);
    openReview(unverified);
  };

  const handleReviewClose = (completed = false) => {
    setReviewQuestions(null);
    if (completed) setSelectedIds(new Set());
  };

  const handleQuestionApproved = (id: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, is_verified: true } : it))
    );
    refreshStats();
  };

  const stagedIds = useMemo(() => new Set(staged.map((s) => s.id)), [staged]);

  const unstagedSelectedCount = useMemo(
    () => [...selectedIds].filter((id) => !stagedIds.has(id)).length,
    [selectedIds, stagedIds]
  );

  const handleStageSelected = () => {
    const itemById = new Map(items.map((it) => [it.id, it]));
    for (const id of selectedIds) {
      if (stagedIds.has(id)) continue;
      const q = itemById.get(id);
      if (q) onStage(q);
    }
  };

  const handleDeleteSelected = async () => {
    const n = selectedIds.size;
    if (n === 0) return;
    if (!window.confirm(`Delete ${n} question${n === 1 ? "" : "s"}? This cannot be undone.`)) {
      return;
    }
    setDeleting(true);
    const ids = [...selectedIds];
    try {
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            await deleteQuestion(id);
            return { id, ok: true as const };
          } catch {
            return { id, ok: false as const };
          }
        })
      );
      const succeeded = results.filter((r) => r.ok);
      for (const { id } of succeeded) {
        handleDeleted(id);
      }
      setSelectedIds(new Set());
      const failed = results.length - succeeded.length;
      if (failed === 0) {
        toast.success(
          `${succeeded.length} question${succeeded.length === 1 ? "" : "s"} deleted`
        );
      } else if (succeeded.length === 0) {
        toast.error("Failed to delete selected questions");
      } else {
        toast.warning(
          `${succeeded.length} deleted, ${failed} failed`
        );
      }
    } catch (err) {
      console.error("[qbank] bulkDelete failed", err);
      toast.error("Bulk delete failed");
    } finally {
      setDeleting(false);
    }
  };

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
          <Button variant="outline" onClick={onGoGenerate}>
            <Sparkles className="size-4 mr-2" />
            Generate Questions
          </Button>
          <Button variant="outline" onClick={onGoImport}>
            <Upload className="size-4 mr-2" />
            Add Questions
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      {/* ── Left: stats + filters + list ──────────────────────────────── */}
      <div className="space-y-3 min-w-0">
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
              {stats.needsReview > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs ml-auto border-amber-400/40 text-amber-500 hover:text-amber-500 hover:bg-amber-500/10"
                  onClick={handleReviewNeedsReview}
                >
                  <ShieldCheck className="size-3 mr-1" />
                  Review Qs
                </Button>
              )}
              <span className="text-muted-foreground text-xs">
                By Type: MCQ {stats.byType.mcq} · Short {stats.byType.short_answer} ·
                Long {stats.byType.long_answer} · Num {stats.byType.numerical}
              </span>
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
                    disabled={deleting}
                  >
                    <ShieldCheck className="size-3 mr-1" />
                    Verify Selected
                  </Button>
                  {unstagedSelectedCount > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={handleStageSelected}
                      disabled={deleting}
                    >
                      <FileText className="size-3 mr-1" />
                      Save to Paper ({unstagedSelectedCount})
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 text-xs"
                    onClick={handleDeleteSelected}
                    disabled={deleting}
                  >
                    {deleting ? (
                      <Loader2 className="size-3 mr-1 animate-spin" />
                    ) : (
                      <Trash2 className="size-3 mr-1" />
                    )}
                    Delete Selected
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

      {reviewQuestions && (
        <ReviewFlowDialog
          questions={reviewQuestions}
          modules={modules}
          onClose={(completed) => handleReviewClose(completed)}
          onQuestionUpdated={handleUpdated}
          onQuestionApproved={handleQuestionApproved}
        />
      )}
    </div>
  );
}

// ─── Small helpers ───────────────────────────────────────────────────────────

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
