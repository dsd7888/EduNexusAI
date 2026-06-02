import { requireRole, apiError } from "@/lib/api/helpers";
import { routeAI } from "@/lib/ai/router";
import { normaliseQuestion } from "@/lib/qpaper/sectionGen";
import type { TemplateQuestion } from "@/lib/qpaper/templates";
import type { NextRequest } from "next/server";

const SYSTEM_PROMPT = `You are an expert question paper setter for Indian engineering universities.
Respond ONLY with valid JSON for a SINGLE question object. First char {, last char }. No markdown. No prose.`;

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin"]);
    if (authResult instanceof Response) return authResult;

    const body = (await request.json()) as Record<string, unknown>;
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

    const prompt = `Regenerate ONE question matching this template entry:

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

<avoid>
Do NOT repeat the previous question text below. Generate a genuinely different question on a related topic within this section's modules.
${avoidText.slice(0, 1500)}
</avoid>

Output a SINGLE JSON object (not an array) with the same structure as the template type. For "mcq": use "sub_parts" (6 entries). For all other types: use "parts". Assign CO (number only), BTL (1-6) and PO (number) to each sub_part/part. No markdown, no prose.`;

    const result = await routeAI("qpaper_gen", {
      messages: [{ role: "user", content: prompt }],
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0.5,
      maxTokens: 2048,
    });

    let raw = String(result.content ?? "").trim();
    raw = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first === -1 || last === -1) {
      console.error("[regenerate-question] parse failure:", raw.slice(0, 300));
      return apiError("Failed to regenerate question", 500);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.slice(first, last + 1));
    } catch (err) {
      console.error("[regenerate-question] JSON parse error:", err);
      return apiError("Failed to parse regenerated question", 500);
    }

    const normalised = normaliseQuestion(parsed, templateQuestion);
    return Response.json({ success: true, question: normalised });
  } catch (err) {
    console.error("[regenerate-question] error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to regenerate question",
      500
    );
  }
}
