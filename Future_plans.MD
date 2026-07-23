## Lesson plan — queued fix (found Jul 15, 2026 during Lab Manual CP2)

**`co_empty` fallback bypasses `validateCoOrNull`.** In
`src/lib/lessonplan/generator.ts`, `buildOneTheorySession`'s no-valid-CO branch
assigns `module.coCodes.slice(0, 1)` straight into the session. Those codes come
from `module_co_mapping`, while the validator's allowlist comes from
`course_outcomes` — so the fallback writes an *unvalidated* code into the plan on
the exact path taken when the AI already failed to produce a valid one.
`generatePracticalSection` has no such fallback, so this is theory-only.

**Zero behaviour change today, by definition:** an audit of all 5 seeded subjects
showed the two tables agree on CO spelling *within* every subject (they disagree
*across* subjects — 4 use `"CO 1"`, IDCH3051 uses `"CO1"` — but that's harmless
since each subject is internally consistent). The bug only bites if one subject's
two tables ever drift, at which point the plan silently carries a CO code that
doesn't exist in `course_outcomes`.

**Fix:** wrap the fallback in `validateCoOrNull(code, validCoCodes)` and emit the
existing `co_empty` warning when it returns null, rather than trusting the slice.
One line + the warning. Ship as its OWN tiny commit after Lab Manual CP5 — not
folded into the lab-manual feature (§22: concurrent-session hygiene / no bundled
commits). The lab-manual gate validates its own fallback rather than copying this
hole.

---

## Lab manual — backlog after the ship audit (Jul 16, 2026)

Shipped: all 5 checkpoints, three-variant export. These three came out of the
post-push audit as non-blocking; #1 (cache contamination) and #3 (silent BTL
default) were fixed before merge, these were not.

1. **`finalized` never un-finalizes.** A whole-student export sets
   `lab_manuals.status='finalized'`, but later autosave PUTs don't flip it back,
   so a manual can read "finalized" while its `doc` has drifted from every
   exported artifact. Either flip `status` back to `draft` in the PUT handler
   when `doc` changes, or accept "finalized" = "was exported at least once" and
   document that. Deans will eventually filter on this column, so decide the
   semantics deliberately. Small.

2. **Export objects accumulate forever.** Every export uploads
   `..._${Date.now()}.ext` and only the newest path is stored; older objects
   orphan in the `lab-manuals` bucket. Harmless at pilot scale. Fix: delete the
   previously-stored path before storing the new one (per variant×format
   column), or a periodic cleanup script. Mirrors the qpaper-history delete
   pattern.

3. **Invisible cache — dead `setCacheFreshness` state.** GET /api/labmanual
   returns per-practical cache-freshness flags and the page stores them, but
   nothing renders them — the "a colleague already generated this" affordance
   (lesson-plan UX) silently dropped. Cache reuse still works transparently;
   faculty just get no "instant vs pay-for-fresh" signal. Either restore the
   banner in the path/setup stage or delete the plumbing — don't keep zombie
   state.

4. **`expectedOutput` runs through `latexToReadable` even for code practicals.**
   For a code lab it's literal program output, where a `$` in shell output would
   be eaten as a math delimiter. Rare (most expected output is plain), but the
   export should skip the latex transform when `scaffold.kind === "code_scaffold"`.

5. **Optional: hint-free viva export toggle.** Viva hints currently print in the
   student manual (defensible as a prep aid). Some faculty will want a hint-free
   viva for assessment. A per-export toggle is a cheap future option, not a v1
   need.

6. **Path re-plan semantics after generation.** Returning faculty land straight
   in review; confirm the route back to re-plan the path communicates that
   existing sections survive a path edit (they do — sections are keyed by
   practicalNo, independent of unit grouping) and that only a regenerate is
   destructive. A UX-copy clarification, not a code bug.

---

## Chat — carried forward after CP1–CP5 (Jul 2026)

Chat itself is **shipped**: streaming, reasoning/research tiers, citations,
persist-before-stream, semantic cache v2, and Visualize. See CLAUDE_CONTEXT §9A for the
route contract and §3 for model routing. What was deliberately left undone:

1. **Quota-count endpoint (`GET /api/chat/quota`).** The UI increments a local counter,
   so remaining-quota drifts across tabs/devices and resets on reload. Now spans three
   buckets: chat 50, research 10, hint 30 (shared by hints and Visualize). Small, and
   the only user-visible correctness gap left in chat. (§18)

2. **`scheduleLog` request-scope guard.** `routeAI` logs cost via `next/server`'s
   `after()`, which needs an active request context — so `routeAI` currently cannot be
   called from a script, cron, or detached task. It fails on the *logging* path after
   spending the tokens. Must be fixed before any non-request caller exists (e.g. a
   batch/offline generation worker). (§18)

3. **CP2b RAG over `document_chunks`.** Dormant by design — pointless until notes/PDF
   ingestion actually populates the table. Revisit when ingestion lands, not before.

4. **`illustration` vizType (Imagen).** The slot is designed for: add one `VIZ_TYPES`
   entry, one `VIZ_REGISTRY` entry, one prompt builder, one line in each `vizTypes.ts`
   map — no route change (§3). Worth it only if a subject needs depictive/photographic
   visuals that Mermaid and computed SVG genuinely can't serve.

5. **Cosmetic, accepted:** the interactive step-1 renders empty operand pills before
   values are assigned. Semantically honest (they genuinely aren't assigned yet), and
   chasing it risks the prompt inventing placeholder values — which is worse. Leave it.

---

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

---

## Syllabus Health Audit — deferred after the CP1–CP5 ship audit (Jul 23, 2026)

Shipped: deterministic 7-check audit, AI suggestions with a conservative gate,
proposal diff view, cascade cache invalidation, compliance-report PDF, plus six
P0–P2 fixes from the self-audit. See CLAUDE_CONTEXT §17. These three were
consciously deferred with Dhruv's sign-off — none blocks the pilot.

1. **`findingIds` targeted re-suggest — UI not wired.** The `/suggest` route
   already accepts `findingIds?: string[]` and re-runs the AI for just those
   findings, bypassing the cache both ways (so a re-roll never overwrites the
   shared canonical set). The backend is complete and tested; the front end
   never sends it. The intended UX is "dismiss a proposal → re-suggest just this
   one." Nice-to-have, not a first-month miss for pilot faculty. When built, it's
   one button on the dismissed finding + passing `{ findingIds: [id] }` — no
   server change.

2. **CO / Module coverage matrix overflows past ~20 modules in the PDF.** Cell
   width is `min(34, (515 − 46 − 40) / moduleCount)`; below ~15pt usable the
   "M{n}" header and the "X" marks start to crowd. Widest real subject in the DB
   is 8 modules and AICTE curricula rarely exceed ~10, so this is theoretical.
   If a 15+-module subject ever appears, the fix is rotating the column headers
   90° or switching the matrix to a heatmap — deliberately NOT built now
   (speculative). It degrades by crowding text, not by dropping data.

3. **No rate limiting on `/api/syllabus/audit/suggest`.** Consistent with the
   lesson-plan and lab-manual AI routes, and mitigated by the fingerprint cache
   (repeat calls are free until the syllabus changes). Fine at pilot scale
   (27 faculty). The rate-limiting conversation belongs at 200+ faculty or when
   any student-facing AI route ships without caching — tracked in
   CLAUDE_CONTEXT §18 as a cross-cutting gap, not a per-feature one.

1. Practice Q based on quiz feedbacks -- just like placement prep
2. Medical oriented-- adaptable to fields
3. Placement—text box based answers too, with yt reference… &/ same such reference sources in AI chat.
4. pdf embedd and all using gemini 
5. Look into Q paper and  handwritten ans input.