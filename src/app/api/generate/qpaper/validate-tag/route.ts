import { requireRole, apiError } from "@/lib/api/helpers";
import {
  validateQuestionTags,
  resolveTagValidation,
  resolveCoDescription,
} from "@/lib/qpaper/validateTags";
import type { CourseOutcomeRow } from "@/lib/qpaper/builder";
import type { NextRequest } from "next/server";

/**
 * Re-validate a SINGLE question unit's CO/BTL tags against its (edited) content.
 *
 * Companion to the batch validator that runs at generation time
 * (`attachTagValidations`). Faculty inline-edits don't re-run the whole-paper
 * validator, so this route judges one unit and applies the identical
 * confidence-based rule via `resolveTagValidation`, returning the resolved tags
 * plus a `validation` only when the low-confidence flag should surface.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole([
      "faculty",
      "superadmin",
      "dean",
      "hod",
    ]);
    if (authResult instanceof Response) return authResult;

    const body = (await request.json()) as Record<string, unknown>;
    const questionText = String(body.questionText ?? "").trim();
    const claimedCO =
      body.claimedCO != null && String(body.claimedCO).trim()
        ? String(body.claimedCO).trim()
        : null;
    const rawBtl = Number(body.claimedBTL);
    const claimedBTL =
      Number.isInteger(rawBtl) && rawBtl >= 1 && rawBtl <= 6 ? rawBtl : null;
    const courseOutcomes = Array.isArray(body.courseOutcomes)
      ? (body.courseOutcomes as CourseOutcomeRow[])
      : [];
    const moduleContent = String(body.moduleContent ?? "");

    // Nothing to judge against → clean pass (mirrors validateQuestionTags).
    if (!questionText || claimedCO == null || claimedBTL == null) {
      return Response.json({ co: claimedCO, btl: claimedBTL });
    }

    const validation = await validateQuestionTags(
      { questionText, claimedCO, claimedBTL },
      {
        claimedDescription: resolveCoDescription(claimedCO, courseOutcomes),
        allOutcomes: courseOutcomes,
      },
      moduleContent
    );

    const resolved = resolveTagValidation(claimedCO, claimedBTL, validation);
    return Response.json({
      co: resolved.co,
      btl: resolved.btl,
      ...(resolved.validation ? { validation: resolved.validation } : {}),
    });
  } catch (err) {
    console.error("[validate-tag] error:", err);
    return apiError(
      err instanceof Error ? err.message : "Failed to validate tag",
      500
    );
  }
}
