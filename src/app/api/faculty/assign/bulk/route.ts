import type { NextRequest } from "next/server";

import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import { requireAuth, requireRole, apiError, apiSuccess } from "@/lib/api/helpers";

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["superadmin"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const body = await request.json().catch(() => ({} as any));
    const assignments = Array.isArray(body?.assignments)
      ? body.assignments
      : [];

    if (assignments.length === 0) {
      return apiError("No assignments provided", 400);
    }

    const failed: { email: string; subjectCode: string; reason: string }[] = [];
    let successful = 0;

    for (const row of assignments) {
      const email = String(row?.email ?? "").trim();
      const subjectCode = String(row?.subjectCode ?? "").trim();

      if (!email || !subjectCode) {
        failed.push({
          email,
          subjectCode,
          reason: "Missing email or subjectCode",
        });
        continue;
      }

      try {
        const { data: faculty, error: facultyError } = await adminClient
          .from("profiles")
          .select("id")
          .eq("email", email)
          .eq("role", "faculty")
          .maybeSingle();

        if (facultyError || !faculty) {
          failed.push({
            email,
            subjectCode,
            reason: "Faculty not found",
          });
          continue;
        }

        const { data: subject, error: subjectError } = await adminClient
          .from("subjects")
          .select("id")
          .eq("code", subjectCode)
          .maybeSingle();

        if (subjectError || !subject) {
          failed.push({
            email,
            subjectCode,
            reason: "Subject not found",
          });
          continue;
        }

        // Check duplicate
        const { data: existing } = await adminClient
          .from("faculty_assignments")
          .select("id")
          .eq("faculty_id", faculty.id)
          .eq("subject_id", subject.id)
          .maybeSingle();

        if (existing) {
          failed.push({
            email,
            subjectCode,
            reason: "Already assigned",
          });
          continue;
        }

        const { error: insertError } = await adminClient
          .from("faculty_assignments")
          .insert({
            faculty_id: faculty.id,
            subject_id: subject.id,
          });

        if (insertError) {
          failed.push({
            email,
            subjectCode,
            reason: insertError.message,
          });
          continue;
        }

        successful++;
      } catch (err) {
        failed.push({
          email,
          subjectCode,
          reason:
            err instanceof Error ? err.message : "Unknown error assigning row",
        });
      }
    }

    return Response.json({
      successful,
      failed,
      total: assignments.length,
    });
  } catch (err) {
    console.error("[faculty/assign/bulk] POST error:", err);
    const msg =
      err instanceof Error ? err.message : "Failed to process bulk assignments";
    return apiError(msg, 500);
  }
}

