import {
  buildOutlinePrompt,
  parseOutlineResponse,
} from "@/lib/ppt/generator";
import { routeAI } from "@/lib/ai/router";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

const VALID_DEPTHS = ["basic", "intermediate", "advanced"] as const;
type Depth = (typeof VALID_DEPTHS)[number];

export async function POST(request: NextRequest) {
  try {
    console.log("[ppt/outline] POST request received");

    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return Response.json(
        { error: "Failed to load profile" },
        { status: 500 }
      );
    }

    const role = (profile as { role?: string }).role;
    if (role !== "faculty" && role !== "superadmin") {
      return Response.json(
        { error: "Forbidden: Faculty or Superadmin only" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const subjectId = String(body?.subjectId ?? "").trim();
    const moduleName =
      body?.moduleName != null ? String(body.moduleName).trim() || undefined : undefined;
    const customTopic =
      body?.customTopic != null ? String(body.customTopic).trim() || undefined : undefined;
    const depthRaw = String(body?.depth ?? "intermediate").toLowerCase();
    const depth: Depth = VALID_DEPTHS.includes(depthRaw as Depth)
      ? (depthRaw as Depth)
      : "intermediate";

    if (!subjectId) {
      return Response.json(
        { error: "subjectId is required" },
        { status: 400 }
      );
    }
    if (!moduleName && !customTopic) {
      return Response.json(
        { error: "At least one of moduleName or customTopic is required" },
        { status: 400 }
      );
    }

    const { data: contentRow, error: contentError } = await adminClient
      .from("subject_content")
      .select("content")
      .eq("subject_id", subjectId)
      .maybeSingle();

    if (contentError) {
      console.error("[ppt/outline] subject_content error:", contentError.message);
      return Response.json(
        { error: "Failed to load syllabus content" },
        { status: 500 }
      );
    }
    if (!contentRow) {
      return Response.json(
        { error: "Syllabus content not found for this subject" },
        { status: 404 }
      );
    }

    const { data: subject, error: subjectError } = await adminClient
      .from("subjects")
      .select("id, name, code")
      .eq("id", subjectId)
      .single();

    if (subjectError || !subject) {
      return Response.json(
        { error: "Subject not found" },
        { status: 404 }
      );
    }

    const subjectName = (subject as { name?: string }).name ?? "";
    const subjectCode = (subject as { code?: string }).code ?? "";
    const syllabusContent = String(
      (contentRow as { content?: string }).content ?? ""
    );

    console.log("[ppt/outline] Generating outline...");
    const outlinePrompt = buildOutlinePrompt({
      subjectName,
      subjectCode,
      syllabusContent,
      moduleName,
      customTopic,
      depth,
    });
    const outlineAi = await routeAI("ppt_gen", {
      messages: [{ role: "user", content: outlinePrompt }],
    });
    const outlineRaw = String(outlineAi.content ?? "");
    const outline = parseOutlineResponse(outlineRaw);

    if (!outline) {
      console.error("[ppt/outline] Failed to parse outline JSON");
      return Response.json(
        { error: "Failed to generate outline" },
        { status: 500 }
      );
    }

    console.log("[ppt/outline] Done. Slides planned:", outline.outline.length);
    return Response.json({ outline });
  } catch (err) {
    console.error("[ppt/outline] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate outline";
    return Response.json({ error: message }, { status: 500 });
  }
}
