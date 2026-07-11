import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import {
  loadLessonPlanContext,
  generateTheorySection,
  generatePracticalSection,
} from "@/lib/lessonplan/generator";
import type { AILogContext } from "@/lib/ai/providers/types";
import type { LessonPlanSection } from "@/lib/lessonplan/types";
import type { NextRequest } from "next/server";

const MODEL_USED = "gemini-2.5-flash";

/** Parse a JSON object keyed by module number into Record<number, number>. */
function parseNumberMap(raw: unknown): Record<number, number> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = Number(k);
    const val = Number(v);
    if (Number.isFinite(key) && Number.isFinite(val)) out[key] = val;
  }
  return Object.keys(out).length ? out : null;
}

function parseStringMap(raw: unknown): Record<number, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<number, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = Number(k);
    if (Number.isFinite(key) && typeof v === "string" && v.trim()) {
      out[key] = v.trim();
    }
  }
  return Object.keys(out).length ? out : undefined;
}

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

    const section = String(body.section ?? "").trim() as LessonPlanSection;
    if (section !== "theory" && section !== "practical") {
      return apiError("section must be 'theory' or 'practical'", 400);
    }

    // ── Assignment check (faculty only; oversight roles bypass) ─────────────
    if (profile.role === "faculty") {
      const { data: assignment } = await adminClient
        .from("faculty_assignments")
        .select("subject_id")
        .eq("faculty_id", user.id)
        .eq("subject_id", subjectId)
        .maybeSingle();
      if (!assignment) {
        return apiError("Forbidden: subject is not assigned to this faculty", 403);
      }
    }

    const force = Boolean(body.force);

    // ── Cache hit path (cost control: reuse a colleague's generation) ───────
    if (!force) {
      const { data: cached } = await adminClient
        .from("lesson_plan_cache")
        .select("payload, model_used, created_at")
        .eq("subject_id", subjectId)
        .eq("section", section)
        .maybeSingle();
      if (cached) {
        const row = cached as {
          payload: unknown;
          model_used: string | null;
          created_at: string;
        };
        return apiSuccess({
          fromCache: true,
          section,
          payload: row.payload,
          modelUsed: row.model_used,
          generatedAt: row.created_at,
        });
      }
    }

    // ── Generate fresh ──────────────────────────────────────────────────────
    const ctx = await loadLessonPlanContext(subjectId);
    if (section === "theory" && ctx.modules.length === 0) {
      return apiError("This subject has no modules to plan", 400);
    }
    if (section === "practical" && ctx.practicals.length === 0) {
      return apiError("This subject has no practicals to plan", 400);
    }

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

    const payload =
      section === "theory"
        ? await generateTheorySection(
            ctx,
            parseNumberMap(body.hoursOverride),
            parseStringMap(body.moduleInstructions),
            logContext,
          )
        : await generatePracticalSection(ctx, logContext);

    // ── Upsert cache (first generator pays; others reuse) ───────────────────
    const { error: upsertError } = await adminClient
      .from("lesson_plan_cache")
      .upsert(
        {
          subject_id: subjectId,
          section,
          payload,
          generated_by: user.id,
          model_used: MODEL_USED,
        },
        { onConflict: "subject_id,section" },
      );
    if (upsertError) {
      console.warn("[lessonplan generate] cache upsert failed:", upsertError.message);
    }

    return apiSuccess({
      fromCache: false,
      section,
      payload,
      modelUsed: MODEL_USED,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[lessonplan generate] error:", message);
    return apiError("Failed to generate lesson plan", 500);
  }
}
