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
        <h2 className="text-2xl font-semibold leading-snug sm:text-3xl">
          {block.title}
        </h2>
        <p className="max-w-prose text-sm italic leading-relaxed text-muted-foreground">
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
          <div className="text-base leading-relaxed">
            <RichQuestionText text={block.plainExplanation} />
          </div>

          {block.formalStatement ? (
            <div className="rounded-lg border-l-2 border-primary/40 bg-muted/50 px-3 py-2 text-sm leading-relaxed">
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
        <h3 className="text-lg font-semibold leading-snug">
          <RichQuestionText text={block.title} />
        </h3>
        {block.pyqSignal ? <PyqChip signal={block.pyqSignal} /> : null}
      </div>

      <div className="mt-3 text-[15px] leading-relaxed">
        <RichQuestionText text={block.plainExplanation} />
      </div>

      {block.formalStatement ? (
        <div className="mt-3 rounded-lg border-l-2 border-primary/40 bg-muted/50 px-3 py-2 text-sm leading-relaxed">
          <RichQuestionText text={block.formalStatement} />
        </div>
      ) : null}

      <p className="mt-3 text-sm italic leading-relaxed text-muted-foreground">
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
