# EduNexus AI — Complete Project Context

*Last updated: July 9, 2026 | Solo developer: Dhruv | Stack: Next.js 16 + Supabase + Gemini*
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
| Math (screen) | KaTeX + mhchem via remark-math/rehype-katex (shared with chat) |
| Math (print/export) | MathJax → self-contained SVG → sharp → PNG @ 300 DPI (katexRender.ts, server-only) |
| PDF Parsing | LlamaParse (notes/syllabus), Gemini Flash (PYQ structured extraction) |
| Deployment | Vercel (with vercel.json timeout configs) |
| Dev tools | Cursor Pro chat (targeted single-file changes), Claude Code (multi-file architectural work) |

---

## 3. AI Model Routing (`src/lib/ai/router.ts`)

```typescript
const TASK_TO_MODEL = {
  chat: "flash",                   // maxTokens: 16384
  chat_reasoning: "pro",           // maxTokens: 32768 — deeper multi-step chat answers
  chat_research: "flash",          // maxTokens: 16384 — search-grounded; routed via chatWithSearch()
  chat_viz_classify: "flash",      // maxTokens: 512, thinkingBudget 0, responseSchema — Visualize call 1
  chat_visualize: "pro",           // maxTokens 16384 (see Pro note) — interactive srcDoc HTML
  chat_viz_diagram: "flash",       // maxTokens: 4096, thinkingBudget 0, responseSchema — Mermaid source
  chat_viz_plot: "pro",            // maxTokens 8192 (see Pro note) — computed-plot HTML
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
  module_co_classify: "flash",     // module→CO mapping classifier
  qbank_image_question: "flash",   // image→question AI draft generation
}
```

**`ppt_diagram` model routing (complexity-based, NOT a blanket Pro rule):**
`routeDiagramModel(slide)` in router.ts decides per-slide:
- `mermaid` → always Flash (terse structured markup, Pro buys nothing)
- `imagen` / `illustration` → always Flash (text model only writes a prompt)
- `svg` / `dual` or absent hint → Flash if `diagramComplexity === "standard"`, Pro if `"intricate"`

`routeDiagramBatchModel(slides[])` takes Pro if ANY slide in the batch needs Pro. The batch route sets `maxTokens: 8192` explicitly for every diagram batch regardless of model choice.

**Chat Visualize routing — `VIZ_REGISTRY` in `src/lib/ai/vizPrompts.ts`:**
The Visualize button is a two-call pipeline, NOT a chat turn (§9A). Call 1
(`chat_viz_classify`) returns `vizType: interactive | diagram | plot`; call 2 is
looked up in `VIZ_REGISTRY[vizType] → { task, payloadKind, buildPrompt }`. The route
never switches on `vizType` itself, so a fourth type (`illustration` → Imagen, the
designed-for slot) is one registry entry + one prompt builder, with no route change.
This is the same per-content-type table pattern as `routeDiagramModel` above — when
adding a content type, extend the table, never add a branch at the call site.

The taxonomy is deliberately split across two modules **by runtime, not by concern**:
`vizTypes.ts` (VIZ_TYPES, VizClassification, loading copy, labels) is client-safe and
imported by the browser panel; `vizPrompts.ts` (prompts, the worked example,
VIZ_REGISTRY) is server-only. Importing the latter into a client component would ship
every prompt and the ~85-line worked example into the page bundle — a payload cost and
a prompt-leak. Keep new prompt text out of `vizTypes.ts`.

**Pro `maxTokens` note:** `chat_visualize` / `chat_viz_plot` declare 16384 / 8192, but
gemini.ts pins Pro to 32768 and ignores them (see the Pro row in §19). The declared
values are recorded intent and DO bind if either task ever falls back to Flash. The
effective limit on Pro is the prompt-level `VIZ_SIZE_CONTRACT` (250 lines) — verified
holding at 2834 max output tokens against an 8k watch threshold (Jul 2026).

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
- `module_co_mapping`: id, module_id, co_code, confidence, source ('ai_classified'/'faculty_verified'), created_at — AI-inferred module→CO assignments, faculty-editable via `/faculty/syllabus`; RLS: public read, faculty write (own assigned subjects)

### Q Paper Tables
- `qpaper_templates`: id, subject_id (nullable), created_by, name, is_default, university_name, exam_title, duration_minutes, total_marks, instructions text[], structure jsonb, **scope** text ('personal'/'school'/'department', default 'personal'), **is_snapshot** bool (true on pre-generation auto-saves, excluded from browse list), **is_preset** bool (true on built-in ESE Standard/Quiz/Custom, seeded once globally at scope='school') — 4 RLS policies cover personal + shared read/write
- `pyq_questions`: id, document_id, subject_id, section_name, q_number, question_text, question_type, marks, co, btl, po, options jsonb, year
- `qpaper_drafts`: id, faculty_id, subject_id, label, builder_state jsonb, generation_status ('idle'/'generating'/'complete'/'failed'), last_saved_at, created_at — faculty-private autosave scratch state (RLS: own + superadmin only; dean/hod intentionally excluded)
- `qpaper_history`: id, faculty_id, subject_id, label, total_marks, structure_summary jsonb, pdf_path, docx_path, answer_key_path, created_at — finalized papers; paths are Storage paths (not URLs). RLS: own OR superadmin/dean/hod (oversight-visible)

### Q Bank Table
- `faculty_question_bank`: id, subject_id, faculty_id, module_id, question_text, question_type (mcq/short_answer/long_answer/numerical/fill_blank), marks, model_answer, options jsonb, co_code, btl_level (1–6), po_codes text[], difficulty (easy/medium/hard), source (ai_generated/faculty_imported/pyq_inspired), is_verified bool, usage_count, last_used_at, created_at, updated_at, **image_path** (nullable, faculty-uploaded image stored in `question-images` Storage bucket)

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
│   │   │   │   │   ├── ScopeAndDifficultyStage.tsx ← stage 2: module selection + BTL range + CO%/Difficulty% distribution
│   │   │   │   │   ├── SourcingStage.tsx           ← stage 3: Fresh/PYQ-style/Bank % mix
│   │   │   │   │   ├── BuilderSectionsEditor.tsx   ← stage 4: drag-drop section builder
│   │   │   │   │   ├── ReviewAndValidateStage.tsx  ← stage 5: review + CO/BTL validation
│   │   │   │   │   ├── FinalizeExportStage.tsx     ← stage 6: generate + export + history
│   │   │   │   │   ├── shared.tsx                  ← shared types + helpers
│   │   │   │   │   ├── useQpaperDraft.ts           ← autosave/resume hook (qpaper_drafts)
│   │   │   │   │   ├── NumericField.tsx            ← clamped numeric input (BTL range, CO%, difficulty%)
│   │   │   │   │   ├── GeneratingView.tsx          ← full-page spinner + cycling hints (generating state)
│   │   │   │   │   └── DoneView.tsx                ← full-width result view + sticky action bar
│   │   │   │   └── history/                        ✅ Re-downloadable finalized papers
│   │   │   ├── qbank/                              ✅ Q bank
│   │   │   │   └── _components/ReviewFlowDialog.tsx ✅ card-by-card verify review dialog
│   │   │   ├── syllabus/                           ✅ faculty syllabus viewer with AI CO mapping display + editing
│   │   │   ├── explainer/                          ⚠️  UNDER DEVELOPMENT (UI shows placeholder)
│   │   │   ├── refine/                             ✅ Content Refinement Tab — PPT Refinement + Text Refinement sub-tabs (§10)
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
│   │       ├── qbank/add-manual/                   ✅ manual question entry + optional image upload
│   │       ├── qbank/draft-image/                  ✅ image→AI draft generation (separate from commit)
│   │       ├── admin/classify-module-co/           ✅ batch CO classification trigger (superadmin/dept_admin)
│   │       ├── syllabus/module-co-mapping/         ✅ GET/PATCH for faculty CO mapping edits
│   │       ├── ppt-refine/extract/ + refine/ + refine-slide/ ✅ refine-slide = single-slide chat
│   │       ├── refine/                             ✅ Text Refinement tab backend
│   │       ├── explainer/generate/ + list/ + [id]/ ✅ (routes exist, UI under development)
│   │       ├── placement/generate/ + submit/ + export/ ✅
│   │       └── placement/practice/generate/ + submit/ + export/ ✅
│   ├── components/ui/ + layout/ + chat/ + ppt/ + ErrorBoundary.tsx ✅
│   ├── components/layout/FacultyShell.tsx           ✅ collapsible faculty nav shell
│   ├── components/RichQuestionText.tsx             ✅ renders AI question text (table/list/bold via markdownLite + KaTeX/mhchem math, incl. MCQ options)
│   ├── components/MathToolbar.tsx + MathTextarea.tsx ✅ cursor-insert worked-example snippets + live KaTeX preview; collapsible
│   ├── components/refine/SlideChatConsole.tsx      ✅ shared chat UI — both refine surfaces, presentation-only (§10)
│   ├── hooks/useSupabaseData.ts                    ✅
│   └── lib/
│       ├── ai/providers/types.ts + gemini.ts       ✅ (responseSchema + thinkingBudget added to ChatParams)
│       ├── ai/router.ts + prompts.ts + imagen.ts   ✅ (routeDiagramModel + routeDiagramBatchModel added)
│       ├── ai/tokenBudget.ts                       ✅ estimateMaxOutputTokens() — dynamic maxTokens for qpaper/qbank/answer-key
│       ├── api/helpers.ts                          ✅
│       ├── db/supabase-browser.ts + server.ts + types.ts ✅
│       ├── pdf/builder.ts                          ✅
│       ├── ppt/generator.ts + pptMath.ts           ✅ (pptMath: LaTeX→PNG rasterization for slide text)
│       ├── ppt-refine/types.ts + extractor.ts + refiner.ts + assembler.ts ✅ (§10)
│       │   + visual-raster.ts + slide-size.ts                                          ✅
│       ├── qbank/types.ts + tagger.ts + generator.ts + parser.ts + row.ts ✅
│       ├── qbank/image-storage.ts                  ✅ uploadQuestionImage, createQuestionImageSignedUrl, downloadQuestionImage
│       ├── explainer/                              ⚠️ PARTIALLY BUILT — see §15 for status
│       │   ├── types.ts                            ← ExtractedContent + 14 PatternData types
│       │   ├── scriptGenerator.ts                  ← two-call: ideate (Flash+thinking) → extract (Pro+responseSchema)
│       │   ├── renderer.ts                         ← pattern-based renderers (8 patterns, UNDER DEVELOPMENT)
│       │   ├── tts.ts                              ← Google Cloud TTS (optional)
│       │   └── storage.ts                          ← short-code alloc + HTML upload/stream
│       ├── text/markdownLite.ts                    ✅ parseMarkdownLite() — pipe-table/list/bold/code parser for AI text
│       ├── text/katexRender.ts                     ✅ server-only; MathJax→SVG→sharp→PNG @300DPI (renderLatexToImage, shouldRenderInline)
│       ├── text/latexSegments.ts                   ✅ client-safe; extractLatexSegments, hasLatex, findUnsupportedNotation, MATH_CHEM_NOTATION_GUIDE
│       ├── qpaper/generator.ts + sectionGen.ts + moduleAssignment.ts + answerKeyGen.ts ✅
│       │   + templates.ts + builder.ts + bankFill.ts + docxBuilder.ts                  ✅
│       │   + sourcing.ts (allocateSlotSources, Hamilton apportionment)                  ✅
│       │   + poolRender.ts (pool block rendering helpers)                               ✅
│       │   + validateTags.ts (validateQuestionTags — Flash CO/BTL judge; confidence field, auto-apply ≥90%) ✅
│       │   + moduleCoClassifier.ts (classifyModulesForSubject — dual-pass Flash CO classifier)     ✅
│       │   + qpaperImages.ts (loadPaperImages, attachQuestionImageUrls, imageDisplaySize)          ✅
│       │   + paperMath.ts (pre-render pass — dedupe+rasterize all unique math/chem spans once per paper) ✅
│       │   + archetypes.ts (subject-family classification for PYQ-archetype generation fallback)   ✅
│       ├── syllabus/types.ts + prompts.ts + parser.ts + reconstruct.ts ✅
│       ├── quiz/generator.ts                       ✅
│       ├── placement/generator.ts + bankManager.ts + fallbackSyllabus.ts + modules.ts ✅
│       ├── refine/generator.ts                     ✅ Text Refinement tab backend — unrelated to ppt-refine/*
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
│   ├── 20260625000000_generated_content_generation_status.sql ✅ applied — expands status enum for PPT checkpoint/resume
│   ├── 20260628000000_module_co_mapping.sql         ✅ applied — module_co_mapping table + RLS
│   ├── 20260628000000_qpaper_templates_personal_shared.sql ✅ applied — is_snapshot, is_preset, 4 RLS policies
│   ├── 20260628000000_question_images.sql          ✅ applied — image_path on faculty_question_bank + question-images bucket
│   └── 20260706000000_faculty_co_edit.sql           ✅ applied — faculty_verified source value + faculty write policy on module_co_mapping
├── supabase/seed_cse_sem1_4.sql                    ✅ 22 subjects Sem 1–4
├── supabase/seed_cse_sem5_7.sql                    ✅ 30 subjects Sem 5–7
├── vercel.json                                     ✅ maxDuration per route; all heavy generation routes also set memory: 1024
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

#### Content Refinement Tab (`/faculty/refine`)
Standalone tool, two independent sub-tabs sharing only page chrome. Full architecture in §10 — summary:

- **PPT Refinement tab:** faculty uploads an existing `.pptx` → extract → refine →
  assemble pipeline (XML-patched, not regenerated — preserves the original file's
  appearance byte-for-byte outside the patched text/visuals). Per-slide selection
  (default all-selected) drives either bulk option-based refinement (8 content toggles +
  Allow New Slides) across the selected slides, or — when exactly one slide is
  selected — a single-slide chat mode for targeted edits. AI-proposed visuals
  (SVG/Mermaid/Imagen) are rasterized and embedded into the exported file as real
  `<p:pic>` shapes, not preview-only. Text that doesn't fit even after auto-shrinking
  spills onto an appended continuation slide when Allow New Slides is on.
- **Text Refinement tab:** unrelated, much simpler pipeline — paste/select text
  (≤15,000 chars) → one of 5 refinement types → `POST /api/refine` → refined markdown
  back. No `.pptx` involved. This is the original (Feb 2026) content-refinement
  feature; functionally unchanged since.

Distinct from the **post-generation refine flow** (`/faculty/generate/refine/[contentId]`),
which edits a deck this product's own PPT generator just built — a different data model
(see §10: "regenerate from template" rather than "patch arbitrary bytes"). The two
surfaces share only the `SlideChatConsole` chat UI component.

#### Q Paper Generation
**Architecture:** Three-view state machine (form → generating → done), mirroring PPT gen.
- form view: two-column layout (setup sidebar + builder main area)
- generating view: full-page spinner + cycling hints, popstate blocked
- done view: full-width result with sticky action bar (Back to Setup, downloads)

**Stage components** (all under `_components/`):
TemplateStructureStage, ScopeAndDifficultyStage, SourcingStage,
BuilderSectionsEditor, ReviewAndValidateStage, DoneView, GeneratingView

**Question block types:** `descriptive`, `descriptive_with_or`, `attempt_any_one`, `mcq`, `pool` (mixed MCQ/True-False/descriptive items; student attempts K of N). True/False modeled as an MCQ variant (`isPoolItemMcqLike` = true).

**Three-axis allocation (replaces BTL-tier presets):**
- BTL range [min, max]: eligibility filter per slot, clamped to module's allowed levels
- CO% (paper-wide %): capacity-aware via module_co_mapping; tiebreaker bias in pickModule
  (5% sectionMarks threshold: weightage wins unconditionally outside it, CO breaks ties inside)
- Difficulty% (easy/medium/hard): Hamilton apportionment to slots, generation-time directive only
  (no pre-generation capacity modeling — mirrors Q Bank's existing treatment)
Old `DifficultyPreset`/`CustomBtlWeights` system retired from UI; machinery kept exported for
backward compat.

**Per-question module pinning:**
BuilderQuestion.pinnedModuleId: bypasses pickModule for that slot entirely.
PoolCompositionEntry.pinnedModuleId: all N items from that row use the pinned module.
Fallback to auto-assignment when pinned module not found in section modules.

**Smart CO filtering:** ScopeAndDifficultyStage shows only COs covered by selected modules
(from moduleCoMap); clears stale coTargetsPct entries when selection changes.

**CO achievability preview:** "X of N selected modules supply CO1" computed from
moduleCoMap in ScopeAndDifficultyStage. Fetched client-side from module_co_mapping
(public-read RLS).

**Validation (confidence-based):**
validateQuestionTags now returns confidence 1-100. Auto-applies corrections silently
when confidence ≥ 90 AND a suggestion exists (mutates unit.co/unit.btl before PDF build —
no rebuild needed). Lower confidence: flag shown as before.

**Per-subpart regeneration:** MCQ sub-items can be regenerated individually
(regenerateSubPart in ReviewAndValidateStage). Full question regeneration unchanged.

**Stale-PDF warning:** amber banner + "Download PDF (outdated)" label when
paperEditedSinceGeneration is true. Clears via onPdfUpdated callback after reExportPdf
succeeds. "Update PDF" button upgrades to visible outline button when stale.

**Templates (personal/shared):**
- is_snapshot: true on pre-generation auto-saves (no longer pollutes the browse list)
- is_preset: true on built-in ESE Standard/Quiz/Custom (seeded once globally, scope='school')
- scope: 'personal' | 'school' (not per-subject)
- Name uniqueness: personal = per-faculty; shared = platform-wide
- Browse dialog: search by name/creator, My Templates + Shared Templates sections
- Creator shown on shared templates; presets shown as "Built-in"
- is_owner computed server-side on every row for delete gating

**Past Papers (/faculty/qpaper/history):** functional — PDF/Word via public URL,
Answer Key via short-lived re-signed URL (/api/qpaper/history/answer-key-link).
History row written lazily on first download, updated on subsequent artifact downloads.
**Reopen for editing:** `qpaper_history.structure_summary` already stores the full
`BuilderSnapshot` (incl. `paper`) written at finalize — so no migration was needed to
make past papers resumable. Each row shows "Open & Edit" (gated on `structure_summary->paper`
present via an id-only filtered query — rows lacking it keep re-download-only, graceful,
not broken), deep-linking to `/faculty/qpaper?resumeHistory=<rowId>`. The builder hydrates
that row via the existing `applySnapshot`, lands in DoneView, and points `historyRowIdRef`
at the row so all in-place actions (inline edit, part/pool-item regen, validation flags,
answer-key generation, re-export) write back to the **same** row — no duplicate. Fresh
links are minted from stored paths (public PDF/Word URL; answer key re-signed) since the
snapshot's own URLs may be expired. Stale-PDF download is blocked behind an explicit
confirm (not silent), so faculty can't grade against outdated content.

**Draft system fully disabled in history-resume mode** (`useQpaperDraft({ disabled })`):
resuming from history must NOT create a `qpaper_drafts` row — a competing draft resurfaces
as a phantom "Resume your draft?" prompt and fights the history session. Instead, a
dedicated debounced autosave on `page.tsx` writes every edit straight back to the
`qpaper_history` row (`structure_summary` + `total_marks` + artifact paths + a `pdfDirty`
flag riding in the snapshot), so reopening the same paper later — even in a new session —
always shows the latest version. `pdfDirty` restores the stale-PDF warning across reloads.
`historyResumeId` is captured in a `useState` initializer AND reconciled in a mount effect
(the initializer returns null under SSR/hard-refresh, so the client re-reads the query
param before the async auth lookup resolves — keeping the draft hook disabled from the
first render).

**Delete past papers:** each history row has a trash action → `POST /api/qpaper/history/delete`
(requireRole faculty+oversight, ownership-checked), which removes the Storage objects
(pdf/docx/answer-key) *then* the row, so deletion actually reclaims bucket space rather
than orphaning files. Confirmation dialog + a header nudge encourage cleanup.

**History-resume architecture (July 2026):** reopening a finalized paper from `/faculty/qpaper/history` into the full review/edit UI demonstrates a complete pattern for session-specific persistence that avoids conflicts with the baseline draft system:
- Query param `?resumeHistory=<rowId>` triggers the resume flow.
- `historyResumeId` is captured in a `useState` initializer AND reconciled in a mount effect (SSR safety net: initializer returns null under server-render/refresh, so the client re-reads the query param before async auth resolves — keeping the draft hook disabled from first render).
- Draft hook is disabled via `{ disabled: true }` — no `qpaper_drafts` row can be created, so no phantom "Resume your draft?" prompt resurfaces.
- History-specific debounced autosave (1.5s window) writes every edit straight back to the `qpaper_history` row: `structure_summary` (the snapshot), `total_marks`, and newly-produced artifact paths (PDF, Word, answer key). A `pdfDirty` flag rides in the snapshot so the stale-PDF warning survives a reload if edits were made without re-exporting.
- Fresh links are minted from stored paths on resume (public PDF/Word via `getPublicUrl`, answer key re-signed on demand via `/api/qpaper/history/answer-key-link`), so expired signed URLs don't break reopens.
- All DoneView actions — inline edit, part/pool-item regen, validation flags, answer-key generation, re-export — operate on the resumed `paper` identically to fresh generation, writing back to the same row (no duplicate row created).
- Stale-PDF download is blocked behind an explicit `confirm()`, preventing silent downloads of outdated content.

**Key insight:** history-resume and draft-autosave can coexist via the disabled-hook pattern. This pattern is reusable if a future feature needs a different persistence backend (e.g., per-module chapter saves, collaborative editing).

**PDF fixes:** horizontal rules removed from MCQ/attempt-any-one/pool headers;
instruction text maxWidth clamp prevents marks-column overflow.

**Sourcing:** 3-category percentage mix (Fresh / PYQ-style / Bank), deterministic Hamilton apportionment via `allocateSlotSources()` in `sourcing.ts`; staged Q-Bank questions guaranteed via `preferredQuestionIds` (unplaceable ones surfaced to faculty, not silently dropped). PYQ structured RAG always fed regardless of mix percentages.

**Token budget:** `estimateMaxOutputTokens()` in `tokenBudget.ts` replaces hardcoded maxTokens across qpaper/qbank/answer-key calls. Separate calibration profiles for "generation" vs "answer_key".

**CO/BTL/PO tagging:** confirmed consistent across web preview (`ReviewAndValidateStage`), PDF (`builder.ts`), and Word (`docxBuilder.ts`) for all question types including pool blocks.

**Flat layout:** `flatLayout: true` on template (used by Quiz preset) flattens the section hierarchy in PDF and Word. **Known gap: web preview in ReviewAndValidateStage does not honor `flatLayout`.**

**Draft autosave/resume:** `useQpaperDraft.ts` hook writes to `qpaper_drafts` (faculty-private). Stores full builder state including any generated paper content. Resume-from-draft flow on page mount. **Pattern: can be disabled** via `{ disabled: true }` when another session is persisting state elsewhere — prevents competing writes and phantom resume prompts. Used in history-resume mode (see below).

**Paper history:** `qpaper_history` table (oversight-visible). Stores Storage paths (not URLs) for durable re-download. Populated on finalize; matching draft is deleted. **CRITICAL:** `structure_summary` jsonb column holds the full `BuilderSnapshot` (incl. `paper: AssembledPaper`, the generated question content) written at finalize — no migration needed to support history-resume, the data was always there. This is the single source of truth for a paper's full state.

**Answer key:** CONFIDENTIAL PDF + Word export. 6 parallel calls (`answer_key_mcq` Flash × 2, `answer_key_descriptive` Pro × 4). Both tasks are in `isStructuredTask` allowlist (prevents Flash thinking from consuming output budget). Pool questions decomposed to per-item Flash/Pro calls in `splitQuestionsForBlocks`.

#### Faculty Syllabus Viewer (/faculty/syllabus)
- Faculty view their subject's full syllabus (modules, content, weightage, BTL levels)
- AI-inferred CO mappings displayed per module with confidence color coding
  (high=green, medium=amber, low=red)
- Faculty can add/remove CO assignments for modules they're assigned to
- Changes persist to module_co_mapping with source='faculty_verified'
- Used by Q Paper generation for CO-aware module picking

#### Q Bank
- Per-subject persistent question library
- Generate: slot-based bulk generation (≤60 questions), Fresh + PYQ-Inspired styles
- Add Questions tab (replaces Import tab): three sub-modes:
  - CSV Import: RFC-4180 parser with AI auto-tagging for missing CO/BTL
  - Single: manual question entry form with optional image upload
  - Bulk Images: multi-file picker (≤20 images), per-card AI draft generation
    (image → AI writes question + tags), editable before commit, parallel per-card
- Image support (Phase 1+2): faculty-uploaded images stored in question-images bucket.
  AI reads image and writes question via Gemini multimodal (routeAI attachments[] path,
  NOT the @google/genai Imagen client). `suggested_type` returned by AI and applied when
  confidence warrants. Type selector unlocked after draft (not locked to "generating" status).
- Image support (Phase 3): images embedded in PDF (builder.ts), Word (docxBuilder.ts),
  web preview (ReviewAndValidateStage), and answer key PDF — all four surfaces use
  imageDisplaySize() from qpaperImages.ts for consistent sizing.
- My Bank: infinite scroll, full filters + text search (client-side, loaded pages only),
  inline edit (including question_type change), delete, staging area.
  Mass operations: "Save to Paper (N)", "Delete Selected".
  Review flow: ReviewFlowDialog — card-by-card review with editable tags, model answer
  collapsible, Approve/Skip/Edit actions, progress bar. Triggered via "Verify Selected"
  or "Review Needs Review" button.
- Auto-tagging: tagger.ts runs as fallback for any untagged manually-entered question
  (not just CSV imports). AI-image questions use is_verified: false.
- module_co_mapping table: AI-inferred module→CO assignments (classifyModulesForSubject,
  dual-pass Flash with confidence calibration). Backfilled for all CSE subjects.
  Faculty can edit assignments via /faculty/syllabus page.
- Q paper integration: From Q Bank source, 📚 badge, usage tracking

#### Animated Explainers (UNDER DEVELOPMENT — UI shows placeholder)
The infrastructure is built but the visual output quality is not acceptable yet. Shelved for a dedicated session. Do not attempt to use or fix incrementally.

ConceptExplainers component hidden from PPT generation result page (July 2026) — feature not production-ready. Component code preserved.

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
- **Threshold: 0.92**, scoped by subject_id + module_id (`SIMILARITY_THRESHOLD` in
  `src/app/api/chat/route.ts`). Raised 0.78 → 0.92 (Jul 2026): at 0.78 near-but-distinct
  questions collided and students got answers to a question they didn't ask. 0.92 keeps
  hits to genuine paraphrases — a deliberately lower hit-rate for correctness.
- `shouldBypassCache()` handles numerical/personal/pasted queries
- **`mode` column** stores `detectQueryMode()`'s exam_prep/problem_solving/conceptual
  classification of the query. NOT the same as the request tier
  (standard/reasoning/research) — two different things both called "mode" (§9A).
- **Cache-eligible = standard tier only, non-bypassed.** reasoning/research never read
  or write the cache.
- **Eviction:** `CACHE_MAX_ROWS_PER_SUBJECT = 500`, LRU by `last_used_at`, trimmed on
  write.
- **Rate limit is checked AFTER the cache lookup**, so a cache hit costs no quota and
  makes no AI call. Ordering is load-bearing: checking first would charge students for
  answers the cache served for free.

---

## 9A. Chat Route Contract (`POST /api/chat`, `POST /api/chat/visualize`)

Numbered 9A to avoid renumbering §10–§23. Rebuilt across CP1–CP5 (Jul 2026).

### Two things are called "mode" — do not conflate
| | Values | Set by | Meaning |
|---|---|---|---|
| **Request tier** | standard / reasoning / research | client `mode` param, or auto | which model + path serves the turn |
| **Query mode** | exam_prep / problem_solving / conceptual | `detectQueryMode(text)` | student intent; picks prompt behaviour; stored in `semantic_cache.mode` |

Tier resolution: an explicit non-`auto` tier always wins. Under `auto`,
`problem_solving` → reasoning, everything else → standard. **research is never
auto-selected** — it is search-grounded and pricier, so it is opt-in only
(`RATE_LIMITS.research` = 10/day vs chat's 50).

### `detectQueryMode` evaluation order is load-bearing
problem_solving MUST be tested before exam_prep. exam_prep's `shortNoQuestion`
shortcut (<60 chars, no question word) otherwise captures terse numerical
imperatives like "Calculate the height of a balanced BST with 15 nodes" and
misroutes them. Since CP2 this also picks the MODEL (Flash instead of Pro), so
the reorder is no longer cosmetic. The two keyword sets don't overlap, so this
affects only that collision.

### Response shapes — the client must handle all three
1. **SSE stream** (standard/reasoning). Frames: `meta` `{mode, recencySuggested}` →
   `chunk` `{text}` (repeated) → `done` `{messageId, struggle}`, or `error`
   `{message}` mid-stream.
2. **Plain JSON** (cache hit, research) — same route, no stream.
3. **Fatal JSON** (429/404/500) — may arrive even though the happy path streams.

`streamClient.ts` dispatches on content-type. **Every success path returns
`messageId`** (the `chat_messages` row id) — Visualize depends on it.

### Invariants
- **Persist-before-stream:** the user's row is inserted BEFORE generation starts, so
  a dropped connection, refresh, or mid-stream failure never loses the question.
  `persistTurn({insertUserRow:false})` on the streaming path avoids the duplicate.
- **History is server-side** — last `HISTORY_LIMIT = 12` rows re-read per request.
  The client never sends conversation history; don't add it.
- **Messages are saved on cache hits AND misses.** Quota is not consumed on a hit.
- **`dbId` ≠ `id`** in `UiMessage`: `id` is a client `genId()` (stable React key from
  optimistic render); `dbId` is the `chat_messages` row id, absent until the row
  exists. Anything addressing a turn server-side must use `dbId`. History loads must
  `select("id", ...)` — omitting it silently breaks Visualize on every resumed
  session (which, given the 72h resume window, is the majority case).
- Session-cap cleanup runs ONLY on new-session creation in `chat/session/route.ts`,
  never per-message — doing it per-message deleted other subjects' sessions.

### Visualize (`POST /api/chat/visualize`) — CLASSIFY → GENERATE
Two AI calls per click, never a chat turn. Classify (`chat_viz_classify`) → generate
via `VIZ_REGISTRY` (§3). Rendered in an inline panel below the message; errors retry
in place and never enter the transcript. **Regenerate replays the stored
classification → 1 AI call, not 2** (the client sends it back; the server re-validates
rather than trusting it, and falls back to a fresh classify if unusable). Quota reuses
the `hint` bucket (30/day, same comprehension-aid class) and decrements **only on a
delivered visualization** — a failed build costs the student nothing.

---

## 10. PPT Generation & Refinement Pipelines

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

### Content Refinement Tab — Two Pipelines, One Shared Component

The Content Refinement Tab (`/faculty/refine`) and the post-generation refine flow
(`/faculty/generate/refine/[contentId]`) are architecturally distinct pipelines that
share exactly one UI component (`SlideChatConsole`) and nothing else. Built across
~30 commits, complete as of July 2026 — this replaces the "explicitly deferred" status
this section previously carried (see §17 for the roadmap correction).

**Why two pipelines, not one:**
- **Standalone tool (`src/lib/ppt-refine/*`)** operates on an arbitrary
  faculty-uploaded `.pptx` whose original design/branding cannot be reproduced. It must
  preserve the file byte-for-byte outside the specific text/visuals it patches, so it
  works by **surgical XML string patching** (`assembler.ts`) against
  `ExtractedSlide`/`RefinedSlide` — a "patch arbitrary bytes" model.
- **Post-gen flow (`generate/ppt/refine` + `rebuild`)** operates on a deck this
  product's own generator just built from a `SlideContent[]` JSON model it fully
  controls. It's safe to **fully regenerate** the file from the edited JSON via the same
  `generatePPTXBuffer()` used for original generation (`src/lib/ppt/generator.ts`) — a
  "regenerate from template" model. There is no separate preview/export data structure
  in this flow, so preview/export drift (see below) cannot occur here by construction.

These data models are deliberately **not unified** — forcing one onto the other would
either break the standalone tool's byte-preservation guarantee, or block the post-gen
flow's fully-declarative editing (reorder, insert, delete slides).

**Shared:** `src/components/refine/SlideChatConsole.tsx` — presentation-only chat UI
(message log, input row, empty-state suggestion chips). Owns no pipeline logic; each
surface owns its own message storage (a flat array in the post-gen flow, a per-slide
`Record<index, ChatMessage[]>` map in the standalone tool) and how an instruction is
actually applied. One behavioral prop, `chipBehavior: "fill" | "send"` — post-gen chips
fill the textarea (explicit send required), standalone-tool chips send immediately
(instant-patch is core to that surface's UX).

### PPT Refinement Pipeline (standalone tool, `/faculty/refine` → "PPT Refinement" tab)

```
Faculty uploads .pptx
  → POST /api/ppt-refine/extract (maxDuration: 60)
    → adm-zip unzips, fast-xml-parser reads slides (extractor.ts)
    → Gemini Flash detects topic + level (ppt_extract task)
    → Returns ExtractedDeck; stores original .pptx + extracted deck in Supabase Storage
  → Configure stage: per-slide checkboxes (default all-selected). Faculty either
    (a) selects multiple/all slides and sets the 8 bulk RefinementOptions + Allow New
        Slides, or
    (b) selects exactly one slide, which swaps the option panel for a SlideChatConsole
        in single-slide chat mode (chipBehavior="send")
  → Bulk path: POST /api/ppt-refine/refine (maxDuration: 300)
    → refineDeck() (refiner.ts): 5-slide batches in parallel, routeAI('ppt_refine')
      with a Gemini responseSchema, deterministic length/pseudocode backstops, retry
      + fallback-to-original on exhausted retries
    → assemblePptx() (assembler.ts): XML-patches selected slides in place, rasterizes
      and embeds any AI-proposed visuals, appends AI-proposed/continuation slides
    → Upload refined .pptx to Storage, return signed URL + per-slide change_summary
  → Chat path: POST /api/ppt-refine/refine-slide (maxDuration: 120)
    → refineSingleSlide() (refiner.ts): one routeAI('ppt_refine') call per message,
      the same deterministic backstops as the batch path; result staged client-side as
      a "chat-edited" slide and folded into the next bulk /refine call's
      extracted_deck (not the lighter storage_path reference) so chat edits survive
      alongside any bulk options run afterward
```

**Assembler approach (same principle as the original ship, much more capability now):**
surgical string-level XML editing — never parse→mutate→reserialize — "so every other
byte is identical to the original." Never touches `<p:pic>`, `<p:graphicFrame>`,
`<p:grpSp>`, or formatting elements other than the text runs and the `<a:xfrm>`/
`<a:bodyPr>` it explicitly patches. Empty title placeholders get text INSERTed rather
than replaced. `<a:normAutofit/>` ships with a computed `fontScale` baked in — PowerPoint
only recomputes autofit on interactive edit, not on file open, so a bare
`<a:normAutofit/>` alone does nothing on export.

### Real Visual Embedding

AI-proposed visuals (`SlideVisual.type: 'svg' | 'mermaid' | 'imagen'`) are rasterized to
PNG by `visual-raster.ts` (sharp for SVG @200 DPI, capped at 2000px longest edge —
deliberately not the LaTeX-tuned `katexRender.ts`; mermaid.ink fetch for Mermaid, 8s
timeout, shared sanitizer with the native PPT generator; base64 decode + 5KB-minimum
guard for Imagen) and embedded by `assembler.ts` as **real `<p:pic>` shapes** — genuine
media parts (`ppt/media/imageN.png`), `.rels` relationships, and
`[Content_Types].xml` coverage — not a preview-only rendering. This was a real gap for
part of the cycle: the results-preview page could show a generated diagram in the
browser while the exported `.pptx` silently never contained it. Now:
- A visual is only placed on a slide with neither an existing `<p:pic>` nor
  `has_image`/`has_diagram` already true (double guard against overwriting an author's
  own image).
- **Text wins over visuals on a fit conflict** — if refined body text wouldn't fit
  alongside the visual's reserved region (42% of the body box height, with a minimum-
  height floor below which no visual is attempted at all), the visual is dropped, never
  the text. Continuation slides are reserved for genuine text overflow only, never
  created just to make room for a picture.
- Rasterization never throws — a bad SVG, mermaid.ink outage, or undersized Imagen
  result all resolve to "no visual embedded" rather than a failed request. Whenever a
  proposed visual doesn't make it into the file (rasterization failure or fit-check
  drop), `change_summary` gets a distinct suffix appended so it's visible to the faculty
  member in the results UI, not just server logs.
- Placement is a heuristic centered-in-region fit, not a measured no-overlap check.
  Bottom "KEY INSIGHT" callout boxes stay text-only — visual embedding only ever targets
  the title/body region.

### Continuation Slides & "Allow New Slides"

The bulk-refine UI option **"Allow Adding New Slides"** (`RefinementOptions.allow_new_slides`,
default **on**) is the single gate for two independent mechanisms:
1. **AI-proposed new slides** (from Expand Thin Sections / Add Real-World Examples / Add
   Practice Problems): folded back into the parent slide as extra labeled bullets when
   the toggle is off, instead of becoming a separate slide.
2. **Continuation slides for text overflow**: when refined body text still overflows at
   the auto-shrink floor, and the toggle is on, the largest whole-bullet prefix that
   fits stays on the source slide and the remainder spills onto one appended
   `"<title> (cont'd)"` slide — capped at exactly one continuation per source slide. If
   even the continuation can't hold the overflow, or the toggle is off, the original
   body text is kept and the slide is marked reverted.

Both mechanisms independently check the same `allow_new_slides` toggle rather than
inferring intent from any AI-emitted signal — see the model-flag-vs-user-toggle learning
in §17.

### Layout/Master Geometry-Inheritance Resolver

A title or body shape with no explicit `<a:xfrm>` in its own `<p:spPr>` is not a shape
with no position — OOXML resolves it from the matching placeholder in the slide's
`slideLayout`, falling back to the `slideMaster` if the layout itself has no xfrm for
it. Every fit/overlap check in `assembler.ts` originally only read a shape's own xfrm,
so such placeholders were invisible to the fit estimator. `buildGeometryResolver()`
parses each slide's layout + master once per deck, resolves title/body geometry through
that inheritance chain, and feeds it into the same fit-check path used for
explicitly-positioned shapes — one rule, not two. An inherited-geometry title is
reverted (not kept oversized) specifically when it both grows noticeably longer than
the original *and* its resolved box overlaps a fixed-position picture or table; an
explicit-position title's overlap with another shape is left alone as a pre-existing
authoring choice.

### Change-Summary Label Taxonomy

Seven distinct outcome states, defined once as string constants in
`src/lib/ppt-refine/types.ts` and consumed by both the server (`refiner.ts`/
`assembler.ts`) and the client (`page.tsx`) — a single source of truth so the UI can
never drift from what the pipeline actually decided:

| State | Meaning |
|---|---|
| No changes needed | Genuine AI no-op — refined content matched the original |
| Refinement failed — original content preserved | All batch retries exhausted |
| Refined content did not fit the slide — original kept | Full revert (title + body) |
| Refined title did not fit — original title kept; body was updated | Partial revert (title only) |
| Refined body did not fit — original body kept; title was updated | Partial revert (body only) |
| Slide not selected for refinement — left unchanged | Deliberately deselected, never sent to AI |
| Slide edited via chat — your changes applied | Single-slide chat mode result |
| Refined content could not be applied to this slide's structure — original kept | AI proposed a real change but no title/body placeholder existed to write it into |

A dropped/failed visual appends a distinct suffix to whichever of the above applies,
rather than silently changing the summary's meaning.

### Post-Generation Refine Flow (`/faculty/generate/refine/[contentId]`)

Edits a deck this product's own generator already built, represented as
`SlideContent[]` (flat `type`/`title`/`bullets`/`note`/`svg`/`mermaid`/`imagenPrompt`/
quiz-style fields for practice slides) — not `ExtractedSlide`/`RefinedSlide`. Left
column: slide list with reorder/delete/"+ Add slide after". Right column:
`SlideChatConsole` (`chipBehavior="fill"`). Sending an instruction calls
`POST /api/generate/ppt/refine` (`operation: "patch" | "insert"`, routes through
`routeAI('ppt_gen', …)` — not the `ppt_refine` task the standalone tool uses). Changes
only mutate local React state until the faculty member explicitly triggers a rebuild
(`POST /api/generate/ppt/rebuild`), which regenerates the entire file from the current
`slides` array via `generatePPTXBuffer()` — the same full-rebuild path as original PPT
generation. No XML patching is involved in this flow at all.

### Text Refinement Tab (`/faculty/refine` → "Text Refinement" sub-tab)

Unrelated, much simpler pipeline predating the PPT-refine work (shipped ~Feb 2026,
functionally unchanged since): paste/select text (≤15,000 chars) → 5 checkbox
refinement types (`src/lib/refine/generator.ts`) → optional target-semester (shown only
for Simplify) → `POST /api/refine` → `routeAI('refine', …)` → refined markdown rendered
via `ReactMarkdown`. No `.pptx` parsing, no slide model, no XML assembly — shares no
code path with `ppt-refine/*` beyond sitting in the same page's other tab.

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
- CO tag validation is a **hard gate** (`validateCoOrNull`), not fallback-coercion: an
  AI-tagged CO that fails format validation becomes `null` + a warning, never a guessed
  nearest-fit value. Covers bulk generation, the regen-question route, and
  `resolveTagValidation`'s AI-suggested-CO path. (Distinct from the module→CO *picker*
  fallback in moduleAssignment.ts — see §17 Key Learnings.)
- Math/chemistry in question text renders across all surfaces via the LaTeX/mhchem
  pipeline — see §13.
- `answer_key_descriptive` task added to `isStructuredTask` allowlist — prevents Flash thinking from silently truncating answer JSON

### BTL Range / CO% / Difficulty% Targeting (July 2026 — replaces BTL-tier presets)

Three secondary directives, set per-paper in `ScopeAndDifficultyStage`, flow through the full pipeline: UI state (`page.tsx`) → generate request body → `SlotAssignmentContext` (`moduleAssignment.ts`) → `QuestionSlot` fields → the per-slot prompt block (`sectionGen.ts`). **Weightage from the syllabus stays the PRIMARY criterion throughout** — these three only bias BTL/CO/difficulty within a module assignment that weightage has already determined.

- **BTL Range** `btlRange: [min, max]` — paper-wide. In `buildSlot` (moduleAssignment.ts) it replaces the old per-question-type `TYPE_BTL_RANGE` lookup as each slot's `targetBtlRange` (still clamped to the module's own allowed levels). When set, `apportionBtlTiers` (the old preset-based tier spreader) is skipped entirely.
- **CO% distribution** `coTargets: Map<co_code, targetMarks>` — prorated server-side from paper-wide % to each section's mark share (`route.ts`). `makePicker`'s module-selection scoring computes a `coScore` (sum of remaining demand across a candidate module's COs) as a **tiebreaker only**: a weightage shortfall gap wider than `sectionMarks * 0.05` (5%) wins unconditionally regardless of CO score; only within that 5% band does CO demand decide, then module number. `commit()` splits each slot's marks equally across the COs its module supplies to update `coAssigned`. `targetCoFor(moduleNumber)` returns the most under-served CO the module can reach, written onto the slot as `QuestionSlot.targetCo`.
- **Difficulty% distribution** `difficultyTargets: [{difficulty, pct}]` (easy/medium/hard) — independent of BTL. `apportionDifficulty()` (Hamilton largest-remainder, mirrors `apportionBtlTiers`' counting logic) spreads labels evenly across a section's slots, writing `QuestionSlot.targetDifficulty`.

**Prompt consumption:** `buildSlotsBlock()` in `sectionGen.ts` emits `Target CO for this slot: ...` and `Difficulty target: ... — {difficultyDirective(d)}` lines per slot when those fields are set, alongside the existing BTL/CO/module lines — the AI receives them as direct per-slot generation directives, not just a data assignment.

**Persistence:** `btlRange` / `coTargetsPct` / `difficultyTargets` are stored inside `qpaper_templates.structure` (the existing unvalidated jsonb blob) via `buildTemplatePayload`/`fromTemplateStructure` in `shared.tsx` — no DB migration needed. Old templates without these keys degrade to `[1,4]` / `{}` / `{easy:40,medium:40,hard:20}` rather than crashing. Draft autosave (`qpaper_drafts.builder_state`, via `useQpaperDraft.ts`) carries the same three fields in `BuilderSnapshot`.

**UI:** `ScopeAndDifficultyStage.tsx` renders BTL Range as two clamped NumericFields (min≤max enforced both directions), CO Distribution as one row per CO with a running-total chip (green=100%, amber=under, red=over) plus a live achievability line per CO (`N of M selected modules supply it`, driven by `module_co_mapping` fetched in `page.tsx`), and Difficulty Distribution as the same three-field + running-total pattern.

---

## 13. Math & Chemistry Rendering (LaTeX / mhchem)

This is the system that renders mathematical notation and chemical formulae consistently across every surface — screen, PDF, Word, PPT, and answer key. It replaces the old "research spike deferred" status: equation/chemistry rendering is now **implemented and shipping**, not a future item.

### The deliberate two-library split (NOT an inconsistency)
- **Screen rendering: KaTeX + mhchem** — reuses the existing chat rendering pipeline (`remark-math` / `rehype-katex`). Fast, client-side, already proven in the chat surface.
- **Print / export rendering: MathJax → self-contained SVG → `sharp` → PNG at 300 DPI** (`src/lib/text/katexRender.ts`, server-only). KaTeX **cannot** server-render to SVG, so print/export uses MathJax instead. Both libraries consume the **identical LaTeX source** — screen stays KaTeX, print/export stays MathJax, by design. Do not "unify" these onto one library; the split is load-bearing.

### Authoring convention (single source of truth)
- Math wrapped in `$...$` (inline) / `$$...$$` (display).
- Chemistry via **bare `\ce{...}`** (no `$` wrapper) — mhchem handles subscripts, charges, reaction arrows, equilibrium arrows, isotopes.
- The canonical notation reference is `MATH_CHEM_NOTATION_GUIDE`, the single exported constant in `src/lib/text/latexSegments.ts`. It is consumed everywhere the same rules must be stated: generation prompts, CSV import docs, and in-app help. Update it in one place; all consumers follow.

### New files
- `src/lib/text/katexRender.ts` — server-only. `renderLatexToImage`, `shouldRenderInline`. MathJax→SVG→sharp→PNG rasterization.
- `src/lib/text/latexSegments.ts` — client-safe. `extractLatexSegments`, `hasLatex`, `findUnsupportedNotation`, and the `MATH_CHEM_NOTATION_GUIDE` constant.
- `src/lib/qpaper/paperMath.ts` — pre-render pass. Dedupes and rasterizes every unique math/chem span **once per paper** before the synchronous PDF/Word builders run (builders are sync, so all image bytes must exist up front).
- `src/lib/qpaper/archetypes.ts` — subject-family classification, used by the PYQ-archetype generation fallback (below).

### Consumers wired (all gated on `hasLatex()` fast-path — untouched behavior when no math present)
- **Screen:** `RichQuestionText` — including MCQ option text (a gap found and fixed mid-session).
- **Q paper PDF:** `builder.ts`.
- **Q paper Word:** `docxBuilder.ts`.
- **Answer-key PDF:** `pdf/builder.ts`.
- **PPT:** `ppt/generator.ts` + `pptMath.ts`.
- Coverage includes table cells and marking-scheme / justification fields — not just question stems.

### Authoring UI: MathToolbar / MathTextarea
Cursor-insert snippet buttons (each button inserts a **complete worked example**, not a bare token), a live KaTeX preview, collapsible by default. Wired into:
- Q Bank manual entry.
- Every editable unit level in `ReviewAndValidateStage.tsx`.
- Both PPT Refine surfaces (`SlidePreview.tsx` and `/faculty/refine`).

### CSV import
Sample template restructured into `### Mathematics ###` / `### Chemistry ###` marker-row sections with worked examples. Row-level preview renders through `RichQuestionText`. `findUnsupportedNotation` flags malformed rows as needs-review rather than importing broken LaTeX silently.

### PYQ-archetype generation fallback
When PYQ coverage for a module is thin or absent, a subject-family-keyed archetype hint (from `archetypes.ts`) **supplements** generation — it never overrides real PYQ mirroring where PYQs exist. Hints by family:
- **Math:** derive/prove-with-steps, solve-with-given-coefficients, compute-on-concrete-instance.
- **Chemistry:** balance-and-classify, predict-product, stoichiometric-calc.

Note: `reference_books` is **title-only** (not excerpt content) — confirmed not usable as a style source, left as passive context only.

### Boundaries (explicitly OUT of scope)
- Skeletal chemical structures / drawn diagrams stay **image-upload-only**.
- Isotope pre-subscript/superscript notation deferred.
- Diagram-generated content (SVG / Mermaid node labels) does **not** render LaTeX inside labels.

### Verification status — REAL REMAINING GAP
Not yet live-tested: **no chemistry subject is seeded in the system.** Everything chemistry-related is verified only synthetically (unit tests on `\ce{}` parsing) or by shared-infrastructure inference from the working math path. Chemistry needs one full live generation cycle (Q Bank → Q Paper → PPT) against a seeded chemistry subject before the math/chem work can be considered fully verified. This is a genuine open gap, not a completed item.

---

## 14. RLS Architecture

RLS enabled on all tables. `get_my_role()` SECURITY DEFINER function prevents recursion.

```sql
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;
```

All API routes use `createAdminClient()` (service role, bypasses RLS). RLS only affects browser client calls.

### RLS Audit (July 2026)

15 tables were found with RLS enabled but zero policies (silently blocking
all browser-client queries with no error). Fixed in a single SQL patch:
exam_structures, note_change_requests, chat_sessions, chat_messages,
quizzes, quiz_attempts, usage_analytics, generated_content,
semantic_cache, document_chunks, co_po_mapping, co_pso_mapping,
exam_scheme, pyq_questions, course_outcomes.

Root cause: Supabase SQL editor bypasses RLS (runs as postgres/superuser),
so these gaps were invisible during development. Browser client (PostgREST)
enforces RLS strictly, returning [] with no error when no policy matches.
Check pg_policies (not migration files) to verify live RLS state.

---

## 15. Animated Explainer Architecture (For Next Session)

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

## 16. Placement Module (Agentic Rebuild — COMPLETE)

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

## 17. Active Feature Roadmap

### Recently Shipped (July 2026)
- **Chat, rebuilt end-to-end (CP1–CP5) — complete.** The full ladder now ships:
  token streaming (SSE); the reasoning tier (Pro) with auto-elevation from
  `detectQueryMode`; the research tier (search-grounded Flash) with citations;
  persist-before-stream so a dropped connection never loses a question; server-side
  history; semantic cache v2 (0.92, mode column, LRU eviction, rate-limit-after-cache);
  and **Visualize** as a two-call CLASSIFY → GENERATE pipeline rendering interactive
  HTML / Mermaid / computed plots in an inline panel. Contract in §9A, routing in §3.
  Inline diagram triage reworked in the same pass: Mermaid is now the DEFAULT inline
  visual, freeform SVG is restricted to plots/geometry/data-structures with a verbatim
  `<marker>` arrowhead template, and above a ~15-element budget the model must defer to
  Visualize rather than draw a cramped diagram.
  Deferred, not blocking (see §18): quota-count endpoint; `scheduleLog` request-scope
  guard; the `illustration` (Imagen) vizType slot, designed for in `VIZ_REGISTRY` but
  deliberately not built.
- **Content Refinement Tab (`/faculty/refine`) — complete, no longer deferred.** Full
  extract → refine → assemble pipeline for the standalone PPT Refinement tab: per-slide
  selection (default all-selected) driving bulk-option or single-slide-chat
  refinement, real visual embedding (SVG/Mermaid/Imagen → rasterized `<p:pic>` shapes),
  continuation slides for text overflow gated by Allow New Slides, and a layout/master
  geometry-inheritance resolver for fit/overlap checks on inherited-position
  placeholders. Text Refinement sub-tab unchanged. Post-generation refine flow
  (`/faculty/generate/refine`) hardened alongside it, sharing only the
  `SlideChatConsole` chat component with the standalone tool. **Complete — see §10 for
  full architecture.**
- **Math & Chemistry rendering (LaTeX / mhchem)** — full cross-surface system: KaTeX (screen) + MathJax→SVG→sharp→PNG (print/export), `$...$` math + bare `\ce{...}` chemistry, `MATH_CHEM_NOTATION_GUIDE` single source of truth, MathToolbar/MathTextarea authoring UI, CSV `### Mathematics ###`/`### Chemistry ###` sections, PYQ-archetype generation fallback (`archetypes.ts`). Wired into screen/PDF/Word/answer-key/PPT. **Complete for math; chemistry not yet live-tested (no chemistry subject seeded) — see §13.**
- **Q paper PDF pagination/metadata bug fixes (this session):**
  - Header/instruction wrap not advancing the cursor (`drawPool`, `drawAttemptAnyOne`, `drawMCQRow`) — audited exhaustively via grep for `maxWidth:`, no fourth instance.
  - Wrong-page metadata: marks/CO/BTL/PO drawn at a stale pre-pagebreak `startY` when a question body crosses a page boundary (`drawSinglePart`, `drawTaggedSubRow`, `drawTaggedOptionRow`) — fixed via `drawQuestionText` returning `{startY, startPage}`.
  - `drawCentered`/`drawSectionHeader` now wrap on overflow instead of running off-page.
- **Q paper generation-quality fixes (this session):**
  - Pool/attempt-any-one shortfall detection generalized — both block types now show a "Generate this item" affordance for blank items (was pool-only).
  - Duplicate-stem detection (`detectDuplicateStems`, `buildDistinctnessBlock`) catches near-identical AI slots.
  - **CO validation hardened:** fallback-coercion (nearest-fit guessing) replaced with a hard gate `validateCoOrNull` — invalid CO becomes `null` + warning, never a guessed value. Now covers bulk generation, the regen-question route, and `resolveTagValidation`'s AI-suggested-CO path (all three previously leaked).
  - BTL-retry corrections (`buildCorrectionsBlock`) now cite the specific violation instead of blind re-rolling.
  - Bank-to-paper shadowing prevention (`buildBankExclusionBlock`) — fresh generation excludes already-placed bank content.
  - Regen concurrency: per-unit lock (`regenUnitKeys` Set) so firing regenerate on multiple items doesn't cross-contaminate siblings.
- **Q Bank review UX (this session):** `ReviewFlowDialog` gained a distinct audited Reject action (vs. Skip/Approve); `BankQuestionCard` gained quick-approve for `is_verified: false` rows.
- **PPT generation robustness (this session):** content-batch generation migrated to `responseSchema` (fixes LaTeX-backslash JSON-escaping failures), then `CONTENT_BATCH_SCHEMA` **narrowed to text-only fields** — the original monolithic schema carrying unused visual fields (e.g. free-form `svgCode`) caused runaway token consumption on text slides (~18× slower, ~12× costlier before narrowing). `DIAGRAM_BATCH_SCHEMA` given an explicit `maxLength` on `svgCode`. Empty-bullet floor check relocated into `generatePPTXBuffer` so it covers the rebuild path too. Illustration-fallback and mermaid-render-failure now set `_needsReview` with an on-slide banner (matching text-content failure flag).
- Q paper BTL-tier presets → BTL Range + CO% + Difficulty% targeting: `moduleAssignment.ts` (`btlRange`/`coTargets`/`difficultyTargets` on `SlotAssignmentContext`, CO-aware `makePicker` with a weightage-primary 5%-threshold tiebreak, `apportionDifficulty`, `targetCo`/`targetDifficulty` on `QuestionSlot`) → `sectionGen.ts` (threaded through + consumed in the per-slot prompt block) → `route.ts` (parses `btlRange`/`coTargets`/`difficultyTargets`, prorates CO% to each section) → full UI replacement in `ScopeAndDifficultyStage.tsx` (BTL Range fields, CO% rows with live achievability preview, Difficulty% split) → persisted in `qpaper_templates.structure` and `qpaper_drafts.builder_state` (no migration). Old preset types/functions kept exported for back-compat, no longer reachable from the UI. **Complete.**
- Q Bank image support (Phases 1, 2, 3 + answer key): faculty image upload (question-images bucket), Bulk Images add-mode with per-card AI draft generation, images embedded across PDF/Word/web preview/answer key. **Complete.**
- Per-question and per-pool-row module pinning (`pinnedModuleId`), bypassing auto-assignment for pinned slots. **Complete.**
- Templates personal/shared (`is_snapshot`/`is_preset`, browse dialog with My/Shared sections, server-side `is_owner` gating). **Complete.**
- module_co_mapping CO backfill for all CSE subjects (dual-pass Flash classifier); faculty-editable via `/faculty/syllabus`. **Complete.**
- Per-subpart MCQ regeneration (`regenerateSubPart`) in ReviewAndValidateStage. **Complete.**
- Stale-PDF warning banner + "Update PDF" flow (`paperEditedSinceGeneration`). **Complete.**
- Faculty Syllabus Viewer (`/faculty/syllabus`) with confidence-coded CO mapping display + faculty editing. **Complete.**
- 15-table RLS audit — fixed tables with RLS enabled but zero policies (see §14).

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
4. Resume builder PDF/Word export QA
5. Expand interview prep bank to 30+ questions
6. Test TPO dashboard with real student batch
7. Placement module bugs (branch matching, gap tag display, setup redirect) — unresolved
8. Verify `dept_admin` role gap in `/api/generate/ppt/refine`'s allowed-roles array —
   present on all three `ppt-refine/*` routes and `/api/refine`, absent on this one. No
   commit explains the omission; confirm with Dhruv whether intentional before treating
   it as a bug.

**Tier 2 — Depth at PPSU:**
9. Q bank UX simplification (too many steps for daily faculty use)
10. Per-module difficulty ceiling UI (popover on module chips) — designed, not built
11. Chemistry live-test: seed one chemistry subject + run a full Q Bank / Q Paper / PPT
    cycle to verify the math/chem rendering path against real chemistry content (math
    path already shipped and verified — see §13)

**Tier 3 — High institutional value:**
12. NAAC auto-report generator (Criterion 2 from existing data — changes Dean's buying decision)
13. Animated explainer renderer rewrite (dedicated session, start with array_sort pattern)
14. Curriculum quality validator tool — deferred until Q Paper fully end-to-end verified
15. **Auto-regen-loop for PPT slides** (flagged, not built) — after slides are marked
    done, run a deterministic-first / AI-fallback-second validity pass so flagged/`null`
    slides self-heal in the same generation loop rather than needing manual Refine. Logged
    as a future practical improvement, not yet scoped.

**Tier 4 — Agentic placement (after foundation):**
16. Placement Agent (Gemini function-calling, multi-turn)
17. Company Arrival Mode (full drive countdown auto-shift)
18. Commerce/Architecture mini-project guides

**Tier 5 — Growth:**
19. Dean/HOD provisioning UI, JD Gap Analysis, Credential Passport, Mock Interview, Multi-tenant

### Key Learnings

- **Generic-over-block-type, not per-type patches:** shortfall/validity/duplicate
  detection built for one block type (pool) had to be separately rediscovered missing
  from siblings (attempt-any-one, plain descriptive/MCQ) three times in one session. Any
  new detection logic should default to covering **every** block type unless there's a
  stated reason a type is exempt.

- **Fallback-coercion is fragile; hard validation gates are not.** The CO leak survived
  two rounds of "smarter fallback" fixes because each depended on correctly enumerating
  every code path. A hard format-validate-or-null gate (`validateCoOrNull`) closed it in
  one pass. Prefer a gate over ever-smarter guessing.

- **Schema shape can cause runaway generation independent of `thinkingBudget`.** A
  responseSchema that includes optional fields irrelevant to a given content type (e.g.
  free-form `svgCode` on a text slide) gives the model no natural stopping pressure under
  constrained decoding — a distinct failure mode from the known thinking-token issue, and
  it must be checked separately. Narrow schemas to the fields a given call actually needs.

- **Gemini double-escapes newlines in `responseSchema` string fields.** A schema field
  holding multi-line text (Mermaid source, code, anything newline-delimited) frequently
  comes back with the backslash itself escaped, so `JSON.parse` yields the two characters
  `\` + `n` instead of a newline. The payload looks fine by length and parses cleanly —
  it just arrives as ONE line and every downstream line-based consumer silently fails.
  **This is a Gemini quirk, not a Mermaid one:** any future responseSchema'd task
  emitting multi-line text will hit it. Un-escape at the consuming route
  (`normalizeMermaid` in `chat/visualize/route.ts` is the reference). Note
  `sanitizeMermaidCode` cannot catch it — that helper splits on real newlines, so a
  one-line payload is invisible to it; it was never broken because the PPT diagram path
  doesn't use responseSchema. Found only by rendering the output (Jul 2026).

- **Live-drive the real UI; static checks cannot see wiring gaps.** The `dbId` bug
  (§9A) passed tsc, lint, build, and every API-level test — the route was correct and
  the client was correct, but the client was sending a client-minted UUID where the
  route expected a row id. Only clicking the button in a browser surfaced it. For any
  feature where the client addresses a server-side entity, drive it end-to-end before
  calling it done.

- **Visual/rendered inspection is the only authoritative check for document outputs.**
  Text-extraction tools are unreliable once inline images / embedded objects are mixed
  into a paragraph — this session a fix nearly shipped for a bug that didn't exist, based
  on trusting extracted text over an actual render. Always inspect the rendered artifact.

- **module_co_mapping gap:** For modules with no clean CO match (e.g. OOP-Java
  Thread/Applet/IO), faculty confirmed this is a curriculum-design issue being
  fixed slowly. In Q Paper generation, nearest-fit CO is assigned (never blank)
  since these modules are taught and carry exam weightage. Modules deliberately
  assigned no CO by the classifier → currently fall back to allCoCodes in
  moduleAssignment.ts (pending Phase 2 picker redesign).

- **Dual-pass AI classification:** For any AI judgment with high-stakes output
  (module_co_mapping, potentially others), run two independent calls and compare.
  Disagreement → union + force confidence:'low'. Agreement → keep result + pick
  lower confidence of the two. Empirically more reliable than single-call +
  self-reported confidence alone.

- **Vercel cold start mitigation:** all heavy generation routes (qpaper gen, answer key,
  PPT build) now have memory:1024 in vercel.json. PPR and ping-warmup approaches
  were evaluated and rejected (PPR risky without per-route testing; ping doesn't
  warm the heavy serverless functions, only edge).

- **A shared parser/config default can silently corrupt content project-wide — always
  check the actual blast radius, don't assume a bug is scoped to where you found it.**
  `fast-xml-parser`'s default `trimValues: true` was fusing run-boundary spaces across
  PowerPoint's split `<a:r>` runs (e.g. `"MOVER "` + `"BREG "` joining into
  `"MOVERBREGX"`). Fixed by setting `trimValues: false` in `extractor.ts`'s parser
  config — confirmed safe to change because `fast-xml-parser` has exactly one call site
  in the entire codebase. The reusable lesson is the check itself: a shared parser/
  config change is not safe to assume scoped until you've grepped for every consumer.

- **Fit-check/overlap logic must resolve REAL effective geometry, not just a shape's
  own `<a:xfrm>`.** A title/body placeholder with an empty `<p:spPr/>` is not a shape
  with no position — OOXML resolves it through the slideLayout, then the slideMaster.
  Any check that only reads a shape's own xfrm is blind to every placeholder using
  inherited geometry, which is common. The geometry-inheritance resolver in
  `assembler.ts` (§10) closes this — walk the inheritance chain before treating "no
  xfrm" as "no constraint."

- **A model-emitted boolean is not a substitute for a deterministic trigger on an
  explicit user toggle.** The `add_summary_slide` decision used to trust the AI's
  self-reported `needs_summary` field, which silently defaulted to `false` on any batch
  that fell back after exhausted retries — so the feature could fail exactly when
  retries were already failing elsewhere. Fixed by making the user's own toggle the
  sole trigger and treating the model's signal as vestigial. Prefer this pattern
  generally: let the user's explicit setting decide, treat model output as advisory at
  most.

- **An option's toggle must be enforced at the code level as well as the prompt
  level.** "Add Key Insights" bullets were being silently dropped whenever a slide was
  already near the shared bullet-count schema cap from other active options — a prompt
  instruction alone can't guarantee compliance under a hard schema constraint. The fix
  is prompt guidance (reserve a slot) *plus* a deterministic post-generation presence
  check that at least converts a silent failure into a logged one. A prompt-only
  instruction is not a hard guarantee the model will honor it every time; back it with
  code wherever the failure would otherwise be invisible.

- **Preview and export can silently disagree — they need their own explicit parity
  checks, not assumed from "the data looks right."** Two separate incidents this
  cycle: an AI-proposed visual rendered in the browser preview while the exported
  `.pptx` never contained it (the assembler was preview-only for visuals until real
  embedding shipped, §10); and bullets rendered correctly on-screen but exported as
  unbulleted plain paragraphs on AI-generated new/continuation slides (plain `<p:sp>`
  shapes inherit no layout bullet formatting, unlike real `<p:ph>` placeholders). Both
  were caught only by inspecting the actual rendered/exported artifact, not by trusting
  the intermediate data — reinforces the "visual/rendered inspection is the only
  authoritative check" learning above from a different angle.

- **Any "revert to original" fallback path needs its own accurate, distinct label.** A
  silent revert reported as a generic "No changes needed" is indistinguishable from a
  genuine AI no-op, and erodes faculty trust exactly when something real went wrong
  (batch failure, content that didn't fit, an AI edit that couldn't be mapped onto the
  slide's structure). `ppt-refine/types.ts` now centralizes seven distinct
  `change_summary` states as the single source of truth for both server and client —
  see §10's label taxonomy table.

- **Concurrent-session hygiene** — see §22 for the working-tree mitigation this cycle
  surfaced repeatedly (large, vaguely-titled commits bundling unrelated work).

---

## 18. Known Issues

| Issue | Status | Fix |
|---|---|---|
| Flash cost shows ₹0.0000 in PPT log | Active | Wire totalFlashCost from routeAI in build route |
| `routeAI` cannot be called outside a request scope | Active | `scheduleLog` wraps `logAICall` in `next/server`'s `after()`, which requires an active request context. Any `routeAI` call from a script, a cron worker, or a detached background task throws on the logging path rather than the AI path — so it fails *after* spending the tokens. Needs a request-scope guard in `scheduleLog` (fall back to a direct `await logAICall`) before any non-request caller is added |
| No quota-count endpoint | Active | The chat UI derives remaining quota by incrementing a local counter after each turn, so it drifts across tabs/devices and resets on reload. Needs a `GET /api/chat/quota` reading `usage_analytics`. Now spans three buckets (chat 50, research 10, hint 30 — the last shared by hints and Visualize) |
| Supabase India ISP DNS block | Ongoing | Cloudflare DNS or WARP VPN |
| Supabase free tier pauses after 1 week | Ongoing | Keep active before demos |
| Email confirmation disabled | Active | Re-enable before go-live |
| Q paper flat-layout web preview | Active | ReviewAndValidateStage ignores flatLayout; PDF/Word correct |
| Per-option-marks cosmetic divergence | Active | Web preview vs PDF/Word rendering differs |
| Answer-key PDF spacing tighter than student paper | Active | Cosmetic — tighten PDF builder spacing |
| Q bank UX too complex | Active | Simplification needed |
| CO-PO/PSO column alignment Sem 1–4 | Active | Fix via superadmin UI before accreditation |
| CO-PO/PSO missing Sem 5–7 electives | Active | Add via superadmin UI before accreditation |
| Animated explainer visuals broken | Shelved | Full renderer rewrite in dedicated session |
| Chemistry rendering not live-tested | Open gap | Math path shipped (§13); no chemistry subject seeded — needs one full Q Bank/Q Paper/PPT cycle to verify `\ce{}` end-to-end |
| Per-module difficulty ceiling UI (popover on module chips) | Designed, not built | Build UI once prioritized |
| Placement module bugs (branch matching, gap tag display, setup redirect) | Active | Unresolved |
| Curriculum quality validator tool | Deferred | Deferred until Q Paper fully end-to-end verified |
| `dept_admin` missing from `/api/generate/ppt/refine` allowed roles | Open question | Present on all three `ppt-refine/*` routes + `/api/refine`; absent only here. No commit explains the omission — confirm with Dhruv whether intentional |
| PPT-refine visual placement is a heuristic region reservation, not a measured no-overlap check | Known limitation | Acceptable for now — text always wins the fit conflict over a visual (§10) |

---

## 19. Architectural Decisions (DO NOT CHANGE)

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
| Visualize is a dedicated route, never a chat prompt-prefix | The original implementation asked the tutor persona for "interactive-html" — the model refused its own UI button, and every attempt and failure became a visible chat turn. A UI affordance must not depend on a persona agreeing to break character (§9A) |
| The ~85-line worked example in `buildVizInteractivePrompt` stays long | Its length IS its function: models copy visible discipline far more reliably than they follow abstract instructions to be disciplined. It is what makes `VIZ_LAYOUT_SAFETY` actually land, and it anchors the 250-line size contract. Shortening it to save prompt tokens reintroduces the §15 layout failures |
| `VIZ_SIZE_CONTRACT` is a prompt-level cap, not a `maxTokens` one | The interactive/plot calls run on Pro (pinned 32768) and emit freeform HTML, so they can carry no responseSchema — the same no-stopping-pressure shape as the runaway below. The prompt ceiling is the only mitigation that doesn't touch the shared provider. Watch `ai_call_logs.output_tokens`; >~8k typical means it stopped holding |
| `vizTypes.ts` / `vizPrompts.ts` split by runtime, not concern | The panel is a client component; importing the prompt module would ship four prompts + the worked example into the page bundle (payload cost + prompt leak) |
| `UiMessage.dbId` separate from `UiMessage.id` | `id` must exist at optimistic-render time (before any row does) to be a stable React key; `dbId` must be the real row id for server addressing. One field cannot be both (§9A) |
| PYQ via Gemini Flash direct | LlamaParse returns raw text; Flash extracts structured data |
| Section-relative slot keys Q1–Q4 | Prevents Section II naming mismatch |
| Module assignment computed in code | Guarantees weightage compliance, AI never picks modules |
| Pro model maxOutputTokens always 32768 in gemini.ts | These are two different layers, not contradictory: `estimateMaxOutputTokens()` in tokenBudget.ts produces a value ≤ 24000 (its CEILING) and is passed as the per-call `maxTokens` param. For Flash tasks (qbank_generate, answer_key_mcq) that computed value IS what Gemini uses. For Pro tasks (answer_key_descriptive, qpaper_gen) gemini.ts ignores the passed `maxTokens` and always uses 32768 — the dynamic budget only materially constrains Flash calls. |
| `answer_key_descriptive` in isStructuredTask | Flash Pro-escalation path: if Flash is used, thinkingBudget 0 prevents truncation; Pro overrides maxTokens to 32768 anyway |
| Hamilton apportionment for sourcing mix | Guarantees per-run determinism; random sampling drifts from the configured % |
| adm-zip NOT unzipper | Turbopack build failure with unzipper |
| XML patching for PPT refinement | Round-trip parse/rebuild re-encodes nodes, breaks PowerPoint |
| ppt-refine's `fast-xml-parser` config uses `trimValues: false` (not the library default) | Default trimming strips whitespace that sometimes lives at a PowerPoint run boundary, fusing adjacent words together on join. Confirmed via grep this is the only call site in the codebase — always re-verify blast radius before trusting a shared parser/config fix is scoped |
| Geometry resolver walks layout→master inheritance for shapes with no explicit `<a:xfrm>` | A placeholder with no own position is not "no constraint" — OOXML resolves it through the slideLayout, then slideMaster. Fit/overlap checks that skip this are blind to a common case (§10) |
| `change_summary` constants centralized in `ppt-refine/types.ts` | Single source of truth for revert/failure/success labels across server (`refiner.ts`/`assembler.ts`) and client (`page.tsx`) — prevents the UI ever showing a generic label for what was actually a specific failure |
| PPT-refine visual embedding always drops the visual before ever shrinking/dropping refined text | Text integrity is prioritized over a cosmetic diagram — a slide with correct-but-plain text beats one with truncated text and a picture |
| Post-gen refine flow uses `SlideContent[]` + full regeneration; standalone ppt-refine uses `ExtractedSlide`/`RefinedSlide` + XML patching — deliberately not unified | Post-gen operates on this product's own generated JSON (safe to fully regenerate via `generatePPTXBuffer()`); ppt-refine operates on an arbitrary uploaded `.pptx` whose original design must be preserved outside the patched text — full regeneration isn't an option there (§10) |
| `allow_new_slides` is the sole gate for both AI-proposed new slides AND text-overflow continuation slides | One user-facing toggle, two independent enforcement points in code — avoids the AI's own signals (e.g. a model-emitted `needs_summary`/similar boolean) silently substituting for the user's explicit choice (§10, §17) |
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
| Weightage always primary in `makePicker` (5% shortfall threshold before CO score breaks ties) | CO% targeting must never let mark distribution drift from syllabus weightage — the whole product's credibility rests on weightage compliance |
| btlRange/coTargetsPct/difficultyTargets stored in `qpaper_templates.structure` jsonb, not new columns | `structure` is already unvalidated jsonb passed through as-is by the templates route — adding keys there needs no migration and degrades gracefully for old rows |
| Math: KaTeX on screen, MathJax→SVG→PNG for print/export (two libraries, one LaTeX source) | KaTeX cannot server-render to SVG; MathJax can. Both consume identical `$...$`/`\ce{}` source. Not an inconsistency — do not "unify" onto one library |
| Chemistry authored as bare `\ce{...}` (no `$` wrapper) | mhchem convention; wrapping in `$` breaks its subscript/charge/arrow handling |
| `MATH_CHEM_NOTATION_GUIDE` is the single exported notation constant | One source consumed by generation prompts, CSV docs, and in-app help — never restate the rules inline elsewhere |
| `paperMath.ts` pre-renders all math spans before PDF/Word build | PDF/Word builders are synchronous — all rasterized image bytes must exist up front; dedupe rasterizes each unique span once per paper |
| responseSchema narrowed to only the fields a call needs (CONTENT_BATCH_SCHEMA text-only, svgCode maxLength-bounded) | Irrelevant optional fields in a schema remove the model's natural stopping pressure under constrained decoding → runaway token cost (~18× slower/~12× costlier observed). Distinct from the thinkingBudget failure mode |

---

## 20. Environment Variables

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

## 21. External / Non-Technical Context

**Competitive positioning:** Not ChatGPT for students (no syllabus lock). Not Redrob or Connect AI (generic aptitude, no syllabus context). EduNexus is the institutional layer — Dean buys for accreditation, placement outcomes, faculty time savings.

**What closes university deals:**
1. NAAC report generation from platform data — regulatory infrastructure, not productivity tool
2. Placement outcome data showing measurable improvement
3. Faculty time savings on PPT + Q paper generation
4. Peer reference from enthusiastic PPSU faculty/HOD

---

## 22. How Dhruv Works (Development Patterns)

1. Cursor-primary workflow — runs prompts, shares logs/screenshots, Claude verifies, iterates
2. Simplicity over complexity — rejects solutions that add layers without solving root problem
3. Generic over hardcoded — fixes must be domain-agnostic
4. Surgical changes preferred — targeted single-file edits
5. Cost-consciousness — API cost is an active architecture concern
6. No pilot/phase distinctions — everything is production-ready from the start
7. Verification loop — exact logs and screenshots after each change
8. Honest assessments — not confirmation
9. Communication style — terse and directive
10. **Concurrent-session hygiene (surfaced repeatedly during the Content Refinement Tab
    cycle):** multiple agents/sessions writing to the same working tree can silently
    bundle unrelated work into one commit, or clobber it. This repo's history has
    several large, vaguely-titled commits ("Half hearted push," "remaining pushes")
    that each bundle 100+ unrelated files across features, and at least one commit
    whose own message admits folding in "an existing uncommitted fix" left in the tree
    by a separate session. Mitigation: use separate git worktrees for genuinely
    parallel sessions, and never trust a reported "committed and pushed" without
    checking `git log` / `git show` yourself when it matters.

---

## 23. How to Start Working

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
- Check Section 19 (architectural decisions) before suggesting changes
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
- Q paper CO%/difficulty% targeting is secondary to weightage — never let it override the 5%-shortfall-threshold rule in `makePicker` (moduleAssignment.ts)
- Math renders via KaTeX on screen, MathJax→SVG→PNG for print/export — two libraries, one LaTeX source; don't unify them (§13)
- Chemistry is authored as bare `\ce{...}` (no `$` wrapper); `MATH_CHEM_NOTATION_GUIDE` in latexSegments.ts is the single notation source
- CO tag validation is a hard `validateCoOrNull` gate (invalid → null + warning), never nearest-fit guessing
- Keep responseSchemas narrow — irrelevant optional fields cause runaway token cost independent of thinkingBudget
- Chemistry rendering is NOT yet live-tested (no chemistry subject seeded) — treat it as an open gap
- ppt-refine's `fast-xml-parser` config uses `trimValues: false` — don't "fix" this back to the library default, it fuses run-boundary spaces (§10)
- PPT-refine fit/overlap checks must resolve inherited layout/master geometry, not just a shape's own `<a:xfrm>` (§10)
- PPT-refine visual embedding always drops the visual before ever touching refined text — never the reverse (§10)
- The post-gen refine flow and the standalone Content Refinement Tab intentionally use different data models (`SlideContent[]`+regenerate vs. `ExtractedSlide`/`RefinedSlide`+XML-patch) — don't try to unify them (§10)
- Before starting a parallel/concurrent session on this repo, use a separate git worktree — see §22 for why