import {
  buildBatchContentPrompt,
  parseBatchContent,
  isAcceptableDiagramSVG,
  svgElementCount,
  type SlideContent,
  type SlideType,
} from "@/lib/ppt/generator";
import {
  routeAI,
  routeDiagramBatchModel,
  type DiagramComplexity,
} from "@/lib/ai/router";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import { requireAuth, requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import type { NextRequest } from "next/server";

const VALID_DEPTHS = ["basic", "intermediate", "advanced"] as const;
type Depth = (typeof VALID_DEPTHS)[number];

// responseSchema for diagram-only (Pro) batches. The batch response is a JSON
// array of slide objects; constraining it guarantees parseable JSON on the
// first call, so a malformed-JSON diagram response no longer costs a full
// wasted Pro call plus a retry (measured at ~89s / ~₹4.36 on one slide).
// Only `type` and `title` are required; the diagram payload field
// (svgCode / mermaidCode / imagenPrompt) is filled per render type.
const DIAGRAM_BATCH_SCHEMA = {
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
      bullets: { type: "array", items: { type: "string" } },
      svgCode: { type: "string" },
      mermaidCode: { type: "string" },
      imagenPrompt: { type: "string" },
      diagramCaption: { type: "string" },
      diagramRenderType: {
        type: "string",
        enum: ["svg", "mermaid", "imagen", "illustration", "dual"],
      },
    },
    required: ["type", "title"],
  },
} as const;

export async function POST(request: NextRequest) {
  try {
    console.log("[ppt/batch] POST request received");

    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const subjectId = String(body?.subjectId ?? "").trim();
    const moduleId = String(body?.moduleId ?? "").trim() || undefined;
    const customTopic =
      body?.customTopic != null
        ? String(body.customTopic).trim() || undefined
        : undefined;
    const slidesRaw = body?.slides;
    const validTypes: SlideType[] = [
      "title",
      "overview",
      "concept",
      "diagram",
      "dual_visual",
      "example",
      "practice",
      "summary",
    ];
    const validRenderHints = [
      "svg",
      "mermaid",
      "imagen",
      "illustration",
      "dual",
    ] as const;
    type RenderHint = (typeof validRenderHints)[number];
    const slides: {
      index: number;
      type: SlideType;
      title: string;
      renderHint?: RenderHint | null;
      diagramComplexity?: DiagramComplexity;
      leftVisual?: string;
      rightVisual?: string;
      leftPrompt?: string;
      rightPrompt?: string;
    }[] = Array.isArray(slidesRaw)
      ? slidesRaw.map((s: unknown) => {
          const o = s as Record<string, unknown>;
          const rawType = String(o?.type ?? "concept");
          const type: SlideType = validTypes.includes(rawType as SlideType)
            ? (rawType as SlideType)
            : "concept";
          const rawHint = o?.renderHint as string | null | undefined;
          let renderHint: RenderHint | null =
            rawHint && validRenderHints.includes(rawHint as RenderHint)
              ? (rawHint as RenderHint)
              : null;
          if (type === "dual_visual") {
            renderHint = "dual";
          }
          // Diagram intricacy tag from the outline. Missing/invalid → "standard"
          // (cheap Flash path); the SVG escalation net catches anything Flash
          // botches, so an absent tag never silently forces a costly Pro call.
          const diagramComplexity: DiagramComplexity | undefined =
            type === "diagram" || type === "dual_visual"
              ? String(o?.diagramComplexity ?? "").toLowerCase() === "intricate"
                ? "intricate"
                : "standard"
              : undefined;
          const base = {
            index: Number(o?.index ?? 0),
            type,
            title: String(o?.title ?? ""),
            renderHint,
            diagramComplexity,
          };
          if (type !== "dual_visual") return base;
          return {
            ...base,
            leftVisual:
              o?.leftVisual != null
                ? String(o.leftVisual).trim() || undefined
                : undefined,
            rightVisual:
              o?.rightVisual != null
                ? String(o.rightVisual).trim() || undefined
                : undefined,
            leftPrompt:
              o?.leftPrompt != null
                ? String(o.leftPrompt).trim() || undefined
                : undefined,
            rightPrompt:
              o?.rightPrompt != null
                ? String(o.rightPrompt).trim() || undefined
                : undefined,
          };
        })
      : [];
    const depthRaw = String(body?.depth ?? "intermediate").toLowerCase();
    const depth: Depth = VALID_DEPTHS.includes(depthRaw as Depth)
      ? (depthRaw as Depth)
      : "intermediate";

    if (!subjectId) {
      return apiError("subjectId is required", 400);
    }
    if (slides.length === 0) {
      return apiError(
        "slides array is required and must not be empty",
        400
      );
    }

    const diagramCount = slides.filter(
      (s) => s.type === "diagram" || s.type === "dual_visual"
    ).length;
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
      .select("id, name")
      .eq("id", subjectId)
      .single();

    if (subjectError || !subject) {
      return apiError("Subject not found", 404);
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
    let batchCostInr = 0;

    const isDiagramBatch = slides.every(
      (s) => s.type === "diagram" || s.type === "dual_visual"
    );
    // Does this batch ask the TEXT model to emit SVG markup? Only svg/dual (and
    // a bare diagram, which defaults to svg) do — those are the slides the
    // escalation net validates and, on sparse/invalid output, retries on Pro.
    // mermaid/imagen/illustration produce no SVG here, so they never escalate.
    const batchProducesSVG =
      isDiagramBatch &&
      slides.some(
        (s) =>
          s.renderHint === "svg" ||
          s.renderHint === "dual" ||
          s.type === "dual_visual" ||
          (s.type === "diagram" && s.renderHint == null)
      );

    type RunResult =
      | { kind: "ok"; slides: SlideContent[]; costInr: number; timeMs: number }
      | { kind: "fallback"; slides: SlideContent[]; costInr: number; timeMs: number }
      | { kind: "fail"; costInr: number; timeMs: number };

    // Placeholder slides built from titles so a refused batch is never missing
    // slides (preserves prior behaviour, now reusable across model attempts).
    function buildRefusalFallback(): SlideContent[] {
      return slides.map((s) => ({
        type: s.type,
        title: s.title,
        bullets:
          s.type === "concept" || s.type === "overview" || s.type === "summary"
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
        ...(s.type === "dual_visual"
          ? {
              diagramRenderType: "dual" as const,
              imagenPrompt: [s.leftPrompt, `Conceptual metaphor for: ${s.title}`]
                .filter(Boolean)
                .join(" "),
              svgCode: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400"><rect width="800" height="400" fill="#F8FAFC"/><text x="400" y="200" text-anchor="middle" font-size="16" fill="#64748B">Technical diagram — see course notes</text></svg>`,
              diagramCaption:
                "Left: metaphor; right: structure — refer to course materials.",
            }
          : {}),
      }));
    }

    // One generation attempt on a SPECIFIC model, with transient-retry + refusal
    // handling. Returns cost + wall-time so callers can attribute spend and
    // latency to the path that actually ran (Task 5).
    async function runBatchOnModel(
      prompt: string,
      model: "flash" | "pro",
      maxRetries: number = 2
    ): Promise<RunResult> {
      let costInr = 0;
      const start = Date.now();
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(
          `[ppt/batch] ${isDiagramBatch ? "diagram" : "content"} attempt ${attempt}/${maxRetries} on ${model}`
        );
        try {
          const maxTokens = isDiagramBatch ? 8192 : 32768;
          const ai = await routeAI(isDiagramBatch ? "ppt_diagram" : "ppt_gen", {
            messages: [{ role: "user", content: prompt }],
            maxTokens,
            model, // explicit per-attempt model override (router honours it)
            // Schema-constrain diagram batches only; content batches keep their
            // existing free-form parsing (parseBatchContent).
            ...(isDiagramBatch ? { responseSchema: DIAGRAM_BATCH_SCHEMA } : {}),
          });
          costInr += ai.costInr;

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
              `[ppt/batch] Gemini (${model}) refused this batch. Generating fallback.`
            );
            return {
              kind: "fallback",
              slides: buildRefusalFallback(),
              costInr,
              timeMs: Date.now() - start,
            };
          }

          const parsed = parseBatchContent(text);
          if (parsed && parsed.length > 0) {
            console.log(
              `[ppt/batch] Parsed ${parsed.length} slide(s) on attempt ${attempt} (${model})`
            );
            return {
              kind: "ok",
              slides: parsed,
              costInr,
              timeMs: Date.now() - start,
            };
          }
          console.warn(
            `[ppt/batch] Parse failed on attempt ${attempt} (${model}), retrying...`
          );
        } catch (err) {
          console.warn(`[ppt/batch] API error on attempt ${attempt} (${model}):`, err);
          if (attempt === maxRetries) throw err;
        }
        // Wait before retry (exponential backoff)
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, attempt * 1500));
        }
      }
      return { kind: "fail", costInr, timeMs: Date.now() - start };
    }

    // Did Flash return acceptable SVG for EVERY slide that should carry one?
    // (isAcceptableDiagramSVG = valid markup AND not suspiciously sparse.)
    function flashSvgIsAcceptable(out: SlideContent[]): boolean {
      return slides.every((inp, i) => {
        const wantsSvg =
          inp.renderHint === "svg" ||
          inp.renderHint === "dual" ||
          inp.type === "dual_visual" ||
          (inp.type === "diagram" && inp.renderHint == null);
        if (!wantsSvg) return true;
        return isAcceptableDiagramSVG(out[i]?.svgCode ?? "");
      });
    }

    // Per-path cost/latency telemetry for the cost-summary (Task 5).
    const pathStats: Record<string, { costInr: number; timeMs: number }> = {};
    function recordPath(path: string, costInr: number, timeMs: number) {
      const s = (pathStats[path] ??= { costInr: 0, timeMs: 0 });
      s.costInr += costInr;
      s.timeMs += timeMs;
    }

    let diagramPath: string | null = null;
    let diagramModel: "flash" | "pro" | null = null;

    async function generateBatch(prompt: string): Promise<SlideContent[] | null> {
      // CONTENT batches: unchanged behaviour — Flash, no escalation.
      if (!isDiagramBatch) {
        const r = await runBatchOnModel(prompt, "flash");
        batchCostInr += r.costInr;
        recordPath("content-flash", r.costInr, r.timeMs);
        return r.kind === "fail" ? null : r.slides;
      }

      // DIAGRAM batches: route by renderHint + diagramComplexity.
      diagramModel = routeDiagramBatchModel(slides);

      // pro-direct: intricate SVG/dual goes straight to Pro (no escalation step).
      if (diagramModel === "pro") {
        const r = await runBatchOnModel(prompt, "pro");
        batchCostInr += r.costInr;
        diagramPath = "pro-direct";
        recordPath("pro-direct", r.costInr, r.timeMs);
        return r.kind === "fail" ? null : r.slides;
      }

      // Flash first.
      const flash = await runBatchOnModel(prompt, "flash");
      batchCostInr += flash.costInr;

      // A clean Flash result = parsed OK and (no SVG expected, or every SVG
      // passes the acceptance gate). Anything else on an SVG batch escalates to
      // Pro BEFORE any placeholder fallback is allowed to stand.
      const flashSucceededClean =
        flash.kind === "ok" &&
        (!batchProducesSVG || flashSvgIsAcceptable(flash.slides));

      if (!batchProducesSVG || flashSucceededClean) {
        diagramPath = "flash-direct";
        recordPath("flash-direct", flash.costInr, flash.timeMs);
        return flash.kind === "fail" ? null : flash.slides;
      }

      console.warn(
        `[ppt/batch] Flash SVG rejected (kind=${flash.kind}) — escalating single slide to Pro`
      );
      const pro = await runBatchOnModel(prompt, "pro");
      batchCostInr += pro.costInr;
      diagramPath = "flash-failed-escalated-to-pro";
      diagramModel = "pro";
      // Attribute BOTH the wasted Flash attempt and the Pro retry to this path.
      recordPath(
        "flash-failed-escalated-to-pro",
        flash.costInr + pro.costInr,
        flash.timeMs + pro.timeMs
      );

      if (pro.kind !== "fail") return pro.slides;
      // Pro also failed: fall back to whatever Flash produced, else null.
      return flash.kind === "fail" ? null : flash.slides;
    }

    const batchContent = await generateBatch(batchPrompt);

    if (!batchContent) {
      console.error(
        "[ppt/batch] All retries exhausted — returning placeholders"
      );
      const placeholders = slides.map((s) => ({
        type: s.type ?? "concept",
        title: s.title ?? "Slide",
        bullets: ["Content generation failed for this slide."],
        note: "⚠️ Regenerate this slide using the Refine page.",
        _failed: true,
      }));
      return Response.json({ slides: placeholders, partial: true, costInr: batchCostInr });
    }

    // Annotate diagramRenderType from input renderHint so build route can identify imagen slides.
    // Also propagate diagramComplexity onto diagram/dual_visual slides so the
    // image-generation pre-pass (build route) can pick the intricate image tier.
    const annotated = batchContent.map((slide, i) => {
      const inputSlide = slides[i];
      if (slide.type === "diagram" && inputSlide?.renderHint) {
        return {
          ...slide,
          diagramRenderType: inputSlide.renderHint as SlideContent["diagramRenderType"],
          ...(inputSlide.diagramComplexity
            ? { diagramComplexity: inputSlide.diagramComplexity }
            : {}),
        };
      }
      if (slide.type === "dual_visual") {
        return {
          ...slide,
          diagramRenderType: "dual" as const,
          ...(inputSlide?.diagramComplexity
            ? { diagramComplexity: inputSlide.diagramComplexity }
            : {}),
          ...(inputSlide?.leftVisual != null
            ? { leftVisual: inputSlide.leftVisual }
            : {}),
          ...(inputSlide?.rightVisual != null
            ? { rightVisual: inputSlide.rightVisual }
            : {}),
          ...(inputSlide?.leftPrompt != null
            ? { leftPrompt: inputSlide.leftPrompt }
            : {}),
          ...(inputSlide?.rightPrompt != null
            ? { rightPrompt: inputSlide.rightPrompt }
            : {}),
        };
      }
      return slide;
    });

    // ── Cost / latency summary, broken out by path (Task 5) ──────────────────
    // Each diagram batch is a single slide, so the per-request lines below tally
    // up across a deck: grep `[ppt/batch][diagram-path]` to see how many diagrams
    // took each of the three paths and the real escalation rate.
    for (const [path, s] of Object.entries(pathStats)) {
      console.log(
        `[ppt/batch][cost-summary] path=${path} costInr=₹${s.costInr.toFixed(4)} timeMs=${s.timeMs}`
      );
    }
    if (isDiagramBatch) {
      const maxSvgElements = annotated.reduce(
        (m, sl) => Math.max(m, svgElementCount(sl.svgCode ?? "")),
        0
      );
      const head = slides[0];
      console.log(
        `[ppt/batch][diagram-path] title="${head?.title ?? ""}" ` +
          `renderHint=${head?.renderHint ?? "svg"} ` +
          `complexity=${head?.diagramComplexity ?? "standard"} ` +
          `model=${diagramModel} path=${diagramPath} ` +
          `maxSvgElements=${maxSvgElements} costInr=₹${batchCostInr.toFixed(4)}`
      );
    }

    console.log(`[ppt/batch] Done. Generated ${annotated.length} slides`);
    return Response.json({
      slides: annotated,
      costInr: batchCostInr,
      // Telemetry so the frontend/build route can aggregate spend by path and
      // attribute Pro spend correctly (instead of folding it into "Flash cost").
      diagramPath,
      diagramModel,
      costByPath: pathStats,
    });
  } catch (err) {
    console.error("[ppt/batch] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate batch content";
    return apiError(message, 500);
  }
}
