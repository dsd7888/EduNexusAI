import { after } from 'next/server'
import { GoogleGenAI, Modality } from '@google/genai'
import { logAICall } from './costLogger'
import { calculateImageCostInr } from './pricing'
import type { AILogContext } from './providers/types'

// Migrated to the unified @google/genai SDK. gemini.ts still uses the legacy
// @google/generative-ai SDK; both can coexist while that file is migrated
// separately. The single shared client below is created lazily.
let cachedClient: GoogleGenAI | null = null
function getGenAI(): GoogleGenAI {
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY!,
    })
  }
  return cachedClient
}

export type ImageComplexity = 'standard' | 'intricate'

/**
 * Image-model tiers, selected by the diagram's diagramComplexity tag:
 *  - standard  → gemini-2.5-flash-image (cheap, fast), fallback gemini-3.1-flash-image
 *  - intricate → gemini-3-pro-image (higher fidelity),  fallback gemini-3.1-flash-image
 *
 * gemini-3.1-flash-image replaces the now-deprecated imagen-4.0-fast-generate-001
 * fallback and serves as the universal safety net for both tiers.
 */
const IMAGE_MODEL_CHAIN: Record<ImageComplexity, string[]> = {
  standard: ['gemini-2.5-flash-image', 'gemini-3.1-flash-image'],
  intricate: ['gemini-3-pro-image', 'gemini-3.1-flash-image'],
}

export interface GenerateImageOptions {
  aspectRatio?: '16:9' | '4:3' | '1:1'
  /** Diagram intricacy tag from the outline — selects the image-model tier. */
  complexity?: ImageComplexity
  /**
   * When provided, each successful (or fully-failed) image generation writes
   * one ai_call_logs row via after(). Callers in the PPT pipeline pass the
   * same contentId/job_id as the text-model calls for that deck.
   */
  logContext?: AILogContext
}

/**
 * Generate a single image, returning base64 PNG bytes (no data-URI prefix) or
 * null if every model in the tier's chain fails.
 *
 * `options` accepts an object; a bare aspect-ratio string is still accepted for
 * backward compatibility with older positional callers.
 */
export async function generateImagenImage(
  prompt: string,
  options: GenerateImageOptions | '16:9' | '4:3' | '1:1' = {}
): Promise<string | null> {
  const opts: GenerateImageOptions =
    typeof options === 'string' ? { aspectRatio: options } : options
  const aspectRatio = opts.aspectRatio ?? '16:9'
  const complexity: ImageComplexity = opts.complexity ?? 'standard'
  const chain = IMAGE_MODEL_CHAIN[complexity]
  const startedAt = Date.now()

  const ai = getGenAI()
  let lastError: string | null = null

  for (const modelName of chain) {
    try {
      const result = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseModalities: [Modality.IMAGE, Modality.TEXT],
          imageConfig: { aspectRatio },
        },
      })

      const parts = result.candidates?.[0]?.content?.parts ?? []
      for (const part of parts) {
        const inlineData = part.inlineData
        if (inlineData?.data && inlineData?.mimeType?.startsWith('image/')) {
          console.log(
            `[imagen] Generated via ${modelName} (tier=${complexity})`
          )
          if (opts.logContext) {
            const { costUsd, costInr } = calculateImageCostInr(complexity, 1)
            const latencyMs = Date.now() - startedAt
            after(() => {
              void logAICall({
                logContext: {
                  ...opts.logContext!,
                  metadata: {
                    ...(opts.logContext!.metadata ?? {}),
                    imageModel: modelName,
                    tier: complexity,
                  },
                },
                task: 'ppt_imagen',
                model: 'imagen',
                unitType: 'images',
                imageCount: 1,
                costUsd,
                costInr,
                status: 'success',
                latencyMs,
              })
            })
          }
          return inlineData.data
        }
      }
      console.warn(`[imagen] ${modelName}: no image parts in response`)
      lastError = `${modelName}: no image parts in response`
    } catch (err: any) {
      console.warn(`[imagen] ${modelName} failed:`, err?.message ?? err)
      lastError = err?.message ? String(err.message) : String(err)
    }
  }

  if (opts.logContext) {
    const latencyMs = Date.now() - startedAt
    const errMsg = (lastError ?? 'all image models failed').slice(0, 500)
    after(() => {
      void logAICall({
        logContext: {
          ...opts.logContext!,
          metadata: {
            ...(opts.logContext!.metadata ?? {}),
            tier: complexity,
          },
        },
        task: 'ppt_imagen',
        model: 'imagen',
        unitType: 'images',
        imageCount: 0,
        costUsd: 0,
        costInr: 0,
        status: 'error',
        errorMessage: errMsg,
        latencyMs,
      })
    })
  }

  return null
}

/**
 * Heuristic: does this imagen/illustration prompt describe a LABEL-HEAVY
 * technical figure (multiple precise, named callouts) rather than an unlabeled
 * scene/metaphor? Diffusion image models reliably mangle text, so label-heavy
 * figures must NOT be left on the cheap "standard" tier — the caller upgrades
 * them to the intricate (Pro) image model, where label fidelity is far better.
 *
 * Judged on CONTENT, not length: explicit label/annotation language, several
 * quoted label strings the model wrote into the prompt, or an enumerated list of
 * named technical parts. A short prose scene description trips none of these.
 */
export function imagenPromptIsLabelHeavy(prompt: string): boolean {
  if (!prompt) return false;
  const p = prompt.toLowerCase();
  // Explicit instruction to label/annotate, or a known label-bearing figure kind.
  const mentionsLabels =
    /\b(label|labell?ed|labell?ing|annotat\w*|callout|call-out|legend|schematic|cross[- ]section|exploded view|cutaway|each part|name each|with arrows pointing)\b/.test(
      p
    );
  // Quoted label strings the model placed in the prompt — e.g. ... "Piston", "Crankshaft".
  const quotedLabels = (prompt.match(/["“”']([^"“”']{2,40})["“”']/g) || []).length;
  // Enumerated named parts: a 4+ item comma list joined with "and" reads as a
  // parts manifest ("piston, connecting rod, crankshaft, and flywheel").
  const commas = (prompt.match(/,/g) || []).length;
  const enumeratedParts = commas >= 4 && /\band\b/.test(p);
  return mentionsLabels || quotedLabels >= 2 || enumeratedParts;
}

/**
 * Outline-stage equivalent of imagenPromptIsLabelHeavy. At outline time there
 * is no imagenPrompt yet — only the slide title. Returns true when the title
 * signals a label-heavy 2D technical figure (component diagrams, A-vs-B
 * comparisons, labeled schematics) that SVG renders far better than any image
 * model. Slides that match are redirected renderHint:"imagen"→"svg" before they
 * ever enter the imagen pipeline.
 */
export function outlineSlideIsLabelHeavy(title: string): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  // Component / part-list diagrams → labeled SVG is always the right call
  if (/\bcomponents?\b|\bparts?\s+of\b|\bpart\s+list\b/.test(t)) return true;
  // A-vs-B / comparison → side-by-side SVG table, not an imagen scene
  if (/\bvs\.?\b|\bversus\b|\bcompar(ison|ative)\b|\bdifferences?\s+(between|of)\b/.test(t)) return true;
  // Labeled schematic / cross-section language in the title itself
  if (/\bschematic\b|\bcross[- ]section\b|\bcutaway\b|\bexploded\b|\blabeled\s+(diagram|view)\b/.test(t)) return true;
  // Block / state / structure diagrams are 2D precision, not 3D scenes
  if (/\bblock\s+diagram\b|\bstate\s+diagram\b|\bstructure\s+(of|diagram)\b/.test(t)) return true;
  return false;
}

export function buildImagenPrompt(options: {
  slideTitle: string
  subject: string
  topic: string
  imagenPrompt: string
  /** From outline/batch diagram renderHint or diagramRenderType (e.g. "illustration"). */
  renderHint?: string | null
}): string {
  const { slideTitle, subject, topic, imagenPrompt, renderHint } = options

  const subjectLower = subject.toLowerCase()
  const isMedical =
    /medical|anatomy|physiology|pharmacology|pathology|clinical|health|nursing|biochem/i.test(
      subjectLower
    )
  const isEngineering =
    /engineering|chemical|civil|electrical|thermal|fluid/i.test(subjectLower)
  const isMechanical =
    /mechanical|manufacturing|machine design|kinematics|dynamics|thermodynamics|materials|strength of/i.test(
      subjectLower
    )
  const isArchitecture =
    /architect|design|spatial|urban|structural/i.test(subjectLower)
  const isBiology =
    /biology|cell|molecular|genetics|ecology|microbio/i.test(subjectLower)
  const isCS =
    /computer science|algorithms|data structures|operating system|networks|software|programming|database|machine learning|artificial intelligence/i.test(
      subjectLower
    )

  const title = slideTitle
  const subjectName = subject

  // Detect if this is conceptual illustration vs technical diagram
  const isConceptual =
    renderHint === "illustration" ||
    renderHint === "dual" ||
    /metaphor|introduction to|visual explanation|conceptual|what is|like a/i.test(
      title
    )

  if (isConceptual) {
    // CONCEPTUAL ILLUSTRATION MODE
    let prompt = `Create a conceptual educational illustration that uses a visual metaphor to explain: ${title}.

The illustration should:
- Show a familiar real-world object, process, or scenario that embodies this concept
- Use clear visual storytelling (e.g., before/during/after sequence, or side-by-side comparison)
- Include minimal text labels (3-5 words maximum per label)
- Use a clean, simplified illustration style (not photorealistic, not cartoon)
- Color-code different elements for visual clarity
- White or very light neutral background

Subject context: ${subjectName}

Specific scene direction (follow closely):
${imagenPrompt}

`

    // Add domain-specific metaphor guidance
    if (isMedical) {
      prompt += `Use medical/anatomical analogies where appropriate. `
    } else if (isCS || isEngineering) {
      prompt += `Use everyday technology or mechanical analogies. `
    }

    prompt += `Style: Simplified educational illustration with clean lines, flat color palette,
minimal shading. Think textbook diagram or infographic, NOT photograph, NOT 3D render,
NOT stock photo. Vector illustration aesthetic, white background, high clarity.`

    return prompt
  }

  // TECHNICAL DIAGRAM MODE (existing code)
  const fieldAccuracyNote = isMedical
    ? `Every anatomical structure must be in its correct position, proportion,
and spatial relationship as found in Gray's Anatomy. Labels must use correct
anatomical terminology. Incorrect anatomy in a medical teaching illustration
is professionally unacceptable.`
    : isMechanical
    ? `All components must reflect correct geometry, assembly relationships,
and proportions as found in standard mechanical engineering references.
Thread profiles, gear geometry, bearing arrangements must be realistic.`
    : isEngineering
    ? `All components must be in their correct positions and proportions as
they appear in real equipment. Flow directions, mechanical linkages, and
spatial relationships must match real engineering practice.`
    : isCS
    ? `All hardware components and system architectures must reflect real
physical designs. Memory layouts, circuit arrangements, and component
hierarchies must be accurate to industry standards.`
    : isArchitecture
    ? `Spatial relationships, structural elements, and proportions must reflect
real architectural and structural principles. Terminology must be correct.`
    : isBiology
    ? `All biological structures must be depicted in correct relative size,
position, and morphology consistent with standard biology textbooks and
microscopy references.`
    : `All components, relationships, and spatial arrangements must accurately
represent the real subject matter as it would appear in a leading university
textbook for this field.`

  return `Create a professional educational illustration for a university lecture.

SUBJECT: ${subject}
TOPIC: ${topic}
SLIDE TITLE: "${slideTitle}"

WHAT TO ILLUSTRATE:
${imagenPrompt}

ACCURACY REQUIREMENT:
${fieldAccuracyNote}

STYLE REQUIREMENTS:
Produce a clean, high-contrast scientific or technical illustration suitable
for projection on a classroom screen. Use a pure white or very light grey
(#F8FAFC) background. Ensure all elements are clearly visible against the
background — no dark backgrounds, no decorative borders, no watermarks.
Apply a professional colour palette: blues for structures, greens for
flow and function, ambers for highlights and callouts, reds for critical
or warning zones. Every major component visible in the illustration must
carry a legible label in a clean sans-serif font. Compose the image in
widescreen 16:9 format optimised for projection. The quality standard
is a peer-reviewed journal figure or a leading university textbook plate.`
}
