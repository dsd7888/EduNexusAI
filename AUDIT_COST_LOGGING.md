# Checkpoint 1 — AI Cost / Token Usage Logging Audit

**Date:** 2026-07-08  
**Scope:** Read-and-report only. No architecture changes. Trivial fixes: none applied.  
**Evidence sources:** Source code under `src/`; live row samples via service-role client; live `pg_policies` / FK / column defs via `supabase db query --linked`.

---

## Executive snapshot

| Layer | What exists today |
|---|---|
| Computation | `gemini.ts` reads `usageMetadata.promptTokenCount` / `candidatesTokenCount`, computes `costInr` with `USD_TO_INR = 83.33`, returns via `routeAI` console log |
| Persistence | Almost nowhere writes `tokens_used` / `cost_inr` into DB columns |
| Primary durable cost signal | PPT only: `generated_content.metadata.totalFlashCostInr` / `totalImagenCostInr` / `totalCostInr` (JSONB, not the typed columns) |
| Event counters | Thin `usage_analytics` upserts for a few student/faculty events — almost always `tokens_used=0`, `cost_inr=0` |
| Live DB (pilot) | `usage_analytics`: 5 rows, all cost/tokens 0; `generated_content.cost_inr`/`tokens_used`: 0 on all 85 rows; PPT metadata cost present on 18/30 ppt rows |

**§18 Flash ₹0.0000 bug status:** Partially fixed for the PPT *generation* pipeline (metadata path). The typed `cost_inr` columns remain 0 everywhere. PPT *refine* and every non-PPT task still do not persist cost. Details below.

---

## Shared pipeline (applies to every `routeAI` call)

**Compute path (correct when usageMetadata is present):**

1. `src/lib/ai/providers/gemini.ts:175–187` — reads Gemini `usageMetadata`; falls back to `estimateTokens(text)` (`len/4`) if missing.
2. `calculateCostInr(input, output, modelKey)` at `:36–45` — Flash `$0.15/$0.60`, Pro `$1.25/$10.00` per 1M tokens × `83.33`.
3. `src/lib/ai/router.ts:146–150` — logs `task`, `modelUsed`, `inputTokens`, `outputTokens`, `costInr` to **stdout only**.

**Not captured in cost math:**
- `thoughtsTokenCount` / thinking tokens (relevant for `chat`, `explainer_ideate`, and any Flash call without `thinkingBudget: 0`).
- Image-model API tokens (`imagen.ts` uses hardcoded `$0.04` / `$0.10` × 83.33 estimates, not usageMetadata).
- Embeddings (`gemini-embedding-001`) — no cost accounting.

**Global 429 fallback chain:** **Does not exist.** `routeAI` catches 429 and rethrows (`router.ts:153–157`). Feature-local retries/escalations are documented per task below.

**`qbank_image_question` note:** Listed in CLAUDE_CONTEXT / this audit’s task list, but **absent from `TASK_TO_MODEL`** in `router.ts`. Call site passes `model: "flash"` explicitly, so it still runs Flash via override; unlisted tasks otherwise fall through to `DEFAULT_MODEL = "flash"`.

---

## Per-task-type findings

### `chat`

1. **WHERE:** Compute: `src/app/api/chat/route.ts:320` → `routeAI("chat")` → gemini/router log. Persist attempt: `:465` `usage_analytics` insert/update; `chat_messages` insert at `:350–361`.  
2. **WHAT:** Router logs input/output tokens, model, ₹. DB: `usage_analytics` gets `event_type='chat'`, `event_count` only — **no** `tokens_used`, **no** `cost_inr`, **no** model. `chat_messages` rows omit `tokens_used` / `model_used` / `cost_inr` (columns exist; stay default 0/null). Live: 0/0 on sampled chat_messages.  
3. **CORRECT?** Computed cost in memory is plausible; **never stored**. Live `usage_analytics` chat rows have `cost_inr=0`, `tokens_used=0`. §18 PPT Flash bug unrelated here — chat was never wired.  
4. **FALLBACK:** No retry chain. On AI failure returns soft fallback text (`:326–338`) **without** logging a failed attempt as a cost/usage row. Rate-limit 429 (`:77–86`) is **not** logged.  
5. **PARALLEL:** Single call. `usage_analytics` is read-modify-write (`:448–463`) — race if same user/subject/day concurrent requests.  
6. **WHO WRITES:** `createAdminClient()`; `user_id: profile.id` set explicitly (`:467`).

Also used by: `quiz/hint/route.ts` (`routeAI("chat")`), `notes/route.ts`, `chat/suggestions/route.ts` — **none** write usage/cost.

---

### `quiz_gen`

1. **WHERE:** Compute: `src/app/api/quiz/generate/route.ts:208`. Persist: **NOT FOUND** for generation cost. Related: `quiz/submit/route.ts:131` logs `event_type='quiz'` on *submit* (not gen). Placement Flash path also calls `routeAI("quiz_gen")` (`placement/generate/route.ts:328`) — no per-call cost persist.  
2. **WHAT:** Console only via `routeAI`. Quiz insert (`:276`) has no cost fields. Submit analytics: event_count only.  
3. **CORRECT?** Computed but discarded. Submit “quiz” events overcount/misattribute as *attempts*, not AI gens.  
4. **FALLBACK:** No model fallback. Rate-limit 429 on generate not logged.  
5. **PARALLEL:** Single call. Submit RMW race same as chat.  
6. **WHO WRITES:** Admin client for quizzes / usage; `generated_by: user.id` / `user_id: user.id` set.

---

### `placement_prep`

1. **WHERE:** Compute: `placement/prep/generate/route.ts:422` (MCQ loop), `:567`/`:574` (parallel Flash calls); also `placement/resume/ats`, `rewrite-bullet`, `jd-analyze`, `interview/evaluate`. Persist: **NOT FOUND**.  
2. **WHAT:** Console only.  
3. **CORRECT?** N/A for storage — lost.  
4. **FALLBACK:** Local 2-attempt parse retry on same Flash model (`:420`). Failed attempts that return from `routeAI` still produce console cost logs; no DB. No Flash→Pro 429 chain.  
5. **PARALLEL:** Dual `routeAI("placement_prep")` in one path (`:567`/`:574`) — both log to console independently; nothing to race in DB.  
6. **WHO WRITES:** N/A for cost. (Prep content inserts elsewhere via admin client with user ids.)

---

### `ppt_gen` (outline + content batches)

1. **WHERE:**  
   - Compute: `generate/ppt/outline/route.ts:206`; `generate/ppt/batch/route.ts:433` (`task=ppt_gen` for content).  
   - Accumulate client-side: `faculty/generate/page.tsx:665`, `:743`, forwarded `:855`.  
   - Checkpoint: `generate/ppt/checkpoint/[contentId]/route.ts:128` (`metadata.totalFlashCostInr += costInr`).  
   - Finalize: `generate/ppt/build/route.ts:304–314` / `:345–347` → `metadata.totalFlashCostInr`, `totalImagenCostInr`, `totalCostInr`.  
2. **WHAT:** Per successful `routeAI`: input/output tokens + model + ₹ (console). Stored: **lumped ₹ in JSONB metadata only**. Key still named `totalFlashCostInr` but build comments admit it is **Flash+Pro text-model total**. No per-model breakdown in DB. `costByPath` returned by batch (`batch/route.ts:887`) is **not** forwarded by the client to build (client only sends `totalFlashCostInr`) — so build’s `costByPath` log path is usually empty. Typed columns `generated_content.cost_inr` / `tokens_used` **never written**.  
3. **CORRECT?**  
   - **§18 ₹0.0000 Flash bug:** **Mostly fixed for PPT gen metadata.** Live: 18/30 ppt rows have nonzero `metadata.totalFlashCostInr` (samples ~₹2–16); **0** rows with `totalFlashCostInr === 0`; 12/30 still missing the key (older/refine/incomplete). Typed `cost_inr` column still **0** on all rows — analytics summing that column would still show ₹0.  
   - Token counts from Gemini for each call appear correct when usageMetadata present; no thinking on structured PPT tasks (`thinkingBudget: 0`).  
4. **FALLBACK:** Content: Flash-only with in-loop retries; whole-batch regenerate once (`batch/route.ts:551–574`). Both attempts’ `costInr` are **summed into `batchCostInr`** (failed/retry spend counted). No 429→next-model chain.  
5. **PARALLEL:** Frontend concurrency 3 for content batches (`generate/page.tsx:789`). Each batch returns its own cost; client sums. Checkpoint is RMW on shared `metadata.totalFlashCostInr` — **possible undercount under concurrent checkpoints** (last writer / lost add). No shared aggregate row race beyond that.  
6. **WHO WRITES:** Admin client; `generated_by: user.id` set (`outline:283`, `build:349`).

---

### `ppt_diagram`

1. **WHERE:** Same batch route as above with `task=ppt_diagram` (`batch/route.ts:433`) and explicit `model` from `routeDiagramBatchModel`. Costs roll into same `totalFlashCostInr` bag.  
2. **WHAT:** Console: per-call model (Flash or Pro). Stored: lumped into metadata total — **no per-call Flash vs Pro vs Imagen rows**. Path telemetry (`flash-direct` / `pro-direct` / escalated) exists in-batch response + console; not persisted.  
3. **CORRECT?** Per-call compute ok; storage loses model mix. Escalation adds Flash+Pro spend into one total (good for money, bad for attribution). Imagen priced separately in build (`:168–170`).  
4. **FALLBACK:** Flash first → escalate to Pro on sparse SVG/mermaid/parse fail (`:589–644`). **Both Flash and Pro costs added** to `batchCostInr` / `recordPath`. Failed 429 mid-attempt: if `routeAI` throws before return, that attempt’s tokens may not increment `costInr` (catch path).  
5. **PARALLEL:** Diagram batches often 1 slide; frontend runs diagram concurrency (comment mentions 5). Same checkpoint RMW risk.  
6. **WHO WRITES:** Via same adminClient / generated_by path as `ppt_gen`.

---

### `ppt_extract`

1. **WHERE:** Compute: `src/lib/ppt-refine/extractor.ts:383` `routeAI('ppt_extract')`. Persist: **NOT FOUND**.  
2. **WHAT:** Console only.  
3. **CORRECT?** Discarded.  
4. **FALLBACK:** None for 429; filename fallback on AI fail (comment in extractor).  
5. **PARALLEL:** Single call.  
6. **WHO WRITES:** N/A.

---

### `ppt_refine`

1. **WHERE:** Compute: `src/lib/ppt-refine/refiner.ts:602`, `:714`, `:1231`. Persist on finish: `ppt-refine/refine/route.ts:277` inserts `generated_content` **without** cost fields / metadata cost keys. Live refine ppt samples (today) lack `totalFlashCostInr`.  
2. **WHAT:** Console per batch; DB row is history-only (file, options, changes_summary).  
3. **CORRECT?** §18 “looks fixed” for **gen**, **not** for refine. Refine decks still show no spend.  
4. **FALLBACK:** Batch retries then `fallbackBatchResponse` (no AI) — prior failed `routeAI` successes still console-logged; exhausted failures may omit last throw’s cost.  
5. **PARALLEL:** Batched refine calls; no shared cost aggregate written.  
6. **WHO WRITES:** Admin client; `generated_by: user.id` (`:305`).

---

### `qpaper_gen`

1. **WHERE:** Compute: `src/lib/qpaper/sectionGen.ts:1770`; regenerate: `generate/qpaper/regenerate-question/route.ts:99`. Persist: `generate/qpaper/route.ts:765` `generated_content` insert — **no** `tokens_used`/`cost_inr`/metadata cost.  
2. **WHAT:** Console only. Per-section Pro calls; validation retry in sectionGen may call AI again — only success path returns to caller; intermediate console logs exist for each successful `routeAI`.  
3. **CORRECT?** Discarded. Live: 49 qpaper rows, column cost 0.  
4. **FALLBACK:** Validation retry (same Pro model), not 429 model chain. Failed attempts that completed `routeAI` are console-logged; not DB.  
5. **PARALLEL:** Sections via `Promise.all` (`qpaper/route.ts:592`) — each would need own row; currently none. No cost RMW.  
6. **WHO WRITES:** Admin; `generated_by: user.id`.

---

### `qpaper_validate_tags`

1. **WHERE:** Compute: `src/lib/qpaper/validateTags.ts:216`. Persist: **NOT FOUND**.  
2. **WHAT:** Console only (Flash, 512 tokens).  
3. **CORRECT?** Discarded. Many per-question calls can be a material Flash spend invisible to analytics.  
4. **FALLBACK:** None.  
5. **PARALLEL:** Invoked per question/unit during section gen — independent console logs; no DB.  
6. **WHO WRITES:** N/A.

---

### `answer_key_mcq` / `answer_key_descriptive`

1. **WHERE:** Compute: `src/lib/qpaper/answerKeyGen.ts:762` (mcq Flash), `:782`/`:795` (descriptive Pro). Persist: `answer-key/route.ts:202` update or `:220` insert `generated_content` — **no cost fields**.  
2. **WHAT:** Console per block. No model breakdown stored.  
3. **CORRECT?** Discarded. Live: 6 answer_key rows, cost columns 0.  
4. **FALLBACK:** Block-level `runBlock` retries (same task/model). No 429 fallback chain. Only successful returns contribute to in-function results; each successful `routeAI` still console-logs. Failed throws: no DB.  
5. **PARALLEL:** Up to **6 concurrent calls** (2 sections × 3 blocks) — `answer-key/route.ts:145` + `answerKeyGen.ts:805`. **No cost DB writes**, so no lost-update race today. If Checkpoint 2 adds per-call inserts, each call must append its own row (do **not** RMW a shared aggregate).  
6. **WHO WRITES:** Admin; `generated_by: user.id` on insert path.

---

### `refine` (notes refinement)

1. **WHERE:** Compute: `src/app/api/refine/route.ts:99`. Persist: `:108` `usage_analytics` insert `event_type='refine'`, event_count 1 — **no tokens/cost**.  
2. **WHAT:** Console + empty cost counters.  
3. **CORRECT?** Event counted; money wrong (0).  
4. **FALLBACK:** None.  
5. **PARALLEL:** Single insert (not RMW) — safer than chat upsert, but duplicate rows possible for same user/day/subject if unique constraint allows (UNIQUE includes subject_id — second insert may fail silently in catch).  
6. **WHO WRITES:** Admin; `user_id: user.id`.

---

### `placement_gen`

1. **WHERE:** Compute: Flash via `quiz_gen` (`:328`) then Pro via `generateWithRetry`/`routeAI("placement_gen")` (`:111`). Persist: `:296`/`:407` `usage_analytics` `event_type='placement_test'` — event_count only, `subject_id: null`.  
2. **WHAT:** Console for AI; analytics event without cost.  
3. **CORRECT?** Cost discarded. **Live:** zero `placement_test` rows — consistent with **`usage_analytics.subject_id` being NOT NULL** (live column def). Inserts with `subject_id: null` fail and are swallowed by `catch` (`:304`/`:415`). Event logging is **broken** as well as cost.  
4. **FALLBACK:** Flash then Pro retry loop (up to 2–3 attempts). Intermediate successful Flash/Pro `routeAI` calls console-log; only final user event attempted in DB (and currently fails).  
5. **PARALLEL:** Sequential Flash→Pro. Analytics RMW race if fixed later.  
6. **WHO WRITES:** Admin; `user_id: user.id` (subject null).

---

### `syllabus_extract`

1. **WHERE:** Compute: `syllabus/extract/route.ts:33`. Returned to client as `costInr: ai.costInr` (`:54`). Persist: **NOT FOUND**.  
2. **WHAT:** Response JSON only + console. No model/token breakdown beyond router log.  
3. **CORRECT?** Ephemeral; not in DB.  
4. **FALLBACK:** None.  
5. **PARALLEL:** Single.  
6. **WHO WRITES:** N/A (superadmin extract only).

---

### `pyq_extract`

1. **WHERE:** Compute: `upload/route.ts:118`. Persist: **NOT FOUND** (only `pyq_questions` content rows).  
2. **WHAT:** Console only.  
3. **CORRECT?** Discarded.  
4. **FALLBACK:** None.  
5. **PARALLEL:** Single per doc.  
6. **WHO WRITES:** Content rows via admin; no cost user_id on those.

---

### `qbank_generate` / `qbank_tag`

1. **WHERE:** Compute: `lib/qbank/generator.ts:233`; tagger: `lib/qbank/tagger.ts:211` (also after generate via `tagMissing`). Persist: `qbank/generate/route.ts:136` → `faculty_question_bank` only — **no cost columns on that table**.  
2. **WHAT:** Console only. Related non-AI: `qbank/[id]/route.ts:211` logs `qbank_verify` / `qbank_reject` event_counts (live 3 verify rows, cost 0).  
3. **CORRECT?** AI spend invisible; only human review clicks counted.  
4. **FALLBACK:** Tagger 2-attempt parse fallback — each successful `routeAI` console-logged.  
5. **PARALLEL:** Generator may call AI per slot batch; no cost store.  
6. **WHO WRITES:** Admin; `faculty_id: user.id`.

---

### `explainer_ideate` / `explainer_extract`

1. **WHERE:** Compute: `lib/explainer/scriptGenerator.ts:173` (ideate Flash+thinking 2048), `:234` (extract Pro). Persist: `explainer/generate/route.ts:201` → `explainers` table — **no cost/token columns**.  
2. **WHAT:** Console only. Ideate thinking tokens likely **undercounted** (only `candidatesTokenCount`).  
3. **CORRECT?** Incomplete even at compute layer for thinking; nothing stored.  
4. **FALLBACK:** None.  
5. **PARALLEL:** Sequential ideate→extract.  
6. **WHO WRITES:** Admin; `created_by: user.id`.

---

### `module_co_classify`

1. **WHERE:** Compute: `lib/qpaper/moduleCoClassifier.ts:211–212` — **two parallel identical Flash calls** (consensus). Persist: writes `module_co_mapping` only — **NOT FOUND** for cost.  
2. **WHAT:** Console ×2.  
3. **CORRECT?** Double spend; neither stored.  
4. **FALLBACK:** None beyond dual-pass consensus.  
5. **PARALLEL:** Dual call intentionally; if logging added, log **both**.  
6. **WHO WRITES:** Mapping rows via admin; no cost ownership field for AI spend.

---

### `qbank_image_question`

1. **WHERE:** Compute: `qbank/draft-image/route.ts:262` `routeAI("qbank_image_question", { model: "flash", ...})`. Persist: **NOT FOUND** (draft returned to client; bank insert is separate). Not in `TASK_TO_MODEL`.  
2. **WHAT:** Console only.  
3. **CORRECT?** Discarded.  
4. **FALLBACK:** None.  
5. **PARALLEL:** Single.  
6. **WHO WRITES:** N/A for cost.

---

## RLS findings

Queried live via `supabase db query --linked` against `pg_policies` / `pg_class` (2026-07-08). **Do not trust migrations alone.**

### Tables involved in cost/usage logging

| Table | RLS enabled | Policy count | Faculty can read other faculty’s cost? | Superadmin cross-read? | Gaps |
|---|---|---|---|---|---|
| `usage_analytics` | **true** | **3** | **No** (SELECT own `user_id = auth.uid()` only) | **Yes** via `"Admins see all usage_analytics"` (`superadmin`, `dept_admin`) | Faculty can read **own** rows (policy does not restrict to superadmin-only). No UPDATE/DELETE policies — browser updates blocked; all writes go through adminClient. **dean/hod not in admin policy** — browser-side dean/hod cannot SELECT all. |
| `generated_content` | **true** | **3** | **No** for others’ rows (`generated_by = auth.uid()`). Faculty cannot see another faculty’s PPT cost metadata | **Yes** (`superadmin`, `dept_admin`) | Faculty **can** read **own** metadata costs. `dept_admin` still named; role maybe legacy. dean/hod not in admin SELECT. |
| `chat_messages` | **true** | **3** | Indirect: faculty SELECT for **assigned subjects’** student sessions — would expose `tokens_used`/`cost_inr`/`model_used` if ever filled | Superadmin/dept_admin yes | Cost columns unused today. Faculty visibility of student chats is product choice; for future cost fields this leaks spend meta to faculty of that subject. |

### Related tables (no AI cost columns, but called out)

| Table | RLS | Notes |
|---|---|---|
| `explainers` | enabled, 3 policies | Authenticated SELECT all explainers — no cost cols |
| `faculty_question_bank` | enabled, 5 policies | Own + superadmin ALL — no cost cols |
| `quizzes` / `quiz_attempts` | enabled, policies present | No AI cost cols |

### App-layer RLS bypass (critical for Checkpoint 2)

- Virtually all API routes use **`createAdminClient()`** (service role) — **bypasses RLS entirely**.
- Ownership is only as good as application code setting `user_id` / `generated_by`.
- **`/api/analytics/summary`** (`summary/route.ts:10`) allows roles `faculty|superadmin|dean|hod`, then uses adminClient to `SELECT` **all** `usage_analytics.cost_inr` for the month (`:42–45`) with **no user filter**. So even though RLS blocks faculty from reading others’ rows in the browser, **any faculty hitting this API can see institution-wide cost totals** (today always ~₹0 because costs aren’t written). Checkpoint 2 must treat this as a real leak if costs become meaningful.
- `/api/analytics` similarly uses adminClient for faculty-scoped *content* stats; summary cost path is the concerning one.

### Zero-policy / RLS-disabled check

- Cost tables above: **RLS on, policies present** (not the July “15 tables with zero policies” failure mode — that was previously patched per CLAUDE_CONTEXT §14; live confirms policies exist for `usage_analytics` / `generated_content` / `chat_messages`).
- **No cost/usage table found with RLS disabled.**

### Policy vs product intent (“superadmin-only cost”)

- Live RLS is **not** “superadmin-only”: users see **own** `usage_analytics`; faculty see **own** `generated_content` (incl. cost metadata).
- If product intent is truly superadmin-only cost visibility, policies and the summary API both need tightening in Checkpoint 2 (decision — see below).

---

## Edge case findings

### 1. Timezone

- `created_at` columns are **`timestamptz`**, defaults `now()` → stored UTC. Correct.
- `usage_analytics.date` is set by `new Date().toISOString().slice(0, 10)` → **UTC calendar date**, not IST. Indian evenings after ~5:30 AM UTC next day / late IST can land on the wrong “day” for daily aggregation. Flag for Checkpoint 2 IST bucketing.

### 2. Currency

- Text models: single shared `USD_TO_INR = 83.33` in `gemini.ts:26`. Consistent across all `routeAI` tasks.
- Images: same `83.33` multiplier with hardcoded USD (`0.04` / `0.10`) in `build/route.ts:168–169` and legacy `generator.ts:1994` (`0.04` only — **ignores intricate tier** if that path runs).
- No live FX feed; rate is stale/hardcoded. No USD storage — only INR floats.

### 3. Deleted / deactivated faculty

- Removing a **`faculty_assignments` row alone** does **not** cascade-delete `usage_analytics` or `generated_content` (no FK to assignments). Historical spend for those rows survives. Good.
- Deleting a **`profiles` row** (or auth user cascading to profiles):  
  - `usage_analytics.user_id` → **ON DELETE CASCADE** (live FK) — **destroys historical spend**.  
  - `generated_content.generated_by` → **ON DELETE CASCADE** — **destroys PPT/qpaper cost metadata**.  
  - `chat_sessions.student_id` → CASCADE → cascades messages.  
  - `explainers.created_by` → **SET NULL** (preserves row, not cost — no cost anyway).  
- **Violation of stated requirement** (“historical spend must survive user removal”) if users are deleted rather than soft-deactivated.

### 4. Student-side rigor vs faculty / rate limits

| Path | Event log | Tokens/cost | Notes |
|---|---|---|---|
| Chat | Yes (event_count) | No | Rate limit 50/day; **429 ceiling hits not logged** |
| Quiz generate | No | No | Rate limit 20/day; ceiling not logged; gen spend invisible |
| Quiz submit | Yes (`quiz`) | No | Counts attempts, not AI |
| Hint | No (uses chat task) | No | Rate limit 30; not logged; shares chat? (checks `event_type='hint'` but nothing writes `hint` — **rate limit for hint is ineffective / always 0**) |
| Placement prep | No | No | Multiple Flash calls, zero analytics |
| Placement test gen | Attempted | No | Inserts fail on null `subject_id` |

Student AI usage is **thinner** than faculty PPT (the only feature with real ₹ in metadata), and generally **event-only or missing**. Demand signal from hitting rate-limit ceilings is **not** recorded anywhere.

---

## Trivial fixes applied this pass

**None.**  

Candidates that look small but fail the “one-line, zero-risk, provably-correct” bar:

- Placement `subject_id: null` — needs nullable column **or** synthetic subject, plus verifying unique constraint; not a one-liner.
- Chat writing `ai.costInr` into `usage_analytics` / `chat_messages` — correct direction but schema semantics (input+output vs single `tokens_used`) and cache paths need a design call.
- Hint rate-limit `event_type` mismatch — fixable but behavioral change to student limits; out of scope for audit-only.

---

## Everything else that needs a decision before Checkpoint 2

1. **Canonical store for cost:** Reuse/`fix` `usage_analytics` + typed columns, vs promote `generated_content.metadata`, vs **new `ai_call_logs` (or similar) per-call table**. Current state cannot power a trustworthy analytics page.
2. **Grain:** Per-call rows (required for 6× answer-key parallelism, PPT batch concurrency, fallback attempts, Flash vs Pro attribution) vs per-job aggregates.
3. **Log failed / 429 / fallback attempts?** Required for later failure-rate tracking; today only successful `routeAI` returns appear in console, and almost nothing in DB.
4. **Per-model breakdown:** Especially PPT (Flash content + Flash/Pro diagrams + image models) and answer-key (2× Flash + 4× Pro).
5. **Thinking-token accounting** for `explainer_ideate` / chat (`thoughtsTokenCount`).
6. **Image cost:** Real usage vs hardcoded $0.04/$0.10; unify generator vs build.
7. **Who may read cost:** Product says superadmin-only; live RLS allows own-row reads; **summary API already exposes global sums to faculty via adminClient**. Tighten policies + API together.
8. **Preserve history on user delete:** Change FKs to `ON DELETE SET NULL` / soft-delete profiles / anonymize — today CASCADE wipes spend.
9. **`usage_analytics.subject_id` NOT NULL** vs placement (and other subjectless events).
10. **IST day boundary** for `date` / aggregations.
11. **FX rate** ownership (hardcoded 83.33 vs config / live rate).
12. **Add `qbank_image_question` to `TASK_TO_MODEL`** (missing today).
13. **Wire or abandon** typed `cost_inr`/`tokens_used` on `chat_messages` and `generated_content` (currently dead columns — 100% zero in pilot).
14. **Hint rate-limit bookkeeping** (`event_type='hint'` never written).
15. **Client trust:** PPT totals currently depend on client-forwarded `totalFlashCostInr`; checkpoint RMW can race — prefer server-side authoritative accumulation for Checkpoint 2.
16. **Rename `totalFlashCostInr`** (value is Flash+Pro) or split keys — naming continues to confuse §18-style bugs.

---

*End of Checkpoint 1 audit. File not committed.*
