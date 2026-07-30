# CP-N1 — Notes v2: typed content blocks

**Status:** complete. Engine + storage + one API route. Zero UI (CP-N4 builds that).
**Branch:** `dev`. **Migrations applied:** `20260730000000_notes_v2.sql`, `20260730000001_ai_call_logs_notes_feature.sql`.

---

## 1. Why Notes v2 exists

Notes v1 was a **query tool wearing a study surface's clothes**. It generated a
markdown blob on demand and cached it in `semantic_cache` — a table whose entire
design (embed the query, score by cosine similarity, evict on `hit_count` /
`last_used_at`) assumes the thing stored is an *answer to a question*.

Study material is not that. It is durable, versioned, regenerable content whose
identity is `(subject, module, scope)` — not a similarity match against a
question nobody asked. Storing it in the query cache meant it had:

- no version, so it could never be improved without being destroyed;
- no staleness signal, so an edited syllabus silently kept serving old notes;
- no regenerate path, so a bad generation was permanent until eviction;
- no cost identity — see §6.

Notes v2 positions notes as a **study surface**: the thing a student opens
*instead of* the textbook the night before an exam, not a thing they query.

## 2. What was retired (Part 0)

Hard cut, not a dual-write.

| Deleted | Was |
|---|---|
| `src/app/api/notes/route.ts` | GET → generate → store in `semantic_cache` |
| `src/app/api/notes/export/route.ts` | POST → PDF |
| `buildQuickNotesPrompt` (`src/lib/ai/prompts.ts`) | the v1 markdown prompt |

**Stubbed:** the sole consumer was a *modal inside the student subjects grid*
(`src/app/(student)/student/subjects/page.tsx`), not a dedicated route. The
Notes button and dialog remain; the body is a "Notes v2 coming soon"
placeholder. Navigation still resolves. CP-N4 fills it in.

**Why hard-cut over dual-write.** Preserving v1 during the rebuild would have
carried its incorrect assumptions into the new pattern — a cache-shaped read
path, a `feature='chat'` log line, a markdown return type. Every one of those is
a thing CP-N1 exists to *not* do, and each would have needed unpicking later
under the pressure of a working feature depending on it.

**Three v1 bugs, for the record.** Two were known going in: wrong table, wrong
cost attribution. The third was found during cleanup — v1 embedded the literal
key string `QUICK_NOTES_MODULE_<uuid>` as the cache vector. That carries no
semantic content, so the 0.90-similarity lookup could only ever hit on an exact
key match; the embedding call was pure waste. No action needed, the path is
gone.

**Measured:** `semantic_cache` held **zero** `QUICK_NOTES_%` rows on dev (9 rows
total, all genuine chat cache). The v1 insert sat inside a log-only `try/catch`
and appears to have been failing silently since it shipped. The migration's
cleanup `DELETE` is a no-op there, kept for prod.

## 3. The typed block model (Part 2)

`src/lib/notes/types.ts`. A set of notes is an **array of typed blocks**, not a
markdown document. Three kinds, discriminated on `kind`:

- **`concept`** — definitions, theorems, principles. The block IS the concept,
  not an introduction to it.
- **`formula`** — any quantitative rule with symbols. Carries a symbol table
  (symbol / meaning / unit) and, wherever a numeric example is possible, a
  worked example.
- **`comparison`** — where the *distinction* is the exam answer. Shared `axes`,
  2–4 `items`, each item carrying exactly one value per axis.

**Why exactly these three.** Together they cover ~90% of engineering syllabus
content. Process flow, hierarchy and mnemonic are TIER-2, deferred until CP-N4
shows what real output is actually missing. Each block type is a
prompt-engineering surface: an unused type dilutes generation quality on the
used ones. That is §19's narrow-schema rule applied at the type-system level.

**Why no image or diagram field.** Visuals are CP4's Visualize pipeline,
reachable per-block via a chip in CP-N4. Baking them in would make every
regeneration pay image cost for visuals most students never open.

**Block IDs are `<kind>-<slug>`**, derived deterministically from the block's
own title. This is the anchor for CP-N4's "Ask about this" and for any future
delta-regeneration; random IDs would break that continuity the moment
regeneration became incremental. `slugifyForBlockId` **drops apostrophes**
rather than treating them as separators — `"Kirchhoff's Voltage Law"` →
`kirchhoffs-voltage-law`, not `kirchhoff-s-voltage-law`. Engineering titles are
full of possessives, and the prompt instructs the model to slugify the same way,
so this was the likeliest place for model output and helper to disagree.

**Validation** is a hand-rolled validator (`validateNoteBlocks`), matching
CP-Q3/CP-Q4 — `zod` is in `package.json` but imported nowhere in `src/`. It
returns **every** issue rather than the first, plus the raw blocks, because the
generator deliberately does not retry them (§5).

`LIMITS` in that file is the **single source of truth** (§17): the prompt's
stated ceilings, the Gemini `responseSchema`'s `maxLength`/`maxItems`, and the
validator all read it. Drift means telling the model one thing and judging it by
another.

## 4. Storage and freshness (Part 1)

`study_notes` — versioned rows keyed by `(subject_id, module_id, scope,
version)`.

**`content_hash` and `is_stale` are not redundant.** The hash is the source of
truth for freshness: a row may be served only when its hash equals the hash of
the *current* syllabus source. `is_stale` is a separate, human-driven override —
faculty flagging notes as poor quality even though the syllabus never moved. A
row is servable only when **both** agree. Treating `is_stale = false` alone as
"fresh" would serve notes describing a syllabus that has since been edited.

Regeneration **inserts a new version** rather than updating in place: the old
version stays readable while the new one generates, and a bad regeneration can
be rolled back by flipping a flag.

### Two schema decisions that diverge from the original spec

1. **The `UNIQUE` is two partial indexes, not one constraint.** A plain
   `UNIQUE(subject_id, module_id, scope, version)` would not constrain
   subject-scope rows at all — SQL treats NULLs as distinct, so every
   `module_id IS NULL` row is trivially unique and CP-N2 could insert version 1
   twice. PG15's `NULLS NOT DISTINCT` fixes exactly this, but the deployed major
   version is not pinned anywhere in this repo, so two partial unique indexes
   give the same guarantee on any version.
2. **A `CHECK` ties `scope` to `module_id` nullability**, making a `'module'`
   row with no module unrepresentable rather than silently colliding with CP-N2's
   rows in every lookup.

### RLS

| Role | Read | Write |
|---|---|---|
| superadmin | all | all |
| student | subjects offered to their **branch** (via `subject_offerings`) | — |
| faculty | `faculty_assignments` only (§4) | `is_stale` only |
| dean/hod | `role_scope` → school/department, fails closed | `is_stale` only |

- **Students read via `subject_offerings`, not `subjects.branch`.** Since
  `20260717000000_subject_offerings.sql` that is the authoritative
  student→subject path, precisely so one syllabus can be reused across branches.
  `subjects.branch` is legacy and gives the wrong answer for any reused subject.
- **Branch only, not branch+semester** — mirrors `useStudentSubjects`, where
  semester is a readiness gate rather than a filter, and the subjects grid shows
  every semester of the branch. A semester predicate would 403 notes for cards
  already on screen.
- **Dean/HOD get their own `role_scope` policy** (mirroring CP-Q4's
  `fas_select_oversight_scoped`). They are faculty-tier for *routing* but hold no
  `faculty_assignments` rows, so folding them into the faculty policy would
  silently give them nothing.
- **The `is_stale`-only write needs a column GRANT, not just a policy.** RLS
  selects rows, not columns, and an UPDATE policy's `WITH CHECK` cannot compare
  the new row to the old — "only `is_stale` may change" is not expressible as a
  policy. Enforcement is `REVOKE UPDATE` + `GRANT UPDATE (is_stale)`. Both layers
  are load-bearing: the GRANT alone lets any faculty flag any subject; the policy
  alone lets an assigned faculty rewrite `blocks` directly and bypass generation.

**RLS does not protect the routes.** Both routes use an `adminClient`, which
bypasses RLS entirely. `src/lib/notes/access.ts` mirrors the policies for that
reason — without it, `GET /api/notes/module/<any id>` would serve any module's
notes to any authenticated user. It is deliberately stricter than `/api/chat`,
which performs no subject-access check at all; that is a pre-existing gap, not a
pattern worth copying onto a new surface.

## 5. Generation (Part 3)

`generateModuleNotes`: load source → hash → cache probe → generate → validate →
insert new version. Task `notes_gen_module`, Flash, `thinkingBudget: 0`,
registered in `router.ts` and `gemini.ts` `isStructuredTask`.

### The schema constraint budget — measured, not assumed

Gemini rejects a `responseSchema` whose constraint state count is too large
(*"too many states for serving"*, a 400 at request validation). §19 already
records that `maxItems` drives that count. Measured against the deployed Flash
endpoint, the **outer array's** bounds dominate it, and this three-way `anyOf`
union cannot afford them at all:

| schema | result |
|---|---|
| strings + nested bounds + outer `maxItems` 12 | REJECTED |
| strings + nested bounds + outer `maxItems` 4 | REJECTED |
| strings + nested bounds + outer `minItems` 4 | REJECTED |
| strings + nested bounds + **no outer bounds** | **SERVED** |

So `blocks` carries no `minItems`/`maxItems`, keeping every string `maxLength`
and every nested bound (`symbols ≤ 8`, comparison `items` 2–4, `axes ≤ 6`).
Block count is the one constraint the prompt states plainly and the validator
enforces exactly, so it was the cheapest to move out of the schema.
**Do not tidy those two keys back onto `blocks` — every call 400s.**

`anyOf` itself was verified against the live endpoint before being relied on:
concept blocks come back free of formula fields, so this is a real discriminated
union, not a flattened one.

### Retry policy — and the reliability finding behind it

Five consecutive real generations of SOEEC1010 M1, the densest seeded module:
**3 successes, 1 unparseable response, 1 validation failure.**

The unparseable case is a **decoder degeneration**, not truncation: the model
fills the entire output budget with escaped newlines inside a string. Raising
`maxTokens` 8192 → 16384 *doubled the newlines* rather than fixing it, which is
how we know. The proximate cause is the missing outer array bound above — those
bounds were also the model's stopping signal. (`maxTokens` stayed at 16384
regardless: successful runs land at 10–11k chars, so 8192 was genuinely tight.)

Therefore:

- **`generation_failed`** — the call threw, or the response was unparseable — is
  **retried once**. Nothing usable came back, so a retry cannot quietly lower
  quality. Both attempts log with `attempt_number`, so the retry is visible in
  the spend rather than hidden inside one apparent call.
- **`invalid_blocks`** — parseable JSON that violates the block model — is
  **never retried**. That means the model produced study material the contract
  rejects, and retrying until something passes is precisely the silent
  degradation this checkpoint refuses. It fails loudly with the full issue list
  and the raw blocks attached, and writes nothing.

## 6. Cost attribution — the bug this fixes

v1 called `routeAI` with task `chat` and `feature: "chat"`. Every rupee spent
generating study material landed in the **chat** bucket on the analytics page,
indistinguishable from real tutoring spend. Notes v2 logs
`task='notes_gen_module'`, `feature='notes'`, asserted explicitly by
`cost_attribution.ts`.

**Consequence for historical data:** any analysis treating the `chat` bucket as
chat-only is overstated by however much v1 quick-notes generation ran. That
spend is not separable retroactively.

## 7. Verification (Part 5)

`_cp_n1_verify/` — six harnesses, **88 assertions, all passing**. Every harness
cleans up on signals as well as in `finally`, and *verifies* the cleanup.

| Harness | Asserts | Result |
|---|---|---|
| `module_generation` | real generation, storage, id determinism | 20/20 |
| `type_distribution` | typing responds to input (two-point probe) | 5/5 |
| `cache_and_hash` | hash invalidation, versioning, staleness | 22/22 |
| `regenerate_auth` | route role/scope gating over real HTTP | 13/13 |
| `validation_failure` | fails loudly, writes nothing, no retry | 16/16 |
| `cost_attribution` | `feature='notes'`, never `'chat'` | 12/12 |

`type_distribution` is the substantive quality check: the same prompt against
SOEEC1010 M1 (electrical) yields **3 formula blocks, 25% formula share**;
against IDSH2020 M5 (mathematical logic) it yields **0 formula blocks, 0%**. A
generator that emitted a fixed mix regardless of input would pass either pole's
own check by luck and fail that comparison every time.

`generateModuleNotes` carries a documented `aiOverride` test seam, used only by
`validation_failure.ts`. "Does not silently retry" is unfalsifiable from outside
without it — the harness counts invocations, so the claim is a measurement.
Never set in application code.

### Two findings worth carrying forward

1. **Postgres `jsonb` does not preserve object key order.** Blocks round-tripped
   through `study_notes` are semantically identical but byte-wise different, so
   CP-N4 diffing or delta-regeneration must canonicalise before comparing or
   checksumming. `cache_and_hash.ts` carries the `canonical()` helper.
2. **`ai_call_logs` has `input_tokens`/`output_tokens`/`thinking_tokens`, no
   `total_tokens`.** `cost_attribution.ts` asserts the *query succeeded* before
   interpreting an empty result — a typo'd column and a never-fired `after()`
   both look like "no rows", and scoring one as the other sends you hunting the
   wrong bug.

## 8. Explicit rejections

Not built, and not by omission:

- **No note-taking overlay.** Notes are generated study material, not a personal
  notebook. Student annotation is a different product with different storage.
- **No collaborative editing.** No multi-writer story, no conflict model, and
  faculty edits would fork content away from the syllabus that grounds it.
- **No cross-subject summary.** Every generation is grounded in one subject's
  syllabus; a cross-subject view has no source to be locked to.
- **No Imagen for concept illustrations.** See §3 — visuals are CP4's pipeline,
  on demand.
- **No speculative block types.** §3.
- **No student-triggered regeneration.** Faculty tier only. Students consume
  notes; they do not decide when the institution pays to rebuild them.

## 9. What later checkpoints build on this

- **CP-N2** — subject-scope notes (`scope='subject'`, `module_id NULL`; the
  partial unique index already accommodates it) and the faculty regeneration
  flow driven by the `is_stale` UPDATE grant. If student-triggered regeneration
  lands, it needs its **own** rate budget rather than borrowing the hint
  allowance the GET currently shares.
- **CP-N3** — PYQ frequency signal (§10).
- **CP-N4** — the student UI: block rendering, "Ask about this" handoff into
  chat via block id, per-block Visualize chip.
- **CP-N5/N6** — export, and the documentation sweep.

## 10. PYQ frequency contract (preview — CP-N3 delivers)

Documented here so CP-N1's block IDs are already stable enough to cross-
reference. The contract is **three-state**, never a bare number:

- **rich signal** — enough matched PYQ occurrences to state frequency
  ("appeared in 7 of the last 10 papers");
- **weak signal** — some matches, below the confidence floor; shown as a hedge,
  never as a count, because a count implies a precision the sample does not
  support;
- **no signal** — no PYQ data for this subject, or no match for this block.
  Renders as *absence*, not as zero. "Never appeared" and "we have no papers"
  are different claims and a student will read a zero as the former.

The join key is the block `id`, which is why §3 makes IDs deterministic from
title rather than random.

---

## Appendix — files

```
supabase/migrations/20260730000000_notes_v2.sql          study_notes, RLS, v1 cache cleanup
supabase/migrations/20260730000001_ai_call_logs_notes_feature.sql
src/lib/notes/types.ts                                   block model, LIMITS, validator
src/lib/notes/prompts.ts                                 prompt + responseSchema
src/lib/notes/generator.ts                               generateModuleNotes
src/lib/notes/access.ts                                  route-side mirror of the RLS
src/app/api/notes/module/[moduleId]/route.ts             GET
src/app/api/notes/module/[moduleId]/regenerate/route.ts  POST
_cp_n1_verify/                                           six harnesses
```
