import type { NextRequest } from "next/server";

import { getGeminiProvider } from "@/lib/ai/providers/gemini";
import { routeAI } from "@/lib/ai/router";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";

export async function GET(request: NextRequest) {
  try {
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

    if (profileError || !profile || profile.role !== "student") {
      return Response.json(
        { error: "Forbidden: Students only" },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const subjectId = url.searchParams.get("subjectId") ?? "";
    const moduleId = url.searchParams.get("moduleId") ?? "";

    if (!subjectId) {
      return Response.json(
        { error: "subjectId is required" },
        { status: 400 }
      );
    }

    const queryText = moduleId
      ? `QUICK_NOTES_MODULE_${moduleId}`
      : `QUICK_NOTES_SUBJECT_${subjectId}`;

    // 3. Check semantic_cache for existing notes
    const { data: cacheRow } = await adminClient
      .from("semantic_cache")
      .select("id, response, hit_count")
      .eq("subject_id", subjectId)
      .eq("query_text", queryText)
      .maybeSingle();

    if (cacheRow && cacheRow.response) {
      await adminClient
        .from("semantic_cache")
        .update({
          hit_count: (cacheRow.hit_count ?? 0) + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq("id", cacheRow.id);

      return Response.json({
        notes: cacheRow.response,
        fromCache: true,
      });
    }

    // Fetch syllabus & subject
    const { data: contentRow, error: contentError } = await adminClient
      .from("subject_content")
      .select("content")
      .eq("subject_id", subjectId)
      .maybeSingle();

    if (contentError || !contentRow) {
      return Response.json(
        { error: "No syllabus content found for this subject" },
        { status: 404 }
      );
    }

    const { data: subjectRow, error: subjectError } = await adminClient
      .from("subjects")
      .select("name")
      .eq("id", subjectId)
      .single();

    if (subjectError || !subjectRow) {
      return Response.json({ error: "Subject not found" }, { status: 404 });
    }

    let moduleName: string | null = null;
    if (moduleId) {
      const { data: moduleRow } = await adminClient
        .from("modules")
        .select("name")
        .eq("id", moduleId)
        .single();
      moduleName = moduleRow?.name ?? null;
    }

    const syllabusContent = String(contentRow.content ?? "");
    const topicLabel = moduleName || subjectRow.name;

    const prompt = `Generate comprehensive quick notes for ${
      moduleName ? `module "${moduleName}"` : `the subject "${subjectRow.name}"`
    }.

Syllabus content:
${syllabusContent}

Format the notes exactly as:

# ${topicLabel}

## Key Concepts
- Bullet points of core ideas, definitions, formulas

## Important Formulas / Rules
- List all key formulas with brief explanation

## Quick Summary
- 3-5 sentence overview of the entire topic

## Remember For Exams
- Most important points to memorize

Be concise but complete. Use markdown formatting. Return only the markdown notes.`;

    const ai = await routeAI("chat", {
      messages: [{ role: "user", content: prompt }],
    });
    const aiResponse = String(ai.content ?? "").trim();

    // Generate embedding and cache
    try {
      const gemini = getGeminiProvider();
      const embedding = await gemini.embed(queryText);
      const embeddingForDB = `[${embedding.join(",")}]`;

      await adminClient.from("semantic_cache").insert({
        subject_id: subjectId,
        module_id: moduleId || null,
        query_text: queryText,
        query_embedding: embeddingForDB,
        response: aiResponse,
        hit_count: 0,
        last_used_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[notes] Failed to cache notes:", err);
    }

    return Response.json({
      notes: aiResponse,
      fromCache: false,
    });
  } catch (err) {
    console.error("[notes] GET error:", err);
    const msg =
      err instanceof Error ? err.message : "Failed to generate notes";
    return Response.json({ error: msg }, { status: 500 });
  }
}

