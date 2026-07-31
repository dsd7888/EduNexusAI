"use client";

/**
 * The chrome the three block cards share.
 *
 * "use client" lives HERE and not on the three cards. The cards are pure
 * presentation and render fine on the server; this file is the only one with an
 * event handler (`AskAboutThisButton`'s onClick), so it is the only real client
 * boundary. Marking the leaf rather than the cards keeps the boundary as small as
 * React lets it be — and the Part 3/4 pages are `"use client"` anyway, which makes
 * the whole tree client-side at those call sites regardless.
 *
 * NOT IN THE CHECKPOINT'S FILE LIST — added because the alternative is the same
 * card shell, the same 44px-tall "Ask about this" button and the same tap-to-
 * reveal hint written out three times. Three copies of a touch-target height is
 * three places for it to drift below 44px, and the mobile constraint is the one
 * constraint in CP-N4 that is hard.
 *
 * Everything here is presentational and deterministic. No state, no effects.
 */
import type { EnrichedNoteBlock } from "@/lib/notes/pyq-frequency";
import { cn } from "@/lib/utils";
import type { BlockHandlers } from "./types";

/**
 * Minimum touch target, in Tailwind units. `h-11` is 2.75rem = 44px at the
 * default root size — the floor named in the checkpoint and in the WCAG 2.2
 * target-size guidance. Written as a constant so a future edit that wants a
 * different button size has to come here and read this comment first.
 */
export const TOUCH_TARGET = "min-h-11";

/** Reading-mode card shell. Mirrors the quiz surface's card (QuestionCard). */
export function ReadingCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "rounded-xl border bg-card p-5 shadow-sm sm:p-6",
        className
      )}
    >
      {children}
    </article>
  );
}

/**
 * Flashcard face shell — centered, roomy, no border.
 *
 * The face deliberately does NOT own its height: Part 4's page gives the card its
 * viewport (`h-dvh`), because only the page knows how much room the progress
 * indicator and the back link have already taken.
 */
export function FlashcardFace({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // `relative` is what lets the reveal hint pin itself to the bottom
        // WITHOUT taking part in the centering — an in-flow hint (mt-auto) eats
        // the free space below the content and pushes the card's title into the
        // top third, which is exactly where a glanceable card should not put it.
        "relative flex h-full w-full flex-col items-center justify-center gap-4 px-6 py-8 text-center",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * "Tap to reveal" affordance.
 *
 * A HINT, NOT A BUTTON, and that is the whole point. In flashcard mode the entire
 * card body is the tap target; rendering a button here would create a small
 * precise target inside a large forgiving one and teach the student to aim for it.
 * `aria-hidden` because the page owns the real accessible control — the hint is
 * decoration duplicating an action already announced there.
 */
export function TapToRevealHint({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "absolute inset-x-0 bottom-6 flex flex-col items-center gap-1 text-muted-foreground",
        className
      )}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="opacity-60"
      >
        <path d="m18 15-6-6-6 6" />
      </svg>
      <span className="text-xs">Tap anywhere to reveal</span>
    </div>
  );
}

/**
 * The reading-mode "Ask about this" control.
 *
 * Rendered only when a handler is supplied, and placed at the FOOT of the card,
 * separated by a rule — not inline with the prose. A student scanning six blocks
 * for the one they are stuck on should be reading titles, not stepping over an
 * action button in every paragraph.
 *
 * Not a shadcn <Button>: those default to h-9 (36px), and every variant that
 * hits 44px would need the same override written three times. This is one
 * element with the floor baked in.
 */
export function AskAboutThisButton({
  block,
  handlers,
}: {
  block: EnrichedNoteBlock;
  handlers: BlockHandlers;
}) {
  const onAsk = handlers.onAskAboutThis;
  if (!onAsk) return null;

  return (
    <div className="mt-4 border-t pt-3">
      <button
        type="button"
        onClick={() => onAsk(block)}
        className={cn(
          TOUCH_TARGET,
          // Tap-friendly on touch, hover-responsive on pointer — but never
          // hover-ONLY: the visible affordance (border + label) is always there.
          "inline-flex w-full items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium",
          "transition-colors hover:bg-accent hover:text-accent-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "sm:w-auto"
        )}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />
        </svg>
        Ask about this
      </button>
    </div>
  );
}

/** Small pill list — concept `relatedTerms`. Non-interactive, so no touch floor. */
export function TermPills({ terms }: { terms: string[] }) {
  if (terms.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-1.5">
      {terms.map((term) => (
        <li
          key={term}
          className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
        >
          {term}
        </li>
      ))}
    </ul>
  );
}
