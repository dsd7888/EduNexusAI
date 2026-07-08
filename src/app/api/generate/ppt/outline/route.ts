import { buildOutlinePrompt, type SlideOutline } from "@/lib/ppt/generator";
import { outlineSlideIsLabelHeavy } from "@/lib/ai/imagen";
import { routeAI } from "@/lib/ai/router";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import { requireAuth, requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import type { AILogContext } from "@/lib/ai/providers/types";
import type { NextRequest } from "next/server";

const VALID_DEPTHS = ["basic", "intermediate", "advanced"] as const;
type Depth = (typeof VALID_DEPTHS)[number];

// A generation is "done with" once it reaches one of these. Anything else
// (outline_done / generating_* / building / pending) is still resumable.
const TERMINAL_STATUSES = ["completed", "failed", "abandoned"] as const;

// responseSchema for the outline call. Constraining the output guarantees
// parseable, schema-conformant JSON on the first call — so the whole multi-tier
// fallback parser this route used to carry is gone. Crucially the schema covers
// EVERY field the happy path produces (not just index/type/title): renderHint,
// diagramComplexity, and the dual_visual quartet. The old line-by-line fallback
// silently dropped all of those whenever it fired, which is why dual_visual
// slides never survived to the batch step.
//
// Optional fields are simply absent from `required`; the model omits them where
// they don't apply (e.g. renderHint on a title slide) rather than emitting null.
const OUTLINE_SCHEMA = {
  type: "object",
  properties: {
    presentationTitle: { type: "string" },
    subject: { type: "string" },
    topic: { type: "string" },
    outline: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "number" },
          type: {
            type: "string",
            enum: [
              "title",
              "overview",
              "concept",
              "diagram",
              "dual_visual",
              "example",
              "practice",
              "summary",
            ],
          },
          title: { type: "string" },
          renderHint: {
            type: "string",
            enum: ["svg", "mermaid", "imagen", "illustration", "dual"],
          },
          diagramComplexity: {
            type: "string",
            enum: ["standard", "intricate"],
          },
          leftVisual: { type: "string" },
          rightVisual: { type: "string" },
          leftPrompt: { type: "string" },
          rightPrompt: { type: "string" },
        },
        required: ["index", "type", "title"],
      },
    },
  },
  required: ["presentationTitle", "subject", "topic", "outline"],
} as const;

export async function POST(request: NextRequest) {
  try {
    console.log("[ppt/outline] POST request received");

    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

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
    const contentId = crypto.randomUUID();
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
      responseSchema: OUTLINE_SCHEMA,
      logContext: {
        userId: user.id,
        userEmail: user.email ?? null,
        userRole: profile.role,
        subjectId,
        subjectCode: subjectCode || null,
        jobId: contentId,
        relatedContentId: contentId,
        feature: "ppt_generation",
      } satisfies AILogContext,
    });
    const raw = String(outlineAi.content ?? "");
    console.log(`[ppt/outline] Raw response length: ${raw.length}`);
    console.log(`[ppt/outline] Raw preview: ${raw.slice(0, 300)}`);

    // responseSchema guarantees schema-conformant JSON, so a single direct parse
    // replaces the old five-tier fallback chain. A failure here means the model
    // call itself failed (truncation/empty), not malformed JSON — surface it.
    let outline: SlideOutline | null = null;
    try {
      const parsed = JSON.parse(raw) as SlideOutline;
      if (parsed?.outline?.length >= 3) outline = parsed;
    } catch (parseErr) {
      console.error(
        "[ppt/outline] JSON.parse failed despite responseSchema:",
        parseErr instanceof Error ? parseErr.message : parseErr
      );
    }

    if (!outline) {
      console.error(
        "[ppt/outline] Outline parse/validation failed. Raw:",
        raw.slice(0, 500)
      );
      return apiError("Failed to parse presentation outline", 500);
    }

    // Redirect label-heavy imagen/illustration slides to SVG at the outline stage
    // so they never enter the imagen pipeline. These are 2D technical figures
    // (component diagrams, A-vs-B comparisons) — SVG is both cheaper and more
    // accurate for them.
    for (const slide of outline.outline) {
      if (
        slide.type === "diagram" &&
        (slide.renderHint === "imagen" || slide.renderHint === "illustration") &&
        outlineSlideIsLabelHeavy(slide.title)
      ) {
        console.log(
          `[ppt/outline] label-heavy→svg: "${slide.title.slice(0, 50)}" (was ${slide.renderHint})`
        );
        slide.renderHint = "svg";
        if (!slide.diagramComplexity) {
          slide.diagramComplexity = "intricate";
        }
      }
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
        id: contentId,
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
      contentId: checkpointRow?.id ?? contentId,
    });
  } catch (err) {
    console.error("[ppt/outline] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate outline";
    return apiError(message, 500);
  }
}
