"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import SlidePreview from "@/components/ppt/SlidePreview";
import { RichQuestionText } from "@/components/RichQuestionText";
import { SlideChatConsole } from "@/components/refine/SlideChatConsole";
import {
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  Trash2,
  Download,
  Loader2,
  AlertCircle,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── TYPES ────────────────────────────────────────────────────────────────────

type SlideType = "concept" | "diagram" | "example" | "practice" | "title";

type SlideContent = {
  type: SlideType;
  title: string;
  bullets?: string[];
  note?: string;
  svg?: string;
  mermaid?: string;
  renderHint?: "svg" | "mermaid" | "imagen";
  imagenPrompt?: string;
  question?: string;
  options?: string[];
  answer?: string;
  explanation?: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getSlideTypeColor(type: SlideType | string | undefined): string {
  if (!type) return "bg-gray-100 text-gray-600";
  switch (type) {
    case "concept":
      return "bg-blue-100 text-blue-700";
    case "diagram":
      return "bg-purple-100 text-purple-700";
    case "example":
      return "bg-green-100 text-green-700";
    case "practice":
      return "bg-amber-100 text-amber-700";
    case "title":
    default:
      return "bg-gray-100 text-gray-600";
  }
}

const SUGGESTIONS_BY_TYPE: Record<SlideType, string[]> = {
  concept: [
    "Simplify the bullets",
    "Add a real-world example",
    "Make the note more specific",
    "Reduce to 4 bullets",
  ],
  diagram: [
    "Regenerate the diagram",
    "Make it a flowchart instead",
    "Add labels to all elements",
  ],
  example: [
    "Add one more worked step",
    "Make the numbers easier",
    "Add units to all values",
  ],
  practice: [
    "Change to a harder question",
    "Fix the correct answer",
    "Improve the explanation",
  ],
  title: ["Make the title more specific", "Shorten the title"],
};

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function RefinePresentationPage() {
  const router = useRouter();
  const params = useParams<{ contentId: string }>();
  const contentId = params?.contentId ?? "";

  // ─── STATE ──────────────────────────────────────────────────────────────────
  const [slides, setSlides] = useState<SlideContent[]>([]);
  const [originalSlideCount, setOriginalSlideCount] = useState<number>(0);
  const [presentationTitle, setPresentationTitle] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [topic, setTopic] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedSlideIndex, setSelectedSlideIndex] = useState<number | null>(
    null
  );
  const [pendingOperation, setPendingOperation] = useState<
    "patch" | "insert" | null
  >(null);
  const [isRefining, setIsRefining] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [inputValue, setInputValue] = useState("");

  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);

  // ─── ADD MESSAGE HELPER ─────────────────────────────────────────────────────
  const addMessage = useCallback(
    (role: Message["role"], content: string, isError = false) => {
      setMessages((prev) => [...prev, { role, content, isError }]);
    },
    []
  );

  // ─── ON MOUNT: fetch content ───────────────────────────────────────────────
  useEffect(() => {
    if (!contentId) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/generate/ppt/content/${contentId}`);
        const data = await res.json().catch(() => ({}));

        if (cancelled) return;

        if (!res.ok) {
          if (res.status === 404) {
            setLoadError("Presentation not found.");
          } else if (res.status === 400) {
            setLoadError(
              typeof data?.error === "string"
                ? data.error
                : "This presentation cannot be refined."
            );
          } else {
            setLoadError(
              typeof data?.error === "string"
                ? data.error
                : "Failed to load presentation."
            );
          }
          setIsLoading(false);
          return;
        }

        const loadedSlides: SlideContent[] = (
          Array.isArray(data?.slides) ? (data.slides as SlideContent[]) : []
        ).filter(Boolean);

        setSlides(loadedSlides);
        setOriginalSlideCount(loadedSlides.length);
        if (loadedSlides.length > 0) {
          setSelectedSlideIndex(0);
        }
        setPresentationTitle(
          typeof data?.presentationTitle === "string"
            ? data.presentationTitle
            : typeof data?.title === "string"
              ? data.title
              : ""
        );
        setSubject(typeof data?.subject === "string" ? data.subject : "");
        setTopic(typeof data?.topic === "string" ? data.topic : "");
        setIsLoading(false);
      } catch {
        if (cancelled) return;
        setLoadError(
          "Failed to load presentation. Check your connection."
        );
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [contentId]);

  // ─── NAVIGATION GUARD (beforeunload) ───────────────────────────────────────
  useEffect(() => {
    if (!hasChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasChanges]);

  // ─── BACK NAV ───────────────────────────────────────────────────────────────
  const handleBack = useCallback(() => {
    if (hasChanges) {
      const ok = window.confirm(
        "You have unsaved changes. Go back without downloading?"
      );
      if (!ok) return;
    }
    router.push("/faculty/generate");
  }, [hasChanges, router]);

  // ─── SLIDE OPS ──────────────────────────────────────────────────────────────
  const moveSlide = useCallback(
    (index: number, direction: "up" | "down") => {
      if (direction === "up" && index === 0) return;
      if (direction === "down" && index === slides.length - 1) return;
      const next = [...slides];
      const target = direction === "up" ? index - 1 : index + 1;
      [next[index], next[target]] = [next[target], next[index]];
      setSlides(next);
      setSelectedSlideIndex(target);
      setHasChanges(true);
      setDownloadUrl(null);
    },
    [slides]
  );

  const deleteSlide = useCallback(
    (index: number) => {
      if (slides.length === 1) {
        addMessage("assistant", "Can't delete the only slide.", true);
        return;
      }
      const next = slides.filter((_, i) => i !== index);
      setSlides(next);
      setSelectedSlideIndex(Math.min(index, next.length - 1));
      setHasChanges(true);
      setDownloadUrl(null);
      addMessage(
        "assistant",
        `Slide ${index + 1} deleted. ${next.length} slides remaining.`
      );
    },
    [slides, addMessage]
  );

  // ─── AI REFINE ──────────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (userInput: string) => {
      const trimmed = userInput.trim();
      if (!trimmed) return;
      if (selectedSlideIndex === null) {
        addMessage(
          "assistant",
          "Select a slide first — click any slide on the left.",
          true
        );
        return;
      }

      addMessage("user", trimmed);
      setIsRefining(true);

      try {
        const opForCall = pendingOperation ?? "patch";
        // Up to 2 slide titles before and 2 after the target, for grounding.
        const neighboringSlides = [
          slides[selectedSlideIndex - 2],
          slides[selectedSlideIndex - 1],
          slides[selectedSlideIndex + 1],
          slides[selectedSlideIndex + 2],
        ]
          .filter(Boolean)
          .map((s) => s.title)
          .filter((t): t is string => Boolean(t));
        const res = await fetch("/api/generate/ppt/refine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: opForCall,
            slideIndex: selectedSlideIndex,
            instruction: trimmed,
            currentSlide:
              opForCall === "insert" ? undefined : slides[selectedSlideIndex],
            subjectName: subject || presentationTitle,
            topic,
            neighboringSlides,
            depth: "intermediate",
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const errMsg =
            typeof data?.error === "string" ? data.error : "";
          if (
            errMsg.includes("fetch failed") ||
            errMsg.includes("network") ||
            errMsg.includes("GoogleGenerativeAI")
          ) {
            addMessage(
              "assistant",
              "AI service is temporarily unreachable. Wait a moment and try again.",
              true
            );
          } else if (res.status === 401) {
            addMessage(
              "assistant",
              "Your session expired. Please refresh the page and try again.",
              true
            );
          } else {
            addMessage(
              "assistant",
              errMsg || "Could not apply that change. Try rephrasing.",
              true
            );
          }
          return;
        }

        if (data.operation === "patch") {
          const next = [...slides];
          next[data.slideIndex] = data.patchedSlide as SlideContent;
          setSlides(next);
          setSelectedSlideIndex(data.slideIndex);
          addMessage("assistant", `Slide ${data.slideIndex + 1} updated.`);
        } else if (data.operation === "insert") {
          const next = [...slides];
          next.splice(
            data.insertAfterIndex + 1,
            0,
            data.newSlide as SlideContent
          );
          setSlides(next);
          setSelectedSlideIndex(data.insertAfterIndex + 1);
          addMessage(
            "assistant",
            `New slide added at position ${data.insertAfterIndex + 2}.`
          );
        }

        setHasChanges(true);
        setDownloadUrl(null);
        setPendingOperation(null);
        setInputValue("");
      } catch {
        addMessage(
          "assistant",
          "Network error — check your connection and try again.",
          true
        );
      } finally {
        setIsRefining(false);
      }
    },
    [
      selectedSlideIndex,
      pendingOperation,
      slides,
      subject,
      presentationTitle,
      topic,
      addMessage,
    ]
  );

  // ─── REBUILD ────────────────────────────────────────────────────────────────
  const rebuildPresentation = useCallback(async () => {
    setIsRebuilding(true);
    try {
      const res = await fetch("/api/generate/ppt/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentId,
          slides,
          presentationTitle,
          subject,
          topic,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Rebuild failed"
        );
      }
      setDownloadUrl(
        typeof data?.downloadUrl === "string" ? data.downloadUrl : null
      );
      setHasChanges(false);
      addMessage(
        "assistant",
        `Presentation rebuilt — ${data.slideCount ?? slides.length} slides ready to download.`
      );
    } catch {
      addMessage("assistant", "Rebuild failed. Try again.", true);
    } finally {
      setIsRebuilding(false);
    }
  }, [contentId, slides, presentationTitle, subject, topic, addMessage]);

  // ─── INSERT REQUEST FROM SLIDE LIST ────────────────────────────────────────
  const startInsertAfter = useCallback(
    (i: number) => {
      setSelectedSlideIndex(i);
      setPendingOperation("insert");
      chatInputRef.current?.focus();
      addMessage(
        "assistant",
        `Describe the new slide to add after slide ${i + 1}. E.g. "Add a diagram showing the Carnot cycle."`
      );
    },
    [addMessage]
  );

  // ─── EARLY RETURNS ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Loading presentation...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-screen items-center justify-center px-4">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <AlertCircle className="h-12 w-12 text-red-500" />
          <p className="text-sm text-foreground">{loadError}</p>
          <Button onClick={() => router.push("/faculty/generate")}>
            Back to Generate
          </Button>
        </div>
      </div>
    );
  }

  const selectedSlide =
    selectedSlideIndex !== null && selectedSlideIndex < slides.length
      ? slides[selectedSlideIndex]
      : null;

  const currentSuggestions: string[] = selectedSlide
    ? (SUGGESTIONS_BY_TYPE[selectedSlide.type] ?? [])
    : [];

  // ─── MAIN LAYOUT ────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* TOP BAR */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b bg-white px-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleBack}
          aria-label="Back"
          className="h-8 w-8"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-sm font-semibold">
            {presentationTitle || "Untitled presentation"}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {slides.length} slides
            {originalSlideCount > 0 && originalSlideCount !== slides.length
              ? ` (was ${originalSlideCount})`
              : ""}
          </span>
        </div>

        {hasChanges && !downloadUrl ? (
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            <span className="text-xs text-muted-foreground">Unsaved</span>
          </div>
        ) : null}

        {!downloadUrl ? (
          <Button
            onClick={rebuildPresentation}
            disabled={isRebuilding || isRefining || slides.length === 0}
            size="sm"
            title={
              isRefining
                ? "Wait for current edit to finish"
                : undefined
            }
          >
            {isRebuilding ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Building...
              </>
            ) : (
              "Build & Download"
            )}
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={rebuildPresentation}
              disabled={isRebuilding || isRefining}
              title={
                isRefining
                  ? "Wait for current edit to finish"
                  : undefined
              }
            >
              {isRebuilding ? "Rebuilding..." : "Rebuild"}
            </Button>
            <a href={downloadUrl} download>
              <Button
                size="sm"
                className="bg-green-600 text-white hover:bg-green-700"
              >
                <Download className="mr-1 h-4 w-4" />
                Download
              </Button>
            </a>
          </div>
        )}
      </div>

      {/* BODY */}
      <div className="flex flex-1 min-h-0">
        {/* LEFT PANEL */}
        <div className="flex w-72 shrink-0 flex-col border-r bg-gray-50 min-h-0">
          <div className="shrink-0 border-b bg-white px-3 py-2">
            <p className="text-sm font-medium">Slides</p>
            <p className="text-[11px] text-muted-foreground">
              ↑↓ reorder · click to edit
            </p>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            <div>
              {slides.map((slide, i) => {
                if (!slide) return null;
                const isSelected = selectedSlideIndex === i;
                return (
                  <div
                    key={i}
                    onClick={() => {
                      if (selectedSlideIndex !== i) {
                        setSelectedSlideIndex(i);
                        setMessages([]);
                        setPendingOperation(null);
                      }
                    }}
                    className={cn(
                      "cursor-pointer border-b px-3 py-2.5 transition hover:bg-white",
                      isSelected &&
                        "border-l-2 border-l-primary bg-white"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="bg-muted flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium">
                        {i + 1}
                      </span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "h-5 px-1.5 text-[10px] font-medium",
                          getSlideTypeColor(slide.type)
                        )}
                      >
                        {slide.type}
                      </Badge>
                      <div className="flex-1" />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 p-0"
                        disabled={i === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveSlide(i, "up");
                        }}
                        aria-label="Move slide up"
                      >
                        <ChevronUp className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 p-0"
                        disabled={i === slides.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveSlide(i, "down");
                        }}
                        aria-label="Move slide down"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 p-0 text-muted-foreground hover:text-red-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSlide(i);
                        }}
                        aria-label="Delete slide"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs font-medium leading-snug">
                      <RichQuestionText text={slide.title || "Untitled"} />
                    </p>
                    {isSelected ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          startInsertAfter(i);
                        }}
                        className="mt-1 text-[10px] text-primary underline-offset-2 hover:underline"
                      >
                        + Add slide after
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className="flex min-w-0 flex-1 flex-col min-h-0">
          {/* TOP: SLIDE PREVIEW */}
          <div className="shrink-0 border-b bg-slate-50 p-4">
            {selectedSlideIndex === null || !selectedSlide ? (
              <div className="aspect-video w-full max-w-lg mx-auto rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center">
                <p className="text-sm text-slate-400">
                  Select a slide to preview
                </p>
              </div>
            ) : (
              <div className="w-full max-w-2xl mx-auto">
                <SlidePreview
                  slide={selectedSlide}
                  slideNumber={selectedSlideIndex + 1}
                  isUpdating={isRefining}
                  contentId={contentId}
                  slideIndex={selectedSlideIndex}
                />
              </div>
            )}
          </div>

          {/* BOTTOM: CHAT (header + messages + input) */}
          <div className="flex flex-1 flex-col min-h-0">
            {/* PANEL HEADER */}
            <div className="shrink-0 border-b px-4 py-3">
              {selectedSlideIndex === null ? (
                <p className="text-sm text-muted-foreground">
                  ← Select a slide to start editing
                </p>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      Slide {selectedSlideIndex + 1}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {selectedSlide?.title ?? ""}
                    </p>
                  </div>
                  {pendingOperation === "insert" ? (
                    <div className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                      <span>
                        Adding slide after {selectedSlideIndex + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingOperation(null);
                          setInputValue("");
                        }}
                        aria-label="Cancel insert"
                        className="rounded-full p-0.5 hover:bg-amber-200"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* MESSAGES + INPUT — shared console (identical markup/behaviour) */}
            <SlideChatConsole
              hasSelection={selectedSlideIndex !== null}
              messages={messages}
              suggestions={currentSuggestions}
              input={inputValue}
              onInputChange={setInputValue}
              onSend={sendMessage}
              isBusy={isRefining}
              chipBehavior="fill"
              inputRef={chatInputRef}
              placeholder={
                selectedSlideIndex === null
                  ? "Select a slide first..."
                  : pendingOperation === "insert"
                    ? "Describe the new slide to add..."
                    : `Describe how to change slide ${selectedSlideIndex + 1}...`
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
