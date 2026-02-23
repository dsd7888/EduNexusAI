export type RefinementType =
  | "readability"
  | "examples"
  | "practice"
  | "expand"
  | "simplify";

export const REFINEMENT_LABELS: Record<RefinementType, string> = {
  readability: "Improve Readability",
  examples: "Add Real-World Examples",
  practice: "Add Practice Problems",
  expand: "Expand Thin Sections",
  simplify: "Simplify for Lower Semester",
};

export function buildRefinementPrompt(options: {
  subjectName: string;
  syllabusContent: string;
  contentToRefine: string;
  refinementTypes: RefinementType[];
  targetSemester?: number;
}): string {
  const {
    subjectName,
    syllabusContent,
    contentToRefine,
    refinementTypes,
    targetSemester,
  } = options;

  const selected = refinementTypes.length
    ? refinementTypes.join(", ")
    : "readability";

  const targetSemText =
    refinementTypes.includes("simplify") && targetSemester
      ? `Target students are semester ${targetSemester} level.`
      : "";

  return `You are an expert academic content editor for ${subjectName}.
Use the syllabus as background context for accuracy.

SYLLABUS CONTENT:
${syllabusContent}

ORIGINAL CONTENT TO REFINE:
${contentToRefine}

APPLY ONLY THESE REFINEMENTS (DO NOT APPLY OTHERS):
Selected refinement types: ${selected}.

If 'readability' is selected:
- Restructure content with clear headings and subheadings.
- Break long paragraphs into digestible chunks.
- Use simple, direct language — no unnecessary jargon.
- Add bullet points where lists make sense.
- Ensure logical flow from one concept to the next.

If 'examples' is selected:
- Add 1-2 modern, real-world examples per major concept.
- Examples should be relatable (industry, everyday life, current tech).
- Clearly label them with the prefix: "Real-World Example:".
- Connect each example back to the theoretical concept.

If 'practice' is selected:
- Add 2-3 practice problems at the end of each major section.
- Vary difficulty: one easy, one medium, one challenging.
- Include brief solution hints (not full solutions).
- Label clearly using: "Practice Problem X:" where X is the number.

If 'expand' is selected:
- Identify sections that are too brief or under-explained.
- Add depth: more explanation, derivations, and contextual detail.
- Do NOT pad with filler — only add genuinely useful content.
- Mark expanded sections with the prefix: "📌 Expanded:".

If 'simplify' is selected:
- ${targetSemText || "Target students are lower semester level."}
- Replace advanced terminology with simpler equivalents where possible.
- Add brief definitions when technical terms must be used.
- Use analogies to explain abstract concepts.
- Prefer shorter sentences and active voice.

FORMAT RULES:
- Use markdown formatting: headings with "##", bullets with "- ", and bold with **...**.
- Preserve the original structure and topic order.
- Do NOT remove any original content — only enhance and add to it.
- Return the complete refined content, not just a diff or list of changes.

IMPORTANT OUTPUT INSTRUCTIONS:
- Start directly with the refined content.
- Do NOT add any preamble like "Here is the refined version...".
- Do NOT add any closing remarks.
- The response must contain only the improved content.`;
}

