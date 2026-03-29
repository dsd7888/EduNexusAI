import { buildOutlinePrompt, type SlideOutline } from "@/lib/ppt/generator";
import { routeAI } from "@/lib/ai/router";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

const VALID_DEPTHS = ["basic", "intermediate", "advanced"] as const;
type Depth = (typeof VALID_DEPTHS)[number];

type OutlineSlide = SlideOutline["outline"][number];

function parseOutlineRobust(raw: string): SlideOutline | null {
  // Step 1: Clean markdown fences
  let cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();

  // Step 2: Fix common Gemini JSON corruption patterns
  cleaned = cleaned
    // Fix: "index = 13" → "index": 13
    .replace(/"index\s*=\s*(\d+)"/g, '"index": $1')
    // Fix trailing commas before } or ]
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    // Fix: missing comma between objects
    .replace(/}\s*{/g, "},{")
    // Fix: single quotes instead of double
    .replace(/'/g, '"')
    // Fix: unquoted keys like {index: 0} → {"index": 0}
    .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

  // Attempt 1: direct parse after cleaning
  try {
    const parsed = JSON.parse(cleaned) as SlideOutline;
    if (parsed?.outline?.length >= 3) return parsed;
  } catch {
    /* continue */
  }

  // Attempt 2: extract JSON object between first { and last }
  try {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as SlideOutline;
      if (parsed?.outline?.length >= 3) return parsed;
    }
  } catch {
    /* continue */
  }

  // Attempt 3: fix the specific "index = N" pattern more aggressively
  try {
    const fixed = cleaned.replace(/"index\s*[=:]\s*(\d+)"/g, '"index": $1');
    const start = fixed.indexOf("{");
    const end = fixed.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const parsed = JSON.parse(fixed.slice(start, end + 1)) as SlideOutline;
      if (parsed?.outline?.length >= 3) return parsed;
    }
  } catch {
    /* continue */
  }

  // Attempt 4: extract slide objects one by one
  // (handles truncation + any remaining malformed objects)
  try {
    const slides: OutlineSlide[] = [];
    const titleMatch = cleaned.match(/"presentationTitle"\s*:\s*"([^"]+)"/);
    const subjectMatch = cleaned.match(/"subject"\s*:\s*"([^"]+)"/);
    const topicMatch = cleaned.match(/"topic"\s*:\s*"([^"]+)"/);

    // Extract each slide with a regex that handles the known fields
    const slidePattern =
      /\{\s*"index[^"]*"\s*[=:]\s*(\d+)\s*,\s*"type"\s*:\s*"([^"]+)"\s*,\s*"title"\s*:\s*"([^"]+)"\s*\}/g;
    let match: RegExpExecArray | null;
    while ((match = slidePattern.exec(cleaned)) !== null) {
      slides.push({
        index: parseInt(match[1], 10),
        type: match[2] as OutlineSlide["type"],
        title: match[3],
      });
    }

    if (slides.length >= 5) {
      console.log(`[ppt/outline] Regex extracted ${slides.length} slides`);
      return {
        presentationTitle: titleMatch?.[1] ?? "Presentation",
        subject: subjectMatch?.[1] ?? "",
        topic: topicMatch?.[1] ?? "",
        outline: slides.sort((a, b) => a.index - b.index),
      };
    }
  } catch {
    /* continue */
  }

  // Attempt 5: line-by-line object reconstruction
  try {
    const slides: OutlineSlide[] = [];
    const titleMatch = cleaned.match(/"presentationTitle"\s*:\s*"([^"]+)"/);
    const subjectMatch = cleaned.match(/"subject"\s*:\s*"([^"]+)"/);
    const topicMatch = cleaned.match(/"topic"\s*:\s*"([^"]+)"/);

    const lines = cleaned.split("\n");
    let currentSlide: Partial<OutlineSlide> = {};

    for (const line of lines) {
      const indexMatch = line.match(/"index[^"]*"\s*[=:]\s*(\d+)/);
      const typeMatch = line.match(/"type"\s*:\s*"([^"]+)"/);
      const titleLineMatch = line.match(/"title"\s*:\s*"([^"]+)"/);

      if (indexMatch) currentSlide.index = parseInt(indexMatch[1], 10);
      if (typeMatch) currentSlide.type = typeMatch[1] as OutlineSlide["type"];
      if (titleLineMatch) currentSlide.title = titleLineMatch[1];

      if (
        currentSlide.index !== undefined &&
        currentSlide.type &&
        currentSlide.title
      ) {
        slides.push({
          index: currentSlide.index,
          type: currentSlide.type,
          title: currentSlide.title,
        });
        currentSlide = {};
      }
    }

    if (slides.length >= 5) {
      console.log(
        `[ppt/outline] Line-by-line extracted ${slides.length} slides`
      );
      return {
        presentationTitle: titleMatch?.[1] ?? "Presentation",
        subject: subjectMatch?.[1] ?? "",
        topic: topicMatch?.[1] ?? "",
        outline: slides.sort((a, b) => a.index - b.index),
      };
    }
  } catch {
    /* continue */
  }

  return null;
}

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
    const moduleId = String(body?.moduleId ?? "").trim() || undefined;
    const moduleNameFromBody =
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
    if (!customTopic && !moduleId && !moduleNameFromBody) {
      return Response.json(
        {
          error:
            "At least one of moduleId, moduleName, or customTopic is required",
        },
        { status: 400 }
      );
    }

    const { data: contentRow, error: contentError } = await adminClient
      .from("subject_content")
      .select("content, reference_books")
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
    const row = contentRow as { content?: string; reference_books?: string };
    const fullSyllabus = String(row.content ?? "");
    const referenceBooks = String(row.reference_books ?? "");

    let moduleName: string | undefined = moduleNameFromBody;
    let moduleDescription = "";

    if (moduleId) {
      const { data: mod, error: modErr } = await adminClient
        .from("modules")
        .select("name, description")
        .eq("id", moduleId)
        .eq("subject_id", subjectId)
        .single();

      if (modErr || !mod) {
        return Response.json(
          { error: "Module not found for this subject" },
          { status: 404 }
        );
      }
      const m = mod as { name?: string; description?: string | null };
      moduleName = m.name ?? moduleName;
      moduleDescription = String(m.description ?? "");
    }

    console.log("[ppt/outline] Generating outline...");
    const outlinePrompt = buildOutlinePrompt({
      subjectName,
      subjectCode,
      fullSyllabus,
      moduleName,
      customTopic,
      moduleDescription,
      depth,
      referenceBooks,
    });
    const outlineAi = await routeAI("ppt_gen", {
      messages: [{ role: "user", content: outlinePrompt }],
    });
    const raw = String(outlineAi.content ?? "");
    console.log(`[ppt/outline] Raw response length: ${raw.length}`);
    console.log(`[ppt/outline] Raw preview: ${raw.slice(0, 300)}`);

    const outline = parseOutlineRobust(raw);

    if (!outline) {
      console.error(
        "[ppt/outline] All parse attempts failed. Raw:",
        raw.slice(0, 500)
      );
      return Response.json(
        { error: "Failed to parse presentation outline" },
        { status: 500 }
      );
    }

    console.log(`[ppt/outline] Done. Slides planned: ${outline.outline.length}`);
    return Response.json({ outline });
  } catch (err) {
    console.error("[ppt/outline] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate outline";
    return Response.json({ error: message }, { status: 500 });
  }
}
