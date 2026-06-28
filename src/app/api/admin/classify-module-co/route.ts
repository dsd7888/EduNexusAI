import { after } from "next/server";
import type { NextRequest } from "next/server";
import { apiError, requireRole } from "@/lib/api/helpers";
import { classifyModulesForSubject } from "@/lib/qpaper/moduleCoClassifier";

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["superadmin", "dept_admin"]);
    if (authResult instanceof Response) return authResult;
    const { adminClient } = authResult;

    const body = (await request.json().catch(() => ({}))) as {
      subject_id?: string;
      branch?: string;
      semester?: number;
    };

    let subjectIds: string[];

    if (body.subject_id) {
      // Single-subject mode
      const id = String(body.subject_id).trim();
      if (!id) return apiError("subject_id must not be empty", 400);

      const { data, error } = await adminClient
        .from("subjects")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) return apiError("Subject not found", 404);
      subjectIds = [id];
    } else if (body.branch) {
      // Batch mode — branch (+ optional semester)
      const branch = String(body.branch).trim();
      if (!branch) return apiError("branch must not be empty", 400);

      let query = adminClient
        .from("subjects")
        .select("id")
        .eq("branch", branch);

      if (body.semester !== undefined && body.semester !== null) {
        query = query.eq("semester", body.semester);
      }

      const { data, error } = await query;
      if (error) return apiError(error.message, 500);
      if (!data || data.length === 0) {
        return apiError(
          `No subjects found for branch="${branch}"` +
            (body.semester !== undefined ? ` semester=${body.semester}` : ""),
          404
        );
      }
      subjectIds = (data as { id: string }[]).map((r) => r.id);
    } else {
      return apiError(
        "Provide either subject_id or branch (+ optional semester)",
        400
      );
    }

    // Respond immediately; run all classifications after the response is sent.
    after(async () => {
      for (const id of subjectIds) {
        await classifyModulesForSubject(id);
      }
    });

    return Response.json({ started: true, subject_count: subjectIds.length });
  } catch (err) {
    console.error("[admin/classify-module-co]", err);
    return apiError("Internal server error", 500);
  }
}
