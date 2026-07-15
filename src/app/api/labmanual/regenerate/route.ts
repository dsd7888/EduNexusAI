import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { assertSubjectAccess } from "@/lib/api/subjectAccess";
import { loadSubjectContext } from "@/lib/subjectContext";
import { generateOnePractical } from "@/lib/labmanual/generator";
import { computePracticalFingerprint } from "@/lib/labmanual/fingerprint";
import { DIFFICULTIES, type Difficulty, type LabManualDoc } from "@/lib/labmanual/types";
import type { AILogContext } from "@/lib/ai/providers/types";
import type { NextRequest } from "next/server";

const MODEL_USED = "gemini-2.5-flash";

/**
 * POST /api/labmanual/regenerate — regenerate ONE practical.
 *
 * Always generates (never reads the cache): the faculty asked for a new take,
 * usually with an instruction or a changed difficulty. It DOES write the cache
 * row for that difficulty, so a colleague benefits from the better version.
 * Runs the same gate as batch generation (buildOnePracticalSection).
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
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

    const practicalNo = Math.trunc(Number(body.practicalNo));
    if (!Number.isFinite(practicalNo)) {
      return apiError("practicalNo is required", 400);
    }

    const rawDifficulty = String(body.difficulty ?? "standard");
    if (!(DIFFICULTIES as string[]).includes(rawDifficulty)) {
      return apiError("difficulty must be guided, standard, or challenge", 400);
    }
    const difficulty = rawDifficulty as Difficulty;

    const instruction =
      typeof body.instruction === "string" && body.instruction.trim()
        ? body.instruction.trim()
        : undefined;

    const denied = await assertSubjectAccess(adminClient, profile.role, user.id, subjectId);
    if (denied) return denied;

    const ctx = await loadSubjectContext(subjectId);
    if (!ctx.practicals.some((p) => p.sr_no === practicalNo)) {
      return apiError(`Practical #${practicalNo} is not in this subject's syllabus`, 400);
    }

    const language =
      typeof body.language === "string" && body.language.trim()
        ? body.language.trim()
        : null;

    const { data: manualRow } = await adminClient
      .from("lab_manuals")
      .select("doc")
      .eq("subject_id", subjectId)
      .eq("faculty_id", user.id)
      .maybeSingle();
    const doc = (manualRow as { doc: LabManualDoc } | null)?.doc ?? null;

    const logContext: AILogContext = {
      userId: user.id,
      userEmail: user.email ?? null,
      userRole: profile.role,
      subjectId,
      subjectCode: ctx.subjectCode,
      jobId: crypto.randomUUID(),
      relatedContentId: null,
      feature: "lab_manual",
    };

    let section, warnings;
    try {
      ({ section, warnings } = await generateOnePractical(
        {
          ctx,
          practicalNo,
          difficulty,
          // fall back to the manual's saved subject-level language choice
          language: language ?? doc?.language ?? null,
          path: doc?.path ?? null,
          customInstruction: instruction,
        },
        logContext,
      ));
    } catch (genErr) {
      const message = genErr instanceof Error ? genErr.message : "unknown error";
      console.error("[labmanual regenerate] generation failed:", message);
      // The caller keeps its existing section on failure.
      return apiError("Regeneration failed — the previous version is unchanged", 502);
    }

    const fingerprint = computePracticalFingerprint(
      ctx,
      practicalNo,
      language ?? doc?.language ?? null,
    );

    const { error: upsertError } = await adminClient.from("lab_manual_cache").upsert(
      {
        subject_id: subjectId,
        practical_no: practicalNo,
        difficulty,
        payload: section,
        syllabus_fingerprint: fingerprint,
        generated_by: user.id,
        model_used: MODEL_USED,
      },
      { onConflict: "subject_id,practical_no,difficulty" },
    );
    if (upsertError) {
      console.warn("[labmanual regenerate] cache upsert failed:", upsertError.message);
    }

    return apiSuccess({ section, warnings, modelUsed: MODEL_USED });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[labmanual regenerate] error:", message);
    return apiError("Failed to regenerate the practical", 500);
  }
}
