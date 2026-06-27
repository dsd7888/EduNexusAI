// _regen2.ts — end-to-end I.C. Engines regen with all fixes from this round:
//   1. strip-at-source (batch/route.ts)
//   2. imagen-before-mermaid priority (SlidePreview.tsx)
//   3. empty-bullets single-retry guard (batch/route.ts)
//
// Run from edunexus-ai/:
//   npx tsx _regen2.ts 2>&1 | tee /tmp/regen2.log
//
// The resulting .pptx is saved to edunexus-ai/_regen2_output.pptx
// Delete this script after confirming the output.

import fs from "fs";
import path from "path";

// ─── Load .env.local BEFORE any imports that read env vars ───────────────────
const ENV_FILE = path.join(process.cwd(), ".env.local");
if (!fs.existsSync(ENV_FILE)) throw new Error(".env.local not found in " + process.cwd());
for (const line of fs.readFileSync(ENV_FILE, "utf-8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx < 0) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
    val = val.slice(1, -1);
  if (!process.env[key]) process.env[key] = val;
}

// ─── Inline schemas (copied from route files) ────────────────────────────────
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
            enum: ["title","overview","concept","diagram","dual_visual","example","practice","summary"],
          },
          title: { type: "string" },
          renderHint: { type: "string", enum: ["svg","mermaid","imagen","illustration","dual"] },
          diagramComplexity: { type: "string", enum: ["standard","intricate"] },
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

const DIAGRAM_BATCH_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      index: { type: "number" },
      type: {
        type: "string",
        enum: ["title","overview","concept","diagram","dual_visual","example","practice","summary"],
      },
      title: { type: "string" },
      bullets: { type: "array", items: { type: "string" } },
      svgCode: { type: "string" },
      mermaidCode: { type: "string" },
      imagenPrompt: { type: "string" },
      diagramCaption: { type: "string" },
      diagramRenderType: {
        type: "string",
        enum: ["svg","mermaid","imagen","illustration","dual"],
      },
    },
    required: ["type", "title"],
  },
} as const;

const VALID_VISUAL_HINTS = ["svg", "mermaid", "imagen", "illustration", "dual"];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Dynamic imports run after env is set — avoids Next.js `next/headers` issues
  // in supabase-server.ts by using @supabase/supabase-js directly.
  const { createClient } = await import("@supabase/supabase-js");
  const { routeAI, routeDiagramBatchModel } = await import("@/lib/ai/router");
  const {
    buildOutlinePrompt,
    buildBatchContentPrompt,
    parseBatchContent,
    generatePPTXBuffer,
  } = await import("@/lib/ppt/generator");
  const { generateImagenImage, buildImagenPrompt } = await import("@/lib/ai/imagen");

  // Admin Supabase client — same as createAdminClient() without the next/headers dep
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // ─── Find subject ────────────────────────────────────────────────────────────
  // Search for subjects related to Mechanical/Civil Engineering (where IC Engines
  // material typically lives in this syllabus). Prefer exact mechanical match.
  const { data: subjects, error: subjectErr } = await admin
    .from("subjects")
    .select("id, name, code")
    .or("name.ilike.%mechanical%,name.ilike.%civil%,name.ilike.%engine%,code.ilike.%ME%,code.ilike.%CV%");

  if (subjectErr) throw new Error("Supabase error: " + subjectErr.message);
  if (!subjects || subjects.length === 0)
    throw new Error('No mechanical/civil subjects found. Check DB or search pattern.');

  console.log("\nMatching subjects:");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (subjects as any[]).forEach((s) => console.log(`  [${s.code}] ${s.name}  id=${s.id}`));

  // Pick the most relevant: prefer one that mentions "Mechanical" or "Civil"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subject = ((subjects as any[]).find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: any) => /mechanical|civil/i.test(s.name)
  ) ?? subjects[0]) as any;
  const subjectId: string = subject.id;
  const subjectName: string = subject.name;
  const subjectCode: string = subject.code ?? "";

  // ─── Fetch syllabus ──────────────────────────────────────────────────────────
  const { data: contentRow } = await admin
    .from("subject_content")
    .select("content, reference_books")
    .eq("subject_id", subjectId)
    .maybeSingle();

  if (!contentRow) throw new Error(`No syllabus for subject ${subjectId}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fullSyllabus: string = String((contentRow as any).content ?? "");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const referenceBooks: string = String((contentRow as any).reference_books ?? "");

  const customTopic = "Basics of I.C. Engines";
  const depth = "intermediate" as const;

  console.log(`\n${"=".repeat(70)}`);
  console.log(`REGEN: "${customTopic}"  |  ${subjectCode}: ${subjectName}`);
  console.log(`${"=".repeat(70)}\n`);

  let totalCostInr = 0;

  // ─── STAGE 1: OUTLINE ────────────────────────────────────────────────────────
  console.log("[outline] Building prompt and calling routeAI...");
  const outlinePrompt = buildOutlinePrompt({
    subjectName,
    subjectCode,
    fullSyllabus,
    customTopic,
    depth,
    referenceBooks,
  });

  const outlineAi = await routeAI("ppt_gen", {
    messages: [{ role: "user", content: outlinePrompt }],
    responseSchema: OUTLINE_SCHEMA,
  });
  totalCostInr += outlineAi.costInr;
  console.log(`[outline] Raw response length: ${String(outlineAi.content ?? "").length}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let outlineData: any;
  try {
    outlineData = JSON.parse(String(outlineAi.content ?? ""));
  } catch {
    console.error("[outline] JSON parse failed. Raw:", String(outlineAi.content ?? "").slice(0, 500));
    throw new Error("Outline parse failed");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outlineItems: any[] = outlineData.outline ?? [];
  console.log(`[outline] Done. Slides planned: ${outlineItems.length}`);

  // ── METRIC 1: outline mis-tag rate ───────────────────────────────────────────
  const mistaggedConcepts = outlineItems.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: any) => s.type === "concept" && s.renderHint && VALID_VISUAL_HINTS.includes(s.renderHint)
  );
  const illustrationDiagrams = outlineItems.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: any) => s.type === "diagram" && s.renderHint === "illustration"
  );
  console.log(`\n=== METRIC 1: OUTLINE MIS-TAG RATE ===`);
  console.log(`  concept slides carrying a visual renderHint (the bug): ${mistaggedConcepts.length}`);
  console.log(`  proper type:diagram renderHint:illustration slides: ${illustrationDiagrams.length}`);
  if (mistaggedConcepts.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mistaggedConcepts.forEach((s: any) =>
      console.log(`    mis-tag: #${s.index} "${s.title}" → renderHint=${s.renderHint}`)
    );
  }

  // ─── STAGE 2: CONTENT BATCHES ────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allSlides: (any | null)[] = new Array(outlineItems.length).fill(null);

  const contentItems = outlineItems.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: any) => s.type !== "diagram" && s.type !== "dual_visual"
  );
  const diagramItems = outlineItems.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: any) => s.type === "diagram" || s.type === "dual_visual"
  );

  const BATCH_SIZE = 5;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentBatches: any[][] = [];
  for (let i = 0; i < contentItems.length; i += BATCH_SIZE)
    contentBatches.push(contentItems.slice(i, i + BATCH_SIZE));

  let totalStripped = 0;
  let totalBlank = 0;
  let totalTextSlides = 0;
  let totalRetried = 0;
  let totalRetryRecovered = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strippedDetails: string[] = [];

  console.log(`\n[batch] ${contentItems.length} content slides → ${contentBatches.length} batch(es)`);

  for (let bi = 0; bi < contentBatches.length; bi++) {
    const batch = contentBatches[bi];

    // ── strip-at-source ──────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stripped: string[] = [];
    const strippedIdxSet = new Set<number>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const processedBatch = batch.map((s: any) => {
      const type = String(s.type ?? "concept");
      let renderHint: string | null = s.renderHint ?? null;
      if (renderHint && VALID_VISUAL_HINTS.includes(renderHint) &&
          type !== "diagram" && type !== "dual_visual") {
        stripped.push(`#${s.index}(${type},${renderHint})"${String(s.title ?? "").slice(0, 40)}"`);
        strippedIdxSet.add(Number(s.index));
        renderHint = null;
      }
      return { ...s, renderHint };
    });

    if (stripped.length > 0) {
      totalStripped += stripped.length;
      stripped.forEach((e) => strippedDetails.push(e));
      console.warn(
        `[ppt/batch][stripped-hint] dropped visual renderHint from ${stripped.length} text slide(s): ${stripped.join(" | ")}`
      );
    }

    // ── call batch model ─────────────────────────────────────────────────────
    const batchPrompt = buildBatchContentPrompt({
      subjectName,
      fullSyllabus,
      depth,
      slides: processedBatch,
      referenceBooks,
      customTopic,
    });

    console.log(
      `[batch] content batch ${bi + 1}/${contentBatches.length} (${batch.length} slides)...`
    );
    const batchAi = await routeAI("ppt_gen", {
      messages: [{ role: "user", content: batchPrompt }],
      maxTokens: 32768,
    });
    totalCostInr += batchAi.costInr;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed: any[] = parseBatchContent(String(batchAi.content ?? "")) ?? [];
    console.log(
      `[batch] content batch ${bi + 1} → parsed ${parsed.length} slide(s) from response`
    );

    // ── empty-bullets retry (Task 3) ─────────────────────────────────────────
    for (let li = 0; li < parsed.length; li++) {
      const slide = parsed[li];
      const inputSlide = processedBatch[li];
      if (!slide || slide.type === "diagram" || slide.type === "dual_visual") continue;

      totalTextSlides++;
      const wasStripped = strippedIdxSet.has(Number(inputSlide?.index ?? -1));
      const needsBullets = ["concept", "overview", "summary"].includes(String(slide.type ?? ""));
      const needsExample = slide.type === "example";
      const needsQuestion = slide.type === "practice";
      const isEmpty =
        (needsBullets && (!Array.isArray(slide.bullets) || slide.bullets.length === 0)) ||
        (needsExample && !slide.example?.problem) ||
        (needsQuestion && !slide.question?.text);

      if (isEmpty && !wasStripped) {
        totalRetried++;
        console.warn(
          `[ppt/batch][empty-bullets-retry] #${inputSlide?.index} "${String(slide.title ?? "").slice(0, 40)}" — retrying once`
        );
        const retryPrompt = buildBatchContentPrompt({
          subjectName,
          fullSyllabus,
          depth,
          slides: [inputSlide],
          referenceBooks,
          customTopic,
        });
        const retryAi = await routeAI("ppt_gen", {
          messages: [{ role: "user", content: retryPrompt }],
          maxTokens: 32768,
        });
        totalCostInr += retryAi.costInr;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const retryParsed: any[] = parseBatchContent(String(retryAi.content ?? "")) ?? [];
        if (retryParsed.length > 0) {
          const recovered = retryParsed[0];
          const hasContent = needsBullets
            ? Array.isArray(recovered.bullets) && recovered.bullets.length > 0
            : needsExample
            ? !!recovered.example?.problem
            : !!recovered.question?.text;
          if (hasContent) {
            parsed[li] = { ...recovered, type: slide.type, title: slide.title };
            totalRetryRecovered++;
            console.log(
              `[ppt/batch][empty-bullets-retry] #${inputSlide?.index} "${String(slide.title ?? "").slice(0, 40)}" recovered (bullets=${Array.isArray(recovered.bullets) ? recovered.bullets.length : 0})`
            );
          } else {
            totalBlank++;
            console.warn(
              `[ppt/batch][empty-bullets-retry] #${inputSlide?.index} "${String(slide.title ?? "").slice(0, 40)}" STILL empty after retry`
            );
          }
        } else {
          totalBlank++;
          console.warn(
            `[ppt/batch][empty-bullets-retry] #${inputSlide?.index} retry returned no parseable slides`
          );
        }
      } else if (isEmpty && wasStripped) {
        // hint was stripped → content model DID produce text, but still came back empty
        // (separate failure mode, not addressed by the retry guard)
        totalBlank++;
        console.warn(
          `[ppt/batch] #${inputSlide?.index} "${String(slide.title ?? "").slice(0, 40)}" empty even after hint strip`
        );
      }
    }

    // Assign into global slots
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    batch.forEach((outlineSlide: any, li: number) => {
      if (parsed[li] != null) allSlides[outlineSlide.index] = parsed[li];
    });
  }

  // ── METRIC 2 ─────────────────────────────────────────────────────────────────
  console.log(`\n=== METRIC 2: STRIPPED HINTS (spurious renderHint dropped at input) ===`);
  console.log(`  stripped this run: ${totalStripped}`);
  if (strippedDetails.length > 0)
    console.log(`  [${strippedDetails.join(" | ")}]`);

  // ── METRIC 3 ─────────────────────────────────────────────────────────────────
  console.log(`\n=== METRIC 3: TEXT-SLIDE CONTENT AFTER FIX ===`);
  console.log(`  text slides evaluated: ${totalTextSlides}`);
  console.log(`  blanks after all retries: ${totalBlank}`);
  console.log(`  retried: ${totalRetried}, recovered by retry: ${totalRetryRecovered}`);

  // List previously-blank concept slides that now have bullets
  console.log(`\n  Previously-blank concept slides now:`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recovered = mistaggedConcepts.map((mc: any) => {
    const slide = allSlides[mc.index];
    const bullets = Array.isArray(slide?.bullets) ? slide.bullets.length : 0;
    return { index: mc.index, title: mc.title, bullets };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recovered.forEach((r: any) =>
    console.log(`    #${r.index} "${r.title}" bullets=${r.bullets}`)
  );

  // ─── Retry wrapper for transient AI network errors ───────────────────────────
  async function retryAI(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    task: string, params: any, maxTries = 3, delayMs = 3000
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    for (let t = 1; t <= maxTries; t++) {
      try {
        return await routeAI(task, params);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (t === maxTries) throw err;
        console.warn(`[retryAI] attempt ${t}/${maxTries} failed (${msg.slice(0, 80)}), retrying in ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs * t));
      }
    }
  }

  // ─── STAGE 3: DIAGRAM BATCHES ────────────────────────────────────────────────
  console.log(`\n[batch] ${diagramItems.length} diagram slide(s) — 1 per batch`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const dSlide of diagramItems as any[]) {
    const diagramBatch = [dSlide];
    // routeDiagramBatchModel expects the shape { renderHint, diagramComplexity }
    const modelChoice = routeDiagramBatchModel([
      { renderHint: dSlide.renderHint, diagramComplexity: dSlide.diagramComplexity },
    ]);
    const task = "ppt_diagram";
    const diagramPrompt = buildBatchContentPrompt({
      subjectName,
      fullSyllabus,
      depth,
      slides: diagramBatch,
      referenceBooks,
      customTopic,
    });

    console.log(
      `[batch] diagram #${dSlide.index} "${String(dSlide.title ?? "").slice(0, 40)}" ` +
        `renderHint=${dSlide.renderHint ?? "svg"} model=${modelChoice}`
    );
    const dAi = await retryAI(task, {
      messages: [{ role: "user", content: diagramPrompt }],
      maxTokens: 8192,
      model: modelChoice,
      responseSchema: DIAGRAM_BATCH_SCHEMA,
    });
    totalCostInr += dAi.costInr;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let dParsed: any[] = [];
    try {
      dParsed = JSON.parse(String(dAi.content ?? ""));
    } catch {
      dParsed = parseBatchContent(String(dAi.content ?? "")) ?? [];
    }

    // Brief pause between diagram API calls to avoid burst rate-limit errors
    await new Promise((r) => setTimeout(r, 400));

    if (dParsed.length > 0) {
      const result = dParsed[0];
      // Annotate renderType from input hint
      if (dSlide.renderHint) result.diagramRenderType = dSlide.renderHint;
      if (dSlide.diagramComplexity) result.diagramComplexity = dSlide.diagramComplexity;
      allSlides[dSlide.index] = result;
      console.log(
        `[batch] diagram #${dSlide.index} done — ` +
          `svgCode=${result.svgCode ? result.svgCode.length + "ch" : "none"} ` +
          `mermaidCode=${result.mermaidCode ? result.mermaidCode.length + "ch" : "none"} ` +
          `imagenPrompt=${result.imagenPrompt ? result.imagenPrompt.length + "ch" : "none"}`
      );
    } else {
      console.warn(`[batch] diagram #${dSlide.index} parse returned nothing`);
    }
  }

  // ─── STAGE 4: IMAGEN PRE-PASS ────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imagenSlides = (allSlides as any[])
    .map((slide, idx) => ({ slide, idx }))
    .filter(({ slide }) => {
      if (!slide || !slide.imagenPrompt || slide.imageBase64) return false;
      if (slide.type === "diagram") {
        return (
          slide.diagramRenderType === "imagen" ||
          slide.diagramRenderType === "illustration"
        );
      }
      if (slide.type === "dual_visual") return true;
      return false;
    });

  let totalImagenCost = 0;
  if (imagenSlides.length > 0) {
    console.log(`\n[imagen] Generating ${imagenSlides.length} image(s)`);
    await Promise.allSettled(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      imagenSlides.map(async ({ slide, idx }: any) => {
        const fullPrompt = buildImagenPrompt({
          slideTitle: slide.title,
          subject: subjectName,
          topic: customTopic,
          imagenPrompt: slide.imagenPrompt,
          renderHint:
            slide.type === "dual_visual" ? "dual" : (slide.diagramRenderType ?? null),
        });
        const complexity = slide.diagramComplexity ?? "standard";
        const imageBase64 = await generateImagenImage(fullPrompt, { complexity });
        if (imageBase64) {
          allSlides[idx] = { ...allSlides[idx], imageBase64 };
          const cost = (complexity === "intricate" ? 0.1 : 0.04) * 83.33;
          totalImagenCost += cost;
          console.log(`[imagen] slide #${idx} "${String(slide.title ?? "").slice(0, 40)}" done`);
        } else {
          console.warn(`[imagen] slide #${idx} returned null — no image`);
        }
      })
    );
  }

  // ─── STAGE 5: BUILD PPTX ─────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const validSlides = (allSlides as any[]).filter(Boolean);
  console.log(`\n[build] Building PPTX from ${validSlides.length} slides...`);

  const pptBuffer = await generatePPTXBuffer({
    presentationTitle: outlineData.presentationTitle,
    subject: outlineData.subject,
    topic: outlineData.topic,
    slides: validSlides,
    addLogo: false,
  });

  const outPath = path.join(process.cwd(), "_regen2_output.pptx");
  fs.writeFileSync(outPath, Buffer.from(pptBuffer));
  console.log(`[build] PPTX saved to: ${outPath}`);
  console.log(`[build] Size: ${Math.round(pptBuffer.byteLength / 1024)} KB`);

  // ─── FINAL SUMMARY ────────────────────────────────────────────────────────────
  totalCostInr += totalImagenCost;
  console.log(`\n${"=".repeat(70)}`);
  console.log(`SUMMARY`);
  console.log(`${"=".repeat(70)}`);
  console.log(`outline mis-tags (concept+visual renderHint): ${mistaggedConcepts.length}`);
  console.log(`stripped at input: ${totalStripped}`);
  console.log(`text-slide blanks after all retries: ${totalBlank}`);
  console.log(
    `empty-bullets retried: ${totalRetried}, recovered: ${totalRetryRecovered}`
  );
  console.log(`total slides generated: ${validSlides.length}/${outlineItems.length}`);
  console.log(`total cost: ₹${totalCostInr.toFixed(4)} (text) + ₹${totalImagenCost.toFixed(2)} (imagen)`);
  console.log(`\nPPTX → ${outPath}`);
}

main().catch((err) => {
  console.error("[regen2] FATAL:", err);
  process.exit(1);
});
