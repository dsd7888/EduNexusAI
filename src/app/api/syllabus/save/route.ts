import type { NextRequest } from "next/server";
import { apiError, requireRole } from "@/lib/api/helpers";
import { persistSyllabusAndClassify } from "@/lib/syllabus/persistAndClassify";
import type { ExtractedSyllabus } from "@/lib/syllabus/types";

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["superadmin"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const body = (await request.json().catch(() => ({}))) as {
      subject_id?: string;
      extracted?: ExtractedSyllabus;
    };

    const subjectId = String(body.subject_id ?? "").trim();
    const extracted = body.extracted;

    if (!subjectId) return apiError("subject_id is required", 400);
    if (!extracted || typeof extracted !== "object") {
      return apiError("extracted payload is required", 400);
    }

    const { data: subject, error: subjectErr } = await adminClient
      .from("subjects")
      .select("id")
      .eq("id", subjectId)
      .single();
    if (subjectErr || !subject) {
      return apiError("Subject not found", 404);
    }

    const { warnings } = await persistSyllabusAndClassify(
      adminClient,
      subjectId,
      extracted,
      { userId: user.id, userEmail: user.email ?? null, userRole: "superadmin" }
    );

    return Response.json({ saved: true, warnings });
  } catch (err) {
    console.error("[syllabus/save] Error:", err);
    const message = err instanceof Error ? err.message : "Save failed";
    return apiError(message, 500);
  }
}
