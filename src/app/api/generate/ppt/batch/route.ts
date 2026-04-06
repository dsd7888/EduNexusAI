import {
  buildBatchContentPrompt,
  parseBatchContent,
  type SlideContent,
  type SlideType,
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
    console.log("[ppt/batch] POST request received");

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
    const customTopic =
      body?.customTopic != null
        ? String(body.customTopic).trim() || undefined
        : undefined;
    const slidesRaw = body?.slides;
    const validTypes: SlideType[] = [
      "title", "overview", "concept", "diagram", "example", "practice", "summary",
    ];
    const validRenderHints = ["svg", "mermaid", "imagen"] as const;
    type RenderHint = (typeof validRenderHints)[number];
    const slides: {
      index: number;
      type: SlideType;
      title: string;
      renderHint?: RenderHint | null;
    }[] = Array.isArray(slidesRaw)
      ? slidesRaw.map((s: unknown) => {
          const o = s as Record<string, unknown>;
          const rawType = String(o?.type ?? "concept");
          const type: SlideType = validTypes.includes(rawType as SlideType)
            ? (rawType as SlideType)
            : "concept";
          const rawHint = o?.renderHint as string | null | undefined;
          const renderHint: RenderHint | null =
            rawHint && validRenderHints.includes(rawHint as RenderHint)
              ? (rawHint as RenderHint)
              : null;
          return {
            index: Number(o?.index ?? 0),
            type,
            title: String(o?.title ?? ""),
            renderHint,
          };
        })
      : [];
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
    if (slides.length === 0) {
      return Response.json(
        { error: "slides array is required and must not be empty" },
        { status: 400 }
      );
    }

    const diagramCount = slides.filter((s) => s.type === "diagram").length;
    if (diagramCount >= 2) {
      console.warn(
        "[ppt/batch] High diagram count:",
        diagramCount,
        "— SVG generation may exceed token limit"
      );
    }

    const { data: contentRow, error: contentError } = await adminClient
      .from("subject_content")
      .select("content, reference_books")
      .eq("subject_id", subjectId)
      .maybeSingle();

    if (contentError) {
      console.error("[ppt/batch] subject_content error:", contentError.message);
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
      .select("id, name")
      .eq("id", subjectId)
      .single();

    if (subjectError || !subject) {
      return Response.json(
        { error: "Subject not found" },
        { status: 404 }
      );
    }

    const subjectName = (subject as { name?: string }).name ?? "";
    const row = contentRow as { content?: string; reference_books?: string };
    const fullSyllabus = String(row.content ?? "");
    const referenceBooks = String(row.reference_books ?? "");

    let moduleName: string | undefined;
    let moduleDescription = "";

    if (moduleId) {
      const { data: mod, error: modErr } = await adminClient
        .from("modules")
        .select("name, description")
        .eq("id", moduleId)
        .eq("subject_id", subjectId)
        .maybeSingle();

      if (!modErr && mod) {
        const m = mod as { name?: string; description?: string | null };
        moduleName = m.name;
        moduleDescription = String(m.description ?? "");
      }
    }

    const batchPrompt = buildBatchContentPrompt({
      subjectName,
      fullSyllabus,
      depth,
      slides,
      referenceBooks,
      moduleName,
      customTopic,
      moduleDescription,
    });
    async function generateBatchWithRetry(
      prompt: string,
      maxRetries: number = 2
    ): Promise<SlideContent[] | null> {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`[ppt/batch] Attempt ${attempt}/${maxRetries}`);
        try {
          const isDiagramBatch = slides.every(s => s.type === "diagram");
          const maxTokens = isDiagramBatch ? 16384 : 32768;
          const ai = await routeAI("ppt_gen", {
            messages: [{ role: "user", content: prompt }],
            maxTokens,
          });

          const text = String(ai.content ?? "");

          // Check for refusal BEFORE trying to parse
          const lower = text.toLowerCase();
          const isRefusal =
            lower.includes("i cannot") ||
            lower.includes("i'm unable") ||
            lower.includes("i am unable") ||
            lower.includes("cannot generate") ||
            lower.includes("not able to") ||
            (text.length < 500 && !text.trim().startsWith("["));

          if (isRefusal) {
            console.warn(
              "[ppt/batch] Gemini refused this batch. Generating fallback."
            );

            // Generate placeholder slides from the slide titles
            // so the deck is never missing slides
            const fallbackSlides: SlideContent[] = slides.map((s) => ({
              type: s.type,
              title: s.title,
              bullets:
                s.type === "concept" ||
                s.type === "overview" ||
                s.type === "summary"
                  ? [
                      `Content for "${s.title}" — please refer to your course materials for detailed notes on this topic.`,
                    ]
                  : undefined,
              example:
                s.type === "example"
                  ? {
                      problem: `Example problem for: ${s.title}`,
                      steps: [
                        "Refer to course materials for worked examples on this topic.",
                      ],
                      answer: "See course notes",
                    }
                  : undefined,
              question:
                s.type === "practice"
                  ? {
                      text: `Practice question on: ${s.title}`,
                      answer: "See course notes",
                      explanation:
                        "Refer to course materials for practice problems on this topic.",
                    }
                  : undefined,
            }));

            return fallbackSlides;
          }

          // If not a refusal, proceed with normal parsing
          const parsed = parseBatchContent(text);
          if (parsed && parsed.length > 0) {
            console.log(`[ppt/batch] Success on attempt ${attempt}`);
            return parsed;
          }
          console.warn(
            `[ppt/batch] Parse failed on attempt ${attempt}, retrying...`
          );
        } catch (err) {
          console.warn(`[ppt/batch] API error on attempt ${attempt}:`, err);
          if (attempt === maxRetries) throw err;
        }
        // Wait before retry (exponential backoff)
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, attempt * 1500));
        }
      }
      return null;
    }

    const batchContent = await generateBatchWithRetry(batchPrompt);

    if (!batchContent) {
      console.error("[ppt/batch] All retries exhausted");
      return Response.json(
        { error: "Failed to generate batch after retries" },
        { status: 500 }
      );
    }

    // Annotate diagramRenderType from input renderHint so build route can identify imagen slides
    const annotated = batchContent.map((slide, i) => {
      const inputSlide = slides[i];
      if (slide.type === "diagram" && inputSlide?.renderHint) {
        return {
          ...slide,
          diagramRenderType: inputSlide.renderHint as SlideContent["diagramRenderType"],
        };
      }
      return slide;
    });

    console.log(`[ppt/batch] Done. Generated ${annotated.length} slides`);
    return Response.json({ slides: annotated });
  } catch (err) {
    console.error("[ppt/batch] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate batch content";
    return Response.json({ error: message }, { status: 500 });
  }
}
