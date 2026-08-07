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

---

## `routeAI` cannot run outside a Next request scope (two motivations now)

`routeAI` logs every call via `after()` from `next/server`, which throws unless a
request scope exists. Every checkpoint harness works around this by entering a
fake scope through `workAsyncStorage` — a shim that has now been copied into four
scripts and documented as a pattern in CLAUDE.md.

Already listed once, from the chat side, as "Chat — carried forward" item 2
(`scheduleLog` request-scope guard) — this is the same defect, re-surfaced from a
second direction. Keep ONE fix, not two.

Originally flagged as harness-only friction. It now has a **second,
non-test motivation**: any background worker or cron that wants to make an AI
call hits the identical wall. `/api/cron/abandon-stale-assessments` does not
(pure DB sweep), but the obvious next crons — nightly quant-classification
backfill, bank health top-up, pre-generating a GATE mock — all would.

**Fix shape:** make the cost-logging call scope-optional — try `after()`, fall
back to a direct `await logAICall(...)` when no scope exists — rather than
requiring callers to fake one. Small, contained in `router.ts`'s `scheduleLog`.
Not urgent; the case for it grows with every background feature.

---

## Faculty Q Bank surfaces need MSQ/NAT support (opened Jul 25, 2026 — CP-Q1)

**Blocking for: the moment the Assessment Engine's write-through starts producing
GATE questions in production (CP-Q3), not before.**

CP-Q1's migration (`20260725000000_assessment_engine.sql`) widened
`faculty_question_bank.question_type` from 5 values to 7 — `'msq'` (multiple-select,
pipe-separated correct letters) and `'nat'` (numerical answer type, answer in the
new `numeric_answer` + `numeric_tolerance` columns rather than `model_answer`). The
engine writes those rows with `source='ai_generated', is_verified=false`, so they
land in the faculty Q Bank UI for review.

Every faculty-side surface in §11 was built against the 5-type world and will meet a
type it does not know:

1. **CSV import parser** (`src/lib/qbank/parser.ts`) — `question_type` validation
   rejects `msq`/`nat`; MSQ needs a multi-correct `correct_option` (today it accepts
   one of A–D), NAT needs answer + tolerance columns and no options.
2. **Add Questions → Single / Bulk Images** (`/faculty/qbank`) — type selector has 5
   options; the manual form has no multi-correct checkbox set and no numeric
   answer/tolerance fields.
3. **Auto-tagger** (`src/lib/qbank/tagger.ts`) — BTL/CO inference prompts describe
   the 5 types.
4. **ReviewFlowDialog** — renders options as single-select radio; an MSQ shows one
   correct answer instead of the set, a NAT shows nothing gradeable.
5. **Q paper renderers** — `bankFill.ts`'s `poolItemBankType`/`descriptiveBankType`
   have no mapping for the new types, and `builder.ts` / `docxBuilder.ts` /
   `ReviewAndValidateStage` render options assuming exactly one correct option.

**Minimum safe scope** (what actually prevents "unknown type" breakage, as opposed
to full authoring support): make every faculty surface *display and filter* the two
types correctly, and make the Q paper bank-fill *skip* them rather than mis-render
them. Full faculty authoring of MSQ/NAT is a separate, larger piece.

**Interim mitigation, already true:** these rows are `is_verified=false`, and Q paper
bank-fill matches on type + marks, so an MSQ/NAT row is only reachable by a slot
asking for that type — which no current template produces. The gap is latent, not
live. It goes live with CP-Q3.

---

## CP-Q3 deferrals (logged Jul 26, 2026 — student assessment UX)

### `/student/quiz/legacy` removal — deletion 1 DONE (CP-N4 Part 0); 2 and 3 still open

The 1,766-line quiz setup/taking/results page moved to `/student/quiz/legacy` in
CP-Q3 Part 2 as a **pure `git mv`, no code change**, so the pilot has a one-week
fallback if the new assessment UX hits a problem. It still talks to the old
`/api/quiz/generate` + `/api/quiz/submit` routes, which also remain live and
untouched.

**Status:** the page and its two inbound links were hard-deleted in CP-N4 Part 0
(pilot window closed). The API routes and tables below were explicitly OUT of
CP-N4's scope and remain live — they are still a CP-Q5 task:

1. ~~`src/app/(student)/student/quiz/legacy/page.tsx`~~ — DONE, CP-N4 Part 0.
2. `/api/quiz/generate`, `/api/quiz/submit`, `/api/quiz/hint`, `/api/quiz/export`
   — but ONLY after confirming nothing else calls them (the chat struggle nudge
   and `/student/subjects`' Quiz button link to `/student/quiz?subjectId=`, which
   the new landing already absorbs; grep before deleting).
3. The `quizzes` / `quiz_attempts` tables — **check first.** `/student/history`
   reads `quiz_attempts`, so a student's pre-CP-Q3 quiz history lives there and
   deleting the tables deletes their record. The likely right answer is to keep
   the tables read-only and drop only the write path.

Precondition for starting: one full pilot week on the new UX with no rollback,
and `usage_analytics` showing zero `/student/quiz/legacy` page loads.

### Visualize integration on the results page — CP-Q4/5

Deliberately NOT wired in CP-Q3. The `InteractiveHtmlViewer` sandbox and the
`chat/visualize` CLASSIFY→GENERATE pipeline (§9A) would let a student turn a
wrong answer's explanation into an interactive diagram directly from the results
page. Two reasons it waits: it costs a Pro call per click on a surface a student
lands on after *every* session (chat's Visualize is opt-in mid-conversation, a
much lower-frequency trigger), and the results page's own value has to be proven
before adding the most expensive affordance in the product to it. Revisit once
there is real usage data on the results page.

### Lint debt — tracked, not scheduled

`npm run lint` baseline as of Jul 26, 2026: **312 problems (158 errors, 154
warnings)**, overwhelmingly `@typescript-eslint/no-explicit-any` in the older
qpaper/ppt lib files. Nothing here blocks anything today and it does not need to
move now. It is recorded because a number that only ever grows quietly becomes
expensive at the exact moment you least want to touch it — the first time a lint
gate is added to CI, or the first time a real error hides in the noise. Re-read
this number each checkpoint; if it grows, the checkpoint added debt.

### Mastery hub enhancements — CP-Q4/5

CP-Q3 ships the mastery hub as subject grid → module breakdown with accuracy,
attempts and the promotion-threshold indicator. Not shipped, in rough priority
order: per-module history over time (needs an attempts-over-time query, not just
the current mastery row), faculty visibility into cohort mastery (the RLS policies
already permit it — `stm_select_faculty_assigned` — so this is UI only), and
"practise this module" deep links that pre-scope a mastery session to one module.

---

## CP-Q4 deferrals (logged Jul 28, 2026 — faculty analytics)

### Still open from CP-Q3, re-confirmed not done

- **`/student/quiz/legacy` removal** — the PAGE was deleted in CP-N4 Part 0
  (Jul 31, 2026). The old `/api/quiz/*` routes and the `quizzes` /
  `quiz_attempts` tables were not touched and are still a CP-Q5 task; see the
  CP-Q3 section above, deletions 2 and 3.
- **Vercel preview latency measurement** — never run. CP-Q3 measured latency
  against local dev only. The numbers that matter are cold-start numbers on
  Vercel, and CP-Q4 adds a route whose inline recompute is a full scan per
  subject (`/api/faculty/analytics/subject/[subjectId]`, `maxDuration` 60,
  `memory` 1024). That route is now the most likely first candidate to blow a
  timeout on a real cohort, and it has never been timed anywhere but localhost.
- **Pilot verification pass** — Dhruv-owned, cross-checkpoint. Unchanged.
- **`routeAI` cannot run outside a Next request scope** — unchanged, and
  untouched by CP-Q4: this checkpoint makes zero AI calls, so nothing here
  needed `routeAI` at all.

### Dean/HOD provisioning — `role_scope` has no UI

**The first real dean or HOD created MUST get a `role_scope` row, or faculty
analytics will correctly show them nothing.** There is currently **no
provisioning UI** — a superadmin has to insert the row directly:

```sql
INSERT INTO role_scope (user_id, school, department)
VALUES ('<profile id>', 'School of Engineering', NULL);  -- NULL = entire school
```

`role_scope` is empty on the live DB and CP-Q4 is its first consumer in code, so
this is a genuine footgun rather than a theoretical one — the failure looks like
a permissions bug, not like missing setup. Cross-reference the **Dean/HOD
provisioning UI** item in §17 Tier 5: whenever that is built, creating a
dean/hod must write the `role_scope` row in the same flow, and the onboarding
docs must say so.

### Schema-drift audit — `module_co_mapping.source` vocabulary

`CLAUDE_CONTEXT.md` §5 documents `source` as `'ai_classified' | 'faculty_verified'`.
The actual CHECK constraint
(`20260628000000_module_co_mapping.sql`) permits only
`('ai_inferred','superadmin_verified')`, and all 135 live rows are
`ai_inferred`. The documented values **cannot exist**.

Audit, not an urgent fix — CO attainment is correct under either vocabulary
because `src/lib/analytics/coWeighting.ts` maps both the real values and the
documented ones. What the audit should decide is which vocabulary is intended,
and in particular whether **faculty** should ever be able to verify a CO mapping:
today the table's RLS grants write to superadmin/dept_admin only, so
"faculty-verified" is not a thing the system can represent. If the answer is
"yes, faculty should verify", that is a policy change plus a `source` value, not
a rename.

Same drift class as §14's RLS warning, seen from the column side. Also captured
this checkpoint: `subjects.school` / `subjects.created_by` existed live with no
migration — now recorded retroactively in
`20260727120000_retro_subjects_school_created_by.sql`. **A broader sweep
comparing live schema against the migration history is worth one focused
session** — these were found by accident, twice, while building on top of them.

### Cross-feature analytics — explicit NON-GOAL

Chat, placement and content-consumption data stay out of faculty analytics.
Recorded here as a deliberate rejection rather than a backlog item, so a future
"faculty want the full picture" request has to argue against the reasoning in
`CP_Q4_FACULTY_ANALYTICS.md` (a student talking to the AI tutor is thinking out
loud; a readable transcript makes it a worse tutor for the students who most
need it). Enforced by `_cp_q4_verify/cross_feature_scoping.ts` with canary
strings, so it cannot regress silently.

If it is ever revisited, the honest version is **student-initiated sharing**, not
faculty-initiated surveillance — a student choosing to show a faculty member a
chat thread they are stuck on. That is a different feature with a different
consent model, not a widening of this one.

### Smaller CP-Q4 items

- **Analytics nav is one link per subject card** on the faculty dashboard. There
  is no top-level analytics entry point that lists subjects, and no cross-subject
  rollup for a dean holding many. A dean today reaches each subject's analytics
  through its card.
- **`per_question` renders the worst 10 discriminators**, with no pagination or
  "show all". Fine at pilot bank size (38 questions); revisit when a subject's
  bank is large enough that the tail matters.
- **Lint debt baseline check (§CP-Q3 lint debt).** CP-Q4 added no new lint
  errors — every new file is clean under `npx eslint`. The repo-wide number is
  unchanged by this checkpoint.

---

## CP-N4 deferrals (logged Jul 31, 2026 — student notes UI)

### Notes generation prompt must require `$…$` on `unit` — CP-N6 prompt patch

**This is a scheduled patch, not a maybe.** It is a known gap on a production
path.

The notes generator honours §13's authoring convention (`$…$` for math, bare
`\ce{…}` for chemistry) in `formula`, `meaning`, `formalStatement` and worked-
example `solution` — but NOT in `symbols[].unit`, which comes back as bare
`\Omega` / `\mu F` with no delimiters. Confirmed against the first real formula
blocks generated for SOEEC1010 M1 (Jul 31, 2026); before that no formula block
existed anywhere in the dev DB, which is why CP-N1–N3 never surfaced it.

`hasLatex()` is delimiter-driven and correctly reports false for an undelimited
control sequence, so the Unit column renders the literal string `\Omega` unless
something repairs it.

The fix is in the generation prompt (`src/lib/notes/prompts.ts`) and/or
`MATH_CHEM_NOTATION_GUIDE` (`src/lib/text/latexSegments.ts`, the single exported
notation constant every prompt consumes): state that unit fields carry the same
`$…$` requirement as every other field. Note the blast radius before editing the
guide — it is consumed by generation prompts, CSV import docs and in-app help
alike, so a change there is not scoped to notes.

**The render-layer fix stays regardless.** `withMathDelimiters` in
`src/components/notes/FormulaBlockCard.tsx` is defensive rendering, and defensive
rendering remains correct after the producer is fixed — old `study_notes` rows
keep their undelimited units indefinitely, since freshness is a hash match and
fixing a prompt does not move any existing row's hash.

### PYQ chip cannot be verified end-to-end until PYQs are seeded

`pyq_questions` holds ZERO rows in dev (`module_co_mapping` has 135). CP-N3
enrichment is therefore correctly emitting no signal anywhere, and no amount of
UI work can make a real chip appear. CP-N4's harness verifies the chip's
rendering by code inspection and against a synthetic signal shaped exactly as
`buildModuleSignal` emits; the live path needs one seeded subject with PYQ
documents before it can be asserted for real. Same class of gap as §13's
"no chemistry subject is seeded" item — synthetic verification only, and it
should be recorded as such rather than reported as covered.

Same gap applies to CP-D0 Part 2 (flashcard mode's design-system restyle):
the header's `<PyqChip>` in `flashcards/page.tsx` renders through the same
unmodified `MonoTag`/`PyqChip` verified in Part 0/1, so there's no new
component risk, but its actual appearance at flashcard scale (size, spacing
against the card counter) has not been seen against real data for the same
reason — still zero `pyq_questions` rows anywhere in dev. Check it whenever
this item is resolved, alongside the reading-view chip above.

### CP-N2 harness cleanup debt (`purgeNotes` scope) — LOW priority

`_cp_n2_verify` leaves `study_notes` rows behind: a CP-N6 verification run
produced 4 residual rows for IDME3532 (M1-M4, `v1`, `is_stale=false`,
2026-08-07 07:10-07:11) that its own cleanup did not remove. They are harmless
— real, valid notes generated through the post-CP-N6 pipeline, and they scan
clean for escape corruption — so they were deliberately left in place rather
than deleted.

The related sharp edge, which matters more than the residue: **CP-N1's
`purgeNotes(moduleId)` deletes ALL `study_notes` rows for a fixture module**,
and SOEEC1010 M1 is a fixture. During CP-N6 that destroyed a row which was
queued for `is_stale` remediation — harmless there (delete and stale both mean
"regenerate on next request"), but it means **any data-remediation pass must run
BEFORE the harness suite, not after**, or the harnesses will silently eat the
rows being remediated and the remediation counts will be wrong.

---

---

1. Practice Q based on quiz feedbacks -- just like placement prep
2. Medical oriented-- adaptable to fields
3. Placement—text box based answers too, with yt reference… &/ same such reference sources in AI chat.
4. pdf embedd and all using gemini 
5. Look into Q paper and  handwritten ans input.