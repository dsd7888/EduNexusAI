"use client";

/**
 * /student/notes/[subjectId] — the reading view (CP-N4 Part 3).
 *
 * DETERMINISTIC END TO END. There is no AI call on this page or in anything it
 * renders. The blocks arrive built; this file decides order, grouping and
 * filtering, and hands each block to renderBlock. That split — AI supplies
 * content, code supplies layout — is the checkpoint's central principle.
 *
 * NO VIRTUALIZATION AND NO PAGINATION, deliberately. The ceiling is 8 modules ×
 * 12 blocks = 96 cards. Virtualizing that costs scroll-position bugs and breaks
 * in-page find (⌘F), which is a real way students use a reading surface, in
 * exchange for solving a performance problem this page does not have.
 *
 * MODULE HEADERS COME FROM sourceMetadata.moduleBreakpoints, never from a marker
 * on the blocks — `_moduleId` is internal routing metadata that never reaches a
 * client. When breakpoints are empty (a subject row written before CP-N4, or
 * before CP-N3's tagging) the page renders a flat list with no headers and no
 * module filter. That is a supported state, not an error.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download, Layers, Search, X } from "lucide-react";

import { renderBlock } from "@/components/notes/BlockRenderer";
import { Skeleton } from "@/components/ui/skeleton";
import type { EnrichedNoteBlock } from "@/lib/notes/pyq-frequency";
import {
  blockTitleOf,
  serializeBlockForChat,
  writeNotesHandoff,
} from "@/lib/notes/chat-handoff";
import { cn } from "@/lib/utils";
import { useSubjectNotes } from "../_hooks/useSubjectNotes";
import {
  ALL_MODULES,
  breakpointForIndex,
  filterBySearch,
  moduleNameForIndex,
  positionBlocks,
  sliceToModule,
} from "../_hooks/filter";

export default function StudentNotesReadingPage() {
  const params = useParams<{ subjectId: string }>();
  const subjectId = params?.subjectId ?? "";
  const router = useRouter();

  const { blocks, metadata, isLoading, error, isRateLimited, generate, isGenerating } =
    useSubjectNotes(subjectId);

  const [moduleId, setModuleId] = useState<string>(ALL_MODULES);
  const [search, setSearch] = useState("");

  // Memoised so the identity is stable — an inline `?? []` is a fresh array
  // every render and would retrigger every downstream memo and callback.
  const breakpoints = useMemo(
    () => metadata?.moduleBreakpoints ?? [],
    [metadata]
  );

  // A selection can outlive the thing it selects: the data reloads and that
  // module is no longer covered. DERIVED during render rather than corrected by
  // an effect — an effect here would setState during render-commit and cascade a
  // second render for a value that was always computable from what we already
  // have. (react-hooks/set-state-in-effect flags exactly this.)
  const activeModuleId =
    moduleId !== ALL_MODULES && !breakpoints.some((b) => b.moduleId === moduleId)
      ? ALL_MODULES
      : moduleId;

  const positioned = useMemo(() => positionBlocks(blocks), [blocks]);

  // Module slice first, then search — searching inside the module you are
  // reading is the behaviour a filter implies.
  const visible = useMemo(
    () => filterBySearch(sliceToModule(positioned, breakpoints, activeModuleId), search),
    [positioned, breakpoints, activeModuleId, search]
  );

  const onAskAboutThis = useCallback(
    (block: EnrichedNoteBlock) => {
      const originalIndex = positioned.find((p) => p.block === block)?.originalIndex ?? -1;
      const key = writeNotesHandoff({
        blockTitle: blockTitleOf(block),
        blockKind: block.kind,
        blockContent: serializeBlockForChat(block),
        subjectId,
        moduleContext: moduleNameForIndex(breakpoints, originalIndex),
      });

      // A null key means sessionStorage is unavailable (private mode, quota).
      // Open the chat anyway rather than dead-ending the button — the student
      // still gets to the right subject's tutor, just without the quote.
      router.push(
        key
          ? `/student/chat/${subjectId}?notesHandoff=${encodeURIComponent(key)}`
          : `/student/chat/${subjectId}`
      );
    },
    [positioned, breakpoints, subjectId, router]
  );

  const flashcardHref =
    activeModuleId === ALL_MODULES
      ? `/student/notes/${subjectId}/flashcards`
      : `/student/notes/${subjectId}/flashcards?moduleId=${encodeURIComponent(activeModuleId)}`;

  // PDF download. `downloadingRef` (not the `isDownloading` state) is the
  // re-entrancy guard: a state read only reflects the LAST commit, so two
  // click events dispatched before React re-renders between them would both
  // see `isDownloading === false` and both fire a fetch — the same class of
  // same-tick double-invocation bug CP-N4's flashcard "Space skips a card"
  // bug was (§19). A ref is synchronous and closes that window; `isDownloading`
  // exists purely to drive the disabled/label UI.
  const downloadingRef = useRef(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
    };
  }, []);

  // A fresh error replaces any pending auto-clear rather than racing it — two
  // downloads failing within 4s of each other would otherwise let the FIRST
  // error's timer wipe the SECOND error's message early.
  const showDownloadError = useCallback((message: string) => {
    if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
    setDownloadError(message);
    errorTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) setDownloadError(null);
      errorTimeoutRef.current = null;
    }, 4000);
  }, []);

  const handleDownloadPdf = useCallback(async () => {
    if (downloadingRef.current) return;
    downloadingRef.current = true;
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const url =
        activeModuleId === ALL_MODULES
          ? `/api/notes/subject/${subjectId}/export`
          : `/api/notes/subject/${subjectId}/export?moduleId=${encodeURIComponent(activeModuleId)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const message =
          res.status === 404
            ? "Generate notes first before downloading."
            : res.status === 429
              ? "Download limit reached for today."
              : "Couldn't download the PDF. Try again.";
        if (mountedRef.current) showDownloadError(message);
        return;
      }
      // A blob: URL carries none of the original response's headers, so the
      // filename has to be read off Content-Disposition here and handed to
      // `download` explicitly — an empty `download=""` attribute still forces
      // a save-as, but the browser then falls back to a name derived from the
      // (meaningless) blob: URL itself, e.g. a raw UUID.
      const disposition = res.headers.get("content-disposition") ?? "";
      const filenameMatch = /filename="?([^";]+)"?/i.exec(disposition);
      const filename = filenameMatch?.[1] ?? "notes.pdf";

      const blob = await res.blob();
      // The download itself is not gated on the component still being
      // mounted — a student who navigates away mid-fetch should still get
      // the file the browser already committed to fetching.
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      if (mountedRef.current) showDownloadError("Couldn't download the PDF. Try again.");
    } finally {
      downloadingRef.current = false;
      if (mountedRef.current) setIsDownloading(false);
    }
  }, [activeModuleId, subjectId, showDownloadError]);

  // Headers are drawn at the first VISIBLE block of each module rather than
  // strictly at breakpoint.startIndex. With no search active those are the same
  // block, so the unfiltered view is exactly the specified behaviour; under
  // search it is the difference between keeping module grouping and losing every
  // header whose lead block happened not to match.
  const seenModules = new Set<string>();
  const showHeaders = activeModuleId === ALL_MODULES && breakpoints.length > 0;

  return (
    <div className="mx-auto w-full max-w-3xl pb-28 sm:pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/student/subjects"
          className="inline-flex min-h-11 items-center gap-1.5 font-plex-sans text-body-sm text-ink-500 transition-colors duration-180 ease-out hover:text-ink-900"
        >
          <ArrowLeft className="size-4" />
          Subjects
        </Link>

        {/* Desktop entries. The mobile ones are the fixed bar below — a
            top-right control is the least thumb-reachable spot on a phone. */}
        {blocks.length > 0 ? (
          <div className="hidden items-center gap-2 sm:flex">
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isDownloading}
              className="inline-flex min-h-11 items-center gap-2 rounded-8 border border-ink-200 px-4 font-plex-sans text-body text-ink transition-colors duration-180 ease-out hover:border-ochre hover:text-ink-900 disabled:pointer-events-none disabled:opacity-60"
            >
              <Download className="size-4" />
              {isDownloading ? "Preparing…" : "Download PDF"}
            </button>
            <Link
              href={flashcardHref}
              className="inline-flex min-h-11 items-center gap-2 rounded-8 border border-ink-200 px-4 font-plex-sans text-body text-ink transition-colors duration-180 ease-out hover:border-ochre hover:text-ink-900"
            >
              <Layers className="size-4" />
              Flashcard mode
            </Link>
          </div>
        ) : null}
      </div>

      {downloadError ? (
        <p className="mt-2 hidden font-plex-sans text-body-sm text-amber-700 sm:block dark:text-amber-300">
          {downloadError}
        </p>
      ) : null}

      <h1 className="mt-3 font-plex-serif text-display-lg font-bold text-ink">Notes</h1>
      {metadata && metadata.modulesTotal > 0 ? (
        <p className="mt-1 font-plex-sans text-body-sm text-ink-500">
          {metadata.modulesCovered.length} of {metadata.modulesTotal} modules
          covered
        </p>
      ) : null}

      {isLoading ? <ReadingSkeleton /> : null}

      {!isLoading && error ? (
        <ErrorState
          message={error}
          isRateLimited={isRateLimited}
          isGenerating={isGenerating}
          onGenerate={generate}
        />
      ) : null}

      {!isLoading && !error ? (
        <>
          <div className="mt-5 space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search these notes…"
                aria-label="Search these notes"
                // The webkit cancel button is suppressed because this input
                // already renders its own clear control — WebKit's native ✕ sat
                // right beside ours, two affordances for one action.
                className="min-h-11 w-full rounded-4 border border-ink-200 bg-paper pl-9 pr-9 font-plex-sans text-body text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink-900 [&::-webkit-search-cancel-button]:appearance-none"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center text-ink-500 transition-colors duration-180 ease-out hover:text-ink-900"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>

            {breakpoints.length > 0 ? (
              <ModuleFilter
                breakpoints={breakpoints}
                value={activeModuleId}
                onChange={setModuleId}
              />
            ) : null}
          </div>

          {blocks.length === 0 ? (
            <EmptyState
              title="No notes yet"
              body="Notes are built from your syllabus once a module has been processed. Check back shortly."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              title="Nothing matched"
              body={`No blocks match "${search.trim()}". Try a shorter word.`}
            />
          ) : (
            <div className="mt-5 space-y-4">
              {visible.map(({ block, originalIndex }) => {
                const bp = showHeaders
                  ? breakpointForIndex(breakpoints, originalIndex)
                  : null;
                let header: React.ReactNode = null;
                if (bp && !seenModules.has(bp.moduleId)) {
                  seenModules.add(bp.moduleId);
                  header = (
                    <h2
                      key={`h-${bp.moduleId}`}
                      className="pt-3 font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500 first:pt-0"
                    >
                      {bp.moduleNumber}. {bp.moduleName}
                    </h2>
                  );
                }
                return (
                  <div key={block.id} className="space-y-4">
                    {header}
                    {renderBlock(block, "reading", { onAskAboutThis }, block.id)}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : null}

      {/* Thumb-reachable primary action. Fixed rather than sticky so it does not
          depend on the scroll container, and it carries the safe-area inset so
          it clears the iOS home indicator. */}
      {!isLoading && !error && blocks.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
          {downloadError ? (
            <p className="mb-2 text-center text-xs text-amber-700 dark:text-amber-300">
              {downloadError}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Link
              href={flashcardHref}
              className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              <Layers className="size-4" />
              Flashcard mode
            </Link>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isDownloading}
              className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border bg-background px-4 text-sm font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-60"
            >
              <Download className="size-4" />
              {isDownloading ? "Preparing…" : "Download"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Module filter.
 *
 * Populated from breakpoints, which means a module skipped during assembly does
 * not appear — correct, and deliberately not softened into a disabled entry. The
 * student cannot filter to blocks that are not in the array, and an inert row
 * claiming otherwise would be a lie about what is available.
 *
 * A horizontally scrolling chip row rather than a <select>: at most 8 options,
 * and a chip row shows the student what exists without a tap.
 */
function ModuleFilter({
  breakpoints,
  value,
  onChange,
}: {
  breakpoints: { moduleId: string; moduleName: string; moduleNumber: number }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const options = [
    { id: ALL_MODULES, label: "All modules" },
    ...breakpoints.map((b) => ({
      id: b.moduleId,
      label: `${b.moduleNumber}. ${b.moduleName}`,
    })),
  ];

  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          aria-pressed={value === opt.id}
          className={cn(
            "min-h-11 shrink-0 rounded-8 border px-4 font-plex-sans text-body-sm transition-colors duration-180 ease-out",
            value === opt.id
              ? "border-ochre bg-ochre text-ink-900"
              : "border-ink-200 text-ink-600 hover:border-ochre hover:text-ink-900"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ReadingSkeleton() {
  return (
    <div className="mt-5 space-y-4">
      <Skeleton className="h-11 w-full" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-xl border p-5">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-6 rounded-xl border border-dashed p-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

/**
 * Amber, never red (§16/§17). A subject whose notes have not been built yet is
 * not an error the student caused.
 *
 * CP-11: the button actually generates now (POST /generate, calling
 * generateModuleNotes per uncovered module then assembling), rather than
 * re-fetching GET — which only assembles already-fresh rows and, on a
 * genuinely uncovered subject, would fail with the same message forever
 * (the "0 rows, infinite loop" this checkpoint fixes).
 */
function ErrorState({
  message,
  isRateLimited,
  isGenerating,
  onGenerate,
}: {
  message: string;
  isRateLimited: boolean;
  isGenerating: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-6 text-center dark:border-amber-500/40 dark:bg-amber-500/10">
      <p className="text-sm text-amber-900 dark:text-amber-200">{message}</p>
      {/* No generate action on a 429 — the quota is spent, and a button that
          cannot succeed is worse than no button. */}
      {!isRateLimited ? (
        <button
          type="button"
          onClick={onGenerate}
          disabled={isGenerating}
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-amber-400 bg-background px-5 text-sm font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-60"
        >
          {isGenerating ? "Generating…" : "Generate notes"}
        </button>
      ) : null}
    </div>
  );
}
