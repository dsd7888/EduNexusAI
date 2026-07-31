/**
 * The block factory — the ONLY thing pages call.
 *
 * WHY A FACTORY AND NOT A SWITCH IN EACH PAGE. The reading view and the flashcard
 * view both need "given a block, draw it". Written as a switch, that switch exists
 * twice, and adding the fourth block kind (process flow, hierarchy, mnemonic — all
 * deliberately deferred by lib/notes/types.ts until real generation output shows
 * which is missing) means finding every copy. Here it is one entry in one place:
 * a new kind is a new file plus a new case, and no page changes.
 *
 * This mirrors CP4's VIZ_REGISTRY and is the same principle §19 records for the
 * explainer renderer — the AI classifies the content type, code renders it.
 *
 * NO UI IN THIS FILE. It dispatches; it does not decide anything visual. If a
 * layout question ever gets answered here rather than in a card, the factory has
 * started being a component.
 */
import type { EnrichedNoteBlock } from "@/lib/notes/pyq-frequency";
import ComparisonBlockCard from "./ComparisonBlockCard";
import ConceptBlockCard from "./ConceptBlockCard";
import FormulaBlockCard from "./FormulaBlockCard";
import type { BlockHandlers, RenderMode } from "./types";

export function renderBlock(
  block: EnrichedNoteBlock,
  mode: RenderMode,
  handlers: BlockHandlers,
  key: string
): React.ReactNode {
  switch (block.kind) {
    case "concept":
      return (
        <ConceptBlockCard
          key={key}
          block={block}
          mode={mode}
          handlers={handlers}
        />
      );
    case "formula":
      return (
        <FormulaBlockCard
          key={key}
          block={block}
          mode={mode}
          handlers={handlers}
        />
      );
    case "comparison":
      return (
        <ComparisonBlockCard
          key={key}
          block={block}
          mode={mode}
          handlers={handlers}
        />
      );
    default:
      // Unreachable while NoteBlock has exactly three members — the `never`
      // binding is what makes adding a fourth kind a COMPILE error here rather
      // than a silently blank card in production.
      return assertNever(block);
  }
}

function assertNever(block: never): null {
  console.error("[notes] renderBlock: unhandled block kind", block);
  return null;
}

export default renderBlock;
