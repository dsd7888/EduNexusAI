import { requireRole, apiError } from "@/lib/api/helpers";
import { routeAI } from "@/lib/ai/router";
import { repairGeminiJsonEscapes } from "@/lib/text/latexSegments";
import { normaliseQuestion, sanitizeQuestionCoCodes } from "@/lib/qpaper/sectionGen";
import type { AILogContext } from "@/lib/ai/providers/types";
import type { TemplateQuestion } from "@/lib/qpaper/templates";
import {
  avoidDirective,
  modeDirective,
  parseAlternativesCount,
  parseRegenerateMode,
  regenerateMaxTokens,
  sanitizeCustomInstruction,
} from "@/lib/qpaper/regenerateModes";
import type { NextRequest } from "next/server";

const SYSTEM_PROMPT = `You are an expert question paper setter for Indian engineering universities.
Respond ONLY with valid JSON for a SINGLE question object. First char {, last char }. No markdown. No prose.`;

const SYSTEM_PROMPT_ARRAY = `You are an expert question paper setter for Indian engineering universities.
Respond ONLY with a valid JSON ARRAY of question objects. First char [, last char ]. No markdown. No prose.`;

/**
 * Pull the JSON payload out of a model response.
 *
 * The previous implementation stripped code fences then sliced between the
 * first `{` and last `}`. That is correct for a single object and silently
 * wrong for an array — it would return the array's first element glued to its
 * last, producing either a parse error or, worse, a plausible-looking wrong
 * object. `wantArray` picks the right delimiters.
 *
 * Returns undefined (not null) on failure, so a legitimately-null payload is
 * distinguishable from a parse failure.
 */
function extractJson(raw: string, wantArray: boolean): unknown {
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();

  const attempt = (open: string, close: string): unknown => {
    const first = cleaned.indexOf(open);
    const last = cleaned.lastIndexOf(close);
    if (first === -1 || last === -1 || last <= first) return undefined;
    try {
      // §13: repair the Gemini escape collision before parsing.
      return JSON.parse(repairGeminiJsonEscapes(cleaned.slice(first, last + 1)));
    } catch {
      return undefined;
    }
  };

  // Try the expected shape first, then the other one: a model that ignores the
  // array instruction still produced usable work, and failing the request would
  // waste a paid call over a formatting slip.
  const primary = wantArray ? attempt("[", "]") : attempt("{", "}");
  if (primary !== undefined) return primary;
  return wantArray ? attempt("{", "}") : attempt("[", "]");
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const body = (await request.json()) as Record<string, unknown>;
    const jobId = crypto.randomUUID();
    const contentId =
      typeof body.contentId === "string" && body.contentId.trim()
        ? body.contentId.trim()
        : typeof body.content_id === "string" && body.content_id.trim()
          ? body.content_id.trim()
          : null;
    const subjectId =
      typeof body.subjectId === "string" && body.subjectId.trim()
        ? body.subjectId.trim()
        : typeof body.subject_id === "string" && body.subject_id.trim()
          ? body.subject_id.trim()
          : null;
    let subjectCode: string | null = null;
    if (subjectId) {
      const { data: subjectRow } = await adminClient
        .from("subjects")
        .select("code")
        .eq("id", subjectId)
        .maybeSingle();
      subjectCode =
        typeof (subjectRow as { code?: unknown } | null)?.code === "string"
          ? ((subjectRow as { code: string }).code || null)
          : null;
    }
    const templateQuestion = body.template_question as
      | TemplateQuestion
      | undefined;
    const sectionModules =
      (body.section_modules as Array<Record<string, unknown>>) ?? [];
    const pyqContext = String(body.pyq_context ?? "").slice(0, 4000);
    const coPoData = body.co_po_data as
      | { courseOutcomes?: Array<{ co_code: string; description: string }> }
      | undefined;
    const avoidText = String(body.question_context ?? "");
    // ── Regeneration steering ───────────────────────────────────────────
    // mode: same_topic (default, historical behaviour) | different_topic |
    // custom. alternatives_count > 1 asks for a set to choose from.
    const mode = parseRegenerateMode(body.mode);
    const customInstruction = sanitizeCustomInstruction(body.custom_instruction);
    const alternativesCount = parseAlternativesCount(body.alternatives_count);
    // A "custom" request with no usable instruction is a no-op dressed up as a
    // mode — reject it rather than silently regenerating with default steering,
    // which would look like the instruction was ignored.
    if (mode === "custom" && !customInstruction) {
      return apiError("custom_instruction is required when mode is 'custom'", 400);
    }
    // Optional retag target (e.g. from a tag-validation "Regenerate instead"):
    // steer the new question toward a specific CO/BTL.
    const targetTags = body.target_tags as
      | { co?: string | number | null; btl?: number | null }
      | undefined;

    if (!templateQuestion) {
      return apiError("template_question is required", 400);
    }

    const moduleBlock = sectionModules
      .map(
        (m) =>
          `Module ${m.module_number}: ${m.name}\n   Content: ${m.description ?? ""}\n   BTL levels: ${
            Array.isArray(m.btl_levels) ? (m.btl_levels as string[]).join(", ") : ""
          }`
      )
      .join("\n\n");

    const coBlock =
      (coPoData?.courseOutcomes ?? [])
        .map((c) => `${c.co_code}: ${c.description}`)
        .join("\n") || "(no CO data)";

    const coTarget =
      targetTags?.co != null && String(targetTags.co).trim()
        ? String(targetTags.co).trim()
        : null;
    const btlTarget =
      typeof targetTags?.btl === "number" &&
      Number.isInteger(targetTags.btl) &&
      targetTags.btl >= 1 &&
      targetTags.btl <= 6
        ? targetTags.btl
        : null;
    const targetBlock =
      coTarget || btlTarget
        ? `\n\n<target_tags>
Tag this question${coTarget ? ` to ${coTarget}` : ""}${
            coTarget && btlTarget ? " and" : ""
          }${btlTarget ? ` at BTL ${btlTarget}` : ""}. Crucially, the question's
actual subject matter and cognitive demand must GENUINELY match these tags — do
not just relabel; write content that truly fits.
</target_tags>`
        : "";

    const shapeLine = `For "mcq": use "sub_parts" (${
      templateQuestion.type === "mcq" ? templateQuestion.sub_parts ?? 6 : 6
    } entries). For all other types: use "parts". Assign CO (number only), BTL (1-6) and PO (number) to each sub_part/part.`;

    // One request can ask for several distinct candidates so the faculty picks
    // rather than rerolls one at a time. The output contract is the only thing
    // that changes — an array of the same object shape.
    const outputSpec =
      alternativesCount > 1
        ? `Output a JSON ARRAY of exactly ${alternativesCount} DISTINCT question objects. First char [, last char ]. Each element has the same structure as the template type, and the ${alternativesCount} options must differ from one another in substance, not just wording. ${shapeLine} No markdown, no prose.`
        : `Output a SINGLE JSON object (not an array) with the same structure as the template type. ${shapeLine} No markdown, no prose.`;

    const prompt = `Regenerate ${
      alternativesCount > 1 ? `${alternativesCount} ALTERNATIVE questions` : "ONE question"
    } matching this template entry:

<template_question>
${JSON.stringify(templateQuestion)}
</template_question>

<module_coverage>
${moduleBlock || "(no module data)"}
</module_coverage>

<co_po_btl_reference>
${coBlock}
</co_po_btl_reference>

<pyq_style_guide>
${pyqContext || "(no PYQ context)"}
</pyq_style_guide>

${modeDirective(mode, customInstruction)}

${avoidDirective(mode, avoidText)}${targetBlock}

${outputSpec}`;

    const result = await routeAI("qpaper_gen", {
      messages: [{ role: "user", content: prompt }],
      systemPrompt:
        alternativesCount > 1 ? SYSTEM_PROMPT_ARRAY : SYSTEM_PROMPT,
      temperature: 0.5,
      // Was a flat 2048 — fine for one question, silent JSON truncation at five.
      maxTokens: regenerateMaxTokens(alternativesCount),
      logContext: {
        userId: user.id,
        userEmail: user.email ?? null,
        userRole: profile.role,
        subjectId,
        subjectCode,
        jobId,
        relatedContentId: contentId,
        feature: "qpaper",
        metadata: { action: "regenerate_question" },
      } satisfies AILogContext,
    });

    const raw = String(result.content ?? "").trim();
    const parsed = extractJson(raw, alternativesCount > 1);
    if (parsed === undefined) {
      console.error("[regenerate-question] parse failure:", raw.slice(0, 300));
      return apiError("Failed to parse regenerated question", 500);
    }

    // Normalise to a list regardless of mode, so single and multi share one
    // path. A model that returns a bare object when asked for an array (or the
    // reverse) is tolerated rather than failed — the shape is recoverable and
    // the faculty should not lose a paid call to a formatting slip.
    const rawCandidates: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    if (rawCandidates.length === 0) {
      return apiError("Model returned no questions", 500);
    }

    // The section pipeline gates CO tags via sanitizeCoCodes, but this
    // single-question route bypasses it — so a hallucinated CO (e.g. a full
    // sentence instead of a code) would otherwise reach the rendered paper.
    // Route every CO through the same shared validateCoOrNull gate: valid codes
    // are kept/canonicalised, anything unresolvable is blanked (absent tag) with
    // a "please assign manually" warning surfaced to faculty. No fallback
    // coercion — the retag target already steers the prompt above (targetBlock).
    const validCoCodes = (coPoData?.courseOutcomes ?? []).map((c) => c.co_code);
    const coWarnings: string[] = [];
    const questions = rawCandidates
      .slice(0, Math.max(1, alternativesCount))
      .map((c) => {
        const normalised = normaliseQuestion(c, templateQuestion);
        coWarnings.push(...sanitizeQuestionCoCodes(normalised, validCoCodes));
        return normalised;
      });

    if (coWarnings.length > 0) {
      console.warn(
        "[regenerate-question] unresolved COs:\n  " + coWarnings.join("\n  ")
      );
    }
    if (alternativesCount > 1 && questions.length < alternativesCount) {
      console.warn(
        `[regenerate-question] asked for ${alternativesCount} alternatives, got ${questions.length}`
      );
    }

    return Response.json({
      success: true,
      // `question` stays the first candidate so existing single-question
      // callers keep working unchanged; `questions` carries the full set.
      question: questions[0],
      questions,
      mode,
      warnings: Array.from(new Set(coWarnings)),
    });
  } catch (err) {
    console.error("[regenerate-question] error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to regenerate question",
      500
    );
  }
}
