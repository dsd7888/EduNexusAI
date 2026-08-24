/**
 * CP-QC1 — question identity + bounded undo.
 *
 * Pure-function assertions, no DB / network / AI spend.
 *   npx tsx _cp_qc1_verify/pure.ts > _cp_qc1_verify/run.log 2>&1
 *
 * Covers the properties the rest of the feature set relies on: ids are unique
 * and stable, backfill is idempotent and collision-free, lookup rejects stale
 * ids, and the undo ring respects BOTH its depth and its byte ceiling.
 */
import {
  ensurePaperLocalIds,
  withLocalIds,
  paperHasAllLocalIds,
  findQuestionByLocalId,
  withUndoPushed,
  withUndoPopped,
  canUndo,
  stripPaperUndo,
  withQuestionReplaced,
  withRegeneratedContent,
  UNDO_DEPTH,
  UNDO_MAX_BYTES,
} from "../src/lib/qpaper/questionIdentity";
import type { AssembledPaper, GeneratedQuestion } from "../src/lib/qpaper/builder";

let pass = 0;
let fail = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.error(`FAIL: ${label}`);
  }
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makePaper(): AssembledPaper {
  return {
    universityName: "PPSU",
    courseCode: "CS101",
    courseName: "Data Structures",
    duration: 150,
    totalMarks: 60,
    instructions: [],
    sections: [
      {
        section_name: "Section I",
        module_range: [1, 4],
        questions: [
          {
            q_number: 1,
            type: "mcq",
            total_marks: 6,
            sub_parts: [
              { label: "i", question: "What is a stack?" },
              { label: "ii", question: "What is a queue?" },
            ],
          },
          {
            q_number: 2,
            type: "descriptive_with_or",
            total_marks: 12,
            parts: [
              { label: "a", question: "Explain BFS.", marks: 6 },
              { label: "b", question: "Explain DFS.", marks: 6 },
            ],
          },
        ],
      },
      {
        section_name: "Section II",
        module_range: [5, 8],
        questions: [
          {
            q_number: 3,
            type: "pool",
            total_marks: 12,
            items: [
              { itemType: "mcq", question_text: "Hash collision?" },
              { itemType: "short", question_text: "Define load factor." },
            ],
          },
        ],
      },
    ],
  };
}

function allIds(paper: AssembledPaper): string[] {
  const out: string[] = [];
  for (const s of paper.sections) {
    for (const q of s.questions) {
      if (q.localId) out.push(q.localId);
      for (const n of [...(q.sub_parts ?? []), ...(q.parts ?? []), ...(q.items ?? [])]) {
        if (n.localId) out.push(n.localId);
      }
    }
  }
  return out;
}

// ─── ensurePaperLocalIds ────────────────────────────────────────────────────

{
  const p = makePaper();
  assert(!paperHasAllLocalIds(p), "fresh fixture starts with no localIds");
  const assigned = ensurePaperLocalIds(p);
  // 3 questions + 2 sub_parts + 2 parts + 2 items = 9 nodes
  assert(assigned === 9, `assigns an id to every node (got ${assigned}, want 9)`);
  assert(paperHasAllLocalIds(p), "after the pass every node has an id");
  const ids = allIds(p);
  assert(new Set(ids).size === ids.length, "all assigned ids are unique");
}

{
  // Idempotence: a second pass must assign nothing and change nothing. This is
  // what keeps a history re-resume from looking like a real edit to the autosave.
  const p = makePaper();
  ensurePaperLocalIds(p);
  const before = JSON.stringify(p);
  const second = ensurePaperLocalIds(p);
  assert(second === 0, `second pass assigns nothing (got ${second})`);
  assert(JSON.stringify(p) === before, "second pass leaves the paper byte-identical");
}

{
  // Determinism: two independent backfills of the same legacy shape agree, so
  // undo/locks survive a reload.
  const a = makePaper();
  const b = makePaper();
  ensurePaperLocalIds(a);
  ensurePaperLocalIds(b);
  assert(
    JSON.stringify(allIds(a)) === JSON.stringify(allIds(b)),
    "backfill is deterministic across runs"
  );
}

{
  // Collision safety: a question inserted into an already-backfilled paper must
  // not be handed an id a shifted sibling already owns.
  const p = makePaper();
  ensurePaperLocalIds(p);
  const existing = p.sections[0].questions[0].localId!;
  p.sections[0].questions.unshift({
    q_number: 0,
    type: "descriptive",
    total_marks: 6,
  } as GeneratedQuestion);
  ensurePaperLocalIds(p);
  const ids = allIds(p);
  assert(new Set(ids).size === ids.length, "no duplicate ids after an insert + rebackfill");
  assert(
    p.sections[0].questions.some((q) => q.localId === existing),
    "the pre-existing question keeps its original id"
  );
}

{
  // Degenerate inputs must not throw — these reach the function from resumed
  // history rows of unknown vintage.
  assert(ensurePaperLocalIds({ sections: [] } as unknown as AssembledPaper) === 0, "empty sections");
  assert(
    ensurePaperLocalIds({} as unknown as AssembledPaper) === 0,
    "paper with no sections array"
  );
  const noKids = {
    sections: [{ section_name: "S", questions: [{ q_number: 1, type: "descriptive", total_marks: 6 }] }],
  } as unknown as AssembledPaper;
  assert(ensurePaperLocalIds(noKids) === 1, "question with no sub_parts/parts/items");
}

// ─── withLocalIds (non-mutating) ────────────────────────────────────────────

{
  const p = makePaper();
  const out = withLocalIds(p);
  assert(out !== p, "legacy paper is cloned, not mutated");
  assert(!paperHasAllLocalIds(p), "the original is left untouched");
  assert(paperHasAllLocalIds(out), "the clone is fully stamped");
}

{
  // Fast path: an already-stamped paper is returned by reference, no clone.
  const p = makePaper();
  ensurePaperLocalIds(p);
  assert(withLocalIds(p) === p, "already-stamped paper is returned as-is (no clone)");
}

// ─── findQuestionByLocalId ──────────────────────────────────────────────────

{
  const p = makePaper();
  ensurePaperLocalIds(p);
  const target = p.sections[1].questions[0].localId!;
  const hit = findQuestionByLocalId(p, target);
  assert(hit !== null, "finds a question by id");
  assert(hit!.sectionIndex === 1 && hit!.questionIndex === 0, "reports the right position");

  // The stale-result case: a regeneration whose question no longer exists must
  // resolve to null so the caller discards it instead of splicing blind.
  assert(findQuestionByLocalId(p, "q-does-not-exist") === null, "unknown id → null");
  assert(findQuestionByLocalId(null, target) === null, "null paper → null");
  assert(findQuestionByLocalId(p, "") === null, "empty id → null");

  // Position must be looked up live, not cached: after a reorder the same id
  // resolves to its new index.
  p.sections[1].questions.unshift({ q_number: 9, type: "descriptive", total_marks: 2, localId: "q-new" });
  const after = findQuestionByLocalId(p, target);
  assert(after!.questionIndex === 1, "id survives a reorder and reports the new index");
}

// ─── Undo ───────────────────────────────────────────────────────────────────

{
  const q: GeneratedQuestion = {
    q_number: 1, type: "descriptive", total_marks: 6, localId: "q-1",
    parts: [{ label: "a", question: "ORIGINAL", marks: 6 }],
  };
  assert(!canUndo(q), "a fresh question has nothing to undo");

  const pushed = withUndoPushed(q, "Regenerated question");
  assert(q.undoStack === undefined, "withUndoPushed does not mutate its input");
  assert(canUndo(pushed), "after a push there is something to undo");
  assert(pushed.undoStack!.length === 1, "one entry after one push");
  assert(pushed.undoStack![0].reason === "Regenerated question", "reason is recorded");

  // Apply a change on top, then undo it.
  const changed: GeneratedQuestion = {
    ...pushed,
    parts: [{ label: "a", question: "REGENERATED", marks: 6 }],
  };
  const popped = withUndoPopped(changed);
  assert(popped !== null, "undo returns a result");
  assert(popped!.question.parts![0].question === "ORIGINAL", "undo restores the previous text");
  assert(popped!.question.localId === "q-1", "undo preserves the live localId");
  assert(!canUndo(popped!.question), "the ring is empty after the only entry is used");
}

{
  // A snapshot must never contain its own history — nested stacks would grow
  // the autosave payload geometrically.
  let q: GeneratedQuestion = {
    q_number: 1, type: "descriptive", total_marks: 6, localId: "q-1",
    parts: [{ label: "a", question: "v0", marks: 6 }],
  };
  for (let i = 1; i <= 3; i++) {
    q = withUndoPushed(q, `edit ${i}`);
    q = { ...q, parts: [{ label: "a", question: `v${i}`, marks: 6 }] };
  }
  assert(
    q.undoStack!.every((e) => e.question.undoStack === undefined),
    "no snapshot carries a nested undoStack"
  );
}

{
  // Depth cap, and that the ring drops the OLDEST entry.
  let q: GeneratedQuestion = {
    q_number: 1, type: "descriptive", total_marks: 6, localId: "q-1",
    parts: [{ label: "a", question: "v0", marks: 6 }],
  };
  for (let i = 1; i <= UNDO_DEPTH + 3; i++) {
    q = withUndoPushed(q, `edit ${i}`);
    q = { ...q, parts: [{ label: "a", question: `v${i}`, marks: 6 }] };
  }
  assert(q.undoStack!.length === UNDO_DEPTH, `ring is capped at ${UNDO_DEPTH}`);
  const newest = q.undoStack![q.undoStack!.length - 1];
  assert(
    newest.question.parts![0].question === `v${UNDO_DEPTH + 2}`,
    "newest entry is the most recent prior version"
  );
  const oldest = q.undoStack![0];
  assert(
    oldest.question.parts![0].question === `v${3}`,
    "oldest surviving entry is correct (older ones dropped)"
  );

  // Stepping back repeatedly must keep working down the ring.
  let cur = q;
  let steps = 0;
  while (canUndo(cur)) {
    cur = withUndoPopped(cur)!.question;
    steps += 1;
  }
  assert(steps === UNDO_DEPTH, `can step back exactly ${UNDO_DEPTH} times`);
}

{
  // Byte ceiling: a pool block big enough to breach UNDO_MAX_BYTES must shed
  // entries rather than bloat every autosave.
  const bigItems = Array.from({ length: 20 }, (_, i) => ({
    itemType: "short" as const,
    question_text: "x".repeat(900) + i,
  }));
  let q: GeneratedQuestion = {
    q_number: 1, type: "pool", total_marks: 20, localId: "q-pool", items: bigItems,
  };
  for (let i = 0; i < UNDO_DEPTH; i++) q = withUndoPushed(q, `edit ${i}`);
  const bytes = new TextEncoder().encode(JSON.stringify(q.undoStack)).length;
  assert(bytes <= UNDO_MAX_BYTES, `oversized stack trimmed to the ceiling (${bytes}B)`);
  assert(q.undoStack!.length >= 1, "at least one undo level is always retained");
  // Guards the assertion above against becoming vacuous: if the fixture ever
  // stops being big enough to breach the ceiling, the trim is never exercised
  // and "<= ceiling" would pass for the wrong reason.
  assert(
    q.undoStack!.length < UNDO_DEPTH,
    `byte ceiling actually fired (kept ${q.undoStack!.length} of ${UNDO_DEPTH})`
  );
}

{
  // `locked` is faculty intent about the slot, not a property of the generated
  // content, so it must survive an undo.
  const q: GeneratedQuestion = {
    q_number: 1, type: "descriptive", total_marks: 6, localId: "q-1", locked: false,
    parts: [{ label: "a", question: "ORIGINAL", marks: 6 }],
  };
  const pushed = withUndoPushed(q, "regen");
  const changedAndLocked: GeneratedQuestion = {
    ...pushed, locked: true, parts: [{ label: "a", question: "NEW", marks: 6 }],
  };
  const popped = withUndoPopped(changedAndLocked)!;
  assert(popped.question.parts![0].question === "ORIGINAL", "content is restored");
  assert(popped.question.locked === true, "lock intent survives undo");
}

{
  assert(withUndoPopped({ q_number: 1, type: "descriptive", total_marks: 6 }) === null,
    "undo on an empty ring returns null");
}

// ─── withQuestionReplaced / withRegeneratedContent ──────────────────────────

{
  const p = makePaper();
  ensurePaperLocalIds(p);
  const targetId = p.sections[0].questions[1].localId!;

  const next = withQuestionReplaced(p, targetId, (q) => ({ ...q, total_marks: 99 }));
  assert(next !== null, "replaces an existing question");
  assert(next!.sections[0].questions[1].total_marks === 99, "the update is applied");
  assert(p.sections[0].questions[1].total_marks === 12, "the input paper is not mutated");
  // Untouched sections keep identity so React re-renders only what changed.
  assert(next!.sections[1] === p.sections[1], "untouched sections are referentially stable");

  // THE STALE-RESULT CASE: a regeneration resolving after its question is gone
  // must be discarded, not written into whatever now occupies that index.
  assert(
    withQuestionReplaced(p, "q-vanished", (q) => q) === null,
    "[REGRESSION] a vanished question yields null so the caller discards the result"
  );
}

{
  // Regenerated content replaces the CONTENT but never the slot's identity,
  // the faculty's lock, or the undo history.
  const original: GeneratedQuestion = {
    q_number: 1, type: "descriptive", total_marks: 6,
    localId: "q-keep", locked: true,
    parts: [{ label: "a", question: "ORIGINAL", marks: 6 }],
  };
  const replacement: GeneratedQuestion = {
    q_number: 1, type: "descriptive", total_marks: 6,
    localId: "q-from-server", locked: false,
    parts: [{ label: "a", question: "NEW", marks: 6 }],
  };

  const merged = withRegeneratedContent(original, replacement, "Regenerated question");
  assert(merged.parts![0].question === "NEW", "new content is applied");
  assert(merged.localId === "q-keep", "the slot's localId wins over the server's");
  assert(merged.locked === true, "the faculty's lock survives regeneration");
  assert(merged.undoStack?.length === 1, "the previous version is pushed onto the ring");
  assert(
    merged.undoStack![0].question.parts![0].question === "ORIGINAL",
    "the snapshot holds the pre-regeneration content"
  );

  // And undoing it gets the original back.
  const undone = withUndoPopped(merged)!;
  assert(undone.question.parts![0].question === "ORIGINAL", "undo restores the original content");
  assert(undone.question.localId === "q-keep", "identity is stable across regenerate + undo");
}

// ─── stripPaperUndo ─────────────────────────────────────────────────────────

{
  const p = makePaper();
  ensurePaperLocalIds(p);
  p.sections[0].questions[0] = withUndoPushed(p.sections[0].questions[0], "regen");
  assert(canUndo(p.sections[0].questions[0]), "precondition: question has history");

  const stripped = stripPaperUndo(p);
  assert(
    stripped.sections.every((s) => s.questions.every((q) => q.undoStack === undefined)),
    "export path carries no undo history"
  );
  assert(canUndo(p.sections[0].questions[0]), "stripPaperUndo does not mutate the original");
  assert(
    stripped.sections[0].questions[0].localId === p.sections[0].questions[0].localId,
    "stripping preserves identity"
  );
}

// ─── Result ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("RESULT: FAIL");
  process.exit(1);
}
console.log("RESULT: PASS");
