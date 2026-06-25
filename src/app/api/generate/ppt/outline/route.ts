import { buildOutlinePrompt, type SlideOutline } from "@/lib/ppt/generator";
import { routeAI } from "@/lib/ai/router";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import { requireAuth, requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import type { NextRequest } from "next/server";

const VALID_DEPTHS = ["basic", "intermediate", "advanced"] as const;
type Depth = (typeof VALID_DEPTHS)[number];

// A generation is "done with" once it reaches one of these. Anything else
// (outline_done / generating_* / building / pending) is still resumable.
const TERMINAL_STATUSES = ["completed", "failed", "abandoned"] as const;

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

    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

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
      return apiError("subjectId is required", 400);
    }
    if (!customTopic && !moduleId && !moduleNameFromBody) {
      return apiError(
        "At least one of moduleId, moduleName, or customTopic is required",
        400
      );
    }

    const { data: contentRow, error: contentError } = await adminClient
      .from("subject_content")
      .select("content, reference_books")
      .eq("subject_id", subjectId)
      .maybeSingle();

    if (contentError) {
      console.error("[ppt/outline] subject_content error:", contentError.message);
      return apiError("Failed to load syllabus content", 500);
    }
    if (!contentRow) {
      return apiError(
        "Syllabus content not found for this subject",
        404
      );
    }

    const { data: subject, error: subjectError } = await adminClient
      .from("subjects")
      .select("id, name, code")
      .eq("id", subjectId)
      .single();

    if (subjectError || !subject) {
      return apiError("Subject not found", 404);
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
        return apiError("Module not found for this subject", 404);
      }
      const m = mod as { name?: string; description?: string | null };
      moduleName = m.name ?? moduleName;
      moduleDescription = String(m.description ?? "");
    }

    // ── Double-submit / duplicate guard (Task 6) ──────────────────────────
    // Run BEFORE any AI call so a duplicate never costs a second outline +
    // diagram spend. If the same user already kicked off a non-terminal
    // generation for this exact subject + module/topic in the last 10 minutes,
    // hand that row back so the client can resume it instead of starting over.
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recentRows } = await adminClient
      .from("generated_content")
      .select("id, status, metadata, created_at")
      .eq("generated_by", user.id)
      .eq("type", "ppt")
      .eq("subject_id", subjectId)
      .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`)
      .gte("created_at", tenMinAgo)
      .order("created_at", { ascending: false })
      .limit(10);

    const duplicate = (recentRows ?? []).find((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const sameModule = (meta.moduleId ?? null) === (moduleId ?? null);
      const sameTopic = (meta.customTopic ?? null) === (customTopic ?? null);
      return sameModule && sameTopic;
    });

    if (duplicate) {
      const meta = (duplicate.metadata ?? {}) as Record<string, unknown>;
      const slides = Array.isArray(meta.slides) ? meta.slides : [];
      const done = slides.filter((s) => s != null).length;
      console.log(
        `[ppt/outline] Duplicate in-flight generation ${duplicate.id} (${done}/${slides.length}) — offering resume`
      );
      return Response.json({
        duplicate: true,
        contentId: duplicate.id,
        slidesDone: done,
        slidesTotal: slides.length,
      });
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
      return apiError("Failed to parse presentation outline", 500);
    }

    console.log(`[ppt/outline] Done. Slides planned: ${outline.outline.length}`);

    // ── Checkpoint immediately (Task 1) ───────────────────────────────────
    // Persist a resumable row BEFORE any content/diagram batch runs. metadata
    // .slides is a null-filled array sized to the outline; the checkpoint route
    // fills it in as batches complete, and build finalizes this same row.
    const outlineCostInr = outlineAi.costInr ?? 0;
    const { data: checkpointRow, error: checkpointError } = await adminClient
      .from("generated_content")
      .insert({
        subject_id: subjectId,
        module_id: moduleId ?? null,
        type: "ppt",
        title: outline.presentationTitle,
        file_path: null,
        metadata: {
          outline,
          slides: new Array(outline.outline.length).fill(null),
          slideCount: outline.outline.length,
          presentationTitle: outline.presentationTitle,
          subject: outline.subject,
          topic: outline.topic,
          depth,
          moduleId: moduleId ?? null,
          customTopic: customTopic ?? null,
          totalFlashCostInr: outlineCostInr,
        },
        generated_by: user.id,
        status: "outline_done",
      })
      .select("id")
      .single();

    if (checkpointError || !checkpointRow) {
      // Non-fatal: the client can still generate without resume support. Log
      // loudly so we notice if checkpointing silently stops working.
      console.error(
        "[ppt/outline] Checkpoint insert failed (continuing without resume):",
        checkpointError?.message
      );
    }

    return Response.json({
      outline,
      costInr: outlineCostInr,
      contentId: checkpointRow?.id ?? null,
    });
  } catch (err) {
    console.error("[ppt/outline] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate outline";
    return apiError(message, 500);
  }
}
