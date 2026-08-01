"use client";

/**
 * /student/notes/[subjectId]/flashcards — the night-before-the-exam surface.
 *
 * FULL VIEWPORT, NO CHROME THAT COMPETES WITH THE CARD. One card, a back link,
 * and a position counter. Nothing else earns its place here: this is the one
 * screen in the product a student uses while tired, in bed, one-handed.
 *
 * ONE TAP TARGET, TWO MEANINGS, DECIDED BY STATE. Not revealed, a tap reveals;
 * revealed, a swipe or an arrow advances. Separate "reveal" and "next" buttons
 * would break the rhythm of a card deck — the whole point is that your thumb
 * never moves.
 *
 * POINTER EVENTS, NOT TOUCH EVENTS, so the same handler serves a phone and a
 * trackpad drag. `h-dvh` and not `h-screen` because mobile browser chrome makes
 * `vh` taller than the visible viewport, which would push the counter under the
 * address bar.
 *
 * POSITION IS NOT PERSISTED, deliberately. Every session starts at card 1. A
 * remembered position in a shuffle-free deck is a way to keep re-reading the
 * front half and never reach the end.
 */

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";

import { renderBlock } from "@/components/notes/BlockRenderer";
import PyqChip from "@/components/notes/PyqChip";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useSubjectNotes } from "../../_hooks/useSubjectNotes";
import { ALL_MODULES, positionBlocks, sliceToModule } from "../../_hooks/filter";

/** Horizontal travel that counts as a swipe rather than a tap. */
const SWIPE_THRESHOLD_PX = 50;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Live `prefers-reduced-motion`.
 *
 * useSyncExternalStore rather than useState-in-an-effect: a media query IS an
 * external store, and this is the primitive React provides for reading one. The
 * effect version cascades a second render on mount and is what
 * react-hooks/set-state-in-effect flags.
 *
 * Kept live rather than read once — a student can change the OS setting with
 * the page open, and the animation should stop immediately when they do.
 *
 * The server snapshot is `false` (animate). It has to be a stable constant or
 * hydration mismatches, and the client corrects it on the first commit.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(REDUCED_MOTION_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false
  );
}

function FlashcardsInner() {
  const params = useParams<{ subjectId: string }>();
  const subjectId = params?.subjectId ?? "";
  const searchParams = useSearchParams();
  const router = useRouter();

  const moduleId = searchParams.get("moduleId") ?? ALL_MODULES;
  const { blocks, metadata, isLoading, error } = useSubjectNotes(subjectId);

  const cards = useMemo(() => {
    const bps = metadata?.moduleBreakpoints ?? [];
    return sliceToModule(positionBlocks(blocks), bps, moduleId).map((p) => p.block);
  }, [blocks, metadata, moduleId]);

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  // The deck can shrink under a running session (a reload returning fewer
  // blocks). Clamped during render rather than corrected by an effect — the
  // same reason the reading view derives its module filter.
  const safeIndex = cards.length === 0 ? 0 : Math.min(index, cards.length - 1);
  const current = cards[safeIndex];

  const backHref =
    moduleId === ALL_MODULES
      ? `/student/notes/${subjectId}`
      : `/student/notes/${subjectId}?moduleId=${encodeURIComponent(moduleId)}`;

  /**
   * Move the deck. PURE — the next index is computed from the value the render
   * already has, and both setState calls are plain values.
   *
   * The first version did this inside a `setIndex(i => …)` updater and called
   * `setRevealed` from within it. React treats updaters as pure functions and
   * DOUBLE-INVOKES them in development to prove it; a side effect in there runs
   * twice. That is not theoretical — it shipped a deck where pressing Space to
   * advance skipped a card (1 → 3), because the nested `go(1)` fired on both
   * invocations. Keep updaters pure.
   */
  const go = useCallback(
    (delta: number) => {
      if (cards.length === 0) return;
      const next = Math.min(Math.max(safeIndex + delta, 0), cards.length - 1);
      // Only drop the reveal when the card actually changes; otherwise swiping
      // past the last card would silently flip it back to its front.
      if (next === safeIndex) return;
      setIndex(next);
      setRevealed(false);
    },
    [safeIndex, cards.length]
  );

  // ── Keyboard ────────────────────────────────────────────────────────────
  // Space doubles as reveal-then-advance so the whole deck is drivable from one
  // key, matching what the thumb does on a phone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        router.push(backHref);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
        return;
      }
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        // Reveal first, advance second — read from the rendered value rather
        // than branching inside a setState updater. See `go` for why.
        if (!revealed) setRevealed(true);
        else go(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, router, backHref, revealed]);

  // ── Pointer (swipe / tap) ───────────────────────────────────────────────
  const downX = useRef<number | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    downX.current = e.clientX;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = downX.current;
    downX.current = null;
    if (start == null) return;
    const dx = e.clientX - start;
    if (Math.abs(dx) >= SWIPE_THRESHOLD_PX) {
      // Left drag (negative dx) moves forward, like turning a page.
      go(dx < 0 ? 1 : -1);
      return;
    }
    setRevealed((r) => !r);
  };

  const reducedMotion = usePrefersReducedMotion();

  return (
    <div className="fixed inset-0 z-30 flex h-dvh flex-col bg-background">
      <header className="flex shrink-0 items-center gap-2 border-b px-2 py-1">
        <Link
          href={backHref}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to notes
        </Link>

        <div className="flex flex-1 flex-wrap items-center justify-center gap-2">
          {cards.length > 0 ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              Card {safeIndex + 1} of {cards.length}
            </span>
          ) : null}
          {/* The chip lives here, never on the card face — on the face it would
              compete with the content the student is trying to recall. */}
          {current?.pyqSignal ? <PyqChip signal={current.pyqSignal} /> : null}
        </div>

        {/* Balances the back link so the counter is optically centred. */}
        <div className="min-h-11 w-28 shrink-0" aria-hidden />
      </header>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <Skeleton className="h-64 w-full max-w-xl rounded-xl" />
        </div>
      ) : error ? (
        <Centered>
          <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>
          <Link
            href={backHref}
            className="mt-4 inline-flex min-h-11 items-center rounded-lg border px-5 text-sm font-medium"
          >
            Back to notes
          </Link>
        </Centered>
      ) : cards.length === 0 ? (
        <Centered>
          <p className="text-sm font-medium">No cards here</p>
          <p className="mt-1 text-sm text-muted-foreground">
            There are no note blocks to revise for this selection.
          </p>
          <Link
            href={backHref}
            className="mt-4 inline-flex min-h-11 items-center rounded-lg border px-5 text-sm font-medium"
          >
            Back to notes
          </Link>
        </Centered>
      ) : (
        <>
          {/* The card area is the tap target — the whole of it, not a button
              inside it. `touch-none` stops the browser claiming the horizontal
              drag for its own back-navigation gesture before we see it. */}
          {/* A <div>, not a <main>: the (student) layout already renders the
              page's <main> landmark, and this surface is a fixed overlay inside
              it. A second one is invalid HTML and gives assistive tech two
              competing "main content" landmarks on one page. */}
          <div
            data-testid="flashcard-surface"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            className="relative flex-1 touch-none select-none overflow-hidden p-4"
            style={{ perspective: "1200px" }}
          >
            <div
              className={cn(
                "relative h-full w-full",
                !reducedMotion && "transition-transform duration-200"
              )}
              style={{
                transformStyle: reducedMotion ? undefined : "preserve-3d",
                transform:
                  reducedMotion || !revealed ? undefined : "rotateY(180deg)",
              }}
            >
              <Face hidden={reducedMotion && revealed} reducedMotion={reducedMotion}>
                {renderBlock(current, "flashcard-front", {}, `${current.id}-f`)}
              </Face>
              <Face
                back
                hidden={reducedMotion && !revealed}
                reducedMotion={reducedMotion}
              >
                {renderBlock(current, "flashcard-back", {}, `${current.id}-b`)}
              </Face>
            </div>
          </div>

          {/* Visible, thumb-reachable prev/next. The swipe is the primary
              gesture; these exist because a swipe is undiscoverable and because
              a mouse user has nothing to swipe with. */}
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={safeIndex === 0}
              aria-label="Previous card"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-4 text-sm disabled:opacity-40"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border px-4 text-sm font-medium"
            >
              {revealed ? "Hide answer" : "Reveal"}
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              disabled={safeIndex >= cards.length - 1}
              aria-label="Next card"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-4 text-sm disabled:opacity-40"
            >
              <ChevronRight className="size-4" />
            </button>
          </footer>
        </>
      )}
    </div>
  );
}

/**
 * One face of the card.
 *
 * Both faces are absolutely positioned and stacked so the container's height is
 * the viewport slot rather than the taller of the two — a formula back (symbol
 * table plus worked example) is much taller than its front, and letting it size
 * the container would make the front card jump on every navigation.
 *
 * Under reduced motion the 3D transform is dropped entirely and the inactive
 * face is unmounted from the accessibility tree with `hidden`, because without a
 * rotation `backface-visibility` has nothing to hide behind and both faces would
 * be readable at once.
 */
function Face({
  children,
  back,
  hidden,
  reducedMotion,
}: {
  children: React.ReactNode;
  back?: boolean;
  hidden?: boolean;
  reducedMotion: boolean;
}) {
  if (reducedMotion && hidden) return null;
  return (
    <div
      className="absolute inset-0 overflow-y-auto rounded-xl border bg-card"
      style={
        reducedMotion
          ? undefined
          : {
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
              transform: back ? "rotateY(180deg)" : undefined,
            }
      }
    >
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
      {children}
    </div>
  );
}

export default function StudentNotesFlashcardsPage() {
  // useSearchParams needs a Suspense boundary in the App Router — the same
  // wrapper the quiz landing uses.
  return (
    <Suspense fallback={null}>
      <FlashcardsInner />
    </Suspense>
  );
}
