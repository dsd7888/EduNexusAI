import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { assertSubjectAccess } from "@/lib/api/subjectAccess";
import { loadSubjectContext } from "@/lib/subjectContext";
import { computePracticalFingerprint } from "@/lib/labmanual/fingerprint";
import type { LabManualDoc, PracticalState } from "@/lib/labmanual/types";
import type { NextRequest } from "next/server";

// ── GET /api/labmanual?subjectId= ───────────────────────────────────────────
// The caller's manual (or null) + per-practical cache freshness, evaluated at
// each practical's CURRENT difficulty (§5). "Fresh" means a cache row exists for
// this practical AT that difficulty whose fingerprint still matches the
// syllabus — so the UI can say "cached" honestly rather than promising a reuse
// the generate route would then miss.
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const subjectId = String(request.nextUrl.searchParams.get("subjectId") ?? "").trim();
    if (!subjectId) return apiError("subjectId is required", 400);

    const denied = await assertSubjectAccess(adminClient, profile.role, user.id, subjectId);
    if (denied) return denied;

    const { data: manualRow } = await adminClient
      .from("lab_manuals")
      .select(
        "id, doc, status, student_docx_path, student_pdf_path, instructor_docx_path, instructor_pdf_path, solutions_docx_path, solutions_pdf_path, updated_at",
      )
      .eq("subject_id", subjectId)
      .eq("faculty_id", user.id)
      .maybeSingle();

    const row = manualRow as { doc: LabManualDoc } | null;
    const doc = row?.doc ?? null;

    const ctx = await loadSubjectContext(subjectId);

    const { data: cacheRows } = await adminClient
      .from("lab_manual_cache")
      .select("practical_no, difficulty, syllabus_fingerprint, created_at, generated_by")
      .eq("subject_id", subjectId);

    const rows = (cacheRows ?? []) as {
      practical_no: number;
      difficulty: string;
      syllabus_fingerprint: string | null;
      created_at: string;
      generated_by: string | null;
    }[];

    const language = doc?.language ?? null;
    const states = (doc?.practicalStates ?? {}) as Record<number, PracticalState>;

    const cacheFreshness: Record<
      number,
      { fresh: boolean; generatedAt: string | null; generatedBySelf: boolean }
    > = {};
    for (const p of ctx.practicals) {
      const difficulty = states[p.sr_no]?.difficulty ?? "standard";
      const fingerprint = computePracticalFingerprint(ctx, p.sr_no, language);
      const hit = rows.find(
        (r) =>
          r.practical_no === p.sr_no &&
          r.difficulty === difficulty &&
          r.syllabus_fingerprint === fingerprint,
      );
      cacheFreshness[p.sr_no] = {
        fresh: !!hit,
        generatedAt: hit?.created_at ?? null,
        generatedBySelf: hit?.generated_by === user.id,
      };
    }

    return apiSuccess({
      manual: manualRow ?? null,
      practicals: ctx.practicals.map((p) => ({
        practicalNo: p.sr_no,
        title: p.name,
        hours: p.hours ?? 2,
      })),
      cacheFreshness,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[labmanual GET] error:", message);
    return apiError("Failed to load lab manual", 500);
  }
}

// ── PUT /api/labmanual ──────────────────────────────────────────────────────
// Upserts the caller's doc jsonb (debounced-autosave target).
export async function PUT(request: NextRequest) {
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

    const doc = body.doc as LabManualDoc | undefined;
    if (!doc || typeof doc !== "object" || !Array.isArray(doc.sections)) {
      return apiError("doc (LabManualDoc) is required", 400);
    }

    const denied = await assertSubjectAccess(adminClient, profile.role, user.id, subjectId);
    if (denied) return denied;

    const { error } = await adminClient.from("lab_manuals").upsert(
      {
        subject_id: subjectId,
        faculty_id: user.id,
        doc,
      },
      { onConflict: "subject_id,faculty_id" },
    );
    if (error) {
      console.error("[labmanual PUT] upsert failed:", error.message);
      return apiError("Failed to save lab manual", 500);
    }

    return apiSuccess({ saved: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[labmanual PUT] error:", message);
    return apiError("Failed to save lab manual", 500);
  }
}
