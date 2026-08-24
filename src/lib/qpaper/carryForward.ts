/**
 * Carry-forward: keep the questions the faculty liked across a regeneration.
 *
 * The complaint this answers: "I liked 3–4 questions from the first generation
 * and wanted them in the next one." Regenerating the whole paper was
 * all-or-nothing — it discarded everything, so improving one weak question
 * meant gambling the good ones, and faculty ended up regenerating repeatedly
 * and losing work they had already accepted.
 *
 * Pure, so the same partitioning drives the confirm dialog's wording and the
 * regeneration request itself. The two disagreeing would be worse than either:
 * a dialog promising to keep four questions while the request keeps three.
 */

import type { AssembledPaper, GeneratedQuestion } from "./builder";

export interface LockPartition {
  /** Questions the faculty pinned. */
  locked: GeneratedQuestion[];
  /** Everything else — what a regeneration is allowed to replace. */
  unlocked: GeneratedQuestion[];
  /**
   * localIds of the locked questions, for the generation request.
   *
   * Excludes any locked question that has no id: without identity it cannot be
   * reliably matched back after regeneration, and quietly dropping it is
   * exactly the data loss this feature exists to prevent.
   */
  lockedIds: string[];
  /** Locked questions that carry no localId — surfaced, never silently dropped. */
  unidentifiedLocked: number;
  /** Any locks at all? Drives whether the confirm dialog mentions them. */
  hasLocks: boolean;
  /**
   * Every question is locked, so regeneration has nothing to do. Worth catching
   * before spending a Pro call that would reproduce the same paper.
   */
  allLocked: boolean;
}

/** Split a paper into what a regeneration must preserve and what it may replace. */
export function partitionLockedQuestions(
  paper: AssembledPaper | null | undefined
): LockPartition {
  const locked: GeneratedQuestion[] = [];
  const unlocked: GeneratedQuestion[] = [];

  for (const section of paper?.sections ?? []) {
    for (const q of section?.questions ?? []) {
      if (!q) continue;
      (q.locked ? locked : unlocked).push(q);
    }
  }

  const lockedIds = locked
    .map((q) => q.localId)
    .filter((id): id is string => Boolean(id));

  return {
    locked,
    unlocked,
    lockedIds,
    unidentifiedLocked: locked.length - lockedIds.length,
    hasLocks: locked.length > 0,
    // An empty paper has nothing locked; reporting it as "all locked" would
    // block regeneration on a paper that has not been generated yet.
    allLocked: locked.length > 0 && unlocked.length === 0,
  };
}

/**
 * Question text of every locked question, for the generation request.
 *
 * Fed to the route's existing AI-exclusion channel (the same one that stops a
 * fresh slot shadowing a Q-Bank question). Without it the model regenerates
 * blind to what is being kept, and the paper can come back with a near-duplicate
 * of a question the faculty deliberately preserved.
 */
export function lockedQuestionTexts(part: LockPartition): string[] {
  const out: string[] = [];
  for (const q of part.locked) {
    for (const s of q.sub_parts ?? []) if (s.question) out.push(s.question);
    for (const p of q.parts ?? []) if (p.question) out.push(p.question);
    for (const i of q.items ?? []) if (i.question_text) out.push(i.question_text);
  }
  return Array.from(new Set(out));
}

export interface RestoreResult {
  paper: AssembledPaper;
  /** How many locked questions were carried through. */
  restored: number;
  /**
   * Locked questions with no compatible slot in the new paper. Surfaced rather
   * than dropped: silently losing a question the faculty explicitly asked to
   * keep is the exact failure this feature exists to prevent.
   */
  unplaceable: GeneratedQuestion[];
}

/**
 * Put the locked questions from `previous` back into a freshly generated paper.
 *
 * Matching is positional (section index, question index) because regeneration
 * reuses the same template, so the structure is identical by construction. The
 * position is still VERIFIED before writing — same block type and same total
 * marks — so a template edited between generations degrades to "reported as
 * unplaceable" instead of pasting a 12-mark question into a 1-mark MCQ slot.
 *
 * Pure; returns a new paper.
 */
export function restoreLockedQuestions(
  fresh: AssembledPaper,
  previous: AssembledPaper | null | undefined
): RestoreResult {
  const part = partitionLockedQuestions(previous);
  if (!part.hasLocks || !previous) {
    return { paper: fresh, restored: 0, unplaceable: [] };
  }

  const unplaceable: GeneratedQuestion[] = [];
  let restored = 0;

  const sections = fresh.sections.map((section, sIdx) => {
    const prevSection = previous.sections[sIdx];
    if (!prevSection) return section;

    let touched = false;
    const questions = section.questions.map((q, qIdx) => {
      const prev = prevSection.questions[qIdx];
      if (!prev?.locked) return q;
      // Same slot shape? Type and marks are the two properties that make a
      // question interchangeable with the slot it occupies.
      if (prev.type !== q.type || prev.total_marks !== q.total_marks) {
        unplaceable.push(prev);
        return q;
      }
      touched = true;
      restored += 1;
      // Keep the NEW slot's identity so the restored question is addressable in
      // the new paper; everything else is the preserved content.
      return { ...prev, localId: q.localId ?? prev.localId };
    });

    return touched ? { ...section, questions } : section;
  });

  // Locked questions in sections the new paper no longer has.
  for (let sIdx = fresh.sections.length; sIdx < previous.sections.length; sIdx++) {
    for (const q of previous.sections[sIdx]?.questions ?? []) {
      if (q.locked) unplaceable.push(q);
    }
  }

  return { paper: { ...fresh, sections }, restored, unplaceable };
}

/**
 * The confirm-dialog text for a whole-paper regeneration.
 *
 * The old copy was a blanket "regenerating will discard your edits", which was
 * simply untrue once locks exist and is the kind of warning faculty learn to
 * click past. This states exactly what will be kept and what will be replaced.
 */
export function regenerateConfirmMessage(
  part: LockPartition,
  editedSinceGeneration: boolean
): string | null {
  const lines: string[] = [];

  if (part.hasLocks) {
    const n = part.unlocked.length;
    lines.push(
      `Regenerate ${n} unlocked question${n === 1 ? "" : "s"}? ` +
        `${part.locked.length} locked question${part.locked.length === 1 ? "" : "s"} will be kept as-is.`
    );
    if (part.unidentifiedLocked > 0) {
      lines.push(
        `${part.unidentifiedLocked} locked question${part.unidentifiedLocked === 1 ? "" : "s"} ` +
          `cannot be carried forward automatically and may be regenerated.`
      );
    }
  } else if (editedSinceGeneration) {
    lines.push(
      "You've made edits since this paper was generated. Regenerating will discard them and produce a fresh paper. Continue?"
    );
  } else {
    // Nothing locked and nothing edited — no warning is warranted.
    return null;
  }

  if (part.hasLocks && editedSinceGeneration) {
    lines.push("Edits to unlocked questions will be discarded.");
  }

  return lines.join("\n\n");
}
