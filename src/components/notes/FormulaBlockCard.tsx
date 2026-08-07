/**
 * Formula block — a quantitative rule, its symbols, and (ideally) one worked use.
 *
 * THE UNIT COLUMN IS CONDITIONAL ON THE WHOLE TABLE, not per row. `unit` is
 * optional on every symbol, and a table with a header called "Unit" above eight
 * empty cells reads as missing data rather than as inapplicable — which is the
 * wrong signal for a formula whose symbols are genuinely dimensionless (a
 * probability, a ratio, a count). Checked across all symbols, dropped entirely
 * when none has one.
 *
 * SYMBOLS ARE A TABLE, NOT A DEFINITION LIST. Symbol/meaning/unit is genuinely
 * tabular — a student scans the symbol column to find the one they don't know.
 * A <dl> makes that scan a read of every entry.
 *
 * Math renders through RichQuestionText (KaTeX + mhchem), the same path as chat
 * and quiz. The `formula` field is authored with `$…$` delimiters per §13, so it
 * needs no special unwrapping — the shared extractor finds the span.
 */
import RichQuestionText from "@/components/RichQuestionText";
import type { FormulaBlock } from "@/lib/notes/types";
import type { EnrichedNoteBlock, PyqSignal } from "@/lib/notes/pyq-frequency";
import { withMathDelimiters } from "@/lib/notes/math-helpers";
import PyqChip from "./PyqChip";
import {
  AskAboutThisButton,
  FlashcardFace,
  ReadingCard,
  TapToRevealHint,
} from "./shell";
import type { BlockHandlers, RenderMode } from "./types";

/** symbol | meaning | unit. The unit column disappears when nothing has a unit. */
function SymbolTable({ symbols }: { symbols: FormulaBlock["symbols"] }) {
  const showUnits = symbols.some((s) => Boolean(s.unit && s.unit.trim()));

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse text-left font-plex-sans text-body-sm text-ink night-surface:text-paper">
        <thead>
          <tr className="text-label uppercase tracking-[0.04em] text-ink-500 night-surface:text-paper/70">
            <th scope="col" className="border-b border-ink-100 px-2 py-1.5 font-semibold night-surface:border-paper/15">
              Symbol
            </th>
            <th scope="col" className="border-b border-ink-100 px-2 py-1.5 font-semibold night-surface:border-paper/15">
              Meaning
            </th>
            {showUnits ? (
              <th scope="col" className="border-b border-ink-100 px-2 py-1.5 font-semibold night-surface:border-paper/15">
                Unit
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {symbols.map((s, i) => (
            <tr key={`${s.symbol}-${i}`} className="border-b border-ink-100 align-top last:border-b-0 night-surface:border-paper/15">
              <td className="whitespace-nowrap px-2 py-1.5 font-medium">
                <RichQuestionText text={withMathDelimiters(s.symbol)} />
              </td>
              <td className="px-2 py-1.5">
                <RichQuestionText text={s.meaning} />
              </td>
              {showUnits ? (
                <td className="whitespace-nowrap px-2 py-1.5 text-ink-500 night-surface:text-paper/70">
                  {s.unit ? (
                    <RichQuestionText text={withMathDelimiters(s.unit)} />
                  ) : (
                    "—"
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Problem then solution.
 *
 * `whitespace-pre-line` on the solution is load-bearing: solutions are
 * multi-step and the generator separates the steps with newlines. Collapsing
 * them (the HTML default) turns a derivation into one run-on sentence.
 */
function WorkedExample({
  example,
}: {
  example: NonNullable<FormulaBlock["workedExample"]>;
}) {
  return (
    // `night-surface:bg-transparent` + a border, not a second filled tint —
    // on the flashcard's `bg-ink` card, another flat `ink-50`-equivalent
    // wash reads as the same box stacked twice rather than a distinct one.
    // A bordered outline groups the content without adding a layer.
    <div className="mt-4 rounded-4 bg-ink-50 px-3 py-2.5 night-surface:border night-surface:border-paper/20 night-surface:bg-transparent">
      <p className="font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink-500 night-surface:text-paper/70">
        Worked example
      </p>
      <p className="mt-1.5 font-plex-sans text-body-sm italic leading-relaxed text-ink-500 night-surface:text-paper/70">
        <RichQuestionText text={example.problem} />
      </p>
      <div className="mt-2 whitespace-pre-line font-plex-sans text-body-sm leading-relaxed text-ink night-surface:text-paper">
        <RichQuestionText text={example.solution} />
      </div>
    </div>
  );
}

export default function FormulaBlockCard({
  block,
  mode,
  handlers,
}: {
  block: FormulaBlock & { pyqSignal?: PyqSignal };
  mode: RenderMode;
  handlers: BlockHandlers;
}) {
  if (mode === "flashcard-front") {
    return (
      <FlashcardFace>
        <h2 className="font-plex-serif text-display-sm font-semibold leading-snug text-paper">
          {block.name}
        </h2>
        {/* text-xl/sm:text-2xl is KaTeX's own display size, untouched — only
            the color is new, since nothing set one before. */}
        <div className="w-full max-w-full overflow-x-auto text-xl text-paper sm:text-2xl">
          <RichQuestionText text={block.formula} />
        </div>
        <TapToRevealHint />
      </FlashcardFace>
    );
  }

  if (mode === "flashcard-back") {
    return (
      <FlashcardFace className="justify-start text-left">
        <div className="w-full max-w-prose">
          <SymbolTable symbols={block.symbols} />
          {block.workedExample ? (
            <WorkedExample example={block.workedExample} />
          ) : null}
          {/* `conditions` is deliberately omitted here — see the card's spec.
              On a phone-sized back face it is one more thing between the student
              and the symbols they flipped the card to see. */}
        </div>
      </FlashcardFace>
    );
  }

  return (
    <ReadingCard>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-plex-serif text-display-sm font-semibold leading-snug text-ink">
          <RichQuestionText text={block.name} />
        </h3>
        {block.pyqSignal ? <PyqChip signal={block.pyqSignal} /> : null}
      </div>

      <div className="mt-3 overflow-x-auto rounded-8 bg-ink-50 px-3 py-3 text-center font-plex-sans text-body-lg text-ink">
        <RichQuestionText text={block.formula} />
      </div>

      <SymbolTable symbols={block.symbols} />

      {block.workedExample ? (
        <WorkedExample example={block.workedExample} />
      ) : null}

      {block.conditions ? (
        <p className="mt-3 font-plex-sans text-body-sm leading-relaxed text-ink-500">
          <span className="font-semibold text-ink-600">Applies when: </span>
          <RichQuestionText text={block.conditions} />
        </p>
      ) : null}

      <AskAboutThisButton
        block={block as EnrichedNoteBlock}
        handlers={handlers}
      />
    </ReadingCard>
  );
}
