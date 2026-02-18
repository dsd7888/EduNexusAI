import {
  createAdminClient,
  createServerClientForRequestResponse,
} from "@/lib/db/supabase-server";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
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
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const path = searchParams.get("path");
    if (!path) {
      return NextResponse.json(
        { error: "path is required" },
        { status: 400 }
      );
    }
    const { data, error } = await adminClient.storage
      .from("documents")
      .createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to create download link" },
        { status: 500 }
      );
    }
    return NextResponse.redirect(data.signedUrl);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create download link" },
      { status: 500 }
    );
  }
}
