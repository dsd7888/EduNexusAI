"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  useFacultySubjects,
  useSubjectModules,
} from "@/hooks/useSupabaseData";
import {
  BookOpen,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Download,
  History,
  Loader2,
  Presentation,
  Wand2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { SlideContent } from "@/lib/ppt/generator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ConceptExplainers,
  type ConceptSlide,
} from "./_components/ConceptExplainers";
import { MyGenerationsPanel } from "./_components/MyGenerationsList";

// ─── Types ───────────────────────────────────────────────────────────────────

type View = "form" | "generating" | "done";
type InputMode = "module" | "topic";
type Depth = "basic" | "intermediate" | "advanced";

type OutlineItem = {
  index: number;
  type: string;
  title: string;
  renderHint?: "svg" | "mermaid" | "imagen" | "illustration" | "dual" | null;
  leftVisual?: string;
  rightVisual?: string;
  leftPrompt?: string;
  rightPrompt?: string;
};

type OutlineResult = {
  presentationTitle: string;
  subject: string;
  topic: string;
  outline: OutlineItem[];
};

// Everything needed to resume an interrupted generation: the saved outline,
// the partially-filled slides, and the original generation parameters.
type ResumePayload = {
  contentId: string;
  subjectId: string;
  moduleId: string | null;
  customTopic: string | null;
  depth: Depth;
  title: string;
  subject: string;
  topic: string;
  presentationTitle: string;
  outline: OutlineResult;
  slides: (SlideContent | null)[];
  slidesDone: number;
  slidesTotal: number;
  totalFlashCostInr: number;
  status: string;
};

type PipelineStage = "planning" | "writing" | "diagrams" | "assembling";
type StageStatus = "pending" | "active" | "done" | "error";

interface SlideCheckItem {
  index: number;
  title: string;
  done: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEPTH_OPTIONS: { value: Depth; label: string; desc: string }[] = [
  {
    value: "basic",
    label: "Basic",
    desc: "Introductory, simple examples, minimal math",
  },
  {
    value: "intermediate",
    label: "Intermediate",
    desc: "Complete university coverage, full derivations",
  },
  {
    value: "advanced",
    label: "Advanced",
    desc: "Rigorous treatment, complex problems, industry applications",
  },
];

const PIPELINE_STAGES: { id: PipelineStage; label: string }[] = [
  { id: "planning", label: "Planning structure" },
  { id: "writing", label: "Writing content" },
  { id: "diagrams", label: "Building diagrams" },
  { id: "assembling", label: "Assembling slides" },
];

const STAGE_INITIAL: Record<PipelineStage, StageStatus> = {
  planning: "pending",
  writing: "pending",
  diagrams: "pending",
  assembling: "pending",
};

// ─── Combobox ────────────────────────────────────────────────────────────────

interface ComboboxOption {
  value: string;
  label: string;
}

function Combobox({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  noOptionsText = "No results",
}: {
  options: ComboboxOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  noOptionsText?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const selected = options.find((o) => o.value === value);

  // Sync display text when value or dropdown-open state changes
  useEffect(() => {
    if (!open) setQuery(selected?.label ?? "");
  }, [value, open, selected]);

  // Debounce filter at ~150 ms
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const filtered =
    debouncedQuery.trim() === ""
      ? options
      : options.filter((o) =>
          o.label.toLowerCase().includes(debouncedQuery.toLowerCase())
        );

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={(e) => {
          setOpen(true);
          if (debounceRef.current) clearTimeout(debounceRef.current);
          setDebouncedQuery("");
          e.currentTarget.select();
        }}
        placeholder={disabled ? "Select a subject first" : placeholder}
        disabled={disabled}
        autoComplete="off"
        aria-haspopup="listbox"
        aria-expanded={open}
      />
      {open && !disabled && (
        <div
          role="listbox"
          className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-md max-h-52 overflow-auto"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {noOptionsText}
            </p>
          ) : (
            filtered.map((opt) => (
              <button
                key={opt.value}
                role="option"
                aria-selected={opt.value === value}
                type="button"
                className={cn(
                  "w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors",
                  opt.value === value && "bg-accent font-medium"
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(opt.value);
                  setQuery(opt.label);
                  setOpen(false);
                }}
              >
                {opt.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Dropdown Select (click-to-reveal, no typing — for short module lists) ────

function DropdownSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  options: ComboboxOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((p) => !p)}
        disabled={disabled}
        className={cn(
          "w-full flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm",
          "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          !selected && "text-muted-foreground"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">
          {selected
            ? selected.label
            : disabled
            ? "Select a subject first"
            : placeholder}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 ml-2 transition-transform duration-150",
            open && "rotate-180"
          )}
        />
      </button>
      {open && !disabled && (
        <div
          role="listbox"
          className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-md max-h-52 overflow-auto"
        >
          {options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              No modules found
            </p>
          ) : (
            options.map((opt) => (
              <button
                key={opt.value}
                role="option"
                aria-selected={opt.value === value}
                type="button"
                className={cn(
                  "w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors",
                  opt.value === value && "bg-accent font-medium"
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Depth Segment Control ────────────────────────────────────────────────────

function DepthSelector({
  value,
  onChange,
}: {
  value: Depth;
  onChange: (v: Depth) => void;
}) {
  const [hovered, setHovered] = useState<Depth | null>(null);
  const previewDesc =
    DEPTH_OPTIONS.find((o) => o.value === (hovered ?? value))?.desc ?? "";

  return (
    <div className="space-y-2">
      <div
        role="radiogroup"
        aria-label="Depth level"
        className="inline-flex w-full rounded-lg border bg-muted p-1 gap-1"
      >
        {DEPTH_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={value === opt.value}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              value === opt.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
            onClick={() => onChange(opt.value)}
            onMouseEnter={() => setHovered(opt.value)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(opt.value)}
            onBlur={() => setHovered(null)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {/* min-h prevents layout shift when text changes */}
      <p className="text-muted-foreground text-xs min-h-[1.1rem]">
        {previewDesc}
      </p>
    </div>
  );
}

// ─── Stage icon ───────────────────────────────────────────────────────────────

function StageIcon({ status }: { status: StageStatus }) {
  if (status === "done")
    return <CheckCircle2 className="size-4 text-green-500 shrink-0" />;
  if (status === "active")
    return <Loader2 className="size-4 animate-spin text-primary shrink-0" />;
  if (status === "error")
    return <XCircle className="size-4 text-destructive shrink-0" />;
  return <Circle className="size-4 text-muted-foreground/40 shrink-0" />;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FacultyGeneratePage() {
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>("module");
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [customTopic, setCustomTopic] = useState("");
  const [depth, setDepth] = useState<Depth>("intermediate");
  const [view, setView] = useState<View>("form");
  const [result, setResult] = useState<{
    downloadUrl: string;
    title: string;
    slideCount: number;
    fileName: string;
    contentId: string;
  } | null>(null);
  const [addLogo, setAddLogo] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [showWhat, setShowWhat] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [conceptSlides, setConceptSlides] = useState<ConceptSlide[]>([]);
  const [recentGeneration, setRecentGeneration] = useState<{
    id: string;
    title: string;
    subject: string | null;
    slideCount: number | null;
    created_at: string;
  } | null>(null);

  // Pipeline progress
  const [stageStatuses, setStageStatuses] =
    useState<Record<PipelineStage, StageStatus>>({ ...STAGE_INITIAL });
  const [slideChecklist, setSlideChecklist] = useState<SlideCheckItem[]>([]);
  const [progress, setProgress] = useState(0);

  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Synchronous double-submit guard — set the instant Generate/Resume is
  // clicked, before any await, so a fast double-click can't start two runs.
  const submittingRef = useRef(false);
  // Serializes checkpoint writes: each call chains onto the previous so the
  // server's read-modify-write of metadata.slides never loses an update even
  // though batches themselves run concurrently.
  const checkpointChainRef = useRef<Promise<void>>(Promise.resolve());
  // A resumable (non-terminal) generation found on mount, if any.
  const [resumable, setResumable] = useState<ResumePayload | null>(null);
  const isGenerating = view === "generating";

  const { subjects } = useFacultySubjects();
  const { modules } = useSubjectModules(selectedSubjectId || null);

  const selectedSubjectName =
    subjects.find((s) => s.id === selectedSubjectId)?.name ?? "";

  const subjectOptions: ComboboxOption[] = subjects.map((s) => ({
    value: s.id,
    label: `${s.code} — ${s.name}`,
  }));
  const moduleOptions: ComboboxOption[] = modules.map((m) => ({
    value: m.id,
    label: `Module ${m.module_number}: ${m.name}`,
  }));

  useEffect(() => {
    setSelectedModuleId("");
  }, [selectedSubjectId]);

  // Prevent navigation during generation
  useEffect(() => {
    if (!isGenerating) return;
    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault();
      window.history.pushState(null, "", window.location.href);
    };
    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handlePopState);
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Generation in progress. Leaving will cancel it.";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isGenerating]);

  // Smooth progress bar
  useEffect(() => {
    if (view !== "generating") return;
    setProgress(0);
    const start = Date.now();
    const duration = 60000;
    const t = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.min(95, (elapsed / duration) * 100));
    }, 500);
    progressRef.current = t;
    return () => {
      if (progressRef.current) clearInterval(progressRef.current);
      progressRef.current = null;
    };
  }, [view]);

  // Detect university logo
  useEffect(() => {
    const logoPath = "/university-logo.png";
    const img = new Image();
    img.onload = () => setLogoUrl(logoPath);
    img.onerror = () => setLogoUrl(null);
    img.src = logoPath;
  }, []);

  const loadResumable = useCallback(async () => {
    try {
      const res = await fetch("/api/generate/ppt/resumable");
      if (!res.ok) return;
      const data = (await res.json()) as { resumable: ResumePayload | null };
      setResumable(data.resumable ?? null);
    } catch (err) {
      console.error("[generate] resumable check failed", err);
    }
  }, []);

  // On mount, surface any interrupted generation so it can be resumed.
  useEffect(() => {
    void loadResumable();
  }, [loadResumable]);

  // Fetch the most recent completed generation for the context column.
  useEffect(() => {
    fetch("/api/generate/ppt/history")
      .then((r) => r.json())
      .then(
        (data: {
          rows: Array<{
            id: string;
            title: string;
            subject: string | null;
            slideCount: number | null;
            created_at: string;
            status: string;
          }>;
        }) => {
          const first = (data.rows ?? []).find((r) => r.status === "completed");
          setRecentGeneration(first ?? null);
        }
      )
      .catch(() => {});
  }, []);

  // Queue a checkpoint write onto the serialized chain. Merges the just-finished
  // batch's slides into the saved row and advances status. Best-effort: a failed
  // checkpoint is logged but never aborts generation.
  const queueCheckpoint = useCallback(
    (
      contentId: string,
      slideIndices: number[],
      slides: (SlideContent | null)[],
      costInr: number,
      status: "generating_content" | "generating_diagrams" | "building"
    ): Promise<void> => {
      const run = checkpointChainRef.current.then(async () => {
        try {
          await fetch(`/api/generate/ppt/checkpoint/${contentId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slideIndices, slides, costInr, status }),
          });
        } catch (err) {
          console.error("[generate] checkpoint failed", err);
        }
      });
      checkpointChainRef.current = run;
      return run;
    },
    []
  );

  const setStage = useCallback(
    (stage: PipelineStage, status: StageStatus) => {
      setStageStatuses((prev) => ({ ...prev, [stage]: status }));
    },
    []
  );

  const markSlidesDone = useCallback((indexes: number[]) => {
    setSlideChecklist((prev) =>
      prev.map((item) =>
        indexes.includes(item.index) ? { ...item, done: true } : item
      )
    );
  }, []);

  async function generatePresentation(resume?: ResumePayload) {
    setView("generating");
    setResult(null);
    setStageStatuses({ ...STAGE_INITIAL });
    setSlideChecklist([]);
    setProgress(0);
    // Fresh run starts a clean checkpoint chain.
    checkpointChainRef.current = Promise.resolve();

    // Resolve the generation config from either the resume payload or the form.
    const cfg = resume
      ? {
          subjectId: resume.subjectId,
          moduleId: resume.moduleId ?? undefined,
          customTopic: resume.customTopic ?? undefined,
          depth: resume.depth,
        }
      : {
          subjectId: selectedSubjectId,
          moduleId:
            inputMode === "module" ? selectedModuleId || undefined : undefined,
          customTopic:
            inputMode === "topic" ? customTopic.trim() || undefined : undefined,
          depth,
        };

    try {
      // ── Stage 1: Planning ─────────────────────────────────────────────────
      setStage("planning", "active");

      let outline: OutlineResult;
      let contentId: string | null;
      let totalFlashCostInr: number;

      if (resume) {
        // Reuse the saved outline — no AI outline call on resume.
        outline = resume.outline;
        contentId = resume.contentId;
        totalFlashCostInr = resume.totalFlashCostInr;
      } else {
        const outlineRes = await fetch("/api/generate/ppt/outline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjectId: cfg.subjectId,
            moduleId: cfg.moduleId,
            customTopic: cfg.customTopic,
            depth: cfg.depth,
          }),
        });
        if (!outlineRes.ok) throw new Error("Failed to generate outline");
        const outlineData = await outlineRes.json();

        // Double-submit guard tripped server-side: an identical generation is
        // already in flight. Offer to resume it instead of duplicating spend.
        if (outlineData?.duplicate) {
          toast.info(
            "You already started this presentation — resume it below."
          );
          await loadResumable();
          setView("form");
          return;
        }

        outline = outlineData.outline as OutlineResult;
        contentId = (outlineData.contentId as string | null) ?? null;
        totalFlashCostInr = (outlineData.costInr as number | undefined) ?? 0;
      }

      setStage("planning", "done");

      // Populate slide checklist from outline; mark already-done ones on resume.
      // Treat checkpointed `_failed` placeholders as NOT done so they regenerate
      // on resume. Otherwise a resumed deck would re-ship the same broken slide
      // (and the build route's failed-title abort would be undefeatable by resume).
      const allSlides: (SlideContent | null)[] = Array.from(
        { length: outline.outline.length },
        (_, i) => {
          if (!resume) return null;
          const s = resume.slides[i] ?? null;
          return s && (s as { _failed?: boolean })._failed ? null : s;
        }
      );
      setSlideChecklist(
        outline.outline.map((s) => ({
          index: s.index,
          title: s.title,
          done: allSlides[s.index] != null,
        }))
      );

      // ── Stage 2: Writing content ──────────────────────────────────────────
      // Build batches from only the slides still missing (resume skips filled).
      const BATCH_SIZE = 5;
      const isVisualSolo = (s: OutlineItem) =>
        s.type === "diagram" || s.type === "dual_visual";
      const pendingContent = outline.outline.filter(
        (s) => !isVisualSolo(s) && allSlides[s.index] == null
      );
      const pendingDiagram = outline.outline.filter(
        (s) => isVisualSolo(s) && allSlides[s.index] == null
      );

      const contentBatches: OutlineItem[][] = [];
      for (let i = 0; i < pendingContent.length; i += BATCH_SIZE) {
        contentBatches.push(pendingContent.slice(i, i + BATCH_SIZE));
      }
      const diagramBatches: OutlineItem[][] = pendingDiagram.map((s) => [s]);

      async function processBatch(
        batch: OutlineItem[],
        batchLabel: string,
        status: "generating_content" | "generating_diagrams"
      ): Promise<void> {
        try {
          const batchRes = await fetch("/api/generate/ppt/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subjectId: cfg.subjectId,
              moduleId: cfg.moduleId,
              customTopic: cfg.moduleId ? undefined : cfg.customTopic,
              slides: batch.map((s) => ({
                index: s.index,
                type: s.type,
                title: s.title,
                renderHint: s.renderHint ?? null,
                ...(s.type === "dual_visual"
                  ? {
                      leftVisual: s.leftVisual,
                      rightVisual: s.rightVisual,
                      leftPrompt: s.leftPrompt,
                      rightPrompt: s.rightPrompt,
                    }
                  : {}),
              })),
              depth: cfg.depth,
            }),
          });

          let batchCostInr = 0;
          if (batchRes.ok) {
            const { slides, costInr = 0 } = await batchRes.json();
            batchCostInr = costInr;
            totalFlashCostInr += batchCostInr;
            batch.forEach((outlineSlide, localIdx) => {
              if (slides[localIdx] != null) {
                allSlides[outlineSlide.index] = slides[localIdx];
              }
            });
            markSlidesDone(batch.map((s) => s.index));
            console.log(`[generate] ${batchLabel} done`);
          } else {
            console.error(
              `[generate] ${batchLabel} failed:`,
              batchRes.status
            );
            const failedSlides = batch.map((s) => ({
              type: s.type ?? "concept",
              title: s.title ?? "Slide",
              bullets: ["Content could not be generated for this slide."],
              note: "⚠️ This slide failed to generate. Use the Refine page to regenerate it.",
              _failed: true,
            }));
            batch.forEach((outlineSlide, localIdx) => {
              allSlides[outlineSlide.index] =
                failedSlides[localIdx] as unknown as SlideContent;
            });
            markSlidesDone(batch.map((s) => s.index));
          }

          // Checkpoint after EVERY batch (success or failure-placeholder) so
          // worst-case loss on interruption is this one batch, not the deck.
          if (contentId) {
            const slideIndices = batch.map((s) => s.index);
            await queueCheckpoint(
              contentId,
              slideIndices,
              slideIndices.map((i) => allSlides[i]),
              batchCostInr,
              status
            );
          }
        } catch (err) {
          console.error(`[generate] ${batchLabel} error:`, err);
          markSlidesDone(batch.map((s) => s.index));
        }
      }

      setStage("writing", "active");
      const CONCURRENCY = 3;
      for (let i = 0; i < contentBatches.length; i += CONCURRENCY) {
        const chunk = contentBatches.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map((batch, localIdx) =>
            processBatch(
              batch,
              `content batch ${i + localIdx + 1}/${contentBatches.length}`,
              "generating_content"
            )
          )
        );
        if (i + CONCURRENCY < contentBatches.length) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      setStage("writing", "done");

      // ── Stage 3: Diagrams ─────────────────────────────────────────────────
      // Concurrency 5 (tune DOWN if 429 rate-limit errors appear on the Pro
      // diagram model — 5 is a starting point, not a ceiling). No artificial
      // stagger between chunks: responseSchema on the diagram path removed the
      // parse-retry tax that previously justified caution.
      setStage("diagrams", "active");
      const DIAGRAM_CONCURRENCY = 5;
      for (let i = 0; i < diagramBatches.length; i += DIAGRAM_CONCURRENCY) {
        const chunk = diagramBatches.slice(i, i + DIAGRAM_CONCURRENCY);
        await Promise.all(
          chunk.map((batch, localIdx) =>
            processBatch(
              batch,
              `diagram ${i + localIdx + 1}/${diagramBatches.length}`,
              "generating_diagrams"
            )
          )
        );
      }
      setStage("diagrams", "done");

      // Make sure every checkpoint write has flushed before finalizing.
      await checkpointChainRef.current;

      const validSlides = allSlides.filter(
        (s): s is SlideContent => Boolean(s)
      );
      if (validSlides.length === 0) throw new Error("No slides generated");

      // ── Stage 4: Assembling ───────────────────────────────────────────────
      // Build finalizes (UPDATEs) the checkpoint row into the completed record.
      setStage("assembling", "active");
      if (contentId) {
        await queueCheckpoint(contentId, [], [], 0, "building");
        await checkpointChainRef.current;
      }
      const buildRes = await fetch("/api/generate/ppt/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: cfg.subjectId,
          contentId,
          presentationTitle: outline.presentationTitle,
          subject: outline.subject,
          topic: outline.topic,
          slides: validSlides,
          addLogo,
          logoUrl: addLogo ? logoUrl : null,
          totalFlashCostInr,
        }),
      });
      if (!buildRes.ok) throw new Error("Failed to build presentation");
      const buildResult = (await buildRes.json()) as {
        downloadUrl: string;
        title: string;
        slideCount: number;
        fileName: string;
        contentId: string;
      };
      setStage("assembling", "done");

      // This generation is now completed — no longer a resume candidate.
      setResumable(null);

      if (progressRef.current) {
        clearInterval(progressRef.current);
        progressRef.current = null;
      }

      // Capture concept slides for explainer section
      const conceptOutline = (outline.outline as OutlineItem[]).filter(
        (s) => s.type === "concept" || s.type === "diagram"
      );
      setConceptSlides(
        conceptOutline.map((s) => {
          const built = allSlides[s.index] as
            | (SlideContent & { bullets?: string[] })
            | null;
          const bullets =
            built && Array.isArray(built.bullets)
              ? built.bullets.join(". ")
              : "";
          return {
            index: s.index,
            title: s.title,
            contentHint: bullets.slice(0, 200),
          };
        })
      );

      setResult(buildResult);
      setView("done");

      setTimeout(() => {
        const a = document.createElement("a");
        a.href = buildResult.downloadUrl;
        a.download = buildResult.fileName ?? "presentation.pptx";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, 300);
    } catch (err) {
      if (progressRef.current) clearInterval(progressRef.current);
      console.error("[generate]", err);
      toast.error(
        err instanceof Error
          ? err.message
          : "Generation failed. Please try again."
      );
      // The partial work is checkpointed server-side — re-offer it as resumable.
      await loadResumable();
      setView("form");
    } finally {
      submittingRef.current = false;
    }
  }

  const handleGenerate = () => {
    if (!selectedSubjectId) return;
    if (inputMode === "module" && !selectedModuleId) return;
    if (inputMode === "topic" && !customTopic.trim()) return;
    // Synchronous double-submit guard — block re-entry before any await.
    if (submittingRef.current) return;
    submittingRef.current = true;
    void generatePresentation();
  };

  const handleResume = () => {
    if (!resumable) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    // Mirror the saved params into form state so the "done" view renders the
    // correct subject/level afterward.
    setSelectedSubjectId(resumable.subjectId);
    setDepth(resumable.depth);
    if (resumable.customTopic) {
      setInputMode("topic");
      setCustomTopic(resumable.customTopic);
    } else if (resumable.moduleId) {
      setInputMode("module");
      setSelectedModuleId(resumable.moduleId);
    }
    void generatePresentation(resumable);
  };

  const handleGenerateAnother = () => {
    setView("form");
    setResult(null);
    setStageStatuses({ ...STAGE_INITIAL });
    setSlideChecklist([]);
    setProgress(0);
    setSelectedModuleId("");
    setCustomTopic("");
    setConceptSlides([]);
    void loadResumable();
  };

  const canGenerate =
    selectedSubjectId &&
    (inputMode === "module" ? selectedModuleId : customTopic.trim());

  // Persistent header rendered in every view
  const pageHeader = (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-2">
        <Presentation className="size-6 text-primary" />
        <h1 className="text-xl font-semibold tracking-tight">
          Generate Presentation
        </h1>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowPanel(true)}
        className="gap-1.5"
      >
        <History className="size-4" />
        My Generations
      </Button>
    </div>
  );

  // ──── VIEW: form ───────────────────────────────────────────────────────────
  if (view === "form") {
    return (
      <>
        {pageHeader}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,760px)_420px] gap-8 items-start">
          {/* Form column */}
          <div className="space-y-4">
            {resumable && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm dark:border-amber-900 dark:bg-amber-950/40">
                <div className="flex items-center gap-2">
                  <Wand2 className="size-4 text-amber-700 dark:text-amber-300" />
                  <p className="font-medium text-sm">Resume previous generation</p>
                </div>
                <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
                  &ldquo;{resumable.presentationTitle}&rdquo; was interrupted —{" "}
                  {resumable.slidesDone} of {resumable.slidesTotal} slides done.
                  Resume to finish only the remaining slides without re-spending on
                  completed ones.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Button onClick={handleResume} className="gap-2">
                    <Wand2 className="size-4" />
                    Resume ({resumable.slidesDone}/{resumable.slidesTotal})
                  </Button>
                  <Button variant="outline" onClick={() => setResumable(null)}>
                    Dismiss &amp; start fresh
                  </Button>
                </div>
              </div>
            )}

            {/* Compact single-panel form */}
            <div className="rounded-xl border bg-card shadow-sm divide-y">
              {/* Subject */}
              <div className="px-5 py-4 space-y-2">
                <Label>Subject</Label>
                <Combobox
                  options={subjectOptions}
                  value={selectedSubjectId}
                  onChange={(v) => {
                    setSelectedSubjectId(v);
                    setSelectedModuleId("");
                  }}
                  placeholder="Search subjects…"
                />
              </div>

              {/* Source toggle + input */}
              <div className="px-5 py-4 space-y-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setInputMode("module")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                      inputMode === "module"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-input hover:bg-muted"
                    )}
                  >
                    <BookOpen className="size-3.5" />
                    From Module
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode("topic")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                      inputMode === "topic"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-input hover:bg-muted"
                    )}
                  >
                    ✏️ Custom Topic
                  </button>
                </div>

                {inputMode === "module" ? (
                  <DropdownSelect
                    options={moduleOptions}
                    value={selectedModuleId}
                    onChange={setSelectedModuleId}
                    placeholder="Select a module…"
                    disabled={!selectedSubjectId}
                  />
                ) : (
                  <div className="space-y-1">
                    <Input
                      placeholder="e.g. Rankine Cycle, Organic Reactions…"
                      value={customTopic}
                      onChange={(e) => setCustomTopic(e.target.value)}
                    />
                    <p className="text-muted-foreground text-xs">
                      AI will use your subject syllabus as the knowledge base
                    </p>
                  </div>
                )}
              </div>

              {/* Depth 3-segment control */}
              <div className="px-5 py-4 space-y-2">
                <Label>Depth</Label>
                <DepthSelector value={depth} onChange={setDepth} />
              </div>

              {/* Collapsed "what gets generated" info line */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowWhat((p) => !p)}
                  className="flex w-full items-center justify-between px-5 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="text-left">
                    Generates: title slide, concept slides, diagrams, worked
                    examples, practice questions, summary
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 ml-2 transition-transform duration-200",
                      showWhat && "rotate-180"
                    )}
                  />
                </button>
                {showWhat && (
                  <div className="px-5 pb-4 pt-2 border-t">
                    <div className="grid grid-cols-2 gap-1.5 text-sm text-muted-foreground">
                      {[
                        "Title & overview",
                        "Concept slides",
                        "SVG diagrams",
                        "Worked examples",
                        "Practice questions",
                        "Summary slide",
                      ].map((item) => (
                        <div key={item} className="flex items-center gap-1.5">
                          <span className="text-green-600">✓</span>
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* University logo inline checkbox */}
              {logoUrl && (
                <div className="px-5 py-3 flex items-center gap-2.5">
                  <Checkbox
                    id="add-logo"
                    checked={addLogo}
                    onCheckedChange={(c) => setAddLogo(Boolean(c))}
                  />
                  <Label
                    htmlFor="add-logo"
                    className="cursor-pointer text-sm font-normal"
                  >
                    Add university logo to title slide
                  </Label>
                </div>
              )}
            </div>

            <Button
              className={cn(
                "w-full h-11 text-base",
                canGenerate
                  ? "bg-primary text-primary-foreground shadow hover:bg-primary/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed opacity-50"
              )}
              size="lg"
              disabled={!canGenerate}
              onClick={handleGenerate}
            >
              Generate Presentation
            </Button>
          </div>

          {/* Context column — visible only on xl+ viewports */}
          <div className="hidden xl:flex flex-col gap-4">
            {recentGeneration && (
              <div className="rounded-xl border bg-card shadow-sm p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Last Generated
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowPanel(true)}
                    className="text-xs text-primary hover:underline"
                  >
                    View all
                  </button>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium leading-tight line-clamp-2">
                    {recentGeneration.title}
                  </p>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                    {recentGeneration.subject && (
                      <span>{recentGeneration.subject}</span>
                    )}
                    {recentGeneration.slideCount != null && (
                      <>
                        <span>·</span>
                        <span>{recentGeneration.slideCount} slides</span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(recentGeneration.created_at).toLocaleDateString(
                      undefined,
                      { month: "short", day: "numeric", year: "numeric" }
                    )}
                  </p>
                </div>
                <Link
                  href={`/faculty/generate/refine/${recentGeneration.id}`}
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <Wand2 className="size-3" />
                  Open in Refine
                </Link>
              </div>
            )}

            <div className="rounded-xl border bg-card shadow-sm p-4 space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Tips
              </p>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <span className="text-primary shrink-0 mt-0.5">•</span>
                  <span>
                    <strong className="text-foreground font-medium">
                      Intermediate
                    </strong>{" "}
                    depth covers full derivations — best for lecture slides and
                    exam prep.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary shrink-0 mt-0.5">•</span>
                  <span>
                    Use{" "}
                    <strong className="text-foreground font-medium">
                      Module
                    </strong>{" "}
                    for full topic scope;{" "}
                    <strong className="text-foreground font-medium">
                      Custom Topic
                    </strong>{" "}
                    for a focused deep-dive within a subject.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary shrink-0 mt-0.5">•</span>
                  <span>
                    Diagram slides use{" "}
                    <strong className="text-foreground font-medium">SVG</strong>{" "}
                    and render natively in PowerPoint — no image exports needed.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary shrink-0 mt-0.5">•</span>
                  <span>
                    Content is grounded in your{" "}
                    <strong className="text-foreground font-medium">
                      uploaded syllabus
                    </strong>{" "}
                    — off-syllabus topics are automatically constrained.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <MyGenerationsPanel
          open={showPanel}
          onClose={() => setShowPanel(false)}
        />
      </>
    );
  }

  // ──── VIEW: generating ─────────────────────────────────────────────────────
  if (view === "generating") {
    const doneCount = slideChecklist.filter((s) => s.done).length;
    const totalCount = slideChecklist.length;

    return (
      <>
        {pageHeader}

        <div className="max-w-xl">
          <div className="rounded-xl border bg-card shadow-sm px-6 py-6 space-y-6">
            <div>
              <h2 className="text-base font-semibold">
                Generating your presentation
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                This usually takes a few minutes. Keep this tab open.
              </p>
            </div>

            <Progress value={progress} className="h-1.5" />

            {/* Pipeline stage list */}
            <div className="space-y-2.5">
              {PIPELINE_STAGES.map((stage) => {
                const status = stageStatuses[stage.id];
                return (
                  <div key={stage.id} className="flex items-center gap-2.5">
                    <StageIcon status={status} />
                    <span
                      className={cn(
                        "text-sm transition-colors",
                        status === "active" && "text-foreground font-medium",
                        status === "done" && "text-muted-foreground line-through",
                        status === "pending" && "text-muted-foreground/60",
                        status === "error" && "text-destructive"
                      )}
                    >
                      {stage.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Slide checklist — appears once outline resolves */}
            {slideChecklist.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Slides
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {doneCount} / {totalCount}
                  </p>
                </div>
                <div className="rounded-lg border divide-y max-h-52 overflow-y-auto">
                  {slideChecklist.map((slide) => (
                    <div
                      key={slide.index}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 text-xs transition-colors",
                        slide.done ? "text-muted-foreground" : "text-foreground"
                      )}
                    >
                      {slide.done ? (
                        <CheckCircle2 className="size-3 text-green-500 shrink-0" />
                      ) : (
                        <Circle className="size-3 text-muted-foreground/30 shrink-0" />
                      )}
                      <span
                        className={cn(
                          "truncate",
                          slide.done && "line-through"
                        )}
                      >
                        {slide.title}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <MyGenerationsPanel
          open={showPanel}
          onClose={() => setShowPanel(false)}
        />
      </>
    );
  }

  // ──── VIEW: done ───────────────────────────────────────────────────────────
  if (view === "done" && result) {
    return (
      <>
        {pageHeader}

        <div className="w-full max-w-xl space-y-5">
          <div className="rounded-xl border bg-card shadow-sm px-6 py-6 space-y-5">
            <div className="flex items-start gap-3">
              <CheckCircle className="size-6 text-green-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h2 className="font-semibold leading-tight">{result.title}</h2>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Badge variant="secondary">{result.slideCount} slides</Badge>
                  <span className="text-xs text-muted-foreground capitalize">
                    {depth}
                  </span>
                  {selectedSubjectName && (
                    <span
                      className="text-xs text-muted-foreground truncate"
                      title={selectedSubjectName}
                    >
                      · {selectedSubjectName}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <Button
              className="w-full"
              onClick={() => window.open(result.downloadUrl, "_blank")}
            >
              <Download className="size-4" />
              Download (.pptx)
            </Button>

            {result.contentId && (
              <Link
                href={`/faculty/generate/refine/${result.contentId}`}
                className="block"
              >
                <Button variant="outline" className="w-full gap-2">
                  <Wand2 className="size-4" />
                  Refine Slides
                </Button>
              </Link>
            )}

            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/50">
              <p className="text-amber-800 dark:text-amber-200 text-xs">
                💡 Diagram slides contain SVG visuals rendered directly in
                PowerPoint
              </p>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleGenerateAnother}
              >
                Generate Another
              </Button>
              <Button variant="outline" asChild className="flex-1">
                <Link href="/faculty/dashboard">Back to Dashboard</Link>
              </Button>
            </div>
          </div>

          {/* TODO: re-enable when Explainer is production-ready
          <ConceptExplainers
            slides={conceptSlides}
            subjectId={selectedSubjectId}
            moduleId={
              inputMode === "module"
                ? selectedModuleId || undefined
                : undefined
            }
          />
          */}
        </div>

        <MyGenerationsPanel
          open={showPanel}
          onClose={() => setShowPanel(false)}
        />
      </>
    );
  }

  return null;
}
