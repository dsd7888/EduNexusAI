import {
  createAdminClient,
  createServerClientForRequestResponse,
} from "@/lib/db/supabase-server";
import { type NextRequest, NextResponse } from "next/server";

const ALLOWED_TYPE = ["syllabus", "notes", "pyq"] as const;

async function getSubjectCode(subjectId: string): Promise<string> {
  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("subjects")
    .select("code")
    .eq("id", subjectId)
    .single();
  return data?.code ?? "unknown";
}

export async function GET() {
  return NextResponse.json({ message: "upload" });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const type = formData.get("type") as string | null;
    const subjectId = formData.get("subjectId") as string | null;
    const moduleId = formData.get("moduleId") as string | null;
    const yearStr = formData.get("year") as string | null;
    const file = formData.get("file") as File | null;

    if (!type || !ALLOWED_TYPE.includes(type as (typeof ALLOWED_TYPE)[number])) {
      return NextResponse.json(
        { error: "Invalid or missing type (syllabus, notes, pyq)" },
        { status: 400 }
      );
    }
    if (!subjectId) {
      return NextResponse.json(
        { error: "Subject is required" },
        { status: 400 }
      );
    }
    if (!file || !(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "A valid PDF file is required" },
        { status: 400 }
      );
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Only PDF files are allowed" },
        { status: 400 }
      );
    }

    if (type === "notes" && !moduleId) {
      return NextResponse.json(
        { error: "Module is required for notes" },
        { status: 400 }
      );
    }
    if (type === "pyq") {
      const year = yearStr ? Number(yearStr) : NaN;
      if (!yearStr || isNaN(year) || year < 2020 || year > 2026) {
        return NextResponse.json(
          { error: "Valid year (2020–2026) is required for PYQs" },
          { status: 400 }
        );
      }
    }

    const response = NextResponse.next();
    const supabase = createServerClientForRequestResponse(request, response);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("[upload] User ID:", user.id);

    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError) {
      console.error("[upload] Profile fetch error:", profileError);
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 500 }
      );
    }

    console.log("[upload] Profile data:", profile);
    console.log("[upload] Profile role:", profile?.role);

    if (profile.role !== "superadmin") {
      return NextResponse.json(
        { error: "Forbidden: Superadmin only" },
        { status: 403 }
      );
    }

    const { data: subject } = await supabase
      .from("subjects")
      .select("id")
      .eq("id", subjectId)
      .single();

    if (!subject) {
      return NextResponse.json(
        { error: "Subject not found" },
        { status: 400 }
      );
    }

    if (type === "notes" && moduleId) {
      const { data: module } = await supabase
        .from("modules")
        .select("id")
        .eq("id", moduleId)
        .eq("subject_id", subjectId)
        .single();
      if (!module) {
        return NextResponse.json(
          { error: "Module not found or does not belong to subject" },
          { status: 400 }
        );
      }
    }

    const timestamp = Date.now();
    const subjectCode = await getSubjectCode(subjectId);
    const fileName = `${type}_${subjectCode}_${timestamp}.pdf`;
    const filePath = `${type}/${subjectId}/${fileName}`;

    const fileBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(filePath, fileBuffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const yearValue =
      type === "pyq" && yearStr ? Number(yearStr) : null;

    const { data: document, error: dbError } = await adminClient
      .from("documents")
      .insert({
        type,
        subject_id: subjectId,
        module_id: moduleId || null,
        year: yearValue,
        title: file.name,
        file_path: filePath,
        uploaded_by: user.id,
        status: "processing",
      })
      .select()
      .single();

    if (dbError) {
      console.error("[upload] Database error:", dbError);
      await supabase.storage.from("documents").remove([filePath]);
      return NextResponse.json(
        { error: `Database error: ${dbError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "File uploaded successfully",
      documentId: document.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
