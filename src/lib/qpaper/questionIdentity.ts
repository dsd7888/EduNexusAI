/**
 * Stable question identity + bounded undo for an assembled paper.
 *
 * Why this exists
 * ---------------
 * Generated questions had no identity. Per-question regeneration built a
 * synthetic template shape, sent it to the AI, and spliced the result back into
 * React state BY ARRAY INDEX. That is unsafe the moment anything reorders or
 * resizes the array — a section edit, a concurrent regeneration resolving out of
 * order, or the debounced history autosave landing between the request and its
 * response. It also made two features impossible to build: undo (nothing kept
 * the previous text) and carry-forward (nothing could name "this question" to
 * preserve it across a full regeneration).
 *
 * `localId` fixes all three. It is stamped once at the assembly boundary,
 * travels inside the paper JSON (so it survives export, `qpaper_drafts`
 * autosave and `qpaper_history` resume), and is PRESERVED across regeneration:
 * the content changes, the identity does not.
 *
 * Scope: paper-local, not global. Two different papers may reuse the same id
 * string; nothing joins on it across papers.
 */

import type {
  AssembledPaper,
  GeneratedQuestion,
  GeneratedSection,
  QuestionPart,
  QuestionUndoEntry,
  SubQuestion,
} from "./builder";
import type { PoolItem } from "./templates";

/**
 * How many prior versions a single question retains.
 *
 * Three, deliberately: this is an undo affordance, not an audit log, and every
 * entry is a whole-question snapshot riding inside the jsonb that
 * `qpaper_drafts.builder_state` / `qpaper_history.structure_summary` autosave on
 * a 1.5s debounce. Depth trades directly against autosave payload size.
 */
export const UNDO_DEPTH = 3;

/**
 * Ceiling on the serialised undo history of a single question (~32 KB).
 *
 * The worst case is a pool block: 20 items x 3 snapshots. Without a byte
 * ceiling a handful of those would dominate the autosave payload for the whole
 * paper. On breach the oldest entries are dropped until the stack fits, so undo
 * degrades to fewer steps rather than bloating every save.
 */
export const UNDO_MAX_BYTES = 32 * 1024;

// ─── Identity ───────────────────────────────────────────────────────────────

/**
 * Positional id used when backfilling a paper persisted before `localId`
 * existed. Deterministic so that re-hydrating the same unchanged history row
 * yields the same ids every time (a random id would make every autosave look
 * like a real edit, and would break undo across a reload).
 */
function positionalId(parts: Array<string | number>): string {
  return `q${parts.join("-")}`;
}

/**
 * Assign `localId` to every node in `paper` that lacks one.
 *
 * MUTATES `paper` in place — it runs on freshly assembled server-side objects
 * and on client state immediately before `setPaper`, where mutating is both
 * cheaper and simpler than rebuilding the tree. Idempotent: a node that already
 * has an id keeps it, so calling this repeatedly is safe and cheap (one pass,
 * O(nodes)).
 *
 * Collision safety: positional ids are only *candidates*. Because existing ids
 * are preserved, a question inserted into a previously-backfilled paper could
 * otherwise be handed an id a shifted sibling already owns. Every id seen in
 * this pass is tracked, and a taken candidate falls back to a suffixed variant.
 *
 * @returns how many ids were newly assigned (0 = everything already had one).
 */
export function ensurePaperLocalIds(paper: AssembledPaper): number {
  if (!paper || !Array.isArray(paper.sections)) return 0;

  // Pass 1: collect ids already in use, so pass 2 can never duplicate one.
  const used = new Set<string>();
  for (const section of paper.sections) {
    for (const q of section?.questions ?? []) {
      if (q?.localId) used.add(q.localId);
      for (const n of nodesOf(q)) {
        if (n?.localId) used.add(n.localId);
      }
    }
  }

  let assigned = 0;
  const claim = (candidate: string): string => {
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    // Deterministic probing keeps repeat runs stable; the counter is bounded by
    // the number of nodes, so this terminates.
    for (let n = 2; ; n++) {
      const alt = `${candidate}x${n}`;
      if (!used.has(alt)) {
        used.add(alt);
        return alt;
      }
    }
  };

  paper.sections.forEach((section: GeneratedSection, sIdx: number) => {
    (section?.questions ?? []).forEach((q: GeneratedQuestion, qIdx: number) => {
      if (!q) return;
      if (!q.localId) {
        q.localId = claim(positionalId([sIdx, qIdx]));
        assigned += 1;
      }
      nodesOf(q).forEach((node, nIdx) => {
        if (node && !node.localId) {
          node.localId = claim(positionalId([sIdx, qIdx, nIdx]));
          assigned += 1;
        }
      });
    });
  });

  return assigned;
}

/** True when every question and child node already carries a `localId`. */
export function paperHasAllLocalIds(paper: AssembledPaper | null | undefined): boolean {
  if (!paper || !Array.isArray(paper.sections)) return true;
  for (const section of paper.sections) {
    for (const q of section?.questions ?? []) {
      if (!q?.localId) return false;
      for (const n of nodesOf(q)) {
        if (n && !n.localId) return false;
      }
    }
  }
  return true;
}

/**
 * Non-mutating counterpart to {@link ensurePaperLocalIds}, for React state.
 *
 * Mutating a paper that is already referenced by state (or by a draft snapshot
 * the autosave still holds) is how stale-render and phantom-diff bugs start, so
 * the client always goes through this.
 *
 * Fast path: a paper whose ids are all present is returned as-is, with no
 * clone. That is the overwhelmingly common case — every paper generated after
 * CP-QC1 arrives already stamped — so resume stays allocation-free and only a
 * genuine legacy backfill pays for the deep copy.
 */
export function withLocalIds(paper: AssembledPaper): AssembledPaper {
  if (paperHasAllLocalIds(paper)) return paper;
  const clone: AssembledPaper =
    typeof structuredClone === "function"
      ? structuredClone(paper)
      : (JSON.parse(JSON.stringify(paper)) as AssembledPaper);
  ensurePaperLocalIds(clone);
  return clone;
}

/** Child nodes of a question, in a stable order, across all block shapes. */
function nodesOf(
  q: GeneratedQuestion | null | undefined
): Array<SubQuestion | QuestionPart | PoolItem> {
  if (!q) return [];
  // Concatenated rather than branch-per-type: a block can in principle carry
  // more than one of these (pool padding paths touch items and parts), and the
  // index only has to be stable within a single pass.
  return [...(q.sub_parts ?? []), ...(q.parts ?? []), ...(q.items ?? [])];
}

/**
 * Locate a question by `localId`.
 *
 * The replacement for "splice by captured array index" at every regeneration
 * call site. Returns null when the question is gone (subject switched, section
 * deleted, paper replaced) — callers MUST treat null as "discard this result",
 * which is precisely the stale-response case that index-based splicing got
 * wrong.
 */
export function findQuestionByLocalId(
  paper: AssembledPaper | null | undefined,
  localId: string
): { sectionIndex: number; questionIndex: number; question: GeneratedQuestion } | null {
  if (!paper || !Array.isArray(paper.sections) || !localId) return null;
  for (let s = 0; s < paper.sections.length; s++) {
    const questions = paper.sections[s]?.questions ?? [];
    for (let q = 0; q < questions.length; q++) {
      if (questions[q]?.localId === localId) {
        return { sectionIndex: s, questionIndex: q, question: questions[q] };
      }
    }
  }
  return null;
}

// ─── Undo ───────────────────────────────────────────────────────────────────

/** A question with its undo history removed — what gets stored in a snapshot. */
function stripUndo(q: GeneratedQuestion): GeneratedQuestion {
  if (!q.undoStack) return q;
  const { undoStack: _drop, ...rest } = q;
  void _drop;
  return rest as GeneratedQuestion;
}

/** Byte length of the serialised stack, used only for the size ceiling. */
function stackBytes(stack: QuestionUndoEntry[]): number {
  try {
    // Node and every modern browser expose TextEncoder; the byte count matters
    // (not the UTF-16 length) because this rides in a JSON column.
    return new TextEncoder().encode(JSON.stringify(stack)).length;
  } catch {
    // Never let accounting break an edit — assume it fits.
    return 0;
  }
}

/**
 * Return a copy of `question` with its current state pushed onto the undo ring.
 *
 * Pure: the input is untouched, so this is safe to call inside a React state
 * updater. Call it BEFORE applying a change, and apply the change to the
 * returned object.
 *
 * Trimming is oldest-first, by depth and then by byte ceiling.
 */
export function withUndoPushed(
  question: GeneratedQuestion,
  reason: string
): GeneratedQuestion {
  const entry: QuestionUndoEntry = {
    at: new Date().toISOString(),
    reason,
    // Snapshot without the stack: a snapshot containing prior snapshots would
    // grow the payload geometrically.
    question: stripUndo(question),
  };

  let stack = [...(question.undoStack ?? []), entry];
  if (stack.length > UNDO_DEPTH) stack = stack.slice(stack.length - UNDO_DEPTH);
  // Byte ceiling: drop oldest until it fits, but always keep at least one entry
  // so a single large question still gets one level of undo.
  while (stack.length > 1 && stackBytes(stack) > UNDO_MAX_BYTES) {
    stack = stack.slice(1);
  }

  return { ...question, undoStack: stack };
}

/**
 * Restore the most recent snapshot.
 *
 * Returns null when there is nothing to undo, so callers can disable the
 * affordance without special-casing. The restored question keeps the REMAINING
 * history (so undo can step back repeatedly) and re-asserts the live
 * `localId` — identity belongs to the slot, not to the snapshot, and a snapshot
 * taken before a backfill could otherwise carry a stale or absent id.
 */
export function withUndoPopped(
  question: GeneratedQuestion
): { question: GeneratedQuestion; entry: QuestionUndoEntry } | null {
  const stack = question.undoStack ?? [];
  if (stack.length === 0) return null;

  const entry = stack[stack.length - 1];
  const remaining = stack.slice(0, -1);

  return {
    question: {
      ...entry.question,
      localId: question.localId ?? entry.question.localId,
      // `locked` is a faculty intent about the SLOT, not a property of the
      // content that was generated into it, so it survives an undo unchanged.
      ...(question.locked !== undefined ? { locked: question.locked } : {}),
      ...(remaining.length > 0 ? { undoStack: remaining } : {}),
    },
    entry,
  };
}

/** Whether a question currently has anything to undo. */
export function canUndo(question: GeneratedQuestion | null | undefined): boolean {
  return Boolean(question?.undoStack && question.undoStack.length > 0);
}

/**
 * Drop all undo history from a paper.
 *
 * Used on the export/persist path where history is dead weight: the PDF, Word
 * and answer-key builders never read it, and shipping it to the AI as context
 * would waste tokens on superseded text.
 */
export function stripPaperUndo(paper: AssembledPaper): AssembledPaper {
  return {
    ...paper,
    sections: paper.sections.map((s) => ({
      ...s,
      questions: (s.questions ?? []).map(stripUndo),
    })),
  };
}
