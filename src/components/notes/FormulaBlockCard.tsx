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
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="border-b px-2 py-1.5 font-medium">
              Symbol
            </th>
            <th scope="col" className="border-b px-2 py-1.5 font-medium">
              Meaning
            </th>
            {showUnits ? (
              <th scope="col" className="border-b px-2 py-1.5 font-medium">
                Unit
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {symbols.map((s, i) => (
            <tr key={`${s.symbol}-${i}`} className="border-b align-top last:border-b-0">
              <td className="whitespace-nowrap px-2 py-1.5 font-medium">
                <RichQuestionText text={withMathDelimiters(s.symbol)} />
              </td>
              <td className="px-2 py-1.5">
                <RichQuestionText text={s.meaning} />
              </td>
              {showUnits ? (
                <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">
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
    <div className="mt-4 rounded-lg bg-muted/50 px-3 py-2.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Worked example
      </p>
      <p className="mt-1.5 text-sm italic leading-relaxed text-muted-foreground">
        <RichQuestionText text={example.problem} />
      </p>
      <div className="mt-2 whitespace-pre-line text-sm leading-relaxed">
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
        <h2 className="text-2xl font-semibold leading-snug sm:text-3xl">
          {block.name}
        </h2>
        <div className="w-full max-w-full overflow-x-auto text-xl sm:text-2xl">
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
        <h3 className="text-lg font-semibold leading-snug">{block.name}</h3>
        {block.pyqSignal ? <PyqChip signal={block.pyqSignal} /> : null}
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg bg-muted/40 px-3 py-3 text-center text-lg">
        <RichQuestionText text={block.formula} />
      </div>

      <SymbolTable symbols={block.symbols} />

      {block.workedExample ? (
        <WorkedExample example={block.workedExample} />
      ) : null}

      {block.conditions ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium">Applies when: </span>
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
