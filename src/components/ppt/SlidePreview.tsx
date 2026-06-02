"use client";

import { useState, useCallback, useEffect } from "react";
import { Loader2, Image as ImageIcon } from "lucide-react";
import { SVGDiagram } from "@/components/chat/SVGDiagram";
import MermaidDiagram from "@/components/chat/MermaidDiagram";
import { cn } from "@/lib/utils";

// ─── TYPES ────────────────────────────────────────────────────────────────────
// Inline so consumers in the refine flow can pass the flat slide shape returned
// by the refine route. We also tolerate a couple of legacy field names from the
// build pipeline (svgCode / mermaidCode / nested example|question) so the same
// component can preview slides freshly loaded from generated_content.

export type SlidePreviewSlide = {
  type: "concept" | "diagram" | "example" | "practice" | "title" | "overview";
  title: string;
  subtitle?: string;
  bullets?: string[];
  // Alternate field names sometimes present on stored slides
  steps?: string[];
  content?: string[] | string;
  note?: string;
  // Diagram fields (flat schema from refine route)
  svg?: string;
  mermaid?: string;
  renderHint?: "svg" | "mermaid" | "imagen" | "illustration" | "dual";
  imagenPrompt?: string;
  // Practice fields (flat schema)
  question?: string | { text?: string };
  options?: string[];
  answer?: string;
  explanation?: string;
  // Practice fields (nested under `q`, sometimes emitted by the AI)
  q?: {
    text?: string;
    question?: string;
    options?: string[];
    answer?: string;
    explanation?: string;
  };
  // Example fields (PPT generator uses nested `example` object)
  example?: { problem?: string; steps?: string[]; answer?: string };
  exampleProblem?: string;
  exampleSteps?: string[];
  exampleAnswer?: string;
  // Imagen image (base64 PNG, filled by build route)
  imageBase64?: string;
  // Legacy / nested schema fallbacks (from build pipeline)
  svgCode?: string;
  mermaidCode?: string;
  renderType?: "svg" | "mermaid" | "imagen" | "illustration" | "dual";
  diagramRenderType?: "svg" | "mermaid" | "imagen" | "illustration" | "dual";
};

type Props = {
  slide: SlidePreviewSlide;
  slideNumber: number;
  isUpdating?: boolean;
  contentId?: string;
  slideIndex?: number;
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getQuestionText(slide: SlidePreviewSlide): string {
  if (typeof slide.question === "string") return slide.question;
  if (slide.question && typeof slide.question === "object") {
    return slide.question.text ?? "";
  }
  return "";
}

const OPTION_LABELS = ["A", "B", "C", "D", "E", "F"];

// ─── NORMALIZATION ────────────────────────────────────────────────────────────
// Slides arrive from three places with subtly different schemas (build pipeline
// uses `svgCode`/`mermaidCode`/nested `example|q`; refine route returns flat
// `svg`/`mermaid`/`question`; legacy decks mix the two). This helper produces
// a single canonical shape the renderer can rely on.

function normalizeSlide(raw: Record<string, unknown>): SlidePreviewSlide {
  const svg = (raw.svgCode ?? raw.svg ?? "") as string;
  const mermaid = (raw.mermaidCode ?? raw.mermaid ?? "") as string;
  const renderHint = (raw.renderType ??
    raw.diagramRenderType ??
    raw.renderHint ??
    "") as string;

  // Normalize bullets — handle nested example object
  let bullets: string[] = [];
  if (Array.isArray(raw.bullets) && raw.bullets.length > 0) {
    bullets = raw.bullets as string[];
  } else if (Array.isArray(raw.steps) && raw.steps.length > 0) {
    bullets = raw.steps as string[];
  } else if (Array.isArray(raw.content) && raw.content.length > 0) {
    bullets = raw.content as string[];
  }

  // Normalize example — PPT generator uses { example: { problem, steps, answer } }
  let exampleProblem = "";
  let exampleSteps: string[] = [];
  let exampleAnswer = "";

  if (raw.example && typeof raw.example === "object") {
    const ex = raw.example as Record<string, unknown>;
    exampleProblem = (ex.problem ?? "") as string;
    exampleSteps = Array.isArray(ex.steps) ? (ex.steps as string[]) : [];
    exampleAnswer = (ex.answer ?? "") as string;
    if (bullets.length === 0) bullets = exampleSteps;
  }

  // Normalize practice — handle flat fields, nested `question` object (PPT
  // generator), and nested `q` object (some AI outputs)
  let question = "";
  let options: string[] = [];
  let answer = "";
  let explanation = "";

  if (raw.question && typeof raw.question === "object") {
    // PPT generator schema: question: { text, options?, answer, explanation }
    const qObj = raw.question as Record<string, unknown>;
    question = ((qObj.text ?? qObj.question ?? "") as string);
    options = Array.isArray(qObj.options) ? (qObj.options as string[]) : [];
    answer = ((qObj.answer ?? "") as string);
    explanation = ((qObj.explanation ?? "") as string);
  } else if (typeof raw.question === "string") {
    question = raw.question;
  }

  // Flat fields override if present (refine route returns these)
  if (Array.isArray(raw.options) && raw.options.length > 0) {
    options = raw.options as string[];
  }
  if (typeof raw.answer === "string" && raw.answer) {
    answer = raw.answer;
  }
  if (typeof raw.explanation === "string" && raw.explanation) {
    explanation = raw.explanation;
  }

  // Also check nested `q` object (some AI outputs)
  if (raw.q && typeof raw.q === "object") {
    const q = raw.q as Record<string, unknown>;
    question = question || ((q.text ?? q.question ?? "") as string);
    options = options.length
      ? options
      : Array.isArray(q.options)
        ? (q.options as string[])
        : [];
    answer = answer || ((q.answer ?? "") as string);
    explanation = explanation || ((q.explanation ?? "") as string);
  }

  const resolvedRenderHint =
    renderHint ||
    (svg.length > 50 ? "svg" : mermaid.length > 10 ? "mermaid" : "");

  return {
    ...(raw as SlidePreviewSlide),
    type: (raw.type ?? "concept") as SlidePreviewSlide["type"],
    title: (raw.title ?? "") as string,
    svg: svg.length > 50 ? svg : undefined,
    mermaid: mermaid.length > 10 ? mermaid : undefined,
    renderHint:
      (resolvedRenderHint as SlidePreviewSlide["renderHint"]) || undefined,
    bullets: bullets.length > 0 ? bullets : undefined,
    note: (raw.note ?? "") as string,
    // example fields (flattened for renderer)
    exampleProblem: exampleProblem || undefined,
    exampleSteps: exampleSteps.length > 0 ? exampleSteps : undefined,
    exampleAnswer: exampleAnswer || undefined,
    // practice fields
    question: question || undefined,
    options: options.length > 0 ? options : undefined,
    answer: answer || undefined,
    explanation: explanation || undefined,
  };
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function SlidePreview({
  slide,
  slideNumber,
  isUpdating = false,
  contentId,
  slideIndex,
}: Props) {
  if (!slide) return null;

  // Normalize once — handles all field name variants from batch generator
  const s = normalizeSlide(slide as Record<string, unknown>);

  if (!s.type) {
    return (
      <div className="aspect-video w-full bg-slate-50 rounded-lg border flex items-center justify-center">
        <p className="text-xs text-slate-400">Slide data unavailable</p>
      </div>
    );
  }

  if (slideNumber === 16) {
    console.log(
      "[SlidePreview] full slide 16:",
      JSON.stringify(slide, null, 2)
    );
  }

  return (
    <div
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-lg border bg-white font-sans shadow-sm",
        "flex flex-col"
      )}
    >
      {s.type === "title" ? (
        <TitleSlide slide={s} />
      ) : s.type === "overview" ? (
        <OverviewSlide slide={s} slideNumber={slideNumber} />
      ) : s.type === "concept" ? (
        <ConceptSlide slide={s} slideNumber={slideNumber} />
      ) : s.type === "example" ? (
        <ExampleSlide slide={s} slideNumber={slideNumber} />
      ) : s.type === "diagram" ? (
        <DiagramSlide
          slide={s}
          slideNumber={slideNumber}
          contentId={contentId}
          slideIndex={slideIndex}
        />
      ) : s.type === "practice" ? (
        <PracticeSlide slide={s} slideNumber={slideNumber} />
      ) : (
        <ConceptSlide slide={s} slideNumber={slideNumber} />
      )}

      {isUpdating ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/70 backdrop-blur-[2px]">
          <div className="flex items-center gap-2 rounded-full border bg-white px-4 py-2 text-xs text-slate-600 shadow-md">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Updating slide...
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── TITLE ────────────────────────────────────────────────────────────────────

function TitleSlide({ slide }: { slide: SlidePreviewSlide }) {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-linear-to-br from-slate-800 to-slate-600 px-12 text-center text-white">
      <p className="mb-4 text-xs font-medium uppercase tracking-widest opacity-60">
        EduNexus AI
      </p>
      <h1 className="mb-4 text-2xl font-bold leading-tight">{slide.title}</h1>
      {slide.subtitle ? (
        <p className="text-sm opacity-75">{slide.subtitle}</p>
      ) : null}
    </div>
  );
}

// ─── HEADER BAR ───────────────────────────────────────────────────────────────

function SlideHeader({
  slide,
  slideNumber,
  tone,
}: {
  slide: SlidePreviewSlide;
  slideNumber: number;
  tone: "concept" | "example" | "diagram" | "practice";
}) {
  const toneClass = {
    concept: "bg-slate-800",
    example: "bg-emerald-700",
    diagram: "bg-violet-700",
    practice: "bg-amber-600",
  }[tone];

  return (
    <div className={cn("shrink-0 px-6 py-3 text-white", toneClass)}>
      <p className="text-[10px] uppercase tracking-widest opacity-50">
        Slide {slideNumber}
      </p>
      <h2 className="line-clamp-2 text-base font-bold leading-tight">
        {slide.title}
      </h2>
    </div>
  );
}

// ─── OVERVIEW ─────────────────────────────────────────────────────────────────

function OverviewSlide({
  slide,
  slideNumber,
}: {
  slide: SlidePreviewSlide;
  slideNumber: number;
}) {
  const raw = slide.bullets ?? slide.content;
  const bullets: string[] = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? [raw]
      : [];
  const half = Math.ceil(bullets.length / 2);
  const col1 = bullets.slice(0, half);
  const col2 = bullets.slice(half);

  return (
    <>
      <SlideHeader slide={slide} slideNumber={slideNumber} tone="concept" />
      <div className="flex flex-1 flex-col justify-between px-6 py-4">
        {bullets.length > 0 ? (
          <div className="grid grid-cols-2 gap-4">
            <ul className="space-y-2">
              {col1.map((b, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-xs leading-snug"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-700" />
                  <span className="text-slate-700">{b}</span>
                </li>
              ))}
            </ul>
            {col2.length > 0 ? (
              <ul className="space-y-2">
                {col2.map((b, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-xs leading-snug"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-700" />
                    <span className="text-slate-700">{b}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-slate-400">No bullets yet.</p>
        )}

        {slide.note ? (
          <div className="mt-auto border-t border-slate-100 pt-3">
            <p className="text-[10px] leading-snug text-slate-500">
              {slide.note}
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}

// ─── CONCEPT ──────────────────────────────────────────────────────────────────

function ConceptSlide({
  slide,
  slideNumber,
}: {
  slide: SlidePreviewSlide;
  slideNumber: number;
}) {
  const raw = slide.bullets ?? slide.content;
  const bullets: string[] = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? [raw]
      : [];
  return (
    <>
      <SlideHeader slide={slide} slideNumber={slideNumber} tone="concept" />
      <div className="flex flex-1 flex-col justify-between px-6 py-4">
        {bullets.length > 0 ? (
          <ul className="space-y-2">
            {bullets.map((b, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-xs leading-snug"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-700" />
                <span className="text-slate-700">{b}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-400">No bullets yet.</p>
        )}

        {slide.note ? (
          <div className="mt-auto border-t border-slate-100 pt-3">
            <p className="text-[10px] leading-snug text-slate-500">
              {slide.note}
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}

// ─── EXAMPLE ──────────────────────────────────────────────────────────────────

function ExampleSlide({
  slide: s,
  slideNumber,
}: {
  slide: SlidePreviewSlide;
  slideNumber: number;
}) {
  const steps: string[] = s.exampleSteps ?? s.bullets ?? [];
  return (
    <>
      <SlideHeader slide={s} slideNumber={slideNumber} tone="example" />
      <div className="flex flex-1 flex-col gap-3 px-6 py-4">
        {s.exampleProblem ? (
          <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2">
            <p className="text-[11px] font-semibold text-emerald-800">
              Problem: {s.exampleProblem}
            </p>
          </div>
        ) : null}

        {steps.length > 0 ? (
          <ol className="space-y-1.5">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700">
                  {i + 1}
                </span>
                <span className="leading-snug text-slate-700">{step}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs italic text-slate-400">No steps available.</p>
        )}

        {s.exampleAnswer ? (
          <div className="mt-auto border-t border-emerald-100 pt-2">
            <p className="text-[11px] font-medium text-emerald-700">
              ✓ {s.exampleAnswer}
            </p>
          </div>
        ) : null}

        {s.note ? (
          <div className="mt-auto border-t border-slate-100 pt-3">
            <p className="text-[10px] leading-snug text-slate-500">
              {s.note}
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}

// ─── DIAGRAM ──────────────────────────────────────────────────────────────────

function DiagramSlide({
  slide,
  slideNumber,
  contentId,
  slideIndex,
}: {
  slide: SlidePreviewSlide;
  slideNumber: number;
  contentId?: string;
  slideIndex?: number;
}) {
  const [loadedImage, setLoadedImage] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  useEffect(() => {
    setLoadedImage(null);
    setImageError(null);
  }, [slideIndex]);

  const isImagen =
    slide.renderHint === "imagen" &&
    !slide.svg &&
    !slide.mermaid;

  // The slide may already have imageBase64 baked in from the build pipeline
  const inlineImage = slide.imageBase64 ?? null;
  const displayImage = loadedImage ?? inlineImage;

  const loadImage = useCallback(async () => {
    if (!contentId || slideIndex == null) return;
    setImageLoading(true);
    setImageError(null);
    try {
      const res = await fetch(
        `/api/generate/ppt/image/${contentId}/${slideIndex}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImageError(
          typeof data?.error === "string" ? data.error : "Failed to load image"
        );
        return;
      }
      setLoadedImage(data.imageBase64);
    } catch {
      setImageError("Network error");
    } finally {
      setImageLoading(false);
    }
  }, [contentId, slideIndex]);

  return (
    <>
      <SlideHeader slide={slide} slideNumber={slideNumber} tone="diagram" />
      <div className="flex flex-1 items-center justify-center bg-slate-50 px-4 py-3">
        {slide.svg ? (
          <div className="flex max-h-[180px] w-full items-center justify-center overflow-hidden [&_svg]:max-h-[180px] [&_svg]:w-auto [&>div]:my-0 [&>div]:border-0 [&>div]:bg-transparent [&>div]:p-0">
            <SVGDiagram svgCode={slide.svg} />
          </div>
        ) : slide.mermaid ? (
          <div className="flex max-h-[180px] w-full items-center justify-center overflow-hidden [&_svg]:max-h-[180px] [&_svg]:w-auto [&>div]:my-0 [&>div]:border-0 [&>div]:bg-transparent [&>div]:p-0">
            <MermaidDiagram chart={slide.mermaid} />
          </div>
        ) : isImagen && displayImage ? (
          <img
            src={`data:image/png;base64,${displayImage}`}
            alt={slide.title}
            className="max-h-[180px] w-auto rounded object-contain"
          />
        ) : isImagen ? (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            {imageLoading ? (
              <>
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-[10px]">Loading image...</p>
              </>
            ) : imageError ? (
              <>
                <ImageIcon className="h-8 w-8" />
                <p className="text-center text-[10px] text-red-400">
                  {imageError}
                </p>
                <button
                  type="button"
                  onClick={loadImage}
                  className="mt-1 rounded-full border px-3 py-1 text-[10px] text-slate-500 transition hover:bg-white"
                >
                  Retry
                </button>
              </>
            ) : contentId && slideIndex != null ? (
              <>
                <ImageIcon className="h-8 w-8" />
                <button
                  type="button"
                  onClick={loadImage}
                  className="rounded-full border bg-white px-3 py-1 text-[10px] text-violet-600 shadow-sm transition hover:bg-violet-50"
                >
                  Load image
                </button>
              </>
            ) : (
              <>
                <ImageIcon className="h-8 w-8" />
                <p className="text-center text-[10px]">
                  AI-generated image
                  <br />
                  visible after rebuild
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <ImageIcon className="h-8 w-8" />
            <p className="text-center text-[10px]">No diagram yet</p>
          </div>
        )}
      </div>
      {isImagen && slide.imagenPrompt && !displayImage ? (
        <div className="shrink-0 border-t bg-amber-50 px-6 py-1.5">
          <p className="text-[10px] text-amber-600">
            Image will update on rebuild
          </p>
        </div>
      ) : null}
      {slide.note ? (
        <div className="shrink-0 border-t bg-white px-6 py-2">
          <p className="text-[10px] text-slate-500">{slide.note}</p>
        </div>
      ) : null}
    </>
  );
}

// ─── PRACTICE ─────────────────────────────────────────────────────────────────

function PracticeSlide({
  slide,
  slideNumber,
}: {
  slide: SlidePreviewSlide;
  slideNumber: number;
}) {
  const question = getQuestionText(slide);
  const options = Array.isArray(slide.options) ? slide.options : [];
  return (
    <>
      <SlideHeader slide={slide} slideNumber={slideNumber} tone="practice" />
      <div className="flex flex-1 flex-col gap-3 px-6 py-4">
        {question ? (
          <p className="text-xs font-medium leading-snug text-slate-800">
            {question}
          </p>
        ) : null}

        {options.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {options.map((opt, i) => {
              const isAnswer =
                typeof slide.answer === "string" &&
                slide.answer.trim().length > 0 &&
                opt.trim() === slide.answer.trim();
              return (
                <div
                  key={i}
                  className={cn(
                    "flex items-start gap-1.5 rounded border px-2 py-1.5 text-[10px]",
                    isAnswer
                      ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                      : "border-slate-200 text-slate-700"
                  )}
                >
                  <span className="shrink-0 font-medium text-slate-500">
                    {OPTION_LABELS[i] ?? `${i + 1}`}.
                  </span>
                  <span>{opt}</span>
                </div>
              );
            })}
          </div>
        ) : null}

        {slide.explanation ? (
          <p className="mt-1 text-[10px] leading-snug text-slate-500">
            💡 {slide.explanation}
          </p>
        ) : null}
      </div>
    </>
  );
}
