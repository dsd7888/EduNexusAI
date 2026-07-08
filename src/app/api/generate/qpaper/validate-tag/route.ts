import { requireRole, apiError } from "@/lib/api/helpers";
import {
  validateQuestionTags,
  resolveTagValidation,
  resolveCoDescription,
} from "@/lib/qpaper/validateTags";
import type { CourseOutcomeRow } from "@/lib/qpaper/builder";
import type { AILogContext } from "@/lib/ai/providers/types";
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
    const { user, profile, adminClient } = authResult;

    const body = (await request.json()) as Record<string, unknown>;
    const subjectId =
      typeof body.subjectId === "string" && body.subjectId.trim()
        ? body.subjectId.trim()
        : typeof body.subject_id === "string" && body.subject_id.trim()
          ? body.subject_id.trim()
          : null;
    const contentId =
      typeof body.contentId === "string" && body.contentId.trim()
        ? body.contentId.trim()
        : typeof body.content_id === "string" && body.content_id.trim()
          ? body.content_id.trim()
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
      moduleContent,
      {
        userId: user.id,
        userEmail: user.email ?? null,
        userRole: profile.role,
        subjectId,
        subjectCode,
        jobId: crypto.randomUUID(),
        relatedContentId: contentId,
        feature: "qpaper",
        metadata: { action: "validate_tag" },
      } satisfies AILogContext
    );

    const resolved = resolveTagValidation(
      claimedCO,
      claimedBTL,
      validation,
      courseOutcomes.map((c) => c.co_code)
    );
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
