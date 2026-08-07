/**
 * Comparison block — exam content where the DISTINCTION is the answer.
 *
 * THE 480px REFLOW IS TWO DOM TREES, NOT ONE CSS-MORPHED TABLE.
 * A 4-item × 6-axis table cannot be made readable at 360px by any amount of
 * column squeezing — the cells carry up to 80 characters each. Below 480px it
 * becomes one card per item with a labelled list of axis→value pairs, which is
 * the same information at a legible measure.
 *
 * The two trees are toggled purely with Tailwind's `min-[480px]:` variant — no
 * resize listener, no JS measurement, so it is correct on first paint and during
 * an orientation change alike. Rendering both is safe for assistive tech: the
 * hidden branch is `display:none`, which screen readers do not announce, so the
 * content is read exactly once. (`aria-hidden` would not work here — which branch
 * is visible depends on the viewport, and aria-hidden is static.)
 *
 * 480px rather than Tailwind's `sm:` (640px) because the checkpoint names 480 and
 * because a 640px cut would push every tablet-in-portrait into the stacked layout
 * where the table still fits comfortably.
 *
 * `items[].values` is positionally aligned to `axes` — an invariant the block
 * validator enforces at write time (see validateNoteBlocks), so this component
 * indexes into values by axis position without re-checking.
 */
import RichQuestionText from "@/components/RichQuestionText";
import type { ComparisonBlock } from "@/lib/notes/types";
import type { EnrichedNoteBlock, PyqSignal } from "@/lib/notes/pyq-frequency";
import PyqChip from "./PyqChip";
import {
  AskAboutThisButton,
  FlashcardFace,
  ReadingCard,
  TapToRevealHint,
} from "./shell";
import type { BlockHandlers, RenderMode } from "./types";

/** Below 480px: one card per item, axis→value pairs stacked. */
function StackedItems({ block }: { block: ComparisonBlock }) {
  return (
    <div className="space-y-3 min-[480px]:hidden">
      {block.items.map((item) => (
        <div key={item.name} className="rounded-lg border bg-muted/30 p-3">
          <p className="text-sm font-semibold">
            <RichQuestionText text={item.name} />
          </p>
          <dl className="mt-2 space-y-2">
            {block.axes.map((axis, ai) => (
              <div key={axis}>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <RichQuestionText text={axis} />
                </dt>
                <dd className="mt-0.5 text-sm leading-relaxed">
                  <RichQuestionText text={item.values[ai] ?? "—"} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

/** 480px and up: axes as columns, items as rows. */
function ComparisonTable({ block }: { block: ComparisonBlock }) {
  return (
    <div className="hidden overflow-x-auto min-[480px]:block">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="border-b px-2 py-1.5 font-medium" />
            {block.axes.map((axis) => (
              <th
                key={axis}
                scope="col"
                className="border-b px-2 py-1.5 font-medium"
              >
                <RichQuestionText text={axis} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.items.map((item) => (
            <tr key={item.name} className="border-b align-top last:border-b-0">
              <th
                scope="row"
                className="whitespace-nowrap px-2 py-2 text-left text-sm font-semibold"
              >
                <RichQuestionText text={item.name} />
              </th>
              {block.axes.map((axis, ai) => (
                <td key={axis} className="px-2 py-2 leading-relaxed">
                  <RichQuestionText text={item.values[ai] ?? "—"} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ComparisonBlockCard({
  block,
  mode,
  handlers,
}: {
  block: ComparisonBlock & { pyqSignal?: PyqSignal };
  mode: RenderMode;
  handlers: BlockHandlers;
}) {
  if (mode === "flashcard-front") {
    return (
      <FlashcardFace>
        <h2 className="text-2xl font-semibold leading-snug sm:text-3xl">
          {block.title}
        </h2>
        {/* The dimensions, not the answers — this is the prompt the student
            answers in their head before flipping. */}
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          Compare on: {block.axes.join(", ")}
        </p>
        <TapToRevealHint />
      </FlashcardFace>
    );
  }

  if (mode === "flashcard-back") {
    return (
      <FlashcardFace className="justify-start text-left">
        <div className="w-full max-w-prose">
          <StackedItems block={block} />
          <ComparisonTable block={block} />
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

      <div className="mt-3">
        <StackedItems block={block} />
        <ComparisonTable block={block} />
      </div>

      <AskAboutThisButton
        block={block as EnrichedNoteBlock}
        handlers={handlers}
      />
    </ReadingCard>
  );
}
