import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { assertSubjectAccess } from "@/lib/api/subjectAccess";
import {
  loadLessonPlanContext,
  regenerateTheorySession,
  regeneratePracticalSession,
} from "@/lib/lessonplan/generator";
import type { AILogContext } from "@/lib/ai/providers/types";
import type { NextRequest } from "next/server";

// Single-session / single-practical regeneration for the ReviewStage "↻" button.
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

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON body", 400);
    }

    const subjectId = String(body.subjectId ?? "").trim();
    if (!subjectId) return apiError("subjectId is required", 400);

    const section = String(body.section ?? "").trim();
    if (section !== "theory" && section !== "practical") {
      return apiError("section must be 'theory' or 'practical'", 400);
    }

    const denied = await assertSubjectAccess(
      adminClient,
      profile.role,
      user.id,
      subjectId,
    );
    if (denied) return denied;

    const instruction =
      typeof body.instruction === "string" ? body.instruction : undefined;

    const ctx = await loadLessonPlanContext(subjectId);
    const logContext: AILogContext = {
      userId: user.id,
      userEmail: user.email ?? null,
      userRole: profile.role,
      subjectId,
      subjectCode: ctx.subjectCode,
      jobId: crypto.randomUUID(),
      relatedContentId: null,
      feature: "lesson_plan",
    };

    if (section === "theory") {
      const moduleNumber = Number(body.moduleNumber);
      const sessionNo = Number(body.sessionNo);
      if (!Number.isFinite(moduleNumber) || !Number.isFinite(sessionNo)) {
        return apiError("moduleNumber and sessionNo are required", 400);
      }
      const siblingTopics = Array.isArray(body.siblingTopics)
        ? (body.siblingTopics as unknown[])
            .map((t) => String(t))
            .filter(Boolean)
        : [];
      const current =
        body.current && typeof body.current === "object"
          ? (body.current as Record<string, unknown>)
          : undefined;

      const { session, warnings } = await regenerateTheorySession(
        ctx,
        { moduleNumber, sessionNo, siblingTopics, current, instruction },
        logContext,
      );
      return apiSuccess({ session, warnings });
    }

    // practical
    const practicalNo = Number(body.practicalNo);
    const title = String(body.title ?? "").trim();
    const hours = Number(body.hours);
    if (!Number.isFinite(practicalNo) || !title) {
      return apiError("practicalNo and title are required", 400);
    }
    const { practical, warnings } = await regeneratePracticalSession(
      ctx,
      {
        practicalNo,
        title,
        hours: Number.isFinite(hours) ? hours : 2,
        instruction,
      },
      logContext,
    );
    return apiSuccess({ practical, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[lessonplan regenerate] error:", message);
    return apiError("Failed to regenerate", 500);
  }
}
