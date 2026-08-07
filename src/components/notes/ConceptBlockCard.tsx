/**
 * Concept block — definitions, theorems, principles.
 *
 * THE VISUAL HIERARCHY IS THE PEDAGOGY. `plainExplanation` is the body text;
 * `formalStatement` is set apart as the precise version; `whyItMatters` is
 * de-emphasised into muted italics. That ordering is deliberate and it inverts
 * how a textbook does it — the textbook leads with the formal statement, which is
 * exactly the sentence a student who does not yet understand the concept cannot
 * parse. Plain first, precise second, motivation last-but-present.
 *
 * All prose runs through RichQuestionText, the same KaTeX + mhchem path as chat
 * and quiz. Notes prose really does carry `$…$` — the generation prompt's own
 * exemplars put math in `formalStatement` — and RichQuestionText's `hasLatex()`
 * fast path means text without math is untouched.
 */
import RichQuestionText from "@/components/RichQuestionText";
import type { ConceptBlock } from "@/lib/notes/types";
import type { EnrichedNoteBlock, PyqSignal } from "@/lib/notes/pyq-frequency";
import PyqChip from "./PyqChip";
import {
  AskAboutThisButton,
  FlashcardFace,
  ReadingCard,
  TapToRevealHint,
  TermPills,
} from "./shell";
import type { BlockHandlers, RenderMode } from "./types";

export default function ConceptBlockCard({
  block,
  mode,
  handlers,
}: {
  block: ConceptBlock & { pyqSignal?: PyqSignal };
  mode: RenderMode;
  handlers: BlockHandlers;
}) {
  const terms = block.relatedTerms ?? [];

  if (mode === "flashcard-front") {
    return (
      <FlashcardFace>
        <h2 className="font-plex-serif text-display-sm font-semibold leading-snug text-paper">
          {block.title}
        </h2>
        <p className="max-w-prose font-plex-sans text-body-sm italic leading-relaxed text-paper/70">
          <RichQuestionText text={block.whyItMatters} />
        </p>
        <TapToRevealHint />
      </FlashcardFace>
    );
  }

  if (mode === "flashcard-back") {
    return (
      <FlashcardFace className="justify-start text-left">
        <div className="w-full max-w-prose space-y-4">
          <div className="font-plex-sans text-body-lg leading-relaxed text-paper">
            <RichQuestionText text={block.plainExplanation} />
          </div>

          {block.formalStatement ? (
            // No bg fill here, deliberately — this face already sits on the
            // `night-surface` card fill (`bg-ink`). A second flat dark wash
            // behind it would read as the same box repeated, not a distinct
            // one; the ochre border carries the "set apart" signal on its
            // own at this contrast (verified 4.89:1 against `bg-ink`).
            <div className="rounded-4 border-l-2 border-ochre px-3 py-2 font-plex-sans text-body-sm leading-relaxed text-paper/90">
              <RichQuestionText text={block.formalStatement} />
            </div>
          ) : null}

          <TermPills terms={terms} />

          {/* On the back the chip is context — "this topic is examined" — rather
              than a scanning aid, so it sits under the answer, not over it. */}
          {block.pyqSignal ? (
            <div className="pt-1">
              <PyqChip signal={block.pyqSignal} />
            </div>
          ) : null}
        </div>
      </FlashcardFace>
    );
  }

  return (
    <ReadingCard>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-plex-serif text-display-sm font-semibold leading-snug text-ink">
          <RichQuestionText text={block.title} />
        </h3>
        {block.pyqSignal ? <PyqChip signal={block.pyqSignal} /> : null}
      </div>

      <div className="mt-3 font-plex-sans text-body-lg leading-relaxed text-ink">
        <RichQuestionText text={block.plainExplanation} />
      </div>

      {block.formalStatement ? (
        <div className="mt-3 rounded-4 border-l-2 border-ochre bg-ink-50 px-3 py-2 font-plex-sans text-body-sm leading-relaxed text-ink-800">
          <RichQuestionText text={block.formalStatement} />
        </div>
      ) : null}

      <p className="mt-3 font-plex-sans text-body-sm italic leading-relaxed text-ink-500">
        <RichQuestionText text={block.whyItMatters} />
      </p>

      <TermPills terms={terms} />

      <AskAboutThisButton
        block={block as EnrichedNoteBlock}
        handlers={handlers}
      />
    </ReadingCard>
  );
}
