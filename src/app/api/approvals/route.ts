import {
  createAdminClient,
  createServerClientForRequestResponse,
} from "@/lib/db/supabase-server";
import { type NextRequest, NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ message: "approvals" });
}

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
    const requestId = body?.requestId;
    const action = body?.action;
    const comment = body?.comment;

    if (!requestId || !action) {
      return NextResponse.json(
        { error: "requestId and action are required" },
        { status: 400 }
      );
    }
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json(
        { error: "action must be 'approve' or 'reject'" },
        { status: 400 }
      );
    }
    if (action === "reject" && !comment?.trim()) {
      return NextResponse.json(
        { error: "comment is required when rejecting" },
        { status: 400 }
      );
    }

    const { data: changeRequest, error: fetchError } = await adminClient
      .from("note_change_requests")
      .select(
        "id, subject_id, module_id, requested_by, current_doc_id, new_file_path, status"
      )
      .eq("id", requestId)
      .single();

    if (fetchError || !changeRequest) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }
    if (changeRequest.status !== "pending") {
      return NextResponse.json(
        { error: "Request is no longer pending" },
        { status: 400 }
      );
    }

    if (action === "approve") {
      let oldDoc: {
        type: string;
        title: string;
        year: number | null;
      } | null = null;

      if (changeRequest.current_doc_id) {
        const { data: doc, error: docError } = await adminClient
          .from("documents")
          .select("type, title, year")
          .eq("id", changeRequest.current_doc_id)
          .single();

        if (docError || !doc) {
          console.error("[approvals] Current document not found:", docError);
          return NextResponse.json(
            { error: "Current document not found" },
            { status: 400 }
          );
        }
        oldDoc = doc;

        const { error: archiveError } = await adminClient
          .from("documents")
          .update({ status: "archived", updated_at: new Date().toISOString() })
          .eq("id", changeRequest.current_doc_id);

        if (archiveError) {
          console.error("[approvals] Archive error:", archiveError);
          return NextResponse.json(
            { error: archiveError.message },
            { status: 500 }
          );
        }
      }

      const { error: insertError } = await adminClient
        .from("documents")
        .insert({
          type: oldDoc?.type ?? "notes",
          subject_id: changeRequest.subject_id,
          module_id: changeRequest.module_id,
          title: oldDoc?.title ?? "Notes",
          file_path: changeRequest.new_file_path,
          year: oldDoc?.year ?? null,
          uploaded_by: changeRequest.requested_by,
          status: "ready",
        });

      if (insertError) {
        console.error("[approvals] Insert document error:", insertError);
        return NextResponse.json(
          { error: insertError.message },
          { status: 500 }
        );
      }

      const { error: updateError } = await adminClient
        .from("note_change_requests")
        .update({
          status: "approved",
          reviewed_by: user.id,
          admin_comment: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      if (updateError) {
        console.error("[approvals] Update request error:", updateError);
        return NextResponse.json(
          { error: updateError.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "Request approved successfully",
      });
    }

    if (action === "reject") {
      const { error: updateError } = await adminClient
        .from("note_change_requests")
        .update({
          status: "rejected",
          reviewed_by: user.id,
          admin_comment: comment!.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      if (updateError) {
        console.error("[approvals] Update request error:", updateError);
        return NextResponse.json(
          { error: updateError.message },
          { status: 500 }
        );
      }

      const { error: storageError } = await adminClient.storage
        .from("documents")
        .remove([changeRequest.new_file_path]);

      if (storageError) {
        console.error("[approvals] Storage cleanup error:", storageError);
      }

      return NextResponse.json({
        success: true,
        message: "Request rejected successfully",
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[approvals] POST error:", err);
    const message = err instanceof Error ? err.message : "Failed to update";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
