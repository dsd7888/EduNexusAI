import {
  createAdminClient,
  createServerClientForRequestResponse,
} from "@/lib/db/supabase-server";
import { type NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const response = NextResponse.next();
    const supabase = createServerClientForRequestResponse(request, response);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "superadmin") {
      return NextResponse.json(
        { error: "Forbidden: Superadmin only" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const facultyId = body?.facultyId;
    const subjectId = body?.subjectId;

    if (!facultyId || !subjectId) {
      return NextResponse.json(
        { error: "facultyId and subjectId are required" },
        { status: 400 }
      );
    }

    const { data: faculty, error: facultyError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", facultyId)
      .single();

    if (facultyError || !faculty) {
      return NextResponse.json(
        { error: "Faculty not found" },
        { status: 400 }
      );
    }
    if (faculty.role !== "faculty") {
      return NextResponse.json(
        { error: "User is not a faculty member" },
        { status: 400 }
      );
    }

    const { data: subject, error: subjectError } = await adminClient
      .from("subjects")
      .select("id")
      .eq("id", subjectId)
      .single();

    if (subjectError || !subject) {
      return NextResponse.json(
        { error: "Subject not found" },
        { status: 400 }
      );
    }

    const { data: existing } = await adminClient
      .from("faculty_assignments")
      .select("id")
      .eq("faculty_id", facultyId)
      .eq("subject_id", subjectId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "Faculty already assigned to this subject" },
        { status: 409 }
      );
    }

    const { error: insertError } = await adminClient
      .from("faculty_assignments")
      .insert({
        faculty_id: facultyId,
        subject_id: subjectId,
        assigned_by: user.id,
        assigned_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error("[faculty/assign] Insert error:", insertError);
      if (insertError.code === "23505") {
        return NextResponse.json(
          { error: "Faculty already assigned to this subject" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Faculty assigned successfully",
    });
  } catch (err) {
    console.error("[faculty/assign] POST error:", err);
    const message = err instanceof Error ? err.message : "Failed to assign";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const response = NextResponse.next();
    const supabase = createServerClientForRequestResponse(request, response);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "superadmin") {
      return NextResponse.json(
        { error: "Forbidden: Superadmin only" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const assignmentId = body?.assignmentId;

    if (!assignmentId) {
      return NextResponse.json(
        { error: "assignmentId is required" },
        { status: 400 }
      );
    }

    const { error: deleteError } = await adminClient
      .from("faculty_assignments")
      .delete()
      .eq("id", assignmentId);

    if (deleteError) {
      console.error("[faculty/assign] Delete error:", deleteError);
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Assignment removed successfully",
    });
  } catch (err) {
    console.error("[faculty/assign] DELETE error:", err);
    const message = err instanceof Error ? err.message : "Failed to remove";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
