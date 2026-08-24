/**
 * Regeneration modes for a single question / part / sub-part / pool item.
 *
 * Before this, the regenerate button had exactly one behaviour, and two
 * complaints followed from it:
 *
 *   - it silently changed the question's TOPIC, with no way to ask for "same
 *     idea, different wording" versus "something else from this unit"; and
 *   - the replacement was often worse than what it replaced, with no way back
 *     (see questionIdentity.ts for the undo ring that fixes the second half).
 *
 * Kept in lib/ rather than in the route so the prompt wording, the caps and the
 * token budget are shared by the API and testable without a network call.
 */

/** What the faculty asked for when they pressed regenerate. */
export type RegenerateMode =
  /** Same concept, different question. The historical behaviour. */
  | "same_topic"
  /** A different concept from the same module. */
  | "different_topic"
  /** Faculty-authored free-text steering. */
  | "custom";

export const REGENERATE_MODES: RegenerateMode[] = [
  "same_topic",
  "different_topic",
  "custom",
];

/**
 * Upper bound on alternatives per request.
 *
 * Five is the number the faculty actually asked for ("give me 5 other
 * alternatives"), and it is also about as many as fit in a chooser without
 * becoming a reading task. It drives the token budget below, so raising it
 * without raising that budget would truncate the JSON.
 */
export const MAX_ALTERNATIVES = 5;

/** Cap on faculty free-text. Long enough for a real instruction, short enough
 *  that it cannot crowd out the syllabus context in the prompt window. */
export const MAX_CUSTOM_INSTRUCTION_CHARS = 1000;

export function parseRegenerateMode(raw: unknown): RegenerateMode {
  const s = String(raw ?? "").trim();
  return (REGENERATE_MODES as string[]).includes(s)
    ? (s as RegenerateMode)
    : "same_topic";
}

export function parseAlternativesCount(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n <= 1) return 1;
  return Math.min(MAX_ALTERNATIVES, n);
}

/**
 * Sanitise faculty free-text before it is interpolated into the prompt.
 *
 * The instruction is a legitimate steering channel, but it is still untrusted
 * text landing in a prompt. Control characters are stripped (they can break the
 * XML-ish block structure the prompt relies on) and the whole thing is length-
 * capped. It is always wrapped in a labelled block by the caller so the model
 * reads it as a faculty request, not as a new system directive.
 */
export function sanitizeCustomInstruction(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CUSTOM_INSTRUCTION_CHARS);
}

/**
 * Token budget for one regeneration request.
 *
 * The route previously hard-coded 2048, which is fine for one question and
 * silently truncates the JSON at five. Scales with the number of alternatives
 * and stays within the qpaper_gen ceiling.
 */
export function regenerateMaxTokens(alternativesCount: number): number {
  const n = Math.max(1, alternativesCount);
  return Math.min(8192, 2048 + (n - 1) * 1400);
}

/**
 * The steering block for a mode.
 *
 * `same_topic` deliberately keeps the historical "related topic" phrasing so
 * default behaviour is unchanged. `different_topic` has to actively contradict
 * it — the old <avoid> text asked for "a genuinely different question on a
 * RELATED topic", which fights a request to move off the topic entirely.
 */
export function modeDirective(
  mode: RegenerateMode,
  customInstruction: string
): string {
  switch (mode) {
    case "different_topic":
      return `<topic_directive>
Choose a DIFFERENT concept from within this question's module — not a rewording
of the previous question and not the same underlying idea. Stay inside the
module's syllabus content, keep the same question type, marks and difficulty,
and keep the CO/BTL tags appropriate to the new concept.
</topic_directive>`;
    case "custom":
      return `<faculty_instruction>
The faculty member has asked for this specific change. Treat it as a binding
requirement on the question you produce, subject only to keeping the question
type and mark value intact:

"${customInstruction}"
</faculty_instruction>`;
    case "same_topic":
    default:
      return `<topic_directive>
Keep the same underlying concept as the previous question, but ask about it
differently — a new scenario, framing, or angle. Same type, marks and difficulty.
</topic_directive>`;
  }
}

/** The "don't repeat this" block, phrased to suit the mode. */
export function avoidDirective(mode: RegenerateMode, previous: string): string {
  const head =
    mode === "different_topic"
      ? "Do NOT reuse the concept or the wording of the previous question below."
      : "Do NOT repeat the previous question text below.";
  return `<avoid>
${head}
${previous.slice(0, 1500)}
</avoid>`;
}
