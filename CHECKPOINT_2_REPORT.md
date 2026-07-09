# Checkpoint 2 — Completion Report

**Date:** 2026-07-08  
**Scope:** AI cost logging backbone only (no analytics UI).  
**Report status:** Review first — not committed with the code unless asked.

---

## Summary

Checkpoint 2 delivered a shared pricing module, `ai_call_logs` (+ migration applied live), required `logContext` on every `routeAI` call, router-level success/error/`rate_limited` logging via `after()`, Imagen logging with the same job ids, Part H analytics leak / hint rate-limit fixes, and TypeScript compile cleanliness (`npx tsc --noEmit` exit 0, `_regen2.ts` excluded as a scratch script).

Folded rulings from the stop-and-report turn:
- **#21** `generate/ppt/refine` → `feature: 'ppt_generation'`, Pattern A `contentId`
- **#22** `placement/practice/generate` → `feature: 'placement_practice'`, Pattern B, `related_content_id` null (bank rows only)

---

## Part F — Call sites (22 + required companions)

| # | Task | File:line (routeAI / key change) | feature | job_id |
|---|---|---|---|---|
| 1 | chat | `src/app/api/chat/route.ts:321` | chat | Pattern B |
| 1a | chat | `src/app/api/quiz/hint/route.ts:52` | chat | Pattern B |
| 1b | chat | `src/app/api/notes/route.ts:112` | chat | Pattern B |
| 1c | chat | `src/app/api/chat/suggestions/route.ts:45` | chat | Pattern B |
| 2 | quiz_gen | `src/app/api/quiz/generate/route.ts:210` (+ backfill) | quiz | Pattern B |
| 3 | quiz_gen (placement) | `src/app/api/placement/generate/route.ts:335` | placement | shared w/ #14 |
| 4 | placement_prep | `placement/prep/generate/route.ts:435,:585,:593` | placement | Pattern B shared |
| 4a–d | placement_prep | `resume/ats:269`, `rewrite-bullet:77`, `jd-analyze:173`, `interview/evaluate:92` | placement | Pattern B each |
| 5 | ppt_gen outline | `generate/ppt/outline/route.ts:208` | ppt_generation | Pattern A pre-gen `contentId` |
| 6 | ppt_gen / ppt_diagram | `generate/ppt/batch/route.ts:449` | ppt_generation | Pattern A `contentId` |
| 7 | ppt_extract | `lib/ppt-refine/extractor.ts:385` | ppt_refine | Pattern A `extractionId` |
| 8 | ppt_refine | `lib/ppt-refine/refiner.ts:604,:737,:1272` (+ refine route backfill) | ppt_refine | Pattern A |
| 9 | qpaper_gen | `lib/qpaper/sectionGen.ts:1776` via `generate/qpaper/route.ts` | qpaper | Pattern B + backfill |
| 10 | qpaper_gen regen | `generate/qpaper/regenerate-question/route.ts:126` | qpaper | Pattern B, related set |
| 11 | qpaper_validate_tags | `lib/qpaper/validateTags.ts:218` (+ validate-tag route) | qpaper | same jobId as #9/#10 |
| 12 | answer_key_* | `lib/qpaper/answerKeyGen.ts:772,:793,:807` via answer-key route | answer_key | ONE jobId ×6 |
| 13 | refine | `src/app/api/refine/route.ts:100` | refine | Pattern B, related null |
| 14 | placement_gen | `placement/generate/route.ts:113` | placement | shared w/ #3 |
| 15 | syllabus_extract | `syllabus/extract/route.ts:35` | syllabus | Pattern B |
| 16 | pyq_extract | `upload/route.ts:120` | pyq_extraction | Pattern B |
| 17 | qbank_generate / tag | `lib/qbank/generator.ts:236`, `tagger.ts:214`, `qbank/generate/route.ts` | qbank | Pattern B shared |
| 18 | explainer_* | `lib/explainer/scriptGenerator.ts:175,:244` (+ generate route backfill) | explainer | Pattern B |
| 19 | module_co_classify | `lib/qpaper/moduleCoClassifier.ts:232,:236` | admin_classification | Pattern B dual-pass metadata |
| 20 | qbank_image_question | `qbank/draft-image/route.ts:263` (+ `TASK_TO_MODEL` entry) | qbank | Pattern B |
| 21 | ppt_gen slide regen | `generate/ppt/refine/route.ts:470` (+ client sends contentId) | ppt_generation | Pattern A contentId |
| 22 | placement_gen practice | `placement/practice/generate/route.ts:323` | placement_practice | Pattern B, related null |

**Companion `tagQuestions` call sites** (signature requires logContext — not new features, but must compile):
- `qbank/add-manual/route.ts` — feature `qbank`, metadata `{ action: 'add_manual_tag' }`
- `qbank/import/route.ts` — feature `qbank`, metadata `{ action: 'import_tag' }`
- `syllabus/save/route.ts` — passes user snapshots into `classifyModulesForSubject` (already #19)

---

## Unlisted `routeAI` sites found

1. **`_regen2.ts`** (repo root scratch script) — excluded from `tsconfig.json`. Not production.  
2. **Comment-only mentions** in file headers (explainer/answerKeyGen/sectionGen) — not call sites.

No third production call site was discovered after folding #21/#22.

---

## Job_id pattern fit notes (flagged, not silently reinvented)

1. **Outline Pattern A:** `contentId` is **pre-generated** with `crypto.randomUUID()` *before* `routeAI`, then used as both `jobId` and inserted `generated_content.id`. Required because outline previously created the draft row only *after* the AI call.
2. **Batch:** `contentId` now required on the body for cost logging (returns 400 if missing). Matches existing checkpoint architecture.
3. **Single-slide refine (#21):** Client (`faculty/generate/refine/[contentId]/page.tsx`) now sends `contentId`; API returns 400 without it.
4. **Practice (#22):** Confirmed `savePracticeToBank` only — no generated_content equivalent → `related_content_id` left null.
5. **Imagen in uploaded ppt-refine:** Logged with `feature: 'ppt_refine'` and same `extractionId` job (not `ppt_generation`) — correct domain for that pipeline; Part G wording targeted the AI-deck build path.
6. **Imagen task name:** `task: 'ppt_imagen'` (not in TASK_TO_MODEL — image path bypasses router). Flagged for Checkpoint 3 display mapping.

---

## Part I — Edge-case verification

| Check | Result |
|---|---|
| 1. Concurrency / no RMW on ai_call_logs | **Pass (by construction).** `logAICall` only `insert`s; answer-key and PPT batches each pass their own insert via `routeAI`/`generateImagenImage`. No aggregate-then-write path. |
| 2. IST at write time | **Pass.** No IST conversion in write path (`pricing`/`costLogger`/`router`/`imagen`). |
| 3. fx_rate snapshot | **Pass.** `costLogger` writes `fx_rate: USD_TO_INR` (83.33) per insert. |
| 4. Failed calls appear | **Reasoned pass.** `router.ts` catch path schedules `logAICall` with `status: 'error' \| 'rate_limited'` via `after()` before rethrow. Live forced insert into pilot was **not** run (mutation policy); Imagen full-failure path also logs `status: 'error'`. |
| 5. Deletion survival | **Pass (live FK).** `user_id` and `subject_id` are `ON DELETE SET NULL`. Snapshots remain on row. |
| 6. tsc clean / all sites migrated | **Pass.** `npx tsc --noEmit` → exit 0. |

### Live DB (applied)

- Migration `20260708000000_ai_call_logs.sql` applied via `supabase db query --linked -f …`
- RLS enabled; policies: `Admins see all ai_call_logs` (SELECT), `Service role full access ai_call_logs` (ALL)
- `usage_analytics.subject_id` is now **nullable**

---

## Part H

1. **`/api/analytics/summary`:** `costThisMonth` / `apiCallsThisMonth` only for `superadmin` | `dept_admin` (keys omitted otherwise). Superadmin analytics page types them optional and shows `—` when absent. Faculty analytics does not consume these fields.
2. **Hint rate limit:** `quiz/hint/route.ts` upserts `usage_analytics` with `event_type: 'hint'` after a successful AI hint.

---

## Intentionally out of scope / cleaned before commit

- Reverted unrelated in-progress visual-embed work (`assembler.ts` large diff, `visual-raster.ts`, `faculty/refine/page.tsx` visual bake) that had landed in the working tree. Retained only the minimal `getShapeXfrm` return type adding `x` so existing visual geometry code still typechecks if reintroduced later — actually after checkout the type fix alone remains on assembler.
- Checkpoint reports (`AUDIT_COST_LOGGING.md`, this file) left **untracked** / not committed.
- `supabase/.temp/cli-latest` not committed.

---

## tsc

```
npx tsc --noEmit
EXIT:0
```

(`_regen2.ts` excluded in `tsconfig.json`.)
