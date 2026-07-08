"use client";

import ReactMarkdown from "react-markdown";
import { RichQuestionText } from "@/components/RichQuestionText";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useFacultySubjects } from "@/hooks/useSupabaseData";
import { RefinementType, REFINEMENT_LABELS } from "@/lib/refine/generator";
import type { ExtractedDeck, ExtractedSlide, RefinedDeck, RefinedSlide, RefinementOptions, SlideType, SlideVisual } from "@/lib/ppt-refine/types";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, ArrowRight, CheckCircle, ChevronLeft, Copy,
  Download, FileUp, Loader2, Presentation, RotateCcw, Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type PptStage = "upload" | "configure" | "processing" | "results";
type ResultsFilter = "all" | "enhanced" | "new" | "unchanged";

// change_summary values that mean the slide was NOT actually enhanced — either it
// was already fine, its batch failed, or its refinement was reverted because it
// didn't fit (kept in sync with REVERT_SUMMARY / fallback messages in
// src/lib/ppt-refine/{assembler,refiner}.ts). Such slides count as "unchanged".
const NO_CHANGE_SUMMARIES = new Set<string>([
  "No changes needed.",
  "Refinement failed — original content preserved.",
  "Refined content did not fit the slide — original kept.",
]);

const isUnchangedSlide = (s: { change_summary: string; is_new: boolean }) =>
  !s.is_new && NO_CHANGE_SUMMARIES.has(s.change_summary);
const isEnhancedSlide = (s: { change_summary: string; is_new: boolean }) =>
  !s.is_new && !NO_CHANGE_SUMMARIES.has(s.change_summary);

interface ExtractionResult {
  extraction_id: string;
  extracted_deck: ExtractedDeck & { subject_context?: unknown };
  storage_path: string | null;
  original_pptx_path?: string | null;
}

interface RefineResult {
  download_url: string;
  refined_deck: RefinedDeck;
  changes_summary: string[];
  stats: { original_slides: number; refined_slides: number; new_slides_added: number };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PROCESS_MESSAGES = [
  "Expanding thin sections with relevant content…",
  "Adding real-world examples from Indian industry…",
  "Generating diagrams for complex concepts…",
  "Checking against your syllabus outcomes…",
  "Rewriting bullets for clarity and structure…",
  "Adding key exam insights to concept slides…",
  "Creating practice questions after concept slides…",
  "Building your presentation file…",
];

const TYPE_STYLES: Record<SlideType, string> = {
  title:    "bg-blue-500/20 text-blue-300 border-blue-500/30",
  overview: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  concept:  "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  diagram:  "bg-teal-500/20 text-teal-300 border-teal-500/30",
  example:  "bg-amber-500/20 text-amber-300 border-amber-500/30",
  practice: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  summary:  "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  unknown:  "bg-slate-500/20 text-slate-300 border-slate-500/30",
};

const PROCESS_STAGES = [
  { key: "analyzing", label: "Analyzing your presentation" },
  { key: "refining",  label: "Refining content" },
  { key: "visuals",   label: "Adding visuals" },
  { key: "building",  label: "Building your presentation" },
  { key: "uploading", label: "Uploading" },
] as const;

const DEFAULT_OPTIONS: RefinementOptions = {
  improve_readability:     true,
  expand_thin_sections:    false,
  add_real_world_examples: false,
  add_visuals:             false,
  add_practice_problems:   false,
  simplify_content:        false,
  add_summary_slide:       false,
  add_key_insights:        false,
  allow_new_slides:        true,
  subject_id:              null,
  target_semester:         null,
};

// ─── Small shared helpers ─────────────────────────────────────────────────────

function SlideTypeBadge({ type }: { type: SlideType }) {
  return (
    <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide", TYPE_STYLES[type])}>
      {type}
    </span>
  );
}

function OptionRow({
  icon, title, desc, enabled, onToggle, badge, children,
}: {
  icon: string; title: string; desc: string;
  enabled: boolean; onToggle: () => void;
  badge?: number; children?: React.ReactNode;
}) {
  return (
    <div className={cn(
      "rounded-lg border p-3 transition-all",
      enabled ? "border-indigo-500/40 bg-indigo-500/5" : "border-border hover:border-border/60"
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <span className="text-base mt-0.5 shrink-0">{icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{title}</span>
              {badge != null && badge > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/30">
                  {badge}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} className="shrink-0 mt-0.5" />
      </div>
      {enabled && children && <div className="mt-3 pt-3 border-t border-border/50">{children}</div>}
    </div>
  );
}

function encodeMermaid(code: string): string {
  try {
    return btoa(unescape(encodeURIComponent(code)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  } catch {
    return "";
  }
}

function SlideVisualPreview({ visual }: { visual: SlideVisual }) {
  if (visual.type === "svg" && visual.content.includes("<svg")) {
    return (
      <div className="rounded border border-border overflow-hidden bg-slate-900 p-2">
        <div
          className="max-w-full [&_svg]:max-w-full [&_svg]:h-auto"
          dangerouslySetInnerHTML={{ __html: visual.content }}
        />
        {visual.caption && <p className="text-xs text-muted-foreground mt-1 text-center">{visual.caption}</p>}
      </div>
    );
  }
  if (visual.type === "imagen" && visual.content.length >= 5120) {
    return (
      <div className="rounded border border-border overflow-hidden">
        <img src={`data:image/png;base64,${visual.content}`} alt={visual.caption || "Generated illustration"} className="max-w-full h-auto" />
        {visual.caption && <p className="text-xs text-muted-foreground p-2 text-center">{visual.caption}</p>}
      </div>
    );
  }
  if (visual.type === "mermaid" && visual.content.trim()) {
    const enc = encodeMermaid(visual.content.trim());
    if (enc) {
      return (
        <div className="rounded border border-border overflow-hidden">
          <img
            src={`https://mermaid.ink/img/${enc}?type=png&bgColor=1E293B`}
            alt={visual.caption || "Diagram"}
            className="max-w-full h-auto"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          {visual.caption && <p className="text-xs text-muted-foreground p-2 text-center">{visual.caption}</p>}
        </div>
      );
    }
  }
  // Fallback: show prompt/code
  return (
    <div className="rounded border border-border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground font-mono break-all line-clamp-3">{visual.content.slice(0, 200)}</p>
      {visual.caption && <p className="text-xs text-muted-foreground mt-1 italic">{visual.caption}</p>}
    </div>
  );
}

// ─── PPT REFINEMENT TAB ───────────────────────────────────────────────────────

function PptRefinementTab() {
  const { subjects, isLoading: subjectsLoading, error: subjectsError, refetch: refetchSubjects } = useFacultySubjects();

  // Stage machine
  const [stage, setStage] = useState<PptStage>("upload");

  // Upload stage
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Configure stage
  const [options, setOptions] = useState<RefinementOptions>(DEFAULT_OPTIONS);

  // Processing stage
  const [processStageIdx, setProcessStageIdx] = useState(0);
  const [completedStageKeys, setCompletedStageKeys] = useState<Set<string>>(new Set());
  const [progressPct, setProgressPct] = useState(0);
  const [msgIdx, setMsgIdx] = useState(0);
  const [processError, setProcessError] = useState<string | null>(null);

  // Results stage
  const [refineResult, setRefineResult] = useState<RefineResult | null>(null);
  const [resultsFilter, setResultsFilter] = useState<ResultsFilter>("all");
  const [selectedSlideIdx, setSelectedSlideIdx] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);

  // ── File selection ──

  const handleFileSelect = useCallback(async (f: File) => {
    if (!selectedSubjectId) {
      toast.error("Select a subject before uploading");
      return;
    }
    if (!f.name.toLowerCase().endsWith(".pptx")) {
      toast.error("Only .pptx files are supported");
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      toast.error("File too large — maximum is 50 MB");
      return;
    }
    setFile(f);
    setIsExtracting(true);

    try {
      const formData = new FormData();
      formData.append("file", f);
      if (selectedSubjectId) formData.append("subject_id", selectedSubjectId);

      const res = await fetch("/api/ppt-refine/extract", { method: "POST", body: formData });
      const json = await res.json();

      if (!res.ok) {
        const msg = json?.error ?? "Failed to read presentation";
        if (msg.toLowerCase().includes("corrupt") || msg.toLowerCase().includes("password")) {
          toast.error("Your file couldn't be read — it may be password-protected");
        } else {
          toast.error(msg);
        }
        setFile(null);
        setIsExtracting(false);
        return;
      }

      setExtraction(json as ExtractionResult);
      setStage("configure");
    } catch {
      toast.error("Upload failed — please check your connection and try again");
      setFile(null);
    } finally {
      setIsExtracting(false);
    }
  }, [selectedSubjectId]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }, [handleFileSelect]);

  // ── Options helpers ──

  const toggle = (key: keyof RefinementOptions) => {
    setOptions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const deck = extraction?.extracted_deck as ExtractedDeck | undefined;
  const thinCount = deck?.slides.filter((s: ExtractedSlide) => s.is_thin).length ?? 0;
  const visualCount = deck?.slides.filter((s: ExtractedSlide) => s.has_image || s.has_diagram).length ?? 0;

  const activeOptionsCount = [
    options.improve_readability, options.expand_thin_sections, options.add_real_world_examples,
    options.add_visuals, options.add_practice_problems, options.simplify_content,
    options.add_summary_slide, options.add_key_insights,
  ].filter(Boolean).length;

  // ── Refine call ──

  const handleRefine = useCallback(async () => {
    if (!extraction || !deck) return;

    setStage("processing");
    setProcessStageIdx(0);
    setCompletedStageKeys(new Set());
    setProgressPct(0);
    setProcessError(null);

    // Estimated time: ~5s per slide batch of 5 + 30s overhead
    const estSeconds = Math.max(60, Math.ceil(deck.slide_count / 5) * 12 + 30);

    // Animate progress over estimated time
    const startTime = Date.now();
    const progressInterval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const pct = Math.min(92, (elapsed / estSeconds) * 100);
      setProgressPct(pct);
      // Advance stage label based on progress
      if (pct > 15 && pct < 70) setProcessStageIdx(1);
      else if (pct >= 70 && pct < 82) setProcessStageIdx(2);
      else if (pct >= 82 && pct < 92) setProcessStageIdx(3);
    }, 500);

    // Rotate messages
    const msgInterval = setInterval(() => {
      setMsgIdx(i => (i + 1) % PROCESS_MESSAGES.length);
    }, 4000);

    try {
      const body: Record<string, unknown> = {
        extraction_id: extraction.extraction_id,
        options: { ...options, subject_id: selectedSubjectId || null },
      };
      if (extraction.original_pptx_path) {
        body.original_pptx_path = extraction.original_pptx_path;
      }
      if (extraction.storage_path) {
        body.storage_path = extraction.storage_path;
      } else {
        body.extracted_deck = extraction.extracted_deck;
      }

      const res = await fetch("/api/ppt-refine/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      clearInterval(progressInterval);
      clearInterval(msgInterval);

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const msg = (json as { error?: string }).error ?? "Refinement failed";
        if (msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("timed out")) {
          setProcessError("Refinement timed out — try with fewer options or a smaller file");
        } else if (msg.toLowerCase().includes("visual")) {
          setProcessError("Could not generate visuals — presentation saved without them");
        } else {
          setProcessError(msg);
        }
        setStage("configure");
        return;
      }

      const json = await res.json() as RefineResult;
      setProgressPct(100);
      setProcessStageIdx(4);
      setCompletedStageKeys(new Set(PROCESS_STAGES.map(s => s.key)));

      setTimeout(() => {
        setRefineResult(json);
        setSelectedSlideIdx(0);
        setResultsFilter("all");
        setStage("results");
      }, 600);

    } catch {
      clearInterval(progressInterval);
      clearInterval(msgInterval);
      setProcessError("Refinement failed — please try again");
      setStage("configure");
    }
  }, [extraction, deck, options, selectedSubjectId]);

  // ── Download ──

  const handleDownload = useCallback(() => {
    if (!refineResult?.download_url) return;
    setIsDownloading(true);
    const a = document.createElement("a");
    a.href = refineResult.download_url;
    a.download = `refined_${file?.name ?? "presentation.pptx"}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => setIsDownloading(false), 1500);
  }, [refineResult, file]);

  // ── Reset to start ──

  const resetToUpload = () => {
    setStage("upload");
    setFile(null);
    setExtraction(null);
    setRefineResult(null);
    setProcessError(null);
    setOptions(DEFAULT_OPTIONS);
  };

  // ── Results filter ──

  const filteredSlides = useMemo(() => {
    if (!refineResult) return [];
    const slides = refineResult.refined_deck.slides;
    switch (resultsFilter) {
      case "enhanced": return slides.filter(isEnhancedSlide);
      case "new":      return slides.filter(s => s.is_new);
      case "unchanged":return slides.filter(isUnchangedSlide);
      default:         return slides;
    }
  }, [refineResult, resultsFilter]);

  const selectedSlide = filteredSlides[Math.min(selectedSlideIdx, Math.max(0, filteredSlides.length - 1))];

  // ════════════════════════════════════════════════════════
  // STAGE 1: UPLOAD
  // ════════════════════════════════════════════════════════

  if (stage === "upload") {
    return (
      <div className="space-y-6">
        {processError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
            {processError}
          </div>
        )}

        {/* Step 1 — Subject selector */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">1. Link to a Subject <span className="text-red-400 font-normal">(required)</span></CardTitle>
            <CardDescription className="text-xs">Required for syllabus-aware refinement and so this presentation appears in your history</CardDescription>
          </CardHeader>
          <CardContent>
            {subjectsError ? (
              <div className="flex items-center justify-between gap-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                <span>Couldn&apos;t load your subjects — {subjectsError}</span>
                <button onClick={refetchSubjects} className="shrink-0 text-xs underline hover:text-red-300">Retry</button>
              </div>
            ) : subjectsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading subjects…
              </div>
            ) : subjects.length === 0 ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
                No subjects assigned — contact your admin to get a subject assigned before refining presentations.
              </div>
            ) : (
              <Select value={selectedSubjectId} onValueChange={setSelectedSubjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a subject…" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.code} — {s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        {/* Step 2 — Drop zone */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">2. Upload your presentation</p>
          <div
            className={cn(
              "flex flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all min-h-[280px] px-8",
              !selectedSubjectId
                ? "border-border bg-muted/10 cursor-not-allowed opacity-60"
                : cn(
                    "cursor-pointer",
                    isDragging
                      ? "border-indigo-400 bg-indigo-500/10"
                      : isExtracting
                      ? "border-border bg-muted/20 cursor-wait"
                      : "border-border hover:border-indigo-400/60 hover:bg-muted/10"
                  )
            )}
            onDragOver={e => { e.preventDefault(); if (selectedSubjectId) setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => { if (selectedSubjectId) handleDrop(e); else e.preventDefault(); }}
            onClick={() => selectedSubjectId && !isExtracting && fileInputRef.current?.click()}
            role="button"
            tabIndex={selectedSubjectId ? 0 : -1}
            aria-disabled={!selectedSubjectId}
            onKeyDown={e => e.key === "Enter" && selectedSubjectId && !isExtracting && fileInputRef.current?.click()}
            aria-label="Upload PPTX file"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pptx"
              className="hidden"
              disabled={!selectedSubjectId}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
            />

            {!selectedSubjectId ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="rounded-full bg-muted p-4 border border-border">
                  <Presentation className="size-8 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">Select a subject to continue</p>
              </div>
            ) : isExtracting ? (
              <div className="flex flex-col items-center gap-4 text-center">
                <Loader2 className="size-10 text-indigo-400 animate-spin" />
                <div>
                  <p className="text-base font-medium text-foreground">Reading your presentation…</p>
                  <p className="text-sm text-muted-foreground mt-1">Extracting {file?.name ?? "slides"}</p>
                </div>
                {/* Skeleton rows */}
                <div className="flex flex-col gap-2 w-64 mt-2">
                  {[70, 50, 80, 45].map((w, i) => (
                    <div key={i} className="h-3 rounded-full bg-muted/50 animate-pulse" style={{ width: `${w}%` }} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="rounded-full bg-indigo-500/10 p-4 border border-indigo-500/20">
                  <Presentation className="size-8 text-indigo-400" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-foreground">Drop your presentation here</p>
                  <p className="text-sm text-muted-foreground mt-1">or click to browse — .pptx files only, max 50 MB</p>
                </div>
                <Button variant="outline" size="sm" className="mt-2" tabIndex={-1}>
                  <FileUp className="size-4" />
                  Choose File
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  // STAGE 2: CONFIGURE
  // ════════════════════════════════════════════════════════

  if (stage === "configure" && deck) {
    return (
      <div className="flex flex-col gap-0">
        {processError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400 flex items-center gap-2">
            <span className="shrink-0">⚠️</span>{processError}
            <button onClick={() => setProcessError(null)} className="ml-auto text-xs underline">dismiss</button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,40%)_minmax(0,60%)] gap-6 pb-20">

          {/* ── Left: Deck overview ── */}
          <div className="space-y-4 min-w-0">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="min-w-0">
                    <CardTitle
                      className="text-sm font-medium truncate"
                      title={file?.name ?? deck.file_name}
                    >
                      {file?.name ?? deck.file_name}
                    </CardTitle>
                    <CardDescription className="text-xs mt-0.5">{deck.detected_topic}</CardDescription>
                  </div>
                  <button
                    onClick={resetToUpload}
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    Change file
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Badge variant="secondary" className="text-xs">{deck.slide_count} slides</Badge>
                  <Badge variant="secondary" className={cn("text-xs capitalize", {
                    "bg-green-500/20 text-green-400 border-green-500/30": deck.detected_level === "basic",
                    "bg-amber-500/20 text-amber-400 border-amber-500/30": deck.detected_level === "intermediate",
                    "bg-red-500/20 text-red-400 border-red-500/30": deck.detected_level === "advanced",
                  })}>
                    {deck.detected_level}
                  </Badge>
                  {thinCount > 0 && (
                    <Badge className="text-xs bg-amber-500/20 text-amber-400 border-amber-500/30">
                      {thinCount} thin
                    </Badge>
                  )}
                  {visualCount > 0 && (
                    <Badge className="text-xs bg-teal-500/20 text-teal-400 border-teal-500/30">
                      {visualCount} visuals
                    </Badge>
                  )}
                </div>
              </CardHeader>
            </Card>

            {/* Slide list */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Slide Overview</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[340px]">
                  <div className="px-4 pb-4 space-y-1">
                    {deck.slides.map((s: ExtractedSlide) => (
                      <div
                        key={s.index}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 border-l-2 transition-colors",
                          s.is_thin ? "border-amber-500/60 bg-amber-500/5" : "border-transparent hover:bg-muted/30"
                        )}
                      >
                        <span className="text-[10px] text-muted-foreground w-5 shrink-0 text-right">{s.index + 1}</span>
                        <SlideTypeBadge type={s.type} />
                        <span className="text-xs text-foreground truncate flex-1">{s.title}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {s.is_thin && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">Thin</span>}
                          <span className="text-[10px] text-muted-foreground">{s.word_count}w</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* ── Right: Options ── */}
          <div className="space-y-5">

            {/* Content Quality */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">Content Quality</h3>
              <div className="space-y-2">
                <OptionRow icon="✦" title="Improve Readability" desc="Clearer language, better structure, parallel bullets" enabled={options.improve_readability} onToggle={() => toggle("improve_readability")} />
                <OptionRow icon="⟳" title="Expand Thin Sections" desc={thinCount > 0 ? `${thinCount} slide${thinCount !== 1 ? "s" : ""} need more content` : "Add depth to under-explained slides"} badge={thinCount} enabled={options.expand_thin_sections} onToggle={() => toggle("expand_thin_sections")} />
                <OptionRow icon="◈" title="Add Key Insights" desc="Exam-critical takeaways appended to concept slides" enabled={options.add_key_insights} onToggle={() => toggle("add_key_insights")} />
              </div>
            </div>

            {/* Examples & Context */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">Examples & Context</h3>
              <div className="space-y-2">
                <OptionRow icon="◉" title="Real-World Examples" desc="Indian industry applications — ISRO, Tata, Infosys, L&T and more" enabled={options.add_real_world_examples} onToggle={() => toggle("add_real_world_examples")} />
                <OptionRow icon="◎" title="Practice Problems" desc="Auto-generated practice question after each concept slide" enabled={options.add_practice_problems} onToggle={() => toggle("add_practice_problems")} />
              </div>
            </div>

            {/* Visual Enhancement */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">Visual Enhancement</h3>
              <OptionRow icon="◈" title="Add Visuals" desc="SVG diagrams, flowcharts, and illustrations for concept slides" enabled={options.add_visuals} onToggle={() => toggle("add_visuals")}>
                <p className="text-xs text-muted-foreground">Generates the best visual type: flowchart, SVG diagram, or illustration</p>
              </OptionRow>
            </div>

            {/* Structure */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">Structure</h3>
              <div className="space-y-2">
                <OptionRow icon="∑" title="Add / Update Summary Slide" desc="Generate or enhance a summary slide at the end" enabled={options.add_summary_slide} onToggle={() => toggle("add_summary_slide")} />
                <OptionRow icon="⊕" title="Allow Adding New Slides" desc="Thin sections or practice questions may become new slides" enabled={options.allow_new_slides} onToggle={() => toggle("allow_new_slides")} />
                <OptionRow icon="▼" title="Simplify for Semester" desc="Adapt language and depth for lower-semester students" enabled={options.simplify_content} onToggle={() => toggle("simplify_content")}>
                  <div className="flex items-center gap-3">
                    <Label className="text-xs shrink-0">Target Semester</Label>
                    <Select
                      value={String(options.target_semester ?? 3)}
                      onValueChange={v => setOptions(prev => ({ ...prev, target_semester: Number(v) }))}
                    >
                      <SelectTrigger className="h-8 w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                          <SelectItem key={n} value={String(n)}>Semester {n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </OptionRow>
              </div>
            </div>
          </div>
        </div>

        {/* Sticky bottom bar */}
        <div className="fixed bottom-0 left-64 right-0 z-10 border-t bg-background/95 backdrop-blur px-6 py-3 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {activeOptionsCount === 0
              ? "Select at least one option to refine"
              : `${activeOptionsCount} option${activeOptionsCount !== 1 ? "s" : ""} selected`}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={resetToUpload}>
              <ChevronLeft className="size-4" /> Back
            </Button>
            <Button
              size="sm"
              disabled={activeOptionsCount === 0}
              onClick={handleRefine}
              className="bg-indigo-600 hover:bg-indigo-700 text-white min-w-[180px]"
            >
              <Sparkles className="size-4" />
              Refine Presentation
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  // STAGE 3: PROCESSING
  // ════════════════════════════════════════════════════════

  if (stage === "processing") {
    const estMin = Math.max(1, Math.ceil((deck?.slide_count ?? 10) / 10));
    const currentStageLabel = PROCESS_STAGES[processStageIdx]?.label ?? "Processing";

    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] py-12">
        <div className="w-full max-w-lg space-y-8">

          {/* Central message */}
          <div className="text-center space-y-2">
            <div className="inline-flex rounded-full bg-indigo-500/10 border border-indigo-500/20 p-4 mb-2">
              <Sparkles className="size-8 text-indigo-400 animate-pulse" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">Enhancing your presentation…</h2>
            <p className="text-sm text-muted-foreground min-h-[1.25rem] transition-all">{PROCESS_MESSAGES[msgIdx]}</p>
          </div>

          {/* Progress bar */}
          <div className="space-y-2">
            <Progress value={progressPct} className="h-2 bg-muted" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{currentStageLabel}</span>
              <span>~{estMin} min for {deck?.slide_count ?? "?"} slides</span>
            </div>
          </div>

          {/* Stages list */}
          <div className="space-y-2 rounded-xl border border-border bg-card/60 p-4">
            {PROCESS_STAGES.map((s, i) => {
              const isDone = completedStageKeys.has(s.key) || i < processStageIdx;
              const isActive = i === processStageIdx;
              return (
                <div key={s.key} className="flex items-center gap-3">
                  <div className={cn(
                    "size-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
                    isDone  ? "border-emerald-500 bg-emerald-500"
                            : isActive ? "border-indigo-400 bg-indigo-400/20 animate-pulse"
                            : "border-border bg-transparent"
                  )}>
                    {isDone && <CheckCircle className="size-3 text-white" />}
                  </div>
                  <span className={cn(
                    "text-sm transition-colors",
                    isDone ? "text-emerald-400 line-through" : isActive ? "text-foreground font-medium" : "text-muted-foreground"
                  )}>
                    {s.label}
                    {isActive && s.key === "refining" && deck && (
                      <span className="text-xs text-muted-foreground ml-2">
                        ({Math.ceil(deck.slide_count / 5)} batch{Math.ceil(deck.slide_count / 5) !== 1 ? "es" : ""})
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  // STAGE 4: RESULTS
  // ════════════════════════════════════════════════════════

  if (stage === "results" && refineResult) {
    const { stats, refined_deck } = refineResult;

    const filterCounts = {
      all:       refined_deck.slides.length,
      enhanced:  refined_deck.slides.filter(isEnhancedSlide).length,
      new:       refined_deck.slides.filter(s => s.is_new).length,
      unchanged: refined_deck.slides.filter(isUnchangedSlide).length,
    };

    const estSizeKb = Math.round(stats.refined_slides * 55);

    return (
      <div className="flex flex-col gap-0 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,35%)_minmax(0,65%)] gap-6">

          {/* ── Left: Changes summary ── */}
          <div className="space-y-4 min-w-0">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="size-5 text-emerald-400" />
                <h2 className="text-base font-semibold">Your presentation is ready</h2>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-muted px-2 py-1">{stats.original_slides} → {stats.refined_slides} slides</span>
                {stats.new_slides_added > 0 && <span className="rounded-full bg-emerald-500/15 text-emerald-400 px-2 py-1">{stats.new_slides_added} new</span>}
                <span className="rounded-full bg-muted px-2 py-1">{filterCounts.enhanced} enhanced</span>
              </div>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1 text-xs">
              {(["all", "enhanced", "new", "unchanged"] as ResultsFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => { setResultsFilter(f); setSelectedSlideIdx(0); }}
                  className={cn(
                    "px-2.5 py-1 rounded-md border capitalize transition-colors",
                    resultsFilter === f
                      ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
                  )}
                >
                  {f} <span className="ml-1 opacity-60">({filterCounts[f]})</span>
                </button>
              ))}
            </div>

            {/* Slide list */}
            <ScrollArea className="h-[calc(100vh-380px)] min-h-[300px] rounded-lg border border-border">
              <div className="p-2 space-y-1">
                {filteredSlides.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No slides in this category</p>
                ) : filteredSlides.map((s, i) => (
                  <button
                    key={`${s.index}-${i}`}
                    onClick={() => setSelectedSlideIdx(i)}
                    className={cn(
                      "w-full text-left rounded-md px-2 py-2 border-l-2 transition-colors",
                      i === selectedSlideIdx
                        ? "bg-indigo-500/10 border-indigo-500"
                        : s.is_new
                        ? "border-emerald-500/40 hover:bg-muted/30"
                        : "border-transparent hover:bg-muted/20"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] text-muted-foreground w-5 shrink-0 text-right">{s.index + 1}</span>
                      <SlideTypeBadge type={s.type} />
                      <span className="text-xs font-medium truncate flex-1"><RichQuestionText text={s.refined_title} /></span>
                      {s.is_new && <span className="text-[9px] text-emerald-400 shrink-0">✦</span>}
                    </div>
                    {s.change_summary && s.change_summary !== "No changes needed." && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 pl-7 line-clamp-1">{s.change_summary}</p>
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* ── Right: Slide preview ── */}
          <div className="space-y-4">
            {selectedSlide ? (
              <>
                {/* Navigation */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <SlideTypeBadge type={selectedSlide.type} />
                    <span className="text-xs text-muted-foreground">Slide {selectedSlide.index + 1}</span>
                    {selectedSlide.is_new && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-medium">✦ New slide</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => setSelectedSlideIdx(i => Math.max(0, i - 1))} disabled={selectedSlideIdx === 0}>
                      <ArrowLeft className="size-3.5" />
                    </Button>
                    <span className="text-xs text-muted-foreground px-1">{selectedSlideIdx + 1} / {filteredSlides.length}</span>
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => setSelectedSlideIdx(i => Math.min(filteredSlides.length - 1, i + 1))} disabled={selectedSlideIdx >= filteredSlides.length - 1}>
                      <ArrowRight className="size-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Slide content card */}
                <Card className="overflow-hidden">
                  <CardHeader className="pb-3 bg-indigo-500/5 border-b border-border">
                    <CardTitle className="text-base font-semibold"><RichQuestionText text={selectedSlide.refined_title} /></CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 space-y-4">
                    {/* Body bullets */}
                    {selectedSlide.refined_body.length > 0 && (
                      <ul className="space-y-1.5">
                        {selectedSlide.refined_body.map((bullet, i) => {
                          const isInsight = /^key insight:/i.test(bullet.trim());
                          if (isInsight) return null; // rendered separately
                          return (
                            <li key={i} className="flex items-start gap-2 text-sm">
                              <span className="mt-1.5 size-1.5 rounded-full bg-indigo-400/60 shrink-0" />
                              <span className="text-foreground/90"><RichQuestionText text={bullet} /></span>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {/* KEY INSIGHT callout */}
                    {selectedSlide.refined_body.some(b => /^key insight:/i.test(b.trim())) && (
                      <div className="rounded-lg bg-indigo-500/10 border border-indigo-500/30 p-3">
                        <p className="text-xs font-bold text-indigo-300 uppercase tracking-wide mb-1">💡 Key Insight</p>
                        <p className="text-sm text-foreground/90">
                          <RichQuestionText text={selectedSlide.refined_body.find(b => /^key insight:/i.test(b.trim()))?.replace(/^key insight:\s*/i, "") ?? ""} />
                        </p>
                      </div>
                    )}

                    {/* Visual preview */}
                    {selectedSlide.visual && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Visual</p>
                        <SlideVisualPreview visual={selectedSlide.visual} />
                      </div>
                    )}

                    {/* Change summary */}
                    {selectedSlide.change_summary && selectedSlide.change_summary !== "No changes needed." && (
                      <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
                        <p className="text-xs font-medium text-amber-400 mb-0.5">What changed</p>
                        <p className="text-xs text-foreground/80">{selectedSlide.change_summary}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            ) : (
              <div className="flex items-center justify-center h-48 rounded-lg border border-dashed border-border text-muted-foreground text-sm">
                Select a slide to preview
              </div>
            )}
          </div>
        </div>

        {/* Sticky bottom bar */}
        <div className="fixed bottom-0 left-64 right-0 z-10 border-t bg-background/95 backdrop-blur px-6 py-3 flex items-center justify-between gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStage("configure")}
          >
            <ChevronLeft className="size-4" />
            Refine Again with Different Options
          </Button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">~{estSizeKb > 1024 ? `${(estSizeKb / 1024).toFixed(1)} MB` : `${estSizeKb} KB`}</span>
            <Button
              size="sm"
              onClick={handleDownload}
              disabled={isDownloading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[200px]"
            >
              {isDownloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Download Presentation
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ─── TEXT REFINEMENT TAB (existing functionality preserved exactly) ───────────

const REFINEMENT_META: Record<RefinementType, { icon: string; title: string; desc: string }> = {
  readability: { icon: "✨", title: "Improve Readability", desc: "Clearer structure and simpler language" },
  examples:    { icon: "🌍", title: "Real-World Examples", desc: "Modern, relatable applications added" },
  practice:    { icon: "📝", title: "Practice Problems",   desc: "Practice questions with hints added" },
  expand:      { icon: "🔍", title: "Expand Thin Sections",desc: "Add depth to under-explained parts" },
  simplify:    { icon: "🎓", title: "Simplify Content",    desc: "Adapt for lower semester students" },
};

const TARGET_SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

function TextRefineTab() {
  const { subjects } = useFacultySubjects();
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [contentToRefine, setContentToRefine] = useState("");
  const [refinementTypes, setRefinementTypes] = useState<RefinementType[]>(["readability"]);
  const [targetSemester, setTargetSemester] = useState<number>(3);
  const [isRefining, setIsRefining] = useState(false);
  const [refinedContent, setRefinedContent] = useState("");
  const [view, setView] = useState<"form" | "result">("form");
  const [charCount, setCharCount] = useState(0);

  const isGenerating = isRefining;
  const selectedSubject = subjects.find(s => s.id === selectedSubjectId);

  useEffect(() => {
    if (!isGenerating) return;
    const handlePopState = (e: PopStateEvent) => { e.preventDefault(); window.history.pushState(null, "", window.location.href); };
    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handlePopState);
    const handleBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = "Generation in progress."; return e.returnValue; };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => { window.removeEventListener("popstate", handlePopState); window.removeEventListener("beforeunload", handleBeforeUnload); };
  }, [isGenerating]);

  const toggleType = (t: RefinementType) => setRefinementTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  const onContentChange = (value: string) => { setContentToRefine(value); setCharCount(value.length); };
  const charColor = charCount > 13000 ? "text-red-600" : charCount > 10000 ? "text-amber-600" : "text-muted-foreground";
  const canRefine = !!selectedSubjectId && !!contentToRefine.trim() && refinementTypes.length > 0 && !isRefining;

  const handleRefine = async () => {
    if (!canRefine) return;
    if (!selectedSubjectId) { toast.error("Please select a subject"); return; }
    setIsRefining(true);
    try {
      const res = await fetch("/api/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId: selectedSubjectId, contentToRefine, refinementTypes, targetSemester: refinementTypes.includes("simplify") ? targetSemester : undefined }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json?.error ?? "Failed to refine content"); setIsRefining(false); return; }
      setRefinedContent(String(json.refinedContent ?? ""));
      setView("result");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to refine content");
    } finally {
      setIsRefining(false);
    }
  };

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(refinedContent); toast.success("Copied!"); }
    catch { toast.error("Failed to copy"); }
  };

  if (view === "form") {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Your Content</CardTitle>
            <CardDescription>Paste your existing notes or explanations and let AI polish them.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Subject</Label>
              <Select value={selectedSubjectId} onValueChange={setSelectedSubjectId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select subject..." /></SelectTrigger>
                <SelectContent>
                  {subjects.map(s => <SelectItem key={s.id} value={s.id}>{s.code} — {s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="content">Content to refine</Label>
              <Textarea id="content" rows={16} maxLength={15000} value={contentToRefine} onChange={e => onContentChange(e.target.value)} placeholder={"Paste your existing notes, content, or topic explanation here...\n\nTip: Copy-paste from your existing PDFs or documents"} />
              <div className="flex justify-end"><span className={cn("text-xs", charColor)}>{charCount} / 15,000 characters</span></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Refinement Options</CardTitle>
            <CardDescription>Choose what kinds of improvements you want applied.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Label className="text-sm">What should be improved? <span className="text-muted-foreground text-xs">(you can select multiple)</span></Label>
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(REFINEMENT_META) as RefinementType[]).map(key => {
                const meta = REFINEMENT_META[key];
                const selected = refinementTypes.includes(key);
                return (
                  <button key={key} type="button" onClick={() => toggleType(key)}
                    className={cn("flex flex-col items-start rounded-lg border p-3 text-left transition-colors",
                      selected ? "border-primary bg-primary/10 ring-1 ring-primary/20" : "border-border hover:border-primary/30 hover:bg-muted/40")}>
                    <div className="flex items-center gap-2"><span>{meta.icon}</span><span className="font-medium text-sm">{meta.title}</span></div>
                    <p className="text-xs text-muted-foreground mt-1">{meta.desc}</p>
                  </button>
                );
              })}
            </div>
            {refinementTypes.includes("simplify") && (
              <div className="space-y-2">
                <Label>Target Semester</Label>
                <Select value={String(targetSemester)} onValueChange={v => setTargetSemester(Number(v))}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TARGET_SEMESTERS.map(sem => <SelectItem key={sem} value={String(sem)}>Semester {sem}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>

        <Button className="w-full h-11 text-base" disabled={!canRefine} onClick={handleRefine}>
          {isRefining ? <><Sparkles className="size-4 animate-spin" />Refining your content…</> : <><Sparkles className="size-4" />Refine Content</>}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><CheckCircle className="size-6 text-green-600" /><h1 className="text-xl font-semibold">Refined Content</h1></div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" type="button" onClick={handleCopy}><Copy className="size-4" />Copy to Clipboard</Button>
          <Button variant="outline" size="sm" type="button" onClick={() => setView("form")}><RotateCcw className="size-4" />Refine Again</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {refinementTypes.map(t => <Badge key={t} variant="secondary" className="text-xs">{REFINEMENT_META[t].icon} {REFINEMENT_LABELS[t] ?? REFINEMENT_META[t].title}</Badge>)}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="h-full">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Original Content</CardTitle></CardHeader>
          <Separator />
          <CardContent className="pt-4">
            <div className="max-h-[600px] overflow-y-auto rounded border bg-muted/40 p-3 text-sm text-muted-foreground whitespace-pre-wrap">{contentToRefine}</div>
          </CardContent>
        </Card>
        <Card className="h-full">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-primary">Refined Content</CardTitle></CardHeader>
          <Separator />
          <CardContent className="pt-4">
            <div className="max-h-[600px] overflow-y-auto rounded border-l-4 border-green-500 bg-background p-3 text-sm prose prose-sm dark:prose-invert">
              <ReactMarkdown>{refinedContent}</ReactMarkdown>
            </div>
          </CardContent>
        </Card>
      </div>
      <p className="text-center text-xs text-muted-foreground">💡 Copy the refined content and paste it into your preferred editor to make further adjustments before sharing with students.</p>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function FacultyRefinePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Sparkles className="size-7 text-primary" />
        <h1 className="text-2xl font-semibold tracking-tight">Refine Content</h1>
      </div>

      <Tabs defaultValue="ppt" className="w-full">
        <TabsList className="mb-2">
          <TabsTrigger value="ppt" className="gap-1.5">
            <Presentation className="size-4" />
            PPT Refinement
          </TabsTrigger>
          <TabsTrigger value="text" className="gap-1.5">
            <Sparkles className="size-4" />
            Text Refinement
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ppt">
          <PptRefinementTab />
        </TabsContent>
        <TabsContent value="text">
          <TextRefineTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
