import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(
  process.env.GOOGLE_GENERATIVE_AI_API_KEY!
)
const API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY!
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * PRIMARY: gemini-2.5-flash-image (generateContent API)
 * Same model family as existing Flash calls — cheapest, consistent.
 * FALLBACK: imagen-4.0-fast-generate-001 (predict API)
 * Higher quality photorealistic renders when Flash image isn't enough.
 */
export async function generateImagenImage(
  prompt: string,
  aspectRatio: '16:9' | '4:3' | '1:1' = '16:9'
): Promise<string | null> {

  // PRIMARY: gemini-2.5-flash-image
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-image',
    })

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        responseModalities: ['image', 'text'] as any,
      },
    } as any)

    const parts = result.response.candidates?.[0]?.content?.parts ?? []
    for (const part of parts) {
      const inlineData = (part as any).inlineData
      if (inlineData?.data && inlineData?.mimeType?.startsWith('image/')) {
        console.log('[imagen] Generated via gemini-2.5-flash-image')
        return inlineData.data
      }
    }
    console.warn('[imagen] Flash image: no image parts in response')
  } catch (err: any) {
    console.warn('[imagen] Flash image failed:', err?.message ?? err)
  }

  // FALLBACK: imagen-4.0-fast-generate-001
  try {
    console.log('[imagen] Trying imagen-4.0-fast fallback...')
    const res = await fetch(
      `${BASE_URL}/imagen-4.0-fast-generate-001:predict?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio,
            safetyFilterLevel: 'block_some',
            personGeneration: 'allow_adult',
          },
        }),
        signal: AbortSignal.timeout(30000),
      }
    )

    if (res.ok) {
      const data = await res.json()
      const imageBytes = data?.predictions?.[0]?.bytesBase64Encoded
      if (imageBytes) {
        console.log('[imagen] Generated via imagen-4.0-fast')
        return imageBytes
      }
      console.warn('[imagen] imagen-4.0-fast: empty response')
    } else {
      const err = await res.text()
      console.warn('[imagen] imagen-4.0-fast failed:', res.status,
        err.slice(0, 200))
    }
  } catch (err: any) {
    console.warn('[imagen] imagen-4.0-fast error:', err?.message ?? err)
  }

  return null
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
