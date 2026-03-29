Good questions. Honest answers:

---

**1. Are we storing PPTs in Supabase Storage?**

Yes — every generated PPTX goes to the `generated-content` bucket. You're right that it's largely wasteful. The file is downloaded once, maybe never opened again from the URL. Storage fills up fast (3MB × 100 PPTs = 300MB, hits Supabase free tier limit).

Better approach: generate the PPTX buffer → stream it directly to the browser as a download → don't store it at all. The `generated_content` table row (metadata only — title, slide count, cost, timestamp) is worth keeping for analytics. The actual file is not. Faculty can regenerate anytime since it's prompt-based.

Only store if faculty explicitly clicks "Save to library" — then it makes sense.

---

**2. Can we rename PPTs more methodically?**

Trivially easy. Current name: `ppt_1774755472994_35695981.pptx` — meaningless. Change the filename generation in `/api/generate/ppt/build/route.ts`:

```typescript
// Current
const fileName = `ppt_${Date.now()}_${userId.slice(0,8)}.pptx`

// Better
const subjectSlug = subject.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20)
const topicSlug = topic.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 25)
const date = new Date().toISOString().slice(0,10)
const fileName = `${subjectSlug}_${topicSlug}_${date}.pptx`
// → Fluid_Mechanics_Module_II_2026-03-29.pptx
```

Ten-minute fix. Do it in the next push.

---

**3. Chat-based PPT refinement — is it possible?**

Yes, entirely possible. The architecture would work like this:

Faculty generates a PPT → sees a chat window on the side → types "Make slide 5 more detailed" or "Add a worked example after slide 8" or "The Carnot diagram needs labels" → AI regenerates only that batch → PPTX is rebuilt with the change.

The pieces already exist: outline JSON is returned from the outline route, batch content is separate, build is separate. You'd store the outline + all slide content in localStorage or a DB row after generation. The chat then modifies specific slides and calls `/api/generate/ppt/batch` for just those slides, then rebuilds.

It's a V2 feature — maybe 3-4 days of focused work. Not for this pilot, but the architecture doesn't need to change to support it.

---

**4. Is there a smarter pipeline for the future?**

Yes. What you have now is a 3-route sequential pipeline (outline → batches → build). It works but has limitations — Flash sometimes under-delivers on complex topics, no iteration, no quality feedback loop.

The smarter architecture for post-pilot:

**Structured generation with JSON schema enforcement.** Gemini supports `response_mime_type: "application/json"` with a schema. Instead of parsing free-form JSON from Flash, you define the exact schema and the model is forced to conform. Zero parsing failures, zero recovery needed.

**Agentic refinement loop.** Generate slide → score it (does it have a formula? enough depth? correct keywords from syllabus?) → if score < threshold, regenerate that slide only. Self-healing quality.

**Two-model pipeline.** Flash generates content (fast, cheap), Pro reviews and enhances one slide at a time only when Flash output is weak. Selective Pro usage rather than blanket Flash.

**Parallel batch calls.** Currently batches are sequential — batch 2 waits for batch 1. They're independent. Run them in `Promise.all()` and generation time drops from 60s to ~20s.

**Slide templates as structured prompts.** Instead of one big batch prompt, each slide type gets its own focused prompt. Concept slide prompt is 200 tokens. Example slide prompt is 150 tokens. Much more reliable than asking Flash to generate 5 different slide types in one call.

None of this requires a different tech stack. All implementable with what you have. Priority order for post-pilot: parallel batches first (biggest speed win, 2 hours), then JSON schema enforcement (biggest reliability win, 1 day), then iterative refinement (biggest quality win, 3 days).