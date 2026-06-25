import { requireRole, apiError } from "@/lib/api/helpers";

type RouteContext = {
  params: Promise<{ contentId: string }>;
};

type ContentRow = { id: string; generated_by: string; file_path: string | null; status: string };

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { contentId } = await params;

    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const { data, error } = await adminClient
      .from("generated_content")
      .select("id, generated_by, file_path, status")
      .eq("id", contentId)
      .eq("type", "ppt")
      .single();

    if (error || !data) {
      return apiError("Not found", 404);
    }

    const row = data as ContentRow;

    if (profile.role === "faculty" && row.generated_by !== user.id) {
      return apiError("Forbidden", 403);
    }

    if (!row.file_path) {
      return apiError("No file available for this presentation", 404);
    }

    const { data: signedData, error: signedError } = await adminClient.storage
      .from("generated-content")
      .createSignedUrl(row.file_path, 86400);

    if (signedError || !signedData) {
      console.error("[ppt/download] sign error:", signedError);
      return apiError("Failed to generate download URL", 500);
    }

    return Response.json({ downloadUrl: signedData.signedUrl });
  } catch (err) {
    console.error("[ppt/download] error:", err);
    return apiError("Internal server error", 500);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const { contentId } = await params;

    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const { data, error } = await adminClient
      .from("generated_content")
      .select("id, generated_by, file_path, status")
      .eq("id", contentId)
      .eq("type", "ppt")
      .single();

    if (error || !data) {
      return apiError("Not found", 404);
    }

    const row = data as ContentRow;

    if (profile.role === "faculty" && row.generated_by !== user.id) {
      return apiError("Forbidden", 403);
    }

    if (row.file_path) {
      const { error: storageError } = await adminClient.storage
        .from("generated-content")
        .remove([row.file_path]);
      if (storageError) {
        console.error("[ppt/download] storage remove error:", storageError);
      }
    }

    const { error: deleteError } = await adminClient
      .from("generated_content")
      .delete()
      .eq("id", contentId);

    if (deleteError) {
      console.error("[ppt/download] db delete error:", deleteError);
      return apiError("Failed to delete record", 500);
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("[ppt/download] delete error:", err);
    return apiError("Internal server error", 500);
  }
}
