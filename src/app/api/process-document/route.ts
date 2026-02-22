import {
  createAdminClient,
  createServerClientForRequestResponse,
} from "@/lib/db/supabase-server";
import { embedDocument } from "@/lib/pdf/embedder";
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
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 500 });
    }

    if (profile.role !== "superadmin") {
      return NextResponse.json(
        { error: "Forbidden: Superadmin only" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const documentId = String(body?.documentId ?? "").trim();

    if (!documentId) {
      return NextResponse.json(
        { error: "documentId is required" },
        { status: 400 }
      );
    }

    const { data: document, error: docError } = await adminClient
      .from("documents")
      .select("id, status")
      .eq("id", documentId)
      .single();

    if (docError || !document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (document.status !== "processing") {
      return NextResponse.json(
        { error: "Document is not in processing state" },
        { status: 409 }
      );
    }

    // Pilot: process synchronously (blocks request).
    // Production: move this to a background queue/worker.
    await embedDocument(documentId);

    return NextResponse.json({
      success: true,
      message: "Document processing started",
    });
  } catch (err) {
    console.error("[process-document] POST error:", err);
    const message = err instanceof Error ? err.message : "Failed to process document";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

