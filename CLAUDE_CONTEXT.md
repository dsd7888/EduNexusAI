# EduNexus AI — Complete Project Context

*Last updated: June 27, 2026 | Solo developer: Dhruv | Stack: Next.js 16 + Supabase + Gemini*
*This document is the single source of truth for any Claude instance working on EduNexus AI.*

---

## 1. What This Project Is

EduNexus AI is a **syllabus-locked, role-aware institutional intelligence platform** for Indian private universities. It is NOT a generic AI tutor. It is an institutional layer that gives universities governance over what students learn from AI.

**Core positioning:** Not ChatGPT for students. An institutional AI platform that a Dean pays for because it enforces the university's syllabus, generates faculty content in minutes, and produces accreditation-ready analytics.

**Current deployment:** `edu-nexus-ai-two.vercel.app`
**Repo:** `https://github.com/dsd7888/EduNexusAI`

**Deployment scope:** P. P. Savani University (PPSU) — Engineering (CSE fully seeded Sem 1–7, Chemical + Mechanical active). Student accounts are manually provisioned by Dhruv (Supabase self-signup disabled).

**Content state (June 2026):** CSE syllabus fully seeded for Semesters 1–7: 52 subjects, 285 modules, 228 COs, full CO-PO/PSO mappings, BTL levels, exam schemes. Seeded via two SQL scripts (`seed_cse_sem1_4.sql` + `seed_cse_sem5_7.sql`). CSE is the first branch with complete structured-syllabus coverage.

**The three institutional lock-in factors:**
1. Syllabus lock — content is their RAG; can't replicate without their PDFs
2. Faculty workflow — PPTs, Q papers, Q bank, refinement all live here; moving = losing content library
3. Accreditation data — once generating NAAC reports, embedded in regulatory process

**Key people:**
- Dhruv (developer, at PPSU)
- Mr. Raviraj Chauhan (faculty mentor)

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind CSS, shadcn/ui |
| Backend | Next.js API Routes (serverless) |
| Database | Supabase (PostgreSQL + pgvector + Auth + Storage) |
| AI Primary | Gemini 2.5 Flash (chat, quiz, PPT batches, refine, extraction, qbank) |
| AI Heavy | Gemini 2.5 Pro (Q paper gen, answer key, placement gen, explainer extraction) |
| AI Images | gemini-2.5-flash-image (primary) + imagen-4.0-fast-generate-001 (fallback) |
| AI Embeddings | gemini-embedding-001 (3072 dimensions) |
| PPT Generation | pptxgenjs (new slides) + adm-zip + fast-xml-parser (PPT refinement XML patching) |
| Diagrams | SVG (inline generation) + Mermaid (via mermaid.ink API for PDF, MermaidDiagram.tsx for chat) + Imagen |
| Interactive Viz | D3.js, P5.js, Chart.js, Plotly via CDN in sandboxed iframes (srcDoc approach) |
| Drag-and-drop | @dnd-kit/core (Q paper builder + Q bank staging) |
| PDF Export | Custom PDFBuilder class in /lib/pdf/builder.ts |
| Word Export | docx v9 (Q paper .docx export) |
| PDF Parsing | LlamaParse (notes/syllabus), Gemini Flash (PYQ structured extraction) |
| Deployment | Vercel (with vercel.json timeout configs) |
| Dev tools | Cursor Pro chat (targeted single-file changes), Claude Code (multi-file architectural work) |

---

## 3. AI Model Routing (`src/lib/ai/router.ts`)

```typescript
const TASK_TO_MODEL = {
  chat: "flash",                   // maxTokens: 16384
  quiz_gen: "flash",               // maxTokens: 8192
  placement_prep: "flash",         // maxTokens: 6000
  ppt_gen: "flash",                // maxTokens: 32768
  ppt_diagram: "flash"|"pro",      // maxTokens: 8192 — diagram-only batches; model is DYNAMIC
  ppt_extract: "flash",            // maxTokens: 512 — topic/level detection (unused from router, inlined)
  ppt_refine: "flash",             // maxTokens: 16384 — PPT content refinement batches
  qpaper_gen: "pro",               // maxTokens: 8192 per section (estimateMaxOutputTokens in sectionGen)
  qpaper_validate_tags: "flash",   // maxTokens: 512 per question — CO/BTL judge
  answer_key_mcq: "flash",         // maxTokens: 2048
  answer_key_descriptive: "pro",   // maxTokens: estimateMaxOutputTokens(..., "answer_key")
  refine: "flash",                 // maxTokens: 8192
  placement_gen: "pro",            // maxTokens: 32768
  syllabus_extract: "flash",       // maxTokens: 8192
  pyq_extract: "flash",            // maxTokens: 4096
  qbank_generate: "flash",         // maxTokens: estimateMaxOutputTokens (via tokenBudget.ts)
  qbank_tag: "flash",              // maxTokens: 2048
  explainer_ideate: "flash",       // maxTokens: 8192, thinking ON (thinkingBudget: 2048 via ChatParams)
  explainer_extract: "pro",        // maxTokens: 16384, thinkingBudget: 0 (structured JSON + responseSchema)
}
```

**`ppt_diagram` model routing (complexity-based, NOT a blanket Pro rule):**
`routeDiagramModel(slide)` in router.ts decides per-slide:
- `mermaid` → always Flash (terse structured markup, Pro buys nothing)
- `imagen` / `illustration` → always Flash (text model only writes a prompt)
- `svg` / `dual` or absent hint → Flash if `diagramComplexity === "standard"`, Pro if `"intricate"`

`routeDiagramBatchModel(slides[])` takes Pro if ANY slide in the batch needs Pro. The batch route sets `maxTokens: 8192` explicitly for every diagram batch regardless of model choice.

**CRITICAL:** `thinkingBudget: 0` for ALL structured JSON tasks. Gemini 2.5 Flash's thinking tokens consume `maxOutputTokens`, causing JSON truncation. Hard-won discovery.

**`ChatParams` extended fields (added June 2026):**
- `responseSchema?: object` — forces `responseMimeType: application/json` + schema-constrained output. Guarantees valid JSON on first call, no parse retry needed.
- `thinkingBudget?: number` — caps (not disables) thinking for tasks that need reasoning but must leave output headroom. Takes priority over the `isStructuredTask` default.

**Thinking budget rules:**
- `explainer_ideate`: thinking ON, capped at 2048 via `thinkingBudget: 2048` in ChatParams
- All other non-structured tasks: thinking uncapped (Flash default)
- All structured JSON tasks (in `isStructuredTask` list): `thinkingBudget: 0`

**Answer key generation:** 6 parallel calls per paper (2× Flash `answer_key_mcq`, 4× Pro `answer_key_descriptive`). Both tasks are in the `isStructuredTask` allowlist in gemini.ts — critical for Flash to set `thinkingBudget: 0` and avoid silent JSON truncation. `answer_key_descriptive` uses dynamic `estimateMaxOutputTokens(..., "answer_key")` which is then overridden to 32768 by the Pro ceiling in gemini.ts.

**Fallback:** 429 rate limit → tries next in fallback chain.

---

## 4. Role Hierarchy & Permissions

### Current roles in DB: superadmin, dean, hod, faculty, student

### SUPERADMIN (Dhruv)
- Created manually in Supabase — never via registration
- Full platform access across all schools/departments

### DEAN
- Scoped to one or more schools via `role_scope` table
- Routes to faculty dashboard, has cross-user visibility (all content for their school)

### HOD
- Scoped to one or more departments within a school via `role_scope` table
- Routes to faculty dashboard, has cross-user visibility within their department

### FACULTY
- Access follows `faculty_assignments` ONLY — not school/branch hierarchy
- Can be assigned to subjects in any school/branch
- Can generate: PPT, PPT Refinement, Q paper, Q bank, Answer Keys, Animated Explainers, Refined Notes

### STUDENT
- Chat with AI tutor (syllabus-locked)
- Self-generate quizzes, placement prep
- Rate limited: 50 chat/day, 20 quiz/day, 30 hints/day

### role_scope table
```sql
role_scope: id, user_id, school, department (null = entire school), created_at
```

### Dean/HOD access pattern
- Dean/HOD route to `/faculty/*` via `FACULTY_TIER_ROLES` in proxy.ts
- They see cross-user data (all PPT content, full Q-bank list, institution-wide analytics) because ownership checks test `=== "faculty"` literally — dean/hod fall into the superadmin-like else branch intentionally
- All 30 faculty-tier API route arrays include `["faculty","superadmin","dean","hod"]`
- Superadmin-only routes (upload, approvals, syllabus, subjects, faculty/assign) remain unchanged

---

## 5. Database Schema

### Core Tables
- `profiles`: id, email, full_name, role (superadmin/dean/hod/faculty/student), department, branch, semester
- `subjects`: id, name, code, department, branch, semester, **school**
- `modules`: id, subject_id, name, module_number, description, hours, weightage_percent, section_number, btl_levels text[]
- `exam_structures`: id, subject_id, total_marks, total_questions, time_limit_minutes, sections (jsonb)
- `faculty_assignments`: id, faculty_id, subject_id, assigned_by, assigned_at
- `role_scope`: id, user_id, school, department, created_at

### Content Tables
- `subject_content`: id, subject_id (UNIQUE), content TEXT, reference_books TEXT, created_by (nullable), practicals jsonb
- `documents`: id, module_id, subject_id, type, title, file_path, year, uploaded_by, status
- `document_chunks`: id, document_id, content, page_number, chunk_index, embedding vector(3072), metadata jsonb
- `note_change_requests`: id, subject_id, module_id, requested_by, reviewed_by, current_doc_id, new_file_path, reason, status, admin_comment, reviewed_at

### Syllabus Structure Tables
- `course_outcomes`: id, subject_id, co_code, description
- `co_po_mapping`: id, subject_id, co_code, po_code, strength (1/2/3)
- `co_pso_mapping`: id, subject_id, co_code, pso_code, strength (1/2/3)
- `exam_scheme`: id, subject_id (UNIQUE), theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits

### Q Paper Tables
- `qpaper_templates`: id, subject_id (nullable), created_by, name, is_default, university_name, exam_title, duration_minutes, total_marks, instructions text[], structure jsonb, **scope** text ('personal'/'school'/'department', default 'personal')
- `pyq_questions`: id, document_id, subject_id, section_name, q_number, question_text, question_type, marks, co, btl, po, options jsonb, year
- `qpaper_drafts`: id, faculty_id, subject_id, label, builder_state jsonb, generation_status ('idle'/'generating'/'complete'/'failed'), last_saved_at, created_at — faculty-private autosave scratch state (RLS: own + superadmin only; dean/hod intentionally excluded)
- `qpaper_history`: id, faculty_id, subject_id, label, total_marks, structure_summary jsonb, pdf_path, docx_path, answer_key_path, created_at — finalized papers; paths are Storage paths (not URLs). RLS: own OR superadmin/dean/hod (oversight-visible)

### Q Bank Table
- `faculty_question_bank`: id, subject_id, faculty_id, module_id, question_text, question_type (mcq/short_answer/long_answer/numerical/fill_blank), marks, model_answer, options jsonb, co_code, btl_level (1–6), po_codes text[], difficulty (easy/medium/hard), source (ai_generated/faculty_imported/pyq_inspired), is_verified bool, usage_count, last_used_at, created_at, updated_at

### Explainers Table
- `explainers`: id, short_code (unique, 8-char), subject_id, module_id, topic, script (jsonb — ExtractedContent), storage_path, has_audio, duration_seconds, created_by, created_at
- Private `explainers` Storage bucket — HTML served via `/e/[code]` public route

### Chat Tables
- `chat_sessions`: id, student_id, subject_id, module_id
- `chat_messages`: id, session_id, role, content, citations (jsonb), tokens_used, model_used, cost_inr

### Quiz Tables
- `quizzes`: id, module_id, subject_id, title, difficulty, questions (jsonb), generated_by
- `quiz_attempts`: id, quiz_id, student_id, answers (jsonb), score, time_taken

### Generation Tables
- `generated_content`: id, subject_id, module_id, type, title, file_path, metadata (jsonb), generated_by, tokens_used, cost_inr, status, answer_key_path, answer_key_generated_at

### Placement Tables
- `placement_companies`, `placement_question_bank`, `practice_question_bank`, `student_question_history`, `placement_attempts`

### System Tables
- `semantic_cache`: id, subject_id, module_id, query_text, query_embedding vector(3072), response, hit_count, last_used_at
- `usage_analytics`: id, date, user_id, subject_id, event_type, event_count, tokens_used, cost_inr

### DB Consistency Rules
- `department = "Engineering"` for ALL rows (current deployment)
- `school = "School of Engineering"` for all seeded CSE subjects
- Filter queries use `branch` only, never `department`
- `subject_content.created_by` is nullable
- RLS enabled on all tables. `get_my_role()` SECURITY DEFINER function breaks recursion in profiles policies
- `documents.type` enum: `'syllabus' | 'notes' | 'pyq' | 'reference_material'`
- `generated_content.type` enum: `'ppt' | 'visual_notes' | 'refined_notes' | 'qpaper' | 'answer_key'`
- `generated_content.status` values: `'pending' | 'outline_done' | 'generating_content' | 'generating_diagrams' | 'building' | 'completed' | 'failed' | 'abandoned'`
- `placement_question_bank` has `question_type` text ('mcq' | 'fill_code', default 'mcq') and `code_context` jsonb columns for fill-in-code questions — reflected in `src/types/placement.ts` line ~320

---

## 6. File Structure (Current State)

```
edunexus-ai/
├── src/
│   ├── proxy.ts                                    ← Auth middleware (Next.js 16, NOT middleware.ts)
│   ├── app/
│   │   ├── (auth)/login/ + register/               ✅
│   │   ├── (superadmin)/superadmin/
│   │   │   ├── dashboard/ + upload/ + approvals/   ✅
│   │   │   ├── faculty/ + subjects/ + analytics/   ✅
│   │   │   └── subjects/[subjectId]/syllabus/       ✅
│   │   ├── (faculty)/faculty/
│   │   │   ├── dashboard/                          ✅
│   │   │   ├── generate/                           ✅ PPT generation
│   │   │   ├── generate/refine/[contentId]/        ✅ Per-slide PPT refinement
│   │   │   ├── qpaper/                             ✅ Q paper builder (page.tsx + _components/)
│   │   │   │   ├── _components/
│   │   │   │   │   ├── TemplateStructureStage.tsx  ← stage 1: template/preset selection
│   │   │   │   │   ├── ScopeAndDifficultyStage.tsx ← stage 2: module selection + BTL presets
│   │   │   │   │   ├── SourcingStage.tsx           ← stage 3: Fresh/PYQ-style/Bank % mix
│   │   │   │   │   ├── BuilderSectionsEditor.tsx   ← stage 4: drag-drop section builder
│   │   │   │   │   ├── ReviewAndValidateStage.tsx  ← stage 5: review + CO/BTL validation
│   │   │   │   │   ├── FinalizeExportStage.tsx     ← stage 6: generate + export + history
│   │   │   │   │   ├── shared.tsx                  ← shared types + helpers
│   │   │   │   │   └── useQpaperDraft.ts           ← autosave/resume hook (qpaper_drafts)
│   │   │   │   └── history/                        ✅ Re-downloadable finalized papers
│   │   │   ├── qbank/                              ✅ Q bank
│   │   │   ├── explainer/                          ⚠️  UNDER DEVELOPMENT (UI shows placeholder)
│   │   │   ├── refine/                             ✅ PPT + text refinement tabs
│   │   │   ├── request-change/ + analytics/ + profile/ ✅
│   │   ├── (student)/student/
│   │   │   ├── dashboard/ + subjects/ + chat/[subjectId]/ ✅
│   │   │   ├── quiz/ + history/ + profile/         ✅
│   │   │   └── placement/ (page, test, history, practice) ✅
│   │   ├── e/[code]/                               ✅ Public explainer permalink
│   │   └── api/
│   │       ├── auth/callback/                      ✅
│   │       ├── admin/cleanup/                      ✅
│   │       ├── analytics/ + analytics/summary/     ✅
│   │       ├── subjects/content/ + subjects/manage/ ✅
│   │       ├── upload/                             ✅
│   │       ├── faculty/assign/ + faculty/assign/bulk/ ✅
│   │       ├── approvals/ + approvals/download/    ✅
│   │       ├── syllabus/extract/ + save/ + load/   ✅
│   │       ├── chat/ + chat/session/ + suggestions/ + export/ ✅
│   │       ├── quiz/generate/ + submit/ + hint/ + export/ ✅
│   │       ├── notes/ + notes/export/              ✅
│   │       ├── generate/ppt/outline/ + batch/ + build/ + content/[id]/ + image/[id]/[idx]/  ✅
│   │       │   + rebuild/ + refine/ + checkpoint/[contentId]/ + download/[contentId]/       ✅
│   │       │   + history/ + resumable/                                                      ✅
│   │       ├── generate/qpaper/ + answer-key/ + regenerate-question/ + export/ + export-docx/ ✅
│   │       ├── qpaper/templates/ + templates/[id]/ ✅
│   │       ├── qpaper/history/ + history/answer-key-link/                                  ✅
│   │       ├── qbank/generate/ + import/ + list/ + [id]/ + questions/ + sample-csv/ ✅
│   │       ├── ppt-refine/extract/ + refine/       ✅
│   │       ├── refine/                             ✅
│   │       ├── explainer/generate/ + list/ + [id]/ ✅ (routes exist, UI under development)
│   │       ├── placement/generate/ + submit/ + export/ ✅
│   │       └── placement/practice/generate/ + submit/ + export/ ✅
│   ├── components/ui/ + layout/ + chat/ + ppt/ + ErrorBoundary.tsx ✅
│   ├── components/RichQuestionText.tsx             ✅ renders AI question text with table/list/bold support via markdownLite
│   ├── hooks/useSupabaseData.ts                    ✅
│   └── lib/
│       ├── ai/providers/types.ts + gemini.ts       ✅ (responseSchema + thinkingBudget added to ChatParams)
│       ├── ai/router.ts + prompts.ts + imagen.ts   ✅ (routeDiagramModel + routeDiagramBatchModel added)
│       ├── ai/tokenBudget.ts                       ✅ estimateMaxOutputTokens() — dynamic maxTokens for qpaper/qbank/answer-key
│       ├── api/helpers.ts                          ✅
│       ├── db/supabase-browser.ts + server.ts + types.ts ✅
│       ├── pdf/builder.ts                          ✅
│       ├── ppt/generator.ts                        ✅
│       ├── ppt-refine/types.ts + extractor.ts + refiner.ts + assembler.ts ✅
│       ├── qbank/types.ts + tagger.ts + generator.ts + parser.ts + row.ts ✅
│       ├── explainer/                              ⚠️ PARTIALLY BUILT — see §16 for status
│       │   ├── types.ts                            ← ExtractedContent + 14 PatternData types
│       │   ├── scriptGenerator.ts                  ← two-call: ideate (Flash+thinking) → extract (Pro+responseSchema)
│       │   ├── renderer.ts                         ← pattern-based renderers (8 patterns, UNDER DEVELOPMENT)
│       │   ├── tts.ts                              ← Google Cloud TTS (optional)
│       │   └── storage.ts                          ← short-code alloc + HTML upload/stream
│       ├── text/markdownLite.ts                    ✅ parseMarkdownLite() — pipe-table/list/bold/code parser for AI text
│       ├── qpaper/generator.ts + sectionGen.ts + moduleAssignment.ts + answerKeyGen.ts ✅
│       │   + templates.ts + builder.ts + bankFill.ts + docxBuilder.ts                  ✅
│       │   + sourcing.ts (allocateSlotSources, Hamilton apportionment)                  ✅
│       │   + poolRender.ts (pool block rendering helpers)                               ✅
│       │   + validateTags.ts (validateQuestionTags — Flash CO/BTL judge)                ✅
│       ├── syllabus/types.ts + prompts.ts + parser.ts + reconstruct.ts ✅
│       ├── quiz/generator.ts                       ✅
│       ├── placement/generator.ts + bankManager.ts + fallbackSyllabus.ts + modules.ts ✅
│       ├── refine/generator.ts                     ✅
│       ├── student/subjectGroups.ts                ✅
│       ├── ui/score.ts                             ✅
│       ├── utils.ts + utils/rate-limit.ts          ✅
├── supabase/migrations/
│   ├── 20260218100000_subject_content.sql          ✅ applied
│   ├── 20260218100001_subject_content_created_by.sql ✅ applied
│   ├── 20260328120000_placement_attempts_detail_columns.sql ✅ applied
│   ├── 20260521000000_structured_syllabus.sql      ✅ applied
│   ├── 20260523000000_qpaper_templates.sql         ✅ applied
│   ├── 20260524000000_pyq_questions.sql            ✅ applied
│   ├── 20260525000000_answer_key.sql               ✅ applied
│   ├── 20260603000000_faculty_question_bank.sql    ✅ applied
│   ├── 20260604000000_explainers.sql               ✅ applied
│   ├── 20260604000001_dean_hod_roles.sql           ✅ applied
│   ├── 20260613000000_placement_fill_code.sql      ✅ applied — adds question_type + code_context to placement_question_bank
│   ├── 20260620000000_qpaper_drafts.sql            ✅ applied — faculty-private autosave drafts
│   ├── 20260620000001_qpaper_templates_scope.sql   ✅ applied — adds scope col to qpaper_templates
│   ├── 20260620000002_documents_reference_material.sql ✅ applied — adds 'reference_material' to documents.type
│   ├── 20260620000003_backfill_get_my_role.sql     ✅ applied — checkpoints get_my_role() into migrations
│   ├── 20260621000000_qpaper_history.sql           ✅ applied — oversight-visible finalized paper history
│   ├── 20260622000000_generated_content_answer_key_type.sql ✅ applied — adds 'answer_key' to generated_content.type
│   └── 20260625000000_generated_content_generation_status.sql ✅ applied — expands status enum for PPT checkpoint/resume
├── supabase/seed_cse_sem1_4.sql                    ✅ 22 subjects Sem 1–4
├── supabase/seed_cse_sem5_7.sql                    ✅ 30 subjects Sem 5–7
├── vercel.json                                     ✅ maxDuration per route
├── CLAUDE_CONTEXT.md                               ← This file
├── .env.local
└── package.json
```

---

## 7. Completed Features

### Auth & Navigation
- proxy.ts auth middleware (Next.js 16), login/register/callback, role-based redirect
- Three role layouts with pure UI sidebars (no auth checks), mobile responsive

### Superadmin Features
- PDF upload (notes + PYQs), unified syllabus management
- Faculty assignment (many-to-many, search-all UI)
- Note-change approval workflow, analytics dashboard

### Student Features
- AI Chat: query mode detection, semantic cache (0.90 threshold), session resume (72h), visualize button, struggle detection
- Quiz: multi-type, Socratic hints, persistence, resume
- Placement prep: company tests, practice drills, history
- Semantic score system: slate/amber/emerald (no red), strengths-first, target-framing

### Faculty Features

#### PPT Generation
- 3-route pipeline (outline → batch → build), activity slides, Indian context, hook slides
- Per-slide continuous refinement UI

#### PPT Refinement
- Faculty uploads existing .pptx → AI refines content (Flash batches of 5)
- XML-patching assembler preserves 100% original appearance
- New slides appended using original slide master, explicit font sizes (sz="2400" title, sz="1600" body)
- 4-stage UI: upload → configure → processing → results

#### Q Paper Generation
Six-stage builder (page split into stage components under `_components/`):
1. **TemplateStructureStage** — preset selection (ESE Standard, Quiz, custom), section/question-block configuration
2. **ScopeAndDifficultyStage** — module selection + BTL-tier presets (Foundational/Balanced/Application-Heavy) + Custom % mode; achievability capped by module weightage share
3. **SourcingStage** — percentage mix allocator (Fresh / PYQ-style / Bank); deterministic Hamilton apportionment via `allocateSlotSources()` in `sourcing.ts`; staged Q-Bank questions guaranteed via `preferredQuestionIds` (unplaceable ones surfaced to faculty, not silently dropped)
4. **BuilderSectionsEditor** — drag-drop section/block editor with live marks totals
5. **ReviewAndValidateStage** — generated paper review; CO/BTL validation pass via `validateQuestionTags()` (Flash judge, flags mismatches with suggested relabel/regenerate action); `<RichQuestionText>` renders pipe-table/list/bold in question text
6. **FinalizeExportStage** — generate button, PDF/Word/answer-key downloads, save-as-template, history log

**Question block types:** `descriptive`, `descriptive_with_or`, `attempt_any_one`, `mcq`, `pool` (mixed MCQ/True-False/descriptive items; student attempts K of N). True/False modeled as an MCQ variant (`isPoolItemMcqLike` = true).

**Difficulty:** BTL-tier presets (`foundational` {BTL 1–2 heavy}, `balanced` {BTL 3–4 focus}, `application_heavy` {BTL 4–6 heavy}) + Custom % sliders. Achievability ceiling = module's weightage share; `capTierWeightsToCeilings` + `renormalizeTierWeights` in `moduleAssignment.ts`.

**Sourcing:** 3-category percentage mix replaces old 4-button exclusive modes. PYQ structured RAG always fed regardless of mix percentages.

**Token budget:** `estimateMaxOutputTokens()` in `tokenBudget.ts` replaces hardcoded maxTokens across qpaper/qbank/answer-key calls. Separate calibration profiles for "generation" vs "answer_key".

**CO/BTL/PO tagging:** confirmed consistent across web preview (`ReviewAndValidateStage`), PDF (`builder.ts`), and Word (`docxBuilder.ts`) for all question types including pool blocks.

**Flat layout:** `flatLayout: true` on template (used by Quiz preset) flattens the section hierarchy in PDF and Word. **Known gap: web preview in ReviewAndValidateStage does not honor `flatLayout`.**

**Draft autosave/resume:** `useQpaperDraft.ts` hook writes to `qpaper_drafts` (faculty-private). Stores full builder state including any generated paper content. Resume-from-draft flow on page mount.

**Paper history:** `qpaper_history` table (oversight-visible). Stores Storage paths (not URLs) for durable re-download. Populated on finalize; matching draft is deleted.

**Answer key:** CONFIDENTIAL PDF + Word export. 6 parallel calls (`answer_key_mcq` Flash × 2, `answer_key_descriptive` Pro × 4). Both tasks are in `isStructuredTask` allowlist (prevents Flash thinking from consuming output budget). Pool questions decomposed to per-item Flash/Pro calls in `splitQuestionsForBlocks`.

#### Q Bank
- Per-subject persistent question library
- Generate: slot-based bulk generation (≤60 questions), Fresh + PYQ-Inspired styles
- Import: CSV/TXT with AI tagging for missing CO/BTL (sample CSV downloadable)
- My Bank: infinite scroll, full filters, inline edit, delete, staging area
- Q paper integration: From Q Bank source, 📚 badge, usage tracking

#### Animated Explainers (UNDER DEVELOPMENT — UI shows placeholder)
The infrastructure is built but the visual output quality is not acceptable yet. Shelved for a dedicated session. Do not attempt to use or fix incrementally.

**What's built:**
- Two-call pipeline architecture: `ideateExplainer()` (Flash + thinking, pedagogical narrative) → `extractStructuredContent()` (Pro + responseSchema, pattern classification + data extraction)
- 14 pattern types defined in types.ts: array_sort, array_search, graph_algorithm, tree_traversal, stack_queue_ops, dp_table, formula_derivation, concept_analogy, comparison_table, process_flow, cause_effect_chain, definition_with_example, hierarchy_structure, state_machine
- Pattern-based renderer architecture in renderer.ts (8 patterns partially implemented)
- Storage, TTS (optional Google Cloud TTS), public `/e/[code]` route all working
- DB table and Storage bucket exist

**What's wrong (root cause identified):**
- The renderer produces pattern-specific HTML but the visual execution is broken -- boxes don't show colors correctly, elements overlap, animations fire incorrectly
- The pattern library approach is correct architecturally; the CSS/JS implementation in each pattern renderer needs a complete rewrite with proper design
- This requires a dedicated session with a clear visual spec for each pattern

**Plan for next session:**
- Start from renderer.ts only -- the pipeline (types, scriptGenerator, storage, routes) is all correct
- Rewrite each pattern renderer as proper self-contained HTML with dark theme, colored boxes, smooth CSS animations
- Test one pattern (array_sort) completely before building others
- Use the 26-pattern taxonomy (array_sort through state_machine) already defined

#### Content Refinement
- Text refinement (paste text → AI refines)
- PPT refinement (upload .pptx → AI refines preserving appearance)

---

## 8. Content Architecture

### Current Approach (TEXT-BASED)
- Syllabus PDF → Gemini Flash extracts → structured DB tables
- `subject_content.content` auto-reconstructed from structured data, used in all AI prompts
- No chunking/pgvector for chat — full syllabus fits in context
- Semantic cache prevents repeated API calls

### Seeded Content
- CSE Sem 1–4: 22 subjects, 127 modules, 96 COs
- CSE Sem 5–7: 30 subjects, 158 modules, 132 COs
- Total: 52 subjects, 285 modules, 228 COs across 7 semesters
- Caveat: CO-PO/PSO strengths for Sem 1–4 have column alignment issue. Sem 5–7 electives missing CO-PO/PSO mappings. Fix via superadmin UI before accreditation use.

---

## 9. Semantic Cache Architecture

- Cosine similarity in JS loop, NEVER `.rpc()` (PostgREST truncates 3072-dim vectors)
- Threshold: 0.90, scoped by subject_id + module_id
- `shouldBypassCache()` handles numerical/personal/pasted queries

---

## 10. PPT Generation Pipeline

### Architecture (3-route split for Vercel 60s timeout)
outline → batch (5 slides/batch, 1 for diagrams) → build

### Checkpoint / Resume
The outline route now inserts a `generated_content` row immediately on success (`status: 'outline_done'`) and checkpoints status through `outline_done → generating_content → generating_diagrams → building → completed`. An interrupted generation (tab close, network drop) leaves a resumable record. The generate page surfaces it on mount via `GET /api/generate/ppt/resumable`. A stale-job cron marks abandoned rows (`status: 'abandoned'` after 20 min of no progress).

New API routes supporting this:
- `POST /api/generate/ppt/checkpoint/[contentId]` — batch writes checkpoint state
- `GET /api/generate/ppt/resumable` — surfaces most recent non-terminal row
- `GET /api/generate/ppt/history` — list of completed decks
- `GET /api/generate/ppt/download/[contentId]` — signed download URL
- `GET /api/cron/abandon-stale-generations` — marks rows with `updated_at` > 20 min ago as `abandoned` (threshold = 20 min, but cron schedule is `0 2 * * *` — once daily at 2am UTC; defense-in-depth only, not a real-time sweeper)

The `generated_content_updated_at` trigger (defined in `20260207000000_initial_schema.sql`) bumps `updated_at` on every checkpoint write, so an actively progressing generation never trips the staleness check. The generate page's `_components/MyGenerationsList.tsx` renders history rows including abandoned-status UI.

### Slide types and diagram routing
Outline schema now includes `dual_visual` slide type (metaphor image + SVG side-by-side) and `diagramComplexity: "standard" | "intricate"` field. These drive the complexity-based model routing described in §3. The outline call uses `responseSchema` to guarantee parseable JSON — the old line-by-line fallback parser is removed (it silently dropped `renderHint`, `diagramComplexity`, and `dual_visual` fields whenever it fired).

### PPT Refinement Pipeline
```
Faculty uploads .pptx
  → POST /api/ppt-refine/extract (maxDuration: 60)
    → adm-zip unzips, fast-xml-parser reads slides
    → Gemini Flash detects topic + level (ppt_extract task)
    → Returns ExtractedDeck + stores original .pptx in Supabase Storage
  → POST /api/ppt-refine/refine (maxDuration: 300)
    → refineDeck(): Flash batches of 5 slides in parallel (ppt_refine task)
    → assemblePptx(): XML-patch approach
      - Existing slides: surgical <a:t> text node replacement ONLY
      - NEVER touches <p:pic>, <p:graphicFrame>, <p:grpSp>, <a:rPr>
      - Empty title placeholders: INSERT text instead of replacing
      - <a:normAutofit/> on all body/title txBody
      - New slides: explicit font sizes (no inherited sizing)
    → Upload refined .pptx to Supabase Storage, return signed URL
```

**PPT refinement issues resolved:**
- HTML tags (`<b>`, `<i>`, `<strong>`, `<em>` + generic tags): `stripHtml()` in `refiner.ts` (post-parse, sanitizes every `refined_title`/`refined_body` string) and `assembler.ts` (pre-XML-encode) — fixed
- Empty title placeholder INSERT: `assemblePptx` injects text into originally-empty title placeholders (Bug 2 comment, line ~395 of assembler.ts) — fixed
- Body overflow: two-layer fix — Bug 4 shrinks the body shape's `cy` when an image element sits inside the body box (prevents text rendering behind images); Bug 5 adds `<a:normAutofit/>` so text that still overflows auto-shrinks — fixed

---

## 11. Q Bank Architecture

### Generation
- Slots: {question_type, marks, count, module_id?, co_code?, btl_level?, difficulty?, style}
- Concurrency window of 5 Flash calls
- PYQ-inspired: same concept, different values/context/framing (NOT identical)
- Max 60 questions per request

### Import
- CSV: RFC-4180 compliant (papaparse not installed — hand-rolled parser)
- Required columns: question_text, marks, question_type
- Optional: model_answer, option_a–d, correct_option, co_code, btl_level, module_name, difficulty
- is_verified=true only when faculty provided BOTH co_code AND btl_level

### Q Paper Integration
- Staging area → Q paper builder: `qbank/page.tsx` writes staged question IDs to `sessionStorage`; `qpaper/page.tsx` reads them on mount (hydrates as `preferredQuestionIds`). **Handoff is wired.**
- "Bank" source in mix: per-slot module/CO/BTL targeting (`bankFill.ts`), preferred IDs placed first
- Order: is_verified DESC, usage_count ASC, RANDOM()
- Dedup via shared used_ids set, fallback to AI for unfilled slots
- Unplaceable preferred questions: returned in API response as `unplaceablePreferred[]`, surfaced to faculty in UI (not silently dropped)

---

## 12. Question Paper Generation System

### Sourcing Mix (replaces old 4-button exclusive modes)
Faculty sets percentage weights for three source categories:
- **fresh** — pure AI generation from syllabus
- **pyq_style** — AI with PYQ style reference (same concept, different values — NOT identical)
- **bank** — draw from `faculty_question_bank`; AI fills any gaps

`allocateSlotSources(totalSlots, mix)` in `sourcing.ts` deterministically apportions slots via Hamilton largest-remainder method (no run-to-run drift). PYQ structured RAG is always fed regardless of mix percentages.

### Question Block Types
- `descriptive` — standard essay/problem question
- `descriptive_with_or` — main question + OR alternative; split by `is_or_alternative` flag
- `attempt_any_one` — answer one of two alternatives
- `mcq` — single multiple-choice block
- `pool` — N items (any mix of mcq/true_false/short_answer/long/numerical/fill_blank), student attempts K; `marksPerItem` shared; True/False is an MCQ variant (`isPoolItemMcqLike`)

Template composition (defined at structure-stage) is authoritative over AI-returned item types for pool blocks.

### Key rules
- Module assignment computed in code (moduleAssignment.ts) — AI never picks modules
- BTL achievability capped by module weightage share — not treated as binary
- Section-relative slot keys Q1–Q4 per section
- CO normalization: "CO1", "CO 1", "01", "co1" all → "01"
- `answer_key_descriptive` task added to `isStructuredTask` allowlist — prevents Flash thinking from silently truncating answer JSON

---

## 13. RLS Architecture

RLS enabled on all tables. `get_my_role()` SECURITY DEFINER function prevents recursion.

```sql
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;
```

All API routes use `createAdminClient()` (service role, bypasses RLS). RLS only affects browser client calls.

---

## 14. Animated Explainer Architecture (For Next Session)

### Pipeline (correct, do not change)
```
generateExplainerContent(request, subjectContext)
  ├── ideateExplainer()
  │   → routeAI('explainer_ideate') — Flash, maxTokens 8192, thinkingBudget: 2048
  │   → Output: pedagogical narrative (natural language, professor-style)
  │   → "Stand at the whiteboard and explain this to confused students"
  │
  └── extractStructuredContent(narrative)
      → routeAI('explainer_extract') — Pro, maxTokens 16384, responseSchema, thinkingBudget: 0
      → Output: ExtractedContent JSON (pattern classification + full pattern data)
      → Direct JSON.parse() — responseSchema guarantees valid JSON
```

### Content type taxonomy (26 patterns, 8 built first)
**Priority 8 (build first):** array_sort, graph_algorithm, formula_derivation, concept_analogy, comparison_table, process_flow, tree_traversal, cause_effect_chain

**Remaining 18 (add later):** array_search, stack_queue_ops, dp_table, definition_with_example, hierarchy_structure, state_machine, mathematical_proof, statistical_distribution, matrix_operation, chemical_reaction, circuit_diagram, force_diagram, signal_waveform, financial_flow, market_mechanism, business_process, lifecycle_cycle, system_architecture

### Renderer approach (what to build next session)
Each pattern = self-contained HTML/CSS/JS module. Dark theme (#0F172A bg). No external deps.

For array_sort specifically (the quality signal test):
- Large colored boxes (72×72px, rounded, bold number centered)
- Boxes physically swap positions (CSS left transition with bounce easing)
- Color semantics: blue=default, yellow=comparing, green=sorted, purple=merged
- The swap animation must feel satisfying — this is the "aha moment"

### Design system (all patterns use this)
```
--bg: #0F172A          canvas background
--surface: #1E293B     element background  
--text: #F1F5F9        primary text
--color-default: #3B82F6
--color-active: #F59E0B
--color-success: #10B981
--color-error: #EF4444
--color-merged: #8B5CF6
Font: Inter from Google Fonts
Canvas: 960px wide, 16:9, dark bg, caption bar below
```

---

## 15. Placement Module (Agentic Rebuild — COMPLETE)

### What's built (June 2026 session)

Full placement operating system. All routes live, all pages deployed. Tested end-to-end at PPSU on Test Student account.

### DB Tables (all with RLS)
- `schools` — discipline_type enum (engineering/commerce/science/architecture/management/pharmacy/law), PPSU SoE seeded
- `student_placement_profiles` — spine of entire module. Stores readiness scores (5 dimensions + overall), resume_data (JSONB), resume_completeness, setup_complete, primary_target, dream_companies, cgpa, backlogs, prep_streak_days, last_active_date
- `placement_company_profiles` — 8 mass recruiters seeded with full OA pattern JSONB, rounds, eligibility, difficulty_band
- `placement_drives` — upcoming drives with date, eligibility
- `placement_question_bank` — AI-generated MCQs, tracks times_served, times_correct, quality_score. 30-day per-student exclusion via placement_question_attempts
- `placement_question_attempts` — per-student per-question history
- `placement_topic_mastery` — per-student per-topic accuracy, sessions_count, current_difficulty (adaptive: easy→medium→hard)

### Key architectural decisions
- Bank-first question serving: check bank for ≥6 unseen questions first, generate via Gemini only on miss. Generated questions saved to bank immediately.
- 30-day question exclusion per student (placement_question_attempts lookup before bank query)
- Adaptive difficulty: promote after ≥70% accuracy AND ≥10 attempts AND ≥2 sessions. Demote after <40% AND ≥5 attempts.
- Readiness scores recomputed after every submit session via weighted average of topic mastery across all topics in that track
- No "selection probability" language anywhere — use readiness, preparedness, fit level
- No red color for performance indicators — use amber
- responseSchema on all Gemini calls, never duplicate schema in prompt text (Google official constraint)
- Task: placement_prep (Flash, maxTokens 4000, thinkingBudget 0)

### Routes

Student pages:
- /student/placement → readiness dashboard (ring, breakdown bars, company fit cards, focus zones, today's focus, upcoming drives)
- /student/placement/setup → 3-step onboarding
- /student/placement/companies → company intelligence browse
- /student/placement/companies/[slug] → company deep-dive
- /student/placement/prep/[track] → track hub with mastery display
  tracks: aptitude | verbal | domain | communication
- /student/placement/prep/[track]/practice → drill page
  Full UX: bidirectional nav, skip, per-Q timer, early exit, session persistence (sessionStorage), tab detection, end-of-session review, answer reveal, adaptive difficulty
- /student/placement/jd-analyzer → JD analysis with syllabus mapping, sessionStorage persistence, recommended next steps linking to specific practice topics, ?from=jd-analyzer back-link
- /student/placement/resume → resume builder with ATS scoring, bullet rewriter (inline ghost text, 3 variants), PDF + Word export
- /student/placement/projects → mini-project guides (static)
- /student/placement/projects/[id] → project detail with step guide
- /student/placement/interview → interview prep bank

Faculty/TPO pages:
- /faculty/placement-dashboard → TPO dashboard with batch readiness, dimension breakdown, student table (sortable), CSV export, upcoming drives, weakest area callout

API routes:
- GET+POST /api/placement/profile
- GET /api/placement/companies
- GET /api/placement/companies/[slug]
- POST /api/placement/prep/generate (bank-first, Gemini fallback, client-side retry on 500/503)
- POST /api/placement/prep/submit (hardened: allSettled, non-fatal inserts, mastery upsert, readiness recompute)
- GET /api/placement/prep/mastery
- POST /api/placement/jd-analyze
- GET+POST /api/placement/resume
- POST /api/placement/resume/ats
- POST /api/placement/resume/rewrite-bullet
- POST /api/placement/resume/export/pdf (@react-pdf/renderer)
- POST /api/placement/resume/export/docx (docx library)
- POST /api/placement/interview/evaluate
- GET /api/placement/tpo/dashboard

### Lib files
- src/types/placement.ts — all placement types
- src/lib/placement/readiness.ts — computeCompanyFit, recomputeOverall, readinessLabel, readinessColorClass, readinessBgClass, isDriveEligible
- src/lib/placement/mini-projects.ts — static MiniProject[] catalog, 4 CSE projects seeded
- src/lib/placement/interview-prep.ts — static InterviewQuestion[] bank, 11 questions seeded across HR + Technical rounds

### Mass recruiter focus (CRITICAL)
70-80% of Indian campus placements are TCS/Infosys/Wipro/Cognizant/Capgemini/Accenture. The system is optimized for: aptitude intensity, verbal intensity, OA patterns, elimination logic, speed, pseudo-coding, communication, consistency. NOT elite DSA. Product company track is opt-in, not default.

### New dependencies added this session
- @react-pdf/renderer (resume PDF export)

### Known remaining items
- Resume builder PDF export needs visual QA (not tested end-to-end)
- Resume Word export needs visual QA
- Mini-project guides: only 4 CSE projects. Commerce/Architecture projects not yet authored.
- Interview prep bank: 11 questions. Expand to 30+ in a future session.
- TPO dashboard: tested with Test Student only. Needs real batch data.
- Placement Agent (Gemini function-calling) — Tier 4, not built yet
- Company Arrival Mode (drive countdown auto-shift) — partially implemented via upcoming drives section, not full arrival mode yet

---

## 16. Active Feature Roadmap

### Recently Shipped (June 2026)
- CSE Sem 1–7 fully seeded (52 subjects, 285 modules, 228 COs)
- RLS fully enabled, 5-tier role hierarchy (superadmin/dean/hod/faculty/student)
- Dean/HOD as first-class roles — all 30 faculty-tier API routes updated
- PPT Refinement — full pipeline with XML patching; HTML-tag stripping, empty-title INSERT, and normAutofit overflow fix all shipped
- PPT Generation — checkpoint/resume pipeline; dual_visual slide type; complexity-based diagram routing (Flash vs Pro per intricacy); outline now uses responseSchema (old fallback parser removed)
- Q Bank — bulk generation, CSV/TXT import, Q paper integration; sessionStorage handoff to Q paper builder wired
- Q paper — six-stage builder (split from monolith into _components/); percentage-mix sourcing allocator; BTL-tier presets + Custom mode; mixed question pool blocks; CO/BTL validation pass; `<RichQuestionText>` markdown-lite rendering; draft autosave/resume (`qpaper_drafts`); paper history page (`qpaper_history`); answer key Word export wired; answer key `isStructuredTask` allowlist fix; Q3 OR/main split fixed; DB constraint for 'answer_key' type fixed; pool items answered in answer key
- Dynamic token budgeting — `tokenBudget.ts` with `estimateMaxOutputTokens()` replacing hardcoded maxTokens across qpaper/qbank/answer-key
- Template scope column — qpaper_templates now support personal/school/department scope
- Animated Explainers infrastructure (pipeline + storage + routes built; UI under development)

### Priority Order (current)

**Tier 1 — Fix before showing anyone (quick wins):**
1. Q paper flat-layout web preview (ReviewAndValidateStage doesn't honor `flatLayout` — PDF/Word do)
2. Per-option-marks cosmetic divergence in web preview vs PDF/Word
3. Answer-key PDF spacing tighter than student paper
4. Template save-but-no-browse/load gap (TemplateStructureStage has no "load a saved template" UI)
5. Resume builder PDF/Word export QA
6. Expand interview prep bank to 30+ questions
7. Test TPO dashboard with real student batch

**Tier 2 — Depth at PPSU:**
9. Q bank UX simplification (too many steps for daily faculty use)

**Tier 3 — High institutional value:**
10. NAAC auto-report generator (Criterion 2 from existing data — changes Dean's buying decision)
11. Animated explainer renderer rewrite (dedicated session, start with array_sort pattern)

**Tier 4 — Agentic placement (after foundation):**
12. Placement Agent (Gemini function-calling, multi-turn)
13. Company Arrival Mode (full drive countdown auto-shift)
14. Commerce/Architecture mini-project guides

**Tier 5 — Growth:**
15. Dean/HOD provisioning UI, JD Gap Analysis, Credential Passport, Mock Interview, Multi-tenant

---

## 17. Known Issues

| Issue | Status | Fix |
|---|---|---|
| Flash cost shows ₹0.0000 in PPT log | Active | Wire totalFlashCost from routeAI in build route |
| Supabase India ISP DNS block | Ongoing | Cloudflare DNS or WARP VPN |
| Supabase free tier pauses after 1 week | Ongoing | Keep active before demos |
| Email confirmation disabled | Active | Re-enable before go-live |
| Q paper flat-layout web preview | Active | ReviewAndValidateStage ignores flatLayout; PDF/Word correct |
| Per-option-marks cosmetic divergence | Active | Web preview vs PDF/Word rendering differs |
| Answer-key PDF spacing tighter than student paper | Active | Cosmetic — tighten PDF builder spacing |
| Template save-but-no-browse/load gap | Active | TemplateStructureStage has no "load saved template" UI |
| Q bank UX too complex | Active | Simplification needed |
| CO-PO/PSO column alignment Sem 1–4 | Active | Fix via superadmin UI before accreditation |
| CO-PO/PSO missing Sem 5–7 electives | Active | Add via superadmin UI before accreditation |
| Animated explainer visuals broken | Shelved | Full renderer rewrite in dedicated session |

---

## 18. Architectural Decisions (DO NOT CHANGE)

| Decision | Reason |
|---|---|
| `proxy.ts` for auth, NOT `middleware.ts` | Next.js 16 specific |
| Layout files are PURE UI — zero auth checks | Prevents redirect loops |
| `supabase-browser.ts` → client components ONLY | Server import crashes client |
| `supabase-server.ts` → server + API routes ONLY | Client import crashes server |
| Cosine similarity in JS loop, NEVER `.rpc()` | PostgREST silently truncates 3072-dim vectors |
| `thinkingBudget: 0` for all JSON tasks | Thinking tokens consume maxOutputTokens on Flash |
| PPT dims: 10" × 5.625" | Anything else causes overflow/scaling bugs |
| PPT split into 3 routes | Vercel 60s timeout |
| Diagram batches: 1 slide per request | Prevents SVG token truncation |
| Content batches: 5 slides per request | Prevents Flash truncation |
| srcDoc for interactive viz | Blob URLs break due to React re-render |
| PYQ via Gemini Flash direct | LlamaParse returns raw text; Flash extracts structured data |
| Section-relative slot keys Q1–Q4 | Prevents Section II naming mismatch |
| Module assignment computed in code | Guarantees weightage compliance, AI never picks modules |
| Pro model maxOutputTokens always 32768 in gemini.ts | These are two different layers, not contradictory: `estimateMaxOutputTokens()` in tokenBudget.ts produces a value ≤ 24000 (its CEILING) and is passed as the per-call `maxTokens` param. For Flash tasks (qbank_generate, answer_key_mcq) that computed value IS what Gemini uses. For Pro tasks (answer_key_descriptive, qpaper_gen) gemini.ts ignores the passed `maxTokens` and always uses 32768 — the dynamic budget only materially constrains Flash calls. |
| `answer_key_descriptive` in isStructuredTask | Flash Pro-escalation path: if Flash is used, thinkingBudget 0 prevents truncation; Pro overrides maxTokens to 32768 anyway |
| Hamilton apportionment for sourcing mix | Guarantees per-run determinism; random sampling drifts from the configured % |
| adm-zip NOT unzipper | Turbopack build failure with unzipper |
| XML patching for PPT refinement | Round-trip parse/rebuild re-encodes nodes, breaks PowerPoint |
| get_my_role() SECURITY DEFINER for RLS | Breaks profiles→profiles recursion |
| Faculty access via faculty_assignments only | Cross-school teaching support |
| subject_content.created_by nullable | Seeded data has no creating user |
| responseSchema on structured AI calls | Guarantees valid JSON, eliminates parse retry loops |
| thinkingBudget: 2048 for explainer_ideate | Caps thinking, reserves ~6k tokens for narrative output |
| Explainer renderer = pattern library | AI classifies content type, code renders it -- not AI specifying pixel coords |
| markdownLite not a full Markdown parser | Only the constructs Gemini actually leaks (pipe tables, bold, code, bullets) — a full parser would add complexity with no benefit |
| qpaper_history stores Storage paths not URLs | Signed URLs expire; paths are stable — re-sign on demand for confidential answer key |
| qpaper_drafts: no dean/hod read | Drafts are private scratch state, not a reviewable artifact — nothing to oversee until finalized |
| Template `scope` column (personal/school/dept) | Enables future cross-subject template sharing without a separate table |

---

## 19. Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
PRIMARY_AI_PROVIDER=gemini
LLAMA_CLOUD_API_KEY=
GOOGLE_CLOUD_TTS_KEY=          # Optional — for animated explainer voiceover
```

---

## 20. External / Non-Technical Context

**Competitive positioning:** Not ChatGPT for students (no syllabus lock). Not Redrob or Connect AI (generic aptitude, no syllabus context). EduNexus is the institutional layer — Dean buys for accreditation, placement outcomes, faculty time savings.

**What closes university deals:**
1. NAAC report generation from platform data — regulatory infrastructure, not productivity tool
2. Placement outcome data showing measurable improvement
3. Faculty time savings on PPT + Q paper generation
4. Peer reference from enthusiastic PPSU faculty/HOD

---

## 21. How Dhruv Works (Development Patterns)

1. Cursor-primary workflow — runs prompts, shares logs/screenshots, Claude verifies, iterates
2. Simplicity over complexity — rejects solutions that add layers without solving root problem
3. Generic over hardcoded — fixes must be domain-agnostic
4. Surgical changes preferred — targeted single-file edits
5. Cost-consciousness — API cost is an active architecture concern
6. No pilot/phase distinctions — everything is production-ready from the start
7. Verification loop — exact logs and screenshots after each change
8. Honest assessments — not confirmation
9. Communication style — terse and directive

---

## 22. How to Start Working

```
I am building EduNexus AI, a university AI tutor + institutional intelligence platform.
Solo developer (Dhruv), using Cursor + Claude Code.
Live at: edu-nexus-ai-two.vercel.app

Next task: [FEATURE NAME]
Full context: [paste this file]

Working approach: Give me Cursor prompts per part. I run them, share
logs/screenshots, you verify before proceeding.
```

**Key rules when working:**
- Always read CLAUDE_CONTEXT.md before responding
- Check Section 18 (architectural decisions) before suggesting changes
- Provide targeted Cursor prompts, not full file rewrites
- `thinkingBudget: 0` for any structured JSON task
- Never use `.rpc()` for cosine similarity — always JS loop
- PPT dimensions are 10" × 5.625" — never change
- `department = "Engineering"` for all rows — filter by `branch` only
- Section-relative slot keys Q1–Q4 per section
- Module assignment for Q paper is code-computed — never AI
- adm-zip not unzipper for PPTX parsing
- XML patching not round-trip parse/rebuild for PPT refinement
- `get_my_role()` must exist in DB before any RLS work
- Faculty access follows `faculty_assignments`, not school hierarchy
- `responseSchema` on all structured AI calls — eliminates parse retry loops
- Explainer renderer = pattern library, not AI-specified coordinates
- `answer_key_descriptive` task must stay in `isStructuredTask` list in gemini.ts
- Pro model in gemini.ts always gets `maxOutputTokens: 32768` — dynamic budget from `tokenBudget.ts` only constrains Flash calls
- `qpaper_history` stores Storage paths, not URLs — never store signed URLs in DB
- `ppt_diagram` model is complexity-based (Flash/Pro per `routeDiagramBatchModel`) — not a blanket Pro rule