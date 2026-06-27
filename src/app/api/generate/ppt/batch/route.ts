import {
  buildBatchContentPrompt,
  parseBatchContent,
  isAcceptableDiagramSVG,
  isAcceptableDiagramMermaid,
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
          // STRIP-AT-SOURCE: a renderHint only ever applies to a visual slide
          // (type diagram / dual_visual). The outline routinely mis-hangs
          // renderHint:"illustration" on text slides — concept, but also title,
          // overview, example, practice, summary. Left in place, the content
          // model obeys the illustration rule, emits an imagenPrompt and DROPS the
          // slide's real text (bullets / example / question) → a blank slide.
          // Dropping the spurious hint makes the model produce normal text content
          // for that slide instead. Legitimate type:diagram illustrations are
          // untouched (they keep their hint and flow through the diagram path).
          if (
            type !== "diagram" &&
            type !== "dual_visual" &&
            renderHint != null
          ) {
            renderHint = null;
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
    const batchProducesSVG =
      isDiagramBatch &&
      slides.some(
        (s) =>
          s.renderHint === "svg" ||
          s.renderHint === "dual" ||
          s.type === "dual_visual" ||
          (s.type === "diagram" && s.renderHint == null)
      );
    // Does this batch ask the TEXT model to emit Mermaid markup? Mermaid gets the
    // SAME escalation net as SVG now (Task 1): a sparse/invalid mermaid stub (a
    // single node restating the title) is a Flash punt worth a Pro retry, not a
    // silent success.
    const batchProducesMermaid =
      isDiagramBatch &&
      slides.some((s) => s.type === "diagram" && s.renderHint === "mermaid");

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

          const parsed = parseBatchContent(text, {
            expectedSlides: slides.length,
            isDiagramBatch,
          });
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

    // Mermaid analogue of flashSvgIsAcceptable: did Flash return non-trivial
    // mermaid for EVERY slide that should carry it? (isAcceptableDiagramMermaid =
    // known diagram type with real connections, not a single title-restated node.)
    function flashMermaidIsAcceptable(out: SlideContent[]): boolean {
      return slides.every((inp, i) => {
        const wantsMermaid =
          inp.type === "diagram" && inp.renderHint === "mermaid";
        if (!wantsMermaid) return true;
        return isAcceptableDiagramMermaid(out[i]?.mermaidCode ?? "");
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
    // Set when a CONTENT batch is still unparseable after BOTH runBatchOnModel's
    // in-loop parse retries AND a fresh whole-batch regenerate (Task 1). Drives
    // the loud, flagged failure response so build/route.ts can decide abort-vs-ship
    // instead of a deck silently shipping placeholder title/overview slides.
    let contentParseFailed = false;

    async function generateBatch(prompt: string): Promise<SlideContent[] | null> {
      // CONTENT batches: Flash, no model escalation — but a TOTAL parse failure
      // ("No JSON array found" / "All recovery attempts failed") must not drop
      // straight to placeholders. runBatchOnModel already retried PARSING across
      // its in-loop attempts on a single generation; here we regenerate the whole
      // batch ONE more time from scratch (Task 1) — a fresh generation routinely
      // parses where a malformed one did not.
      if (!isDiagramBatch) {
        const first = await runBatchOnModel(prompt, "flash");
        batchCostInr += first.costInr;
        recordPath("content-flash", first.costInr, first.timeMs);
        if (first.kind !== "fail") return first.slides;

        console.warn(
          "[ppt/batch][content-fail] content batch unparseable after in-loop retries — regenerating the whole batch once before giving up"
        );
        const retry = await runBatchOnModel(prompt, "flash");
        batchCostInr += retry.costInr;
        recordPath("content-flash-retry", retry.costInr, retry.timeMs);
        if (retry.kind !== "fail") {
          console.log(
            "[ppt/batch][content-fail] whole-batch regenerate recovered the batch"
          );
          return retry.slides;
        }

        contentParseFailed = true;
        console.error(
          "[ppt/batch][content-fail] content batch STILL unparseable after whole-batch regenerate — flagging affected slides for build route"
        );
        return null;
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
      // passes the gate) and (no mermaid expected, or every mermaid passes it).
      const flashParseFailed = flash.kind === "fail";
      const svgSparse =
        flash.kind === "ok" &&
        batchProducesSVG &&
        !flashSvgIsAcceptable(flash.slides);
      const mermaidSparse =
        flash.kind === "ok" &&
        batchProducesMermaid &&
        !flashMermaidIsAcceptable(flash.slides);
      const flashSucceededClean =
        flash.kind === "ok" && !svgSparse && !mermaidSparse;

      // Escalate to Pro whenever Flash did NOT cleanly succeed AND we have a Pro
      // safety net for this batch. Triggers, treated identically:
      //   (a) batchProducesSVG && SVG sparse/invalid — the original gate.
      //   (b) batchProducesMermaid && mermaid sparse/invalid — Task 1 parity.
      //   (c) flash failed to PARSE at all ("No JSON array found" / "All recovery
      //       attempts failed"). A total parse failure is just as strong a "Flash
      //       struggled" signal, so an imagen/illustration batch that won't parse
      //       also gets the Pro retry instead of silently dropping to placeholders.
      const shouldEscalate =
        !flashSucceededClean &&
        (batchProducesSVG || batchProducesMermaid || flashParseFailed);

      if (!shouldEscalate) {
        // Not escalating means Flash succeeded cleanly, or produced an
        // imagen/illustration batch that parsed — a "fail" kind always escalates
        // now, so flash.slides is always present here.
        diagramPath = "flash-direct";
        recordPath("flash-direct", flash.costInr, flash.timeMs);
        return flash.slides;
      }

      console.warn(
        `[ppt/batch] Flash diagram rejected (kind=${flash.kind}, parseFailed=${flashParseFailed}, svgSparse=${svgSparse}, mermaidSparse=${mermaidSparse}) — escalating single slide to Pro`
      );
      const pro = await runBatchOnModel(prompt, "pro");
      batchCostInr += pro.costInr;
      // Distinguish escalation causes in telemetry so `[ppt/batch][diagram-path]`
      // lets the failure modes be counted apart.
      diagramPath = flashParseFailed
        ? batchProducesSVG || batchProducesMermaid
          ? "flash-failed-escalated-to-pro"
          : "flash-parsefail-escalated-to-pro"
        : mermaidSparse && !svgSparse
          ? "flash-mermaid-escalated-to-pro"
          : "flash-failed-escalated-to-pro";
      diagramModel = "pro";
      // Attribute BOTH the wasted Flash attempt and the Pro retry to this path.
      recordPath(diagramPath, flash.costInr + pro.costInr, flash.timeMs + pro.timeMs);

      if (pro.kind !== "fail") return pro.slides;
      // Pro also failed: fall back to whatever Flash produced, else null.
      return flash.kind === "fail" ? null : flash.slides;
    }

    const batchContent = await generateBatch(batchPrompt);

    if (!batchContent) {
      const failedIndices = slides.map((s) => s.index);
      const failedTypes = slides.map((s) => s.type);
      // A failed title/overview slide is the unacceptable case — a deck must
      // never silently ship a "Content generation failed" title slide. This flag
      // rides to the frontend → build route, which decides abort-vs-ship.
      const hasCriticalSlide = slides.some(
        (s) => s.type === "title" || s.type === "overview"
      );
      console.error(
        `[ppt/batch][batch-fail] ${isDiagramBatch ? "diagram" : "content"} batch produced ZERO parseable slides after all retries` +
          `${contentParseFailed ? " + whole-batch regenerate" : ""}. ` +
          `affectedIndices=[${failedIndices.join(",")}] types=[${failedTypes.join(",")}] ` +
          `criticalSlidePresent=${hasCriticalSlide} — returning flagged placeholders.`
      );
      const placeholders = slides.map((s) => ({
        type: s.type ?? "concept",
        title: s.title ?? "Slide",
        bullets: ["Content generation failed for this slide."],
        note: "⚠️ Regenerate this slide using the Refine page.",
        _failed: true,
      }));
      return Response.json({
        slides: placeholders,
        partial: true,
        costInr: batchCostInr,
        parseFailed: true,
        failedSlideIndices: failedIndices,
        hasCriticalSlide,
      });
    }

    // Annotate diagramRenderType from input renderHint so build route can identify
    // imagen slides. Propagate diagramComplexity as-is from the outline — label-heavy
    // slides have already been redirected to renderHint:"svg" at the outline stage, so
    // no imagen-tier override is needed here.
    const annotated: SlideContent[] = batchContent.map((slide, i) => {
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

    // Compute stripped-hint list + index set in one pass:
    //   strippedList → telemetry string; strippedIndices → gates the empty-content
    //   retry below (slides whose hint was stripped had a different failure mode —
    //   the strip itself fixed them; empty bullets there would be a separate issue
    //   requiring a different look, so we leave them for now).
    const strippedList: string[] = [];
    const strippedIndices = new Set<number>();
    for (const s of Array.isArray(slidesRaw) ? slidesRaw : []) {
      const o = s as Record<string, unknown>;
      const t = String(o?.type ?? "");
      const h = String(o?.renderHint ?? "");
      const idx = Number(o?.index ?? -1);
      const isVisualHint = ["svg", "mermaid", "imagen", "illustration"].includes(h);
      if (isVisualHint && t !== "diagram" && t !== "dual_visual") {
        strippedList.push(`#${idx}(${t},${h})"${String(o?.title ?? "").slice(0, 40)}"`);
        strippedIndices.add(idx);
      }
    }

    // Single-retry guard for genuinely empty text content (model returned
    // bullets:[] with no renderHint involved). One Flash attempt, no fallback.
    // Same philosophy as the diagram escalation-retry: try once more before
    // accepting an empty slide; never degrade to a placeholder.
    if (!isDiagramBatch) {
      const emptyContentSlides = annotated
        .map((slide, arrIdx) => ({ slide, arrIdx }))
        .filter(({ slide, arrIdx }) => {
          if (slide.type === "diagram" || slide.type === "dual_visual") return false;
          const inp = slides[arrIdx];
          if (strippedIndices.has(inp?.index ?? -1)) return false;
          const needsBullets = ["concept", "overview", "summary"].includes(
            slide.type ?? ""
          );
          const needsExample = slide.type === "example";
          const needsQuestion = slide.type === "practice";
          if (
            needsBullets &&
            (!Array.isArray(slide.bullets) || slide.bullets.length === 0)
          )
            return true;
          if (needsExample && !slide.example?.problem) return true;
          if (needsQuestion && !slide.question?.text) return true;
          return false;
        });

      if (emptyContentSlides.length > 0) {
        console.warn(
          `[ppt/batch][empty-bullets-retry] ${emptyContentSlides.length} text slide(s) with empty content — retrying each once`
        );
        for (const { slide, arrIdx } of emptyContentSlides) {
          const inp = slides[arrIdx];
          if (!inp) continue;
          const retryPrompt = buildBatchContentPrompt({
            subjectName,
            fullSyllabus,
            depth,
            slides: [inp],
            referenceBooks,
            moduleName,
            customTopic,
            moduleDescription,
          });
          const retryResult = await runBatchOnModel(retryPrompt, "flash", 1);
          batchCostInr += retryResult.costInr;
          if (retryResult.kind === "ok" && retryResult.slides.length > 0) {
            const recovered = retryResult.slides[0];
            const needsBullets = ["concept", "overview", "summary"].includes(
              slide.type ?? ""
            );
            const hasContent = needsBullets
              ? Array.isArray(recovered.bullets) && recovered.bullets.length > 0
              : slide.type === "example"
              ? !!recovered.example?.problem
              : !!recovered.question?.text;
            if (hasContent) {
              annotated[arrIdx] = {
                ...recovered,
                type: slide.type,
                title: slide.title,
              };
              console.log(
                `[ppt/batch][empty-bullets-retry] #${inp.index} "${slide.title.slice(0, 40)}" recovered (bullets=${Array.isArray(recovered.bullets) ? recovered.bullets.length : 0})`
              );
            } else {
              console.warn(
                `[ppt/batch][empty-bullets-retry] #${inp.index} "${slide.title.slice(0, 40)}" STILL empty after retry`
              );
            }
          } else {
            console.warn(
              `[ppt/batch][empty-bullets-retry] #${inp.index} "${slide.title.slice(0, 40)}" retry kind=${retryResult.kind}`
            );
          }
        }
      }
    }

    // Outline mis-tag telemetry: grep `[ppt/batch][stripped-hint]` across a deck to
    // sum how many slides the outline mis-tagged (visual renderHint on a text type)
    // and had their spurious hint dropped at input so they kept their text content.
    // A healthy outline trends this to 0; it stays harmless either way.
    if (strippedList.length > 0) {
      console.warn(
        `[ppt/batch][stripped-hint] dropped visual renderHint from ${strippedList.length} text slide(s): ` +
          strippedList.join(" | ")
      );
    }

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
