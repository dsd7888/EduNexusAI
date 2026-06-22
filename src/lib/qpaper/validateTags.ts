/**
 * CO/BTL tag validation for generated question-paper questions.
 *
 * A Flash-backed "judge" that decides whether a question's *actual content and
 * cognitive demand* genuinely match its claimed Course Outcome (CO) and Bloom's
 * Taxonomy Level (BTL) — not whether the labels merely look well-formed. Used as
 * a post-generation pass: every AI-generated atomic unit (sub-part / part) is
 * checked in one concurrent batch, and only genuine mismatches are surfaced.
 */

import { routeAI } from "@/lib/ai/router";
import { BLOOMS_LEGEND } from "./templates";
import type {
  CourseOutcomeRow,
  GeneratedSection,
  QuestionPart,
  SubQuestion,
} from "./builder";

export interface TagValidation {
  /** True when the claimed CO and BTL both genuinely fit the question. */
  matches: boolean;
  /** A better-fitting CO code, only when the claimed CO is wrong. */
  suggestedCO?: string;
  /** A better-fitting BTL (1-6), only when the claimed BTL is wrong. */
  suggestedBTL?: number;
  /** One-or-two sentence justification (shown to faculty on the flag). */
  reasoning: string;
}

export interface QuestionTagInput {
  questionText: string;
  /** Claimed CO code, e.g. "CO2" (or null when untagged). */
  claimedCO: string | null;
  /** Claimed Bloom's level 1-6 (or null when untagged). */
  claimedBTL: number | null;
}

export interface CourseOutcomeContext {
  /** Description the claimed CO code maps to, or null if it can't be resolved. */
  claimedDescription: string | null;
  /** Every CO for the subject — lets the judge suggest a better-fitting code. */
  allOutcomes: CourseOutcomeRow[];
}

const SYSTEM_PROMPT =
  "You are a strict outcome-based-education (OBE) auditor for an engineering " +
  "university question paper. You judge whether a question's ACTUAL subject " +
  "matter and cognitive demand genuinely match its claimed Course Outcome (CO) " +
  "and Bloom's Taxonomy Level (BTL) — never whether the labels merely look " +
  "well-formatted. Be conservative: report a mismatch only when the question " +
  "clearly tests a different outcome or a clearly different cognitive level.";

// Schema-constrained output — Gemini guarantees the shape, so no parse retry.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    matches: {
      type: "boolean",
      description:
        "true if the claimed CO and BTL both genuinely fit the question",
    },
    suggestedCO: {
      type: "string",
      description:
        "A better-fitting CO code from the provided list, only when the CO is wrong. Omit when matches is true.",
    },
    suggestedBTL: {
      type: "integer",
      description:
        "The true Bloom's level 1-6, only when the claimed BTL is wrong. Omit when matches is true.",
    },
    reasoning: {
      type: "string",
      description: "One or two sentences justifying the verdict",
    },
  },
  required: ["matches", "reasoning"],
};

function bloomName(level: number | null): string {
  return BLOOMS_LEGEND.find((b) => b.level === level)?.name ?? "unknown";
}

/**
 * Resolve a CO code to its description, tolerating "CO2" / "co-2" / "2" forms.
 */
export function resolveCoDescription(
  code: string | null,
  outcomes: CourseOutcomeRow[]
): string | null {
  if (!code) return null;
  const norm = (s: string) => s.replace(/[^0-9a-z]/gi, "").toLowerCase();
  const target = norm(code);
  const direct = outcomes.find((c) => norm(c.co_code) === target);
  if (direct) return direct.description;
  const digits = code.replace(/\D+/g, "");
  if (digits) {
    const byDigit = outcomes.find(
      (c) => c.co_code.replace(/\D+/g, "") === digits
    );
    if (byDigit) return byDigit.description;
  }
  return null;
}

/**
 * Judge a single question's CO/BTL tags against its content and the syllabus.
 * Always resolves — on any error (or an untagged question) it returns a clean
 * pass, so a flaky judge never adds noise to an otherwise valid paper.
 */
export async function validateQuestionTags(
  question: QuestionTagInput,
  courseOutcome: CourseOutcomeContext,
  moduleContent: string
): Promise<TagValidation> {
  const text = question.questionText.trim();
  // Nothing to judge against → treat as a pass (no flag, no noise).
  if (!text || question.claimedCO == null || question.claimedBTL == null) {
    return { matches: true, reasoning: "" };
  }

  const coList =
    courseOutcome.allOutcomes
      .map((c) => `${c.co_code}: ${c.description}`)
      .join("\n") || "(no course outcomes defined)";

  const prompt = `<question>
${text}
</question>

Claimed CO: ${question.claimedCO}${
    courseOutcome.claimedDescription
      ? ` — ${courseOutcome.claimedDescription}`
      : " (description unavailable)"
  }
Claimed BTL: ${question.claimedBTL} (${bloomName(question.claimedBTL)})

<bloom_levels>
1 Remember · 2 Understand · 3 Apply · 4 Analyze · 5 Evaluate · 6 Create
</bloom_levels>

<course_outcomes>
${coList}
</course_outcomes>

<module_content>
${moduleContent.slice(0, 3000) || "(no module content available)"}
</module_content>

Decide:
1. CO — does the question's subject matter genuinely fall under the claimed CO? If a different CO from the list fits clearly better, set suggestedCO to that CO code.
2. BTL — does the verb/task genuinely demand the claimed cognitive level? A question that only asks to recall a definition is BTL 1 even if labelled BTL 4; one requiring real analysis is BTL 4 even if labelled BTL 2. If the true level differs, set suggestedBTL (1-6).

Set matches=false ONLY when the CO or the BTL is clearly wrong. When matches=true, omit suggestedCO and suggestedBTL. Keep reasoning to one or two sentences.`;

  try {
    const result = await routeAI("qpaper_validate_tags", {
      messages: [{ role: "user", content: prompt }],
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0,
      thinkingBudget: 0,
      maxTokens: 512,
      responseSchema: RESPONSE_SCHEMA,
    });

    const parsed = JSON.parse(
      String(result.content ?? "")
    ) as Partial<TagValidation>;
    const matches = parsed.matches !== false; // default to pass if absent
    const out: TagValidation = {
      matches,
      reasoning:
        typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
    if (!matches) {
      // Only surface suggestions that actually differ from the claimed tags.
      const sco =
        typeof parsed.suggestedCO === "string" ? parsed.suggestedCO.trim() : "";
      if (
        sco &&
        sco.toUpperCase() !== question.claimedCO.toUpperCase()
      ) {
        out.suggestedCO = sco;
      }
      const sbtl = Number(parsed.suggestedBTL);
      if (
        Number.isInteger(sbtl) &&
        sbtl >= 1 &&
        sbtl <= 6 &&
        sbtl !== question.claimedBTL
      ) {
        out.suggestedBTL = sbtl;
      }
    }
    return out;
  } catch (err) {
    console.error(
      "[validateQuestionTags] failed:",
      err instanceof Error ? err.message : err
    );
    // A flaky judge must never add noise to a clean paper.
    return { matches: true, reasoning: "" };
  }
}

/**
 * Validate every AI-generated tagged unit across the paper in ONE concurrent
 * batch (not N sequential round-trips), mutating each unit in place. Only
 * genuine mismatches get a `validation` attached — passing units stay untouched,
 * so the payload (and the UI) stays clean. Bank-sourced units are skipped: they
 * are faculty-verified and must not be re-judged.
 *
 * `moduleContentBySection[i]` is the syllabus content for `sections[i]`.
 */
export async function attachTagValidations(
  sections: GeneratedSection[],
  outcomes: CourseOutcomeRow[],
  moduleContentBySection: string[]
): Promise<void> {
  type Unit = SubQuestion | QuestionPart;
  const jobs: Array<{ unit: Unit; moduleContent: string }> = [];

  sections.forEach((section, sIdx) => {
    const moduleContent = moduleContentBySection[sIdx] ?? "";
    for (const q of section.questions) {
      if (q.type === "pool" && q.items) {
        for (const item of q.items) {
          if (item.co == null || item.btl == null) continue;
          jobs.push({
            unit: {
              question: item.question_text,
              co: item.co,
              btl: item.btl,
              po: item.po,
            } as SubQuestion,
            moduleContent,
          });
        }
        continue;
      }
      const units: Unit[] = [...(q.sub_parts ?? []), ...(q.parts ?? [])];
      for (const u of units) {
        if (u.from_bank) continue; // verified — don't re-judge
        if (u.co == null || u.btl == null) continue; // nothing to validate
        jobs.push({ unit: u, moduleContent });
      }
    }
  });

  if (jobs.length === 0) return;

  await Promise.all(
    jobs.map(async ({ unit, moduleContent }) => {
      const validation = await validateQuestionTags(
        {
          questionText: unit.question,
          claimedCO: unit.co ?? null,
          claimedBTL: unit.btl ?? null,
        },
        {
          claimedDescription: resolveCoDescription(unit.co ?? null, outcomes),
          allOutcomes: outcomes,
        },
        moduleContent
      );
      // Invisible when fine: only attach on a real mismatch.
      if (!validation.matches) unit.validation = validation;
    })
  );
}
