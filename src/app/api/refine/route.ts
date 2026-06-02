import {
  buildRefinementPrompt,
  type RefinementType,
} from "@/lib/refine/generator";
import { routeAI } from "@/lib/ai/router";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import { requireAuth, requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const body = await request.json().catch(() => ({} as any));
    const subjectId = String(body?.subjectId ?? "").trim();
    const rawContent = String(body?.contentToRefine ?? "");
    const typesRaw = Array.isArray(body?.refinementTypes)
      ? (body.refinementTypes as string[])
      : [];
    const targetSemester =
      typeof body?.targetSemester === "number"
        ? body.targetSemester
        : undefined;

    const contentToRefine = rawContent.trim();

    if (!contentToRefine) {
      return apiError("contentToRefine must not be empty", 400);
    }

    if (contentToRefine.length > 15000) {
      return apiError(
        "contentToRefine is too long (max 15000 characters). Please reduce the content size.",
        400
      );
    }

    const validTypes: RefinementType[] = typesRaw.filter((t): t is RefinementType =>
      ["readability", "examples", "practice", "expand", "simplify"].includes(
        t as RefinementType
      )
    );

    if (!validTypes.length) {
      return apiError(
        "At least one valid refinement type is required",
        400
      );
    }

    // 3. Fetch subject content (optional for refinement)
    let syllabusContent = "";
    if (subjectId) {
      const { data: contentRow, error: contentError } = await adminClient
        .from("subject_content")
        .select("content")
        .eq("subject_id", subjectId)
        .maybeSingle();

      if (contentError) {
        console.error("[refine] subject_content error:", contentError.message);
      } else if (contentRow) {
        syllabusContent = String(
          (contentRow as { content?: string }).content ?? ""
        );
      }
    }

    // 4. Fetch subject name
    let subjectName = "this subject";
    if (subjectId) {
      const { data: subject, error: subjectError } = await adminClient
        .from("subjects")
        .select("name")
        .eq("id", subjectId)
        .maybeSingle();

      if (!subjectError && subject && (subject as { name?: string }).name) {
        subjectName = (subject as { name?: string }).name ?? subjectName;
      }
    }

    const prompt = buildRefinementPrompt({
      subjectName,
      syllabusContent,
      contentToRefine,
      refinementTypes: validTypes,
      targetSemester,
    });

    console.log("[refine] Types:", validTypes.join(", "));
    console.log("[refine] Content length:", contentToRefine.length, "chars");

    const ai = await routeAI("refine", {
      messages: [{ role: "user", content: prompt }],
    });

    const aiResponse = String(ai.content ?? "");

    // Track usage (simple insert)
    try {
      const today = new Date().toISOString().slice(0, 10);
      await adminClient.from("usage_analytics").insert({
        date: today,
        user_id: user.id,
        subject_id: subjectId || null,
        event_type: "refine",
        event_count: 1,
      });
    } catch (err) {
      console.error("[refine] usage_analytics error:", err);
    }

    return Response.json({ refinedContent: aiResponse });
  } catch (err) {
    console.error("[refine] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to refine content";
    return apiError(message, 500);
  }
}

