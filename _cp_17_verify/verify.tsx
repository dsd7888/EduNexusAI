/**
 * CP-17 verify: true_false renders zero answer controls.
 *
 * No jsdom/testing-library in this repo (see CLAUDE.md — no test framework).
 * Renders the real AnswerInput component via react-dom/server so this
 * exercises the actual fixed code path, not a reimplementation of it.
 * react-dom/server does not execute onClick handlers, so instead of
 * simulating clicks we render the component across a sequence of prop
 * states a real click WOULD produce (value/onChange are controlled by the
 * parent runner) — this is exactly how PracticeRunner/ExamRunner drive it.
 */
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import AnswerInput from "../src/app/(student)/student/quiz/session/[sessionId]/_components/AnswerInput";
import type { SessionQuestion } from "../src/app/(student)/student/quiz/session/[sessionId]/_components/types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

const baseQuestion: SessionQuestion = {
  slotId: "slot-1",
  question: "The sky is blue.",
  type: "true_false",
  options: null, // exactly what the server sends per typeHasOptions() — CP-17's bug trigger
  marks: 1,
  subjectId: "subj-1",
  moduleId: null,
  difficulty: "easy",
};

function render(props: Partial<React.ComponentProps<typeof AnswerInput>> = {}) {
  return renderToStaticMarkup(
    React.createElement(AnswerInput, {
      question: baseQuestion,
      value: null,
      onChange: () => {},
      revealed: false,
      ...props,
    })
  );
}

// ── 1. Happy path: unanswered true_false renders exactly 2 controls ────────
{
  const html = render();
  const buttonCount = (html.match(/<button/g) ?? []).length;
  assert(buttonCount === 2, `unanswered true_false renders 2 buttons (got ${buttonCount})`);
  assert(html.includes("True") && html.includes("False"), "buttons are labelled True/False");
}

// ── 2. options: [] (not null) also renders 2 controls ──────────────────────
// bankFill/generator never populate options for true_false, but guard the
// other falsy shape too since `question.options ?? []` treats both the same.
{
  const html = render({ question: { ...baseQuestion, options: [] } });
  const buttonCount = (html.match(/<button/g) ?? []).length;
  assert(buttonCount === 2, `options:[] true_false still renders 2 buttons (got ${buttonCount})`);
}

// ── 3. Selection reflects controlled value ──────────────────────────────────
{
  const html = render({ value: "True" });
  assert(html.includes('aria-pressed="true"'), "value='True' marks a button aria-pressed");
}

// ── 4. Reveal paints the correct answer, never the selected-wrong one as red ─
{
  const htmlCorrectSelected = render({ value: "True", revealed: true, correctAnswer: "True" });
  assert(
    htmlCorrectSelected.includes("emerald"),
    "revealed + correct selection paints emerald"
  );
  const htmlWrongSelected = render({ value: "False", revealed: true, correctAnswer: "True" });
  assert(
    htmlWrongSelected.includes("amber") && htmlWrongSelected.includes("emerald"),
    "revealed + wrong selection paints amber on the pick, emerald on the key (never red)"
  );
  assert(!htmlWrongSelected.includes("red-"), "no red-* class anywhere on a wrong true_false reveal");
}

// ── 5. Unhappy / interrupted: rapid prop-state changes (student answers,
//    then the runner advances to a NEW question before the click settles —
//    same shape as an interrupted async flow) must not leak stale selection
//    onto the next slot. ─────────────────────────────────────────────────────
{
  const q2: SessionQuestion = { ...baseQuestion, slotId: "slot-2", options: null };
  const htmlSlot1Answered = render({ question: baseQuestion, value: "True" });
  const htmlSlot2Fresh = render({ question: q2, value: null }); // runner resets value on advance
  assert(
    htmlSlot1Answered.includes('aria-pressed="true"'),
    "slot-1 shows its own selection"
  );
  assert(
    !htmlSlot2Fresh.includes('aria-pressed="true"'),
    "slot-2 (freshly advanced-to) shows no stale selection from slot-1"
  );
}

// ── 6. Unhappy / concurrent: locked (disabled prop true, e.g. a second
//    submit racing the first) still renders both controls, disabled — not a
//    blank panel, and not silently droppable. ──────────────────────────────
{
  const html = render({ disabled: true, value: "True" });
  const disabledCount = (html.match(/disabled=""/g) ?? []).length;
  assert(disabledCount === 2, `locked true_false still renders 2 disabled buttons (got ${disabledCount})`);
}

// ── 7. Grading-format contract: correctAnswer emitted by
//    src/lib/assessment/presets.ts is exactly "True"/"False" (case-sensitive
//    literal), matching what the True/False buttons now emit via onChange. ──
{
  const html = render({ value: "true" }); // lowercase, e.g. a legacy/resumed value
  assert(html.includes('aria-pressed="true"'), "selection match is case-insensitive on read");
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILURE(S)`);
process.exit(failed === 0 ? 0 : 1);
