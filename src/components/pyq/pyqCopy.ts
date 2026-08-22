/**
 * Every faculty-facing sentence about past papers, in one place.
 *
 * WHY CENTRALISED: this feature's whole premise is that faculty will only do
 * unpaid data entry if the reason is specific and checkable. The moment the
 * qpaper page says one thing ("better questions") and the Past Papers tab says
 * another ("more accurate"), the claim reads as marketing and gets discounted
 * — along with everything else the platform tells them. One wording, five
 * surfaces.
 *
 * RULES THIS COPY FOLLOWS:
 *  - Name the mechanism, never a number. "Mirrors your department's phrasing,
 *    marks ladder and difficulty" is checkable by looking at the output. "40%
 *    more accurate" is not substantiable and one sceptical HOD asking "based on
 *    what?" costs the pilot.
 *  - State the current fallback honestly. With no papers the generator leans on
 *    the subject-family archetype hints in src/lib/qpaper/archetypes.ts — i.e.
 *    it is guessing the exam style from the subject family. Saying so motivates
 *    more strongly than any benefit claim, because it is a specific admission.
 *  - Frame the library as THEIRS and accumulating, not as help for us. "Add
 *    your papers to this subject's library" beats "help improve the AI".
 */

/** The one-line reason, used wherever the capability is offered but inert. */
export const PYQ_BENEFIT_SHORT =
  "Past papers let the AI mirror your department's actual phrasing, marks ladder and difficulty.";

/** The honest statement of what happens without them. */
export const PYQ_FALLBACK_NOTE =
  "Without them, questions are written from the syllabus alone and the exam style is inferred from the subject family.";

/** Two-sentence version for the Past Papers tab header and the upload dialog. */
export const PYQ_BENEFIT_LONG = `${PYQ_BENEFIT_SHORT} ${PYQ_FALLBACK_NOTE}`;

/** Inline note on a disabled PYQ control. Deliberately not a sales pitch. */
export const PYQ_EMPTY_HINT = "No past papers uploaded for this subject";

/** Label used for the action everywhere, so it is recognisable across pages. */
export const PYQ_UPLOAD_CTA = "Upload past papers";

/** What each surface gains, for the "what this unlocks" list in the dialog. */
export const PYQ_UNLOCKS: ReadonlyArray<{ where: string; what: string }> = [
  {
    where: "Q Paper",
    what: "the PYQ-style sourcing category, which mirrors real past questions instead of writing fresh ones",
  },
  {
    where: "Q Bank",
    what: "PYQ-Inspired generation — same concept as a real past question, different values and framing",
  },
  {
    where: "Student notes",
    what: "the exam-frequency signal that marks which modules are actually examined often",
  },
];
