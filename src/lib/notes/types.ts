/**
 * Notes v2 — the typed content block model.
 *
 * A set of notes is an ARRAY OF TYPED BLOCKS, not a markdown document. Three
 * kinds, discriminated on `kind`:
 *
 *   concept    — definitions, theorems, principles
 *   formula    — any quantitative rule with symbols
 *   comparison — exam content where the DISTINCTION is the answer
 *
 * WHY EXACTLY THESE THREE. Together they cover ~90% of what appears in
 * engineering syllabi. Additional kinds (process flow, hierarchy, mnemonic) are
 * deliberately deferred until CP-N4 shows what real generation output is
 * actually missing. Each block type is a prompt-engineering surface: an unused
 * type dilutes generation quality on the used ones, which is §19's narrow-schema
 * rule applied at the type-system level rather than the request level.
 *
 * WHY NO IMAGE OR DIAGRAM FIELD. Visuals are CP4's Visualize pipeline, reachable
 * per-block via a chip in CP-N4. Notes storage stays text-only so regeneration
 * never pays image cost for visuals most students never open.
 *
 * THE LIMITS IN THIS FILE ARE THE SINGLE SOURCE OF TRUTH (§17). The generation
 * prompt states them as word/character ceilings, the Gemini responseSchema
 * encodes them as maxLength/maxItems, and {@link validateNoteBlocks} enforces
 * them after parsing. All three read the constants below — if they drift apart,
 * the model is being told one thing and judged by another.
 */

// ─── Shared limits ──────────────────────────────────────────────────────────

/**
 * Coverage floor/ceiling for one module's notes.
 *
 * Below MIN the notes are not worth opening; above MAX they stop being exam
 * preparation and become a re-transcription of the syllabus. "Comprehensive is
 * worse than focused" is stated in the prompt too — this pair is what the
 * validator holds the output to.
 */
export const NOTE_BLOCKS_MIN = 4;
export const NOTE_BLOCKS_MAX = 12;

export const LIMITS = {
  /** Every block: `<kind>-<slug>`, e.g. "concept-kirchhoffs-voltage-law". */
  id: 100,

  concept: {
    title: 80,
    plainExplanation: 600,
    formalStatement: 400,
    whyItMatters: 300,
    relatedTerms: { maxItems: 5, maxLength: 40 },
  },

  formula: {
    name: 80,
    /** LaTeX, rendered through the existing KaTeX pipeline (§13). */
    formula: 200,
    symbols: {
      maxItems: 8,
      // Not specified by the checkpoint; chosen to fit a table row without
      // wrapping. `meaning` is the only one that ever wants prose.
      symbol: 20,
      meaning: 80,
      unit: 20,
    },
    workedExample: { problem: 300, solution: 600 },
    conditions: 200,
  },

  comparison: {
    title: 80,
    axes: { maxItems: 6, maxLength: 40 },
    /** 2–4 things being compared; fewer than 2 is not a comparison. */
    items: { minItems: 2, maxItems: 4, name: 50, value: 80 },
  },
} as const;

// ─── Block types ────────────────────────────────────────────────────────────

/** Definitions, theorems, principles. The block IS the concept — not an intro to it. */
export type ConceptBlock = {
  kind: "concept";
  /** Stable within a notes version. CP-N4's "Ask about this" anchors on it. */
  id: string;
  title: string;
  /** Plain-language "what it is". */
  plainExplanation: string;
  /** The precise/formal statement, when the concept has one. */
  formalStatement?: string;
  /** Why it is on the exam, or where it shows up in engineering practice. */
  whyItMatters: string;
  relatedTerms?: string[];
};

/** Any quantitative rule with symbols. */
export type FormulaBlock = {
  kind: "formula";
  id: string;
  name: string;
  /** LaTeX. Chemistry is authored as bare \ce{...} with no $ wrapper (§13). */
  formula: string;
  symbols: Array<{ symbol: string; meaning: string; unit?: string }>;
  /** Optional in the type, strongly pushed by the prompt — a formula a student
   *  has seen applied once is worth more than a formula they have only read. */
  workedExample?: { problem: string; solution: string };
  /** "applies when…" — the condition that makes the formula wrong if ignored. */
  conditions?: string;
};

/** Exam content where the distinction between things IS the answer. */
export type ComparisonBlock = {
  kind: "comparison";
  id: string;
  title: string;
  /** The comparison dimensions, e.g. ["Key count", "Speed", "Use case"]. */
  axes: string[];
  /** Each item carries exactly one value per axis, positionally aligned. */
  items: Array<{ name: string; values: string[] }>;
};

export type NoteBlock = ConceptBlock | FormulaBlock | ComparisonBlock;

export type NoteBlockKind = NoteBlock["kind"];

export const NOTE_BLOCK_KINDS: readonly NoteBlockKind[] = [
  "concept",
  "formula",
  "comparison",
] as const;

// ─── ID discipline ──────────────────────────────────────────────────────────

/**
 * `<kind>-<slug>`, lowercase, hyphen-separated, no leading/trailing/double
 * hyphens. Enforced rather than merely requested: the generator is prompted to
 * derive IDs deterministically from the title/name so that regenerating notes
 * for unchanged content yields the same IDs. Random IDs would break CP-N4's
 * "Ask about this" continuity the moment delta-regeneration is added.
 */
export const NOTE_BLOCK_ID_PATTERN =
  /^(concept|formula|comparison)-[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The slug half of an ID, derived the same way the prompt asks the model to.
 *
 * Apostrophes are DROPPED, not treated as separators, so "Kirchhoff's Voltage
 * Law" yields `kirchhoffs-voltage-law` and not `kirchhoff-s-voltage-law`.
 * Engineering titles are full of possessives (Ohm's, Norton's, Thevenin's), and
 * the stray one-letter segment is both ugly and — because the prompt asks the
 * model to slugify the same way — the likeliest place for the model's IDs and
 * this helper to disagree. Covers the ASCII quote and the Unicode right single
 * quote, which is what most models actually emit.
 */
export function slugifyForBlockId(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’ʼ`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** Canonical ID for a block, used to repair or verify model-supplied IDs. */
export function buildBlockId(kind: NoteBlockKind, title: string): string {
  const slug = slugifyForBlockId(title);
  return `${kind}-${slug || "untitled"}`;
}

// ─── Validation ─────────────────────────────────────────────────────────────

export type BlockValidationIssue = {
  /** Index in the incoming array; -1 for whole-array issues (count, shape). */
  index: number;
  /** Dotted path within the block, e.g. "symbols[2].meaning". */
  field: string;
  message: string;
  /** Present when the block got far enough to read them — aids debugging. */
  kind?: string;
  id?: string;
};

export type NoteBlocksValidation =
  | { ok: true; blocks: NoteBlock[] }
  | { ok: false; issues: BlockValidationIssue[]; rawBlocks: unknown[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Bounded non-empty string. */
function checkStr(
  out: BlockValidationIssue[],
  ctx: { index: number; kind?: string; id?: string },
  value: unknown,
  field: string,
  max: number,
  required: boolean
): void {
  if (value === undefined || value === null) {
    if (required) out.push({ ...ctx, field, message: "is required" });
    return;
  }
  if (typeof value !== "string") {
    out.push({ ...ctx, field, message: `must be a string, got ${typeof value}` });
    return;
  }
  if (required && value.trim().length === 0) {
    out.push({ ...ctx, field, message: "must not be empty" });
    return;
  }
  if (value.length > max) {
    out.push({
      ...ctx,
      field,
      message: `exceeds ${max} chars (got ${value.length})`,
    });
  }
}

function checkStrArray(
  out: BlockValidationIssue[],
  ctx: { index: number; kind?: string; id?: string },
  value: unknown,
  field: string,
  opts: { maxItems: number; maxLength: number; minItems?: number },
  required: boolean
): void {
  if (value === undefined || value === null) {
    if (required) out.push({ ...ctx, field, message: "is required" });
    return;
  }
  if (!Array.isArray(value)) {
    out.push({ ...ctx, field, message: "must be an array" });
    return;
  }
  const min = opts.minItems ?? 0;
  if (value.length < min) {
    out.push({ ...ctx, field, message: `needs at least ${min} items (got ${value.length})` });
  }
  if (value.length > opts.maxItems) {
    out.push({
      ...ctx,
      field,
      message: `has more than ${opts.maxItems} items (got ${value.length})`,
    });
  }
  value.forEach((v, i) => checkStr(out, ctx, v, `${field}[${i}]`, opts.maxLength, true));
}

/**
 * Validates raw model output against the block model.
 *
 * Returns EVERY issue found, not just the first — a generation that failed
 * validation is reported with all of its problems and the raw blocks attached,
 * because CP-N1 deliberately does NOT silently retry (a silently-retried notes
 * generation is a silently-degraded one). The caller surfaces this for
 * debugging instead of hiding it behind a second attempt.
 *
 * `expectCount` is opt-out (harnesses validating a single hand-built block do
 * not want the 4–12 coverage floor applied).
 */
export function validateNoteBlocks(
  raw: unknown,
  opts: { expectCount?: boolean } = {}
): NoteBlocksValidation {
  const expectCount = opts.expectCount ?? true;
  const issues: BlockValidationIssue[] = [];

  if (!Array.isArray(raw)) {
    return {
      ok: false,
      rawBlocks: [],
      issues: [{ index: -1, field: "blocks", message: "must be an array" }],
    };
  }
  const rawBlocks = raw as unknown[];

  if (expectCount) {
    if (rawBlocks.length < NOTE_BLOCKS_MIN) {
      issues.push({
        index: -1,
        field: "blocks",
        message: `needs at least ${NOTE_BLOCKS_MIN} blocks (got ${rawBlocks.length})`,
      });
    }
    if (rawBlocks.length > NOTE_BLOCKS_MAX) {
      issues.push({
        index: -1,
        field: "blocks",
        message: `has more than ${NOTE_BLOCKS_MAX} blocks (got ${rawBlocks.length})`,
      });
    }
  }

  const seenIds = new Set<string>();

  rawBlocks.forEach((rawBlock, index) => {
    if (!isRecord(rawBlock)) {
      issues.push({ index, field: "", message: "must be an object" });
      return;
    }
    const kind = rawBlock.kind;
    if (typeof kind !== "string" || !NOTE_BLOCK_KINDS.includes(kind as NoteBlockKind)) {
      issues.push({
        index,
        field: "kind",
        message: `must be one of ${NOTE_BLOCK_KINDS.join(", ")}`,
      });
      return;
    }
    const id = typeof rawBlock.id === "string" ? rawBlock.id : undefined;
    const ctx = { index, kind, id };

    // ID: pattern, prefix agreement with `kind`, and uniqueness within the set.
    checkStr(issues, ctx, rawBlock.id, "id", LIMITS.id, true);
    if (id) {
      if (!NOTE_BLOCK_ID_PATTERN.test(id)) {
        issues.push({
          ...ctx,
          field: "id",
          message: "must match <kind>-<slug>, lowercase and hyphen-separated",
        });
      } else if (!id.startsWith(`${kind}-`)) {
        issues.push({
          ...ctx,
          field: "id",
          message: `prefix must match kind "${kind}"`,
        });
      }
      if (seenIds.has(id)) {
        issues.push({ ...ctx, field: "id", message: "is duplicated within this notes version" });
      }
      seenIds.add(id);
    }

    if (kind === "concept") {
      const L = LIMITS.concept;
      checkStr(issues, ctx, rawBlock.title, "title", L.title, true);
      checkStr(issues, ctx, rawBlock.plainExplanation, "plainExplanation", L.plainExplanation, true);
      checkStr(issues, ctx, rawBlock.whyItMatters, "whyItMatters", L.whyItMatters, true);
      checkStr(issues, ctx, rawBlock.formalStatement, "formalStatement", L.formalStatement, false);
      if (rawBlock.relatedTerms !== undefined) {
        checkStrArray(issues, ctx, rawBlock.relatedTerms, "relatedTerms", L.relatedTerms, false);
      }
      return;
    }

    if (kind === "formula") {
      const L = LIMITS.formula;
      checkStr(issues, ctx, rawBlock.name, "name", L.name, true);
      checkStr(issues, ctx, rawBlock.formula, "formula", L.formula, true);
      checkStr(issues, ctx, rawBlock.conditions, "conditions", L.conditions, false);

      const symbols = rawBlock.symbols;
      if (!Array.isArray(symbols)) {
        issues.push({ ...ctx, field: "symbols", message: "is required and must be an array" });
      } else {
        if (symbols.length === 0) {
          issues.push({ ...ctx, field: "symbols", message: "must not be empty" });
        }
        if (symbols.length > L.symbols.maxItems) {
          issues.push({
            ...ctx,
            field: "symbols",
            message: `has more than ${L.symbols.maxItems} rows (got ${symbols.length})`,
          });
        }
        symbols.forEach((row, i) => {
          if (!isRecord(row)) {
            issues.push({ ...ctx, field: `symbols[${i}]`, message: "must be an object" });
            return;
          }
          checkStr(issues, ctx, row.symbol, `symbols[${i}].symbol`, L.symbols.symbol, true);
          checkStr(issues, ctx, row.meaning, `symbols[${i}].meaning`, L.symbols.meaning, true);
          checkStr(issues, ctx, row.unit, `symbols[${i}].unit`, L.symbols.unit, false);
        });
      }

      const we = rawBlock.workedExample;
      if (we !== undefined && we !== null) {
        if (!isRecord(we)) {
          issues.push({ ...ctx, field: "workedExample", message: "must be an object" });
        } else {
          checkStr(issues, ctx, we.problem, "workedExample.problem", L.workedExample.problem, true);
          checkStr(issues, ctx, we.solution, "workedExample.solution", L.workedExample.solution, true);
        }
      }
      return;
    }

    // comparison
    const L = LIMITS.comparison;
    checkStr(issues, ctx, rawBlock.title, "title", L.title, true);
    checkStrArray(issues, ctx, rawBlock.axes, "axes", { ...L.axes, minItems: 1 }, true);

    const items = rawBlock.items;
    if (!Array.isArray(items)) {
      issues.push({ ...ctx, field: "items", message: "is required and must be an array" });
      return;
    }
    if (items.length < L.items.minItems || items.length > L.items.maxItems) {
      issues.push({
        ...ctx,
        field: "items",
        message: `must hold ${L.items.minItems}-${L.items.maxItems} items (got ${items.length})`,
      });
    }
    const axisCount = Array.isArray(rawBlock.axes) ? rawBlock.axes.length : null;
    items.forEach((item, i) => {
      if (!isRecord(item)) {
        issues.push({ ...ctx, field: `items[${i}]`, message: "must be an object" });
        return;
      }
      checkStr(issues, ctx, item.name, `items[${i}].name`, L.items.name, true);
      checkStrArray(
        issues,
        ctx,
        item.values,
        `items[${i}].values`,
        { maxItems: L.axes.maxItems, maxLength: L.items.value },
        true
      );
      // The cross-field invariant that makes the table renderable at all: one
      // value per axis, positionally aligned. A row of the wrong length would
      // render silently misaligned in CP-N4 rather than erroring.
      if (axisCount !== null && Array.isArray(item.values) && item.values.length !== axisCount) {
        issues.push({
          ...ctx,
          field: `items[${i}].values`,
          message: `must hold exactly one value per axis (${axisCount}); got ${item.values.length}`,
        });
      }
    });
  });

  if (issues.length > 0) return { ok: false, issues, rawBlocks };
  return { ok: true, blocks: rawBlocks as NoteBlock[] };
}

/** One-line rendering of validation issues, for logs and harness output. */
export function formatValidationIssues(issues: BlockValidationIssue[]): string {
  return issues
    .map((i) => {
      const where = i.index === -1 ? "blocks" : `block[${i.index}]${i.id ? ` (${i.id})` : ""}`;
      return `${where}${i.field ? `.${i.field}` : ""}: ${i.message}`;
    })
    .join("; ");
}
