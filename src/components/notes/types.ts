/**
 * Notes v2 — the render-side contract for block cards (CP-N4).
 *
 * NOTHING HERE DESCRIBES CONTENT. The content model is `@/lib/notes/types`, which
 * this checkpoint is forbidden to touch, and the serve-time PYQ signal is
 * `@/lib/notes/pyq-frequency`. What this file adds is the orthogonal axis those
 * two say nothing about: WHERE a block is being drawn. The same ConceptBlock is
 * three different layouts depending on whether it is being read, quizzed from the
 * front, or revealed on the back — and that is a property of the surface, not of
 * the block.
 *
 * This is §19's "AI classifies content type, code renders it" applied one level
 * down: the AI supplies the block, the mode supplies the layout, and no component
 * in this tree makes a network call of any kind.
 */
import type { EnrichedNoteBlock } from "@/lib/notes/pyq-frequency";

/**
 * Which face of which surface is being drawn.
 *
 * `flashcard-front` and `flashcard-back` are separate modes rather than one
 * `flashcard` mode plus a `revealed` boolean because the front and back of a card
 * share almost no layout — the front is a centered title, the back is a table or
 * a paragraph. A boolean would make every card component a two-branch component
 * with a shared shell that fits neither branch.
 */
export type RenderMode = "reading" | "flashcard-front" | "flashcard-back";

/**
 * Callbacks a surface may offer. Every field is optional and every card treats
 * absence as "do not render the affordance" — which is how flashcard mode gets a
 * chrome-free card without the card knowing what a flashcard is: Part 4 passes
 * `{}`, so nothing interactive renders.
 */
export type BlockHandlers = {
  /**
   * Hand this block to the chat surface. Reading mode only — on a flashcard back
   * the navigation gesture is a swipe, and a tappable button inside the tap-to-
   * reveal area would fight it for the same pointer event.
   */
  onAskAboutThis?: (block: EnrichedNoteBlock) => void;
};
