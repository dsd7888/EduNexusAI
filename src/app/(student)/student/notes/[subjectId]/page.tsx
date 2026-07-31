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

import { useCallback, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Layers, Search, X } from "lucide-react";

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

  const { blocks, metadata, isLoading, error, isRateLimited, reload } =
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
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Subjects
        </Link>

        {/* Desktop entry to flashcards. The mobile one is the fixed bar below —
            a top-right control is the least thumb-reachable spot on a phone. */}
        {blocks.length > 0 ? (
          <Link
            href={flashcardHref}
            className="hidden min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground sm:inline-flex"
          >
            <Layers className="size-4" />
            Flashcard mode
          </Link>
        ) : null}
      </div>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Notes</h1>
      {metadata && metadata.modulesTotal > 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {metadata.modulesCovered.length} of {metadata.modulesTotal} modules
          covered
        </p>
      ) : null}

      {isLoading ? <ReadingSkeleton /> : null}

      {!isLoading && error ? (
        <ErrorState
          message={error}
          isRateLimited={isRateLimited}
          onRetry={reload}
        />
      ) : null}

      {!isLoading && !error ? (
        <>
          <div className="mt-5 space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search these notes…"
                aria-label="Search these notes"
                // The webkit cancel button is suppressed because this input
                // already renders its own clear control — WebKit's native ✕ sat
                // right beside ours, two affordances for one action.
                className="min-h-11 w-full rounded-lg border bg-background pl-9 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:appearance-none"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
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
                      className="pt-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground first:pt-0"
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
          <Link
            href={flashcardHref}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            <Layers className="size-4" />
            Flashcard mode
          </Link>
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
            "min-h-11 shrink-0 rounded-full border px-4 text-sm transition-colors",
            value === opt.id
              ? "border-primary bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
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
 * not an error the student caused, and the retry usually works — the first call
 * for a subject is what triggers assembly.
 */
function ErrorState({
  message,
  isRateLimited,
  onRetry,
}: {
  message: string;
  isRateLimited: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-6 text-center dark:border-amber-500/40 dark:bg-amber-500/10">
      <p className="text-sm text-amber-900 dark:text-amber-200">{message}</p>
      {/* No retry on a 429 — the quota is spent, and a button that cannot
          succeed is worse than no button. */}
      {!isRateLimited ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-amber-400 bg-background px-5 text-sm font-medium transition-colors hover:bg-accent"
        >
          Generate notes
        </button>
      ) : null}
    </div>
  );
}
