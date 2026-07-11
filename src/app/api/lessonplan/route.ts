import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { assertSubjectAccess } from "@/lib/api/subjectAccess";
import type { LessonPlanDoc } from "@/lib/lessonplan/types";
import type { NextRequest } from "next/server";

// ── GET /api/lessonplan?subjectId= ──────────────────────────────────────────
// Returns the caller's plan row (or null) + cache existence flags per section.
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole([
      "faculty",
      "superadmin",
      "dean",
      "hod",
    ]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const subjectId = String(
      request.nextUrl.searchParams.get("subjectId") ?? "",
    ).trim();
    if (!subjectId) return apiError("subjectId is required", 400);

    const denied = await assertSubjectAccess(
      adminClient,
      profile.role,
      user.id,
      subjectId,
    );
    if (denied) return denied;

    const { data: planRow } = await adminClient
      .from("lesson_plans")
      .select("id, plan, status, docx_path, pdf_path, updated_at")
      .eq("subject_id", subjectId)
      .eq("faculty_id", user.id)
      .maybeSingle();

    const { data: cacheRows } = await adminClient
      .from("lesson_plan_cache")
      .select("section, created_at, generated_by")
      .eq("subject_id", subjectId);

    const cache: Record<string, { generatedAt: string; generatedBySelf: boolean }> =
      {};
    for (const r of (cacheRows ?? []) as {
      section: string;
      created_at: string;
      generated_by: string | null;
    }[]) {
      cache[r.section] = {
        generatedAt: r.created_at,
        generatedBySelf: r.generated_by === user.id,
      };
    }

    return apiSuccess({
      plan: planRow ?? null,
      cache: {
        theory: cache.theory ?? null,
        practical: cache.practical ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[lessonplan GET] error:", message);
    return apiError("Failed to load lesson plan", 500);
  }
}

// ── PUT /api/lessonplan ─────────────────────────────────────────────────────
// Upserts the caller's plan jsonb (debounced-autosave target).
export async function PUT(request: NextRequest) {
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

    const plan = body.plan as LessonPlanDoc | undefined;
    if (!plan || typeof plan !== "object" || !Array.isArray(plan.theory)) {
      return apiError("plan (LessonPlanDoc) is required", 400);
    }

    const denied = await assertSubjectAccess(
      adminClient,
      profile.role,
      user.id,
      subjectId,
    );
    if (denied) return denied;

    const { error } = await adminClient.from("lesson_plans").upsert(
      {
        subject_id: subjectId,
        faculty_id: user.id,
        plan,
      },
      { onConflict: "subject_id,faculty_id" },
    );
    if (error) {
      console.error("[lessonplan PUT] upsert failed:", error.message);
      return apiError("Failed to save lesson plan", 500);
    }

    return apiSuccess({ saved: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[lessonplan PUT] error:", message);
    return apiError("Failed to save lesson plan", 500);
  }
}
