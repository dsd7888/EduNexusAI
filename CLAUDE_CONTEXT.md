# EduNexus AI — Complete Project Context

*Last updated: May 31, 2026 | Solo developer: Dhruv | Stack: Next.js 16 + Supabase + Gemini*
*This document is the single source of truth for any Claude instance working on EduNexus AI.*

---

## 1. What This Project Is

EduNexus AI is a **syllabus-locked, role-aware institutional intelligence platform** for Indian private universities. It is NOT a generic AI tutor. It is an institutional layer that gives universities governance over what students learn from AI.

**Core positioning:** Not ChatGPT for students. An institutional AI platform that a Dean pays for because it enforces the university's syllabus, generates faculty content in minutes, and produces accreditation-ready analytics.

**Current deployment:** `edu-nexus-ai-two.vercel.app`
**Repo:** `https://github.com/dsd7888/EduNexusAI`

**Deployment scope:** P. P. Savani University (PPSU) — Engineering branches (Chemical + Mechanical), 12 subjects, 4 faculty. Student accounts are manually provisioned by Dhruv (Supabase self-signup disabled).

**Content state (May 2026):** The platform is now populated with the **real CSE (Computer Science and Engineering) syllabus for Semesters 1–4** — 22 subjects with full module content, course outcomes, CO-PO/PSO mappings, BTL levels, exam schemes, and practicals/tutorials. Seeded via `supabase/seed_cse_sem1_4.sql` (branch `Computer Science and Engineering`, department `Engineering`). This makes CSE the first branch with complete structured-syllabus coverage feeding chat, quiz, PPT, and Q-paper generation.

**The three institutional lock-in factors:**
1. Syllabus lock — content is their RAG; can't replicate without their PDFs
2. Faculty workflow — PPTs, Q papers, refinement all live here; moving = losing content library
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
| AI Primary | Gemini 2.5 Flash (chat, quiz, PPT batches, refine, extraction) |
| AI Heavy | Gemini 2.5 Pro (Q paper gen, answer key, placement gen) |
| AI Images | gemini-2.5-flash-image (primary) + imagen-4.0-fast-generate-001 (fallback) |
| AI Embeddings | gemini-embedding-001 (3072 dimensions) |
| PPT Generation | pptxgenjs |
| Diagrams | SVG (inline generation) + Mermaid (via mermaid.ink API for PDF, MermaidDiagram.tsx for chat) + Imagen |
| Interactive Viz | D3.js, P5.js, Chart.js, Plotly via CDN in sandboxed iframes (srcDoc approach) |
| Drag-and-drop | @dnd-kit/core (Q paper builder) |
| PDF Export | Custom PDFBuilder class in /lib/pdf/builder.ts |
| PDF Parsing | LlamaParse (notes/syllabus), Gemini Flash (PYQ structured extraction) |
| Deployment | Vercel (with vercel.json timeout configs) |
| Dev tools | Cursor Pro chat (targeted single-file changes), Claude Code (multi-file architectural work) |

---

## 3. AI Model Routing (`src/lib/ai/router.ts`)

```typescript
const TASK_TO_MODEL = {
  chat: "flash",           // maxTokens: 16384 (raised for SVG + interactive viz)
  quiz_gen: "flash",       // maxTokens: 8192
  ppt_gen: "flash",        // maxTokens: 32768
  qpaper_gen: "pro",       // maxTokens: 8192 per section — Pro for CO/BTL accuracy
  answer_key_mcq: "flash", // maxTokens: 2048 — MCQ-only answer key block
  refine: "flash",         // maxTokens: 8192
  placement_gen: "pro",    // maxTokens: 32768
  syllabus_extract: "flash", // maxTokens: 8192 — PDF → structured syllabus JSON
  pyq_extract: "flash",    // maxTokens: 4096 — PYQ PDF → per-question structured data
}
```

**CRITICAL:** `thinkingBudget: 0` is set for ALL structured JSON tasks (`ppt_gen`, `quiz_gen`, `qpaper_gen`, `refine`, `placement_gen`). Gemini 2.5 Flash's thinking tokens consume `maxOutputTokens`, causing JSON truncation. This was a hard-won discovery and the root fix for most generation failures.

**Answer key generation uses 3 parallel calls per section:**
- MCQ block → `answer_key_mcq` (Flash, maxTokens: 2048)
- Main questions block (Q2 + Q3 main) → `qpaper_gen` (Pro, maxTokens: 12288)
- Alternatives block (Q3 OR + Q4) → `qpaper_gen` (Pro, maxTokens: 12288)

Both sections run in parallel → 6 total concurrent calls per answer key generation.

**Fallback:** If 429 rate limit on primary provider, tries next in fallback chain.

---

## 4. Role Hierarchy & Permissions

### SUPERADMIN (Dhruv)
- Created manually in Supabase — never via registration
- Full platform access: upload content, manage faculty accounts, assign subjects, approve/reject note-change requests, view all analytics, manage syllabus
- Can do everything faculty can

### DEPT_ADMIN (future)
- Same as superadmin but scoped to their department

### FACULTY (assigned to subjects by superadmin)
- Assigned to specific subjects by superadmin
- Cannot upload directly to RAG (must go through approval workflow)
- Can generate: PPT, Visual Notes, Refined Notes, Question Papers, Answer Keys
- Can view analytics for assigned subjects only
- Can submit note-change requests (pending superadmin approval)

### STUDENT (manually provisioned)
- Chat with AI tutor (syllabus-locked, approved content only)
- Self-generate quizzes for knowledge check
- Placement readiness prep (company-specific aptitude + technical)
- View own quiz history, scores, placement readiness
- Rate limited: 50 chat queries/day, 20 quiz gens/day, 30 hints/day

---

## 5. Database Schema

### Core Tables
- `profiles`: id, email, full_name, role, department, branch, semester
- `subjects`: id, name, code, department, branch, semester
- `modules`: id, subject_id, name, module_number, description, **hours**, **weightage_percent**, **section_number**, **btl_levels text[]**
- `exam_structures`: id, subject_id, total_marks, total_questions, time_limit_minutes, sections (jsonb)
- `faculty_assignments`: id, faculty_id, subject_id, assigned_by, assigned_at

### Content Tables
- `subject_content`: id, subject_id (UNIQUE), content TEXT, reference_books TEXT, created_by, **practicals jsonb** — syllabus text for AI context
- `documents`: id, module_id, subject_id, type ('syllabus'/'notes'/'pyq'), title, file_path, year, uploaded_by, status ('processing'/'ready'/'failed'/'archived')
- `document_chunks`: id, document_id, content, page_number, chunk_index, embedding vector(3072), metadata jsonb
- `note_change_requests`: id, subject_id, module_id, requested_by, reviewed_by, current_doc_id, new_file_path, reason, status ('pending'/'approved'/'rejected'), admin_comment, reviewed_at

### Syllabus Structure Tables (added May 2026)
- `course_outcomes`: id, subject_id, co_code, description — e.g. "CO1: Illustrate various concepts"
- `co_po_mapping`: id, subject_id, co_code, po_code, strength (1/2/3)
- `co_pso_mapping`: id, subject_id, co_code, pso_code, strength (1/2/3)
- `exam_scheme`: id, subject_id (UNIQUE), theory_ce, theory_ese, practical_ce, practical_ese, tutorial_marks, total_marks, credits

### Q Paper Tables (added May 2026)
- `qpaper_templates`: id, subject_id, created_by, name, is_default, university_name, exam_title, duration_minutes, total_marks, instructions text[], structure jsonb
- `pyq_questions`: id, document_id, subject_id, section_name, q_number, question_text, question_type, marks, co, btl, po, options jsonb, year — extracted from PYQ PDFs via Gemini Flash

### Chat Tables
- `chat_sessions`: id, student_id, subject_id, module_id
- `chat_messages`: id, session_id, role, content, citations (jsonb), tokens_used, model_used, cost_inr

### Quiz Tables
- `quizzes`: id, module_id, subject_id, title, difficulty, questions (jsonb), generated_by
- `quiz_attempts`: id, quiz_id, student_id, answers (jsonb), score, time_taken

### Generation Tables
- `generated_content`: id, subject_id, module_id, type, title, file_path, metadata (jsonb), generated_by, tokens_used, cost_inr, status, **answer_key_path**, **answer_key_generated_at**

### Placement Tables
- `placement_companies`: id, name, branches (TEXT[]), aptitude_pattern (jsonb), difficulty, avg_package_lpa
- `placement_question_bank`: id, company_id, branch, category, subcategory, question (jsonb), times_used, created_at
- `practice_question_bank`: id, module_id, branch, category, subcategory, question (jsonb), times_used
- `student_question_history`: student_id, question_bank_id — 7-day deduplication window
- `placement_attempts`: id, student_id, company_id, score, category_scores (jsonb), time_taken, created_at

### System Tables
- `semantic_cache`: id, subject_id, module_id, query_text, query_embedding vector(3072), response, hit_count, last_used_at
- `usage_analytics`: id, date, user_id, subject_id, event_type, event_count, tokens_used, cost_inr

### DB Consistency Rule
- `department = "Engineering"` for ALL rows (current deployment)
- `branch` values match whatever case was set at signup — do not alter
- Filter queries use `branch` only, never `department`
- Multi-department expansion: repurpose `department` column when needed

---

## 6. File Structure (Current State)

```
edunexus-ai/
├── src/
│   ├── proxy.ts                                    ← Auth middleware (Next.js 16, NOT middleware.ts)
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx                      ✅
│   │   │   └── register/page.tsx                   ✅
│   │   ├── (superadmin)/
│   │   │   ├── layout.tsx                          ← Pure UI sidebar, NO auth checks
│   │   │   └── superadmin/
│   │   │       ├── dashboard/page.tsx              ✅
│   │   │       ├── upload/page.tsx                 ✅ PDF upload (notes + PYQs only — syllabus moved)
│   │   │       ├── approvals/page.tsx              ✅
│   │   │       ├── faculty/page.tsx                ✅
│   │   │       ├── subjects/page.tsx               ✅ Subject management + "Manage Syllabus" per subject
│   │   │       ├── subjects/[subjectId]/syllabus/  ✅ Unified syllabus management (PDF → extract → edit → save)
│   │   │       └── analytics/page.tsx              ✅
│   │   ├── (faculty)/
│   │   │   ├── layout.tsx                          ← Pure UI sidebar, NO auth checks
│   │   │   └── faculty/
│   │   │       ├── dashboard/page.tsx              ✅
│   │   │       ├── generate/page.tsx               ✅ PPT generation
│   │   │       ├── generate/refine/[contentId]/page.tsx ✅ Per-slide PPT refinement UI
│   │   │       ├── qpaper/page.tsx                 ✅ Q paper builder (drag-drop + templates + answer key)
│   │   │       ├── request-change/page.tsx         ✅
│   │   │       ├── refine/page.tsx                 ✅
│   │   │       ├── analytics/page.tsx              ✅
│   │   │       └── profile/page.tsx                ✅
│   │   ├── (student)/
│   │   │   ├── layout.tsx                          ✅
│   │   │   └── student/
│   │   │       ├── dashboard/page.tsx              ✅
│   │   │       ├── subjects/page.tsx               ✅
│   │   │       ├── chat/page.tsx                   ✅ Subject picker / chat entry
│   │   │       ├── chat/[subjectId]/page.tsx        ✅ + Visualize button per message + struggle detection banner
│   │   │       ├── quiz/page.tsx                   ✅ + subjectId query param pre-selection
│   │   │       ├── history/page.tsx                ✅
│   │   │       ├── profile/page.tsx                ✅
│   │   │       └── placement/
│   │   │           ├── page.tsx                    ✅
│   │   │           ├── test/[companyId]/page.tsx   ✅
│   │   │           ├── history/page.tsx            ✅
│   │   │           └── practice/[moduleId]/page.tsx ✅
│   │   ├── api/
│   │   │   ├── auth/callback/route.ts              ✅
│   │   │   ├── admin/cleanup/route.ts              ✅ Maintenance cleanup
│   │   │   ├── analytics/route.ts                  ✅ Event logging
│   │   │   ├── analytics/summary/route.ts          ✅ Aggregated analytics
│   │   │   ├── subjects/content/route.ts           ✅
│   │   │   ├── subjects/manage/route.ts            ✅ Subject create/update
│   │   │   ├── upload/route.ts                     ✅ Notes + PYQ only; notes → LlamaParse, PYQ → Gemini Flash (inline)
│   │   │   ├── faculty/assign/route.ts             ✅
│   │   │   ├── faculty/assign/bulk/route.ts        ✅ Bulk faculty assignment
│   │   │   ├── approvals/route.ts                  ✅
│   │   │   ├── approvals/download/route.ts         ✅ Download note-change file
│   │   │   ├── syllabus/extract/route.ts           ✅ POST PDF → Gemini → ExtractedSyllabus JSON
│   │   │   ├── syllabus/save/route.ts              ✅ POST ExtractedSyllabus → all DB tables
│   │   │   ├── syllabus/load/route.ts              ✅ GET reassemble saved state for editor
│   │   │   ├── chat/route.ts                       ✅ Inline semantic cache + query mode + struggle detection
│   │   │   ├── chat/session/route.ts               ✅ Resume per subject (72h window) or force_new
│   │   │   ├── chat/suggestions/route.ts           ✅
│   │   │   ├── chat/export/route.ts                ✅
│   │   │   ├── quiz/generate/route.ts              ✅
│   │   │   ├── quiz/submit/route.ts                ✅
│   │   │   ├── quiz/hint/route.ts                  ✅
│   │   │   ├── quiz/export/route.ts                ✅ Quiz result PDF
│   │   │   ├── notes/route.ts                      ✅
│   │   │   ├── notes/export/route.ts               ✅
│   │   │   ├── generate/ppt/outline/route.ts       ✅
│   │   │   ├── generate/ppt/batch/route.ts         ✅ Diagram-only batches → ppt_diagram (Pro)
│   │   │   ├── generate/ppt/build/route.ts         ✅
│   │   │   ├── generate/ppt/content/[contentId]/route.ts            ✅ Load stored slide JSON
│   │   │   ├── generate/ppt/image/[contentId]/[slideIndex]/route.ts ✅ Per-slide image regen
│   │   │   ├── generate/ppt/rebuild/route.ts       ✅ Rebuild PPTX from edited slide JSON
│   │   │   ├── generate/ppt/refine/route.ts        ✅ Per-slide JSON patch (continuous refinement)
│   │   │   ├── generate/qpaper/route.ts            ✅ Section-by-section, Pro, CO/PO/BTL, PYQ RAG
│   │   │   ├── generate/qpaper/answer-key/route.ts ✅ 6 parallel Pro/Flash calls, CONFIDENTIAL PDF
│   │   │   ├── generate/qpaper/regenerate-question/route.ts ✅ Single question regen
│   │   │   ├── generate/qpaper/export/route.ts     ✅ Re-render edited paper to PDF
│   │   │   ├── qpaper/templates/route.ts           ✅ GET (auto-seeds 3 presets) + POST
│   │   │   ├── qpaper/templates/[id]/route.ts      ✅ DELETE
│   │   │   ├── refine/route.ts                     ✅
│   │   │   ├── placement/generate/route.ts         ✅
│   │   │   ├── placement/submit/route.ts           ✅
│   │   │   ├── placement/export/route.ts           ✅ Placement result PDF
│   │   │   └── placement/practice/
│   │   │       ├── generate/route.ts               ✅
│   │   │       ├── submit/route.ts                 ✅
│   │   │       └── export/route.ts                 ✅ Practice result PDF
│   │   ├── auth/loading/page.tsx                   ✅
│   │   ├── layout.tsx                              ✅
│   │   └── page.tsx                               ✅
│   ├── components/
│   │   ├── ui/                                     ✅ shadcn components
│   │   │   └── score-meter.tsx                     ✅ Semantic score meter (X% → target bar), dep-free
│   │   ├── layout/
│   │   │   ├── NavLink.tsx                         ✅
│   │   │   ├── LogoutButton.tsx                    ✅
│   │   │   ├── UserProfile.tsx                     ✅
│   │   │   └── PageSkeleton.tsx                    ✅
│   │   ├── chat/
│   │   │   ├── MarkdownRenderer.tsx                ✅ Dispatches svg/mermaid/interactive-html fences
│   │   │   ├── MermaidDiagram.tsx                  ✅
│   │   │   └── SVGDiagram.tsx                      ✅ Sanitizes + renders inline SVG
│   │   ├── ppt/
│   │   │   └── SlidePreview.tsx                    ✅
│   │   └── ErrorBoundary.tsx                       ✅
│   ├── hooks/
│   │   └── useSupabaseData.ts                      ✅ Client-side data-fetching hook
│   └── lib/
│       ├── ai/
│       │   ├── providers/
│       │   │   ├── types.ts                        ✅ AIProvider, ChatParams, ChatResponse interfaces
│       │   │   └── gemini.ts                       ✅ Flash/Pro/Embedding/Imagen implementation
│       │   ├── router.ts                           ✅ routeAI(task, params) with thinkingBudget:0
│       │   ├── prompts.ts                          ✅ Tutor/notes/suggestion builders + detectQueryMode + PPT prompt constants
│       │   └── imagen.ts                           ✅ buildImagenPrompt + generateImagenImage (domain detection)
│       ├── api/
│       │   └── helpers.ts                          ✅ requireAuth / requireRole / apiError / apiSuccess
│       ├── db/
│       │   ├── supabase-browser.ts                 ✅ createBrowserClient() — client components ONLY
│       │   ├── supabase-server.ts                  ✅ createServerClient(), createAdminClient()
│       │   └── types.ts                            ✅ All DB TypeScript types
│       ├── pdf/
│       │   └── builder.ts                          ✅ PDFBuilder class — all PDF exports (markdown-aware)
│       ├── ppt/
│       │   └── generator.ts                        ✅ buildOutlinePrompt + buildBatchContentPrompt + generatePPTXBuffer (fixed dims)
│       ├── qpaper/
│       │   ├── generator.ts                        ✅ Q paper types + generation orchestration
│       │   ├── sectionGen.ts                       ✅ Section prompt builder, Pro generation, validation, retry
│       │   ├── moduleAssignment.ts                 ✅ Weightage-based module-to-slot assignment (pure TS)
│       │   ├── answerKeyGen.ts                     ✅ Answer key prompt builder + 3-block parallel generation + PDF
│       │   ├── templates.ts                        ✅ PPSU_ESE, CE_QUIZ, CUSTOM preset templates
│       │   └── builder.ts                          ✅ Q paper PDF builder (PPSU format with CO/BTL/PO columns)
│       ├── syllabus/
│       │   ├── types.ts                            ✅ ExtractedSyllabus shape
│       │   ├── prompts.ts                          ✅ Extraction system + user prompts
│       │   ├── parser.ts                           ✅ 5-attempt JSON parser with progressive cleaning
│       │   └── reconstruct.ts                      ✅ Rebuild plain-text syllabus for subject_content.content
│       ├── quiz/
│       │   └── generator.ts                        ✅ Match-as-MCQ, multi-type
│       ├── placement/
│       │   ├── generator.ts                        ✅ Bank-first + weighted random + Flash-first
│       │   ├── bankManager.ts                      ✅ Question bank fetch/save + 7-day dedup
│       │   ├── fallbackSyllabus.ts                 ✅ Per-branch fallback syllabus text
│       │   └── modules.ts                          ✅ PRACTICE_MODULES catalog
│       ├── refine/
│       │   └── generator.ts                        ✅ Content refinement (RefinementType goals)
│       ├── student/
│       │   └── subjectGroups.ts                    ✅ Subject grouping helper (semester / code / none)
│       ├── ui/
│       │   └── score.ts                            ✅ Semantic score system (not-started/in-progress/on-track, no red)
│       ├── utils.ts                                ✅ cn() + shared client helpers
│       └── utils/
│           └── rate-limit.ts                       ✅ 50 chat / 20 quiz / 30 hints per day
├── supabase/migrations/
│   ├── 20260218100000_subject_content.sql          ✅ applied
│   ├── 20260218100001_subject_content_created_by.sql ✅ applied
│   ├── 20260328120000_placement_attempts_detail_columns.sql ✅ applied
│   ├── 20260521000000_structured_syllabus.sql      ✅ applied — modules columns + CO/PO tables + exam_scheme
│   ├── 20260523000000_qpaper_templates.sql         ✅ applied
│   ├── 20260524000000_pyq_questions.sql            ✅ applied
│   └── 20260525000000_answer_key.sql               ✅ applied — answer_key_path + answer_key_generated_at
├── supabase/seed_cse_sem1_4.sql                    ✅ Real CSE Sem 1–4 syllabus seed (22 subjects, one DO block each)
├── vercel.json                                     ✅ maxDuration per route
├── CLAUDE_CONTEXT.md                               ← This file
├── .env.local
└── package.json
```

---

## 7. Completed Features

### Auth & Navigation
- proxy.ts auth middleware (Next.js 16)
- Login, register, auth callback, role-based redirect
- Three role layouts with pure UI sidebars (no auth checks)
- Mobile responsive with hamburger menu
- Error boundaries, loading skeletons, role-based route protection

### Superadmin Features
- Upload: notes PDFs, PYQ PDFs (syllabus upload moved to dedicated page)
- **Unified Syllabus Management** — PDF upload → Gemini Flash extracts structured data → admin reviews + edits in accordion UI → saves to DB (course_outcomes, co_po_mapping, exam_scheme, modules enriched with weightage/BTL/section)
- Faculty assignment (many-to-many)
- Note-change approval workflow
- Analytics dashboard

### Student Features
- **Subjects page** — filtered by branch + semester, Quick Notes modal
- **AI Chat:**
  - Query mode detection (`detectQueryMode`) — exam_prep / problem_solving / conceptual → different AI behavior per mode
  - Session continuity — resume per subject (72h window), force_new option, resume banner
  - Semantic cache: threshold 0.90, strict (subject_id + module_id) scoping
  - **Visualize button** — on every AI message, sends follow-up prompt for interactive visualization
  - **Struggle detection** — pure string tokenization, flags repeated concept across 3+ messages in session → shows quiz nudge banner
  - SVG, Mermaid, interactive HTML visualizations
  - PDF export, suggested prompts
- **Quiz** — MCQ, True/False, Short Answer, Match-as-MCQ, subjectId query param pre-selection, Socratic hints, persistence, resume
- **Placement Prep** — company tests, practice drills, history
- **Rate limiting** — 50 chat/day, 20 quiz/day, 30 hints/day

### Faculty Features
- **PPT generation** — full 3-route pipeline with activity slides, Indian context, hook slides, layout variety
- **Question Paper Generation:**
  - Drag-drop builder with @dnd-kit/core
  - 3 preset templates (PPSU ESE 60M, CE Quiz 10M, Custom)
  - Templates are editable — prefill drag-drop builder
  - Paper metadata form (semester, date, time, instructions, university name)
  - CO/PO/BTL mapping per question — sourced from syllabus DB
  - Module-weighted question distribution (code-computed, not AI-decided)
  - Section I / Section II strict module segregation
  - PYQ structured RAG (pyq_questions table, always fed to generation regardless of mode)
  - Two parallel Pro calls for generation (one per section)
  - Per-question regeneration, inline edit, Update PDF
  - Save as template
- **Answer Key Generation:**
  - CONFIDENTIAL PDF for evaluators only (faculty-only access, signed URL)
  - 6 parallel calls: 2× Flash (MCQ), 4× Pro (main + OR alternatives)
  - Full model answers + marking scheme breakdown per question
  - Partial credit guidance, alternative approach notes
  - Both OR alternatives and both Q4 options always shown
- **Content refinement** — paste text, AI refines
- **Note change request** — upload new version → superadmin queue

---

## 8. Content Architecture

### Current Approach (TEXT-BASED)
- Superadmin uses unified syllabus page: uploads PDF → Gemini Flash extracts → structured data saved to DB (modules, course_outcomes, co_po_mapping, exam_scheme)
- `subject_content.content` (plain text) is auto-reconstructed from structured data and used in AI prompts
- No chunking/pgvector for chat — full syllabus fits in context
- Semantic cache prevents repeated API calls

### Seeded Real Content — CSE Sem 1–4 (`supabase/seed_cse_sem1_4.sql`)
- 22 subjects extracted from the official PPSU CSE syllabus PDF into the structured tables (`subjects`, `subject_content`, `modules`, `course_outcomes`, `co_po_mapping`, `co_pso_mapping`, `exam_scheme`); one `DO $$` block per subject so one failure can't corrupt the rest.
- 127 modules, 96 COs; Sem 1: 4 / Sem 2: 6 / Sem 3: 7 / Sem 4: 5 subjects. All branch `Computer Science and Engineering`, department `Engineering`.
- Tutorial-only subjects store their tutorial list in `subject_content.practicals` (no separate tutorial field). Lab/workshop/exposure subjects have no module rows.
- **Caveat to verify before accreditation use:** CO-PO / CO-PSO strengths were assigned to consecutive PO/PSO columns starting at PO1/PSO1 because the source matrix column alignment was lost in PDF→text extraction. A few subjects had BTL tables that didn't align 1:1 with their module list (mapped by name, some left empty). All flagged inline + in the file's EXTRACTION SUMMARY.
- Mirrors what the unified syllabus page produces, so chat/quiz/PPT/Q-paper for CSE run on real structured data.

### Full PDF RAG (planned)
- LlamaParse for notes (already active for notes uploads)
- Flow: PDF upload → LlamaParse → clean markdown → chunked → embedded → pgvector
- Currently: notes are LlamaParse-parsed but chunking/embedding pipeline exists

### PYQ Processing
- PYQ PDFs bypass LlamaParse entirely
- Gemini Flash extracts structured questions directly: `{question_text, type, marks, co, btl, po, section_name, year}`
- Stored in `pyq_questions` table, not `document_chunks`
- Always fed to Q paper generation as style reference regardless of PYQ mode selected

---

## 9. Semantic Cache Architecture

**Table:** `semantic_cache`
**Embedding model:** gemini-embedding-001 (3072 dimensions)
**Similarity:** cosine similarity computed in JS loop — **NEVER use `.rpc()` for this** (PostgREST silently truncates 3072-dim vectors)
**Threshold:** 0.90 (lowered from 0.97 — root cause of low hit rate was cross-subject contamination, not threshold)
**Scoping:** SQL filter on `subject_id` AND `module_id` FIRST, then cosine similarity in JS loop

**Cache bypass function** (`shouldBypassCache` in chat API route):
```typescript
function shouldBypassCache(message: string): boolean {
  if (/[\[{][\d\s,.-]+[\]}]/.test(m)) return true          // numerical arrays
  if (/\b\d+\.?\d*\s*(K|°C|°F|cm|mm|...)/.test(m)) return true // units+numbers
  if (/\b\d+\s*[+\-*/^=]\s*\d+/.test(m)) return true       // inline math
  if (/\b(calculate|compute|solve...).*\d+/i.test(m)) return true
  if (/\b(given|where|assume|let).*[=:]\s*\d+/i.test(m)) return true
  if (/\b(my|mine|our|i got|i have...)\b/i.test(m)) return true
  if (/\b(this code|this equation|the following...)\b/i.test(m)) return true
  if (/```[\s\S]{20,}```/.test(m)) return true              // code blocks
  if (/\b(mr\.|case study|case of)\s+[A-Z]/i.test(m)) return true
  if (/\b(analyse|analyze|critique)...[A-Z]/.test(m)) return true
  if (m.length > 400) return true
  return false
}
```

---

## 10. PPT Generation Pipeline

### Architecture (3-route split for Vercel 60s timeout)
```
Faculty → POST /api/generate/ppt/outline → slide structure JSON
        → POST /api/generate/ppt/batch × N → content in batches of 5
        → POST /api/generate/ppt/build → PPTX assembly + Imagen + upload → signed URL
```

### Parallel Processing
```typescript
const CONCURRENCY = { content: 3, diagram: 2 }
```

### Batch Sizes
- Content batches: 5 slides per batch
- Diagram batches: 1 slide per batch (prevents SVG token truncation)
- Diagram-only batch maxTokens: 16,384

### Slide Dimensions
`SLIDE_W = 10"`, `SLIDE_H = 5.625"` (16:9) — **NEVER CHANGE**

### Diagram Routing (renderHint in outline)
- `"svg"` — precise 2D: algorithm diagrams, state diagrams, data structures, graphs, chemical formulas
- `"mermaid"` — sequential/logical flow: processes, decision trees, timelines, hierarchies
- `"imagen"` — 3D/photorealistic: anatomy, equipment internals, 3D assemblies, lab setups
- `"activity"` — no diagram; scenario + numbered student tasks (see below)
- Default to "svg". Use "imagen" only when 3D spatial understanding is genuinely necessary.

### New Slide Types (from prompts.ts constants)
- **Hook slide** — one scenario creating felt need for the algorithm. Single question at end. No bullets. Indian context. Placed before concept definition.
- **Activity slide** — real Indian scenario IS the algorithm problem. 3-4 numbered student tasks (compute, draw, map, identify). Discussion prompt. Solution hint. Placed after worked example.
- **Key Insight slide** — one core insight, one explanation sentence, one example. Used sparingly.

### PPT Prompt Constants (prompts.ts exports, wired into generator.ts)
- `OUTLINE_PROMPT_ACTIVITY_MANDATE` — mandatory activity slide per algorithm concept
- `OUTLINE_PROMPT_INDIAN_CONTEXT` — Indian examples required (cities, companies, cricket, IRCTC etc.)
- `OUTLINE_PROMPT_HOOK_SLIDE` — structural hook rule (scenario → constraint → question, no bullets)
- `BATCH_PROMPT_INDIAN_CONTEXT` — Indian context in batch content generation
- `BATCH_PROMPT_NO_PLACEHOLDER_DIAGRAMS` — never output description of a diagram instead of the diagram
- `BATCH_PROMPT_COMPLETENESS` — no truncation with ellipsis; cap `💡` callouts at 120 chars
- `BATCH_PROMPT_LAYOUT_VARIETY` — definition/comparison/worked-example/hook/activity slide formats

### Image Generation
- Primary: `gemini-2.5-flash-image`
- Fallback: `imagen-4.0-fast-generate-001`
- Guard: if returned blob < 5KB, skip embedding (treat as failed render, omit image shape)
- Domain detection: isMedical, isEngineering, isMechanical, isArchitecture, isBiology, isCS

### `cap()` and `capTitle()`
- `cap(text)` — strips markdown, never truncates
- `capTitle(text, max=90)` — titles only, truncates at 90 chars

---

## 11. Placement Readiness Module

### Question Bank Architecture
- Bank-first serving: check bank → AI only if insufficient (30x faster)
- Weighted random: 70% fresh / 25% seasoned / 5% classic
- Flash threshold: 14/20 (Pro fallback below)
- Module-level Set locks prevent double API calls

### Company Test: 20 questions, 20 minutes
- Quantitative (40%), Logical (30%), Verbal (20%), Technical (10%)
- Technical questions grounded in `subject_content`

### Test Resilience
- localStorage persistence, resume dialogs, tab visibility detection, beforeunload warning

---

## 12. Interactive Chat Visualizations

### How It Works
Student asks to "visualize" / "show me" / "animate" → AI generates `interactive-html` fence → rendered in sandboxed srcDoc iframe.

**Visualize button:** Every AI message has a hover button that sends a follow-up prompt to generate a visualization for that specific message's concept. Discoverable without magic words.

### Key Files
- `chat/[subjectId]/page.tsx` — `InteractiveHtmlViewer` (extracts the `interactive-html` fence → srcDoc iframe), the per-message visualize button, and the struggle-detection banner all live here. The visualize trigger is an inline follow-up prompt string in this page — there is no separate `INTERACTIVE_VISUALIZATION_RULES` export or `validators.ts` module.

### srcDoc (hard-won — do not change back to blob URLs)
Blob URLs fail due to React re-render lifecycle. srcDoc is simpler and has no lifecycle dependencies.

### CDN Libraries
D3.js v7, Chart.js v4, Plotly.js, P5.js — all via cdn.jsdelivr.net

---

## 13. SVG/Mermaid Rendering in Chat

### Frontend Renderer (MarkdownRenderer.tsx)
Catches: mermaid/svg/xml/html fences, raw `<svg>` blocks

### sanitizeMermaidCode()
- Node labels with colons → wrap in quotes
- Edge labels: strip `(){}:<>_&%#"`
- Node IDs starting with numbers → prefix `n`
- >15 nodes → truncate
- Parse error → fallback to readable code block

### SVGDiagram.tsx
- Removes `<script>`, `on*` handlers, external hrefs, `<foreignObject>`
- Returns null if SVG < 50 chars

### SVG Prompt Rules
- Always wrap in ` ```svg ``` ` fence
- viewBox: always `"0 0 800 400"`
- Colors: #2563EB blue, #1E40AF dark blue, #16A34A green, #D97706 amber, #DC2626 red

---

## 14. Prompt Engineering Architecture

All prompts follow PTCF (Persona → Task → Context → Format) with XML tag structure.

### buildTutorSystemPrompt (Chat)
Uses `detectQueryMode(message)` to select behavioral branch before building prompt:

```typescript
type QueryMode = "exam_prep" | "problem_solving" | "conceptual"

function detectQueryMode(message: string): QueryMode {
  // exam_prep: "define", "list", "state", "what is the formula", short queries
  // problem_solving: numbers + "calculate"/"solve"/"find"
  // conceptual: everything else (default)
}
```

- **exam_prep** — drops curiosity hook and metacognition. Direct structured answer. Ends with "Want a quick quiz on this?"
- **problem_solving** — step-by-step solution with labeled steps. Ends with "Try a variation: [one related numerical]"
- **conceptual** — full LearnLM prompt (active learning, cognitive load management, curiosity, metacognition)

Complexity adjusts by semester (1-2: beginner, 3-4: intermediate, 5+: advanced).

### buildOutlinePrompt (PPT Outline)
Key rules: canonical diagram mandate, CONCEPT→DIAGRAM→EXAMPLE teaching sequence, renderHint rules, activity slide mandate, Indian context mandate, hook slide structural rule.

### buildBatchContentPrompt (PPT Content)
Key rules: JSON-only output, accuracy mandate, no placeholder diagrams, no truncation, Indian context in examples, layout variety by slide type.

### Q Paper Generation Prompt (sectionGen.ts — buildUserPrompt)
7-part prompt structure: examination context → module-question assignment (code-computed) → syllabus content → CO/PO/BTL rules → PYQ style reference (always) → quality standards (21 rules) → output schema.

Key: module assignment is computed in `moduleAssignment.ts` (pure TS, weightage-based greedy algorithm) and injected as explicit slot→module mapping. AI never decides which module goes to which slot.

### Answer Key Prompt (answerKeyGen.ts)
System: Senior Professor and Chief Examiner persona.
Per question: model answer + marking scheme breakdown (marks per component) + partial credit guidance + alternative approach note.
MCQ block: Flash, one-sentence justification + one-sentence distractor note per MCQ.
Q2-Q4 blocks: Pro, full step-by-step solutions with intermediate values.

---

## 15. PDF Export Architecture

### PDFBuilder Class (`/lib/pdf/builder.ts`)
Shared across all PDF exports. Handles markdown (headings, bold, bullets, numbered lists, tables, code blocks).

### Answer Key PDF (answerKeyGen.ts — buildAnswerKeyPDF)
- "CONFIDENTIAL — FOR EVALUATORS ONLY" in header
- Same style as Q paper (plain text, no markdown tables, no backtick blocks)
- Partial credit notes as plain "Note:" prefix
- OR alternatives and both Q4 options always shown

---

## 16. Question Paper Generation System

### UI (faculty/qpaper/page.tsx)
**Three sections:**
1. Paper metadata form: university name, exam title, semester, date, time, instructions (editable list)
2. Template selector: [PPSU ESE — 60M] [CE Quiz — 10M] [Custom] — clicking prefills drag-drop builder
3. Drag-drop builder (@dnd-kit/core): sections → questions, per-question type/marks/OR toggle/attempt-any

**After generation:**
- Paper preview with CO/BTL/PO badges per question
- Per-question regenerate button (single Pro call, maxTokens 2048)
- Inline edit textarea
- "Update PDF" re-export
- "Save as template" with name input
- "Generate Answer Key" button → CONFIDENTIAL PDF download

### API Architecture (generate/qpaper/route.ts)
1. Load: subject_content, modules (with section_number/weightage_percent/btl_levels), course_outcomes, co_po_mapping, exam_scheme, pyq_questions (up to 40, always loaded)
2. Compute module-to-slot assignment: `assignModulesToSlots()` in moduleAssignment.ts
3. Generate: two parallel Pro calls (Section I, Section II), each 8192 maxTokens
4. Validate: `validateGeneratedSection()` — BTL must be within module's allowed range; auto-retry once on failure
5. Build PDF via builder.ts (PPSU format: CO BTL PO columns, OR separator, Bloom's legend footer)
6. Upload to Supabase Storage, return signed URL

### Template System
Three presets auto-seeded on first load:
- `PPSU_ESE`: 2 sections × 30M, Q1(MCQ×6), Q2(6M), Q3(a+b with OR, 6M each), Q4(attempt any one, 6M)
- `CE_QUIZ`: 1 section, Q1(MCQ×10, 1M each)
- `CUSTOM`: starts empty, faculty builds from scratch

Saved templates stored in `qpaper_templates` table per subject.

### Slot Key Convention
Section-relative: Q1–Q4 regardless of section number (Section II also uses Q1–Q4).
`attempt_any_one` uses parent key "Q4" with nested `options[]` — NOT Q4_i/Q4_ii as separate top-level keys.
CO normalization: "CO1", "CO 1", "01", "co1" all normalize to "01" before validation.

### Q Paper PDF Format (PPSU standard)
- University header → exam title → course code → date/time/marks row → instructions → sections
- CO BTL PO columns at fixed x-positions right-aligned per question
- OR separator centered between main and alternative Q3
- Bloom's legend + Course Outcomes footer on last page

---

## 17. Architectural Decisions (DO NOT CHANGE)

| Decision | Reason |
|---|---|
| `proxy.ts` for auth, NOT `middleware.ts` | Next.js 16 specific |
| Layout files are PURE UI — zero auth checks | Prevents redirect loops |
| `supabase-browser.ts` → client components ONLY | Server import crashes client |
| `supabase-server.ts` → server + API routes ONLY | Client import crashes server |
| Cosine similarity in JS loop, NEVER `.rpc()` | PostgREST silently truncates 3072-dim vectors |
| Embeddings: 3072 dimensions, string format for insert | `[${embedding.join(',')}]` format |
| `thinkingBudget: 0` for all JSON tasks | Thinking tokens consume maxOutputTokens on Flash |
| PPT dimensions: 10" × 5.625" | Anything else causes overflow/scaling bugs |
| PPT split into 3 routes | Vercel 60s timeout |
| Diagram batches: 1 slide per request | Prevents SVG token truncation |
| Content batches: 5 slides per request | Prevents Flash truncation |
| Chat session: resume per subject (72h window) | Per-subject resume prevents stateless tutor. force_new=true param for explicit fresh start. |
| Cache hits must save messages to DB | Was a bug — cache hits skipped saving |
| srcDoc for interactive viz, not blob URLs | Blob URLs break due to React re-render revoking them |
| PYQ via Gemini Flash direct (not LlamaParse) | LlamaParse returns raw text; Flash extracts structured {q_text, co, btl, po} directly |
| Section-relative slot keys (Q1–Q4 per section) | Prevents Section II slot naming mismatch (Q5-Q8 never shown to AI) |
| Module assignment computed in code, not by AI | AI decides content quality, not structural distribution; guarantees weightage compliance |
| Answer key Pro calls: maxTokens 12288 | Full section answers exceed 8192 — truncation caused Section II failures |
| Supabase India ISP DNS block | Fix: Cloudflare DNS (1.1.1.1) or WARP VPN |

---

## 18. Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
PRIMARY_AI_PROVIDER=gemini
LLAMA_CLOUD_API_KEY=          # For LlamaParse (notes upload)
```

---

## 19. Known Issues

| Issue | Status | Fix |
|---|---|---|
| Flash cost shows ₹0.0000 in PPT log | Active | Wire `totalFlashCost` from routeAI responses in build route |
| Supabase India ISP DNS block (since Feb 2026) | Ongoing | Cloudflare DNS or WARP VPN |
| Supabase free tier pauses after 1 week inactivity | Ongoing | Keep active before demos |
| RLS temporarily disabled on profiles + documents | Active | Re-enable before go-live |
| Email confirmation disabled | Active | Re-enable before go-live |
| Gemini Flash free tier: 15 RPM | Constraint | Stagger batch calls with 800ms delay |
| Vercel free: 60s timeout | Managed | PPT split routes each stay under 60s |
| PPT diagram slides: all 5 showing broken image (red ✗) | Fixed (May 30) | Diagram batches routed to Pro (`ppt_diagram` task) + `<5KB` image blob guard in generator.ts — verify on next generation |
| Q paper answer key Q3 main/OR answers swapped | Active | splitQuestionsForBlocks fix pending |
| PPT `💡 Real world` callouts still truncating (14/45 slides) | Fixed (May 30) | `capNote` now caps at 120 chars on a word boundary with no ellipsis; `BATCH_PROMPT_COMPLETENESS` added — verify on next generation |
| Hook slides generating bullet lists instead of scenario | Mitigated (May 30) | `OUTLINE_PROMPT_HOOK_SLIDE` rewritten to a single-scenario structural rule — verify on next generation |

---

## 20. Active Feature Roadmap

### Recently Shipped (May 31)
- **Real CSE Sem 1–4 syllabus seeded** — `supabase/seed_cse_sem1_4.sql` (22 subjects, 127 modules, 96 COs). See Section 8.
- **Student-side UI retention overhaul** — retired "red for any low score" in favour of a semantic score system (`lib/ui/score.ts`: not-started = slate, in-progress = amber, on-track = emerald, target-aware; `components/ui/score-meter.tsx` for the "X% → target 65%" framing). Applied across dashboard (score badges, AI-Tutor reframed as an action card, dismissible tip moved up, daily warmth line), subjects (dropped redundant "Engineering" tag, Chat as primary action), quiz (prominent Generate CTA, inline-not-toast validation, "What do you want to focus on?" label, History count), placement (grey not-started vs amber skill bars, last-score + Retake on company cards, tests-taken surfaced), and placement history (strengths-first ordering, target-framed header). Pure CSS + small pure functions; no new deps, queries, or generation cost.
- Faculty quick wins — depth-radio + refine-card selected-state fills; sidebar "Request Change" → "Request Note Update".

### Recently Shipped (May 30)
- PPT diagram batches routed to Pro (`ppt_diagram` task) + `<5KB` image blob guard in generator.ts
- `💡` callout truncation fix — `capNote` 120-char word-boundary cap, no ellipsis
- Hook slide structural rewrite (single scenario, not a bullet list)
- Mandatory activity slides + Indian-context mandate + layout-variety constants wired into the PPT prompts

### In Progress
- **PPT Continuous Refinement** — routes (`generate/ppt/{content,image,rebuild,refine}`) and the `faculty/generate/refine/[contentId]` page exist; faculty loads slide JSON via `contentId`, AI patches only that slide's JSON, rebuilds PPTX → new signed URL. Slide JSON stored in `generated_content.metadata`.
- Q paper answer key Q3 main/OR swap fix

### PPT Pipeline Improvements
1. Parallel batch processing (full Promise.all on content batches)
2. JSON schema enforcement via Gemini `responseSchema` parameter

### Practical Coding Feature (student)
Scenario-based coding exercises with pre-filled programs and blanks. `/student/lab/page.tsx`. Flash for generation, Pro fallback. Semantic evaluation (no code execution).

### Lecture → PPT Pipeline (faculty)
Part 1 (UI): MediaRecorder in-browser, no streaming during recording — built
Part 2 (API): `/api/lecture/transcribe` — Gemini audio → structured segments
Part 3 (wiring): segments → existing PPT outline pipeline

### Additional Features
- NAAC auto-report generator (Criteria 2 + 6)
- LlamaParse full RAG for notes (chunking + embedding pipeline)
- Analytics — real data (struggle detection signals, most-asked questions, cache hit rate)
- Multi-department expansion (repurpose `department` column)
- Multi-tenant architecture (`tenant_id` on all tables)
- Camera Ask (Vision) — photograph textbook problem
- WhatsApp bot via Twilio/WATI

---

## 21. External / Non-Technical Context

> ⚠️ This section contains business and strategic context that may be outdated. Included for background only. Do not use for technical decisions.

**Competitive positioning:** Not ChatGPT for students (no syllabus lock, no governance). Not OpenMAIC (consumer, no governance). EduNexus is the institutional layer — the Dean buys it, not the student.

**Domain context injection for multi-department PPTs:**
When a new department is onboarded, add 3-4 lines of exam conventions to the subject's metadata. This is the only thing that varies between departments — all structural quality rules are universal.

Example conventions:
- CS/IT: Graph problems use Indian city networks. Sorting uses IPL/cricket statistics. DP uses startup/investment scenarios.
- Mechanical: Optimization uses manufacturing/assembly line scenarios. Graph problems use supply chain logistics.
- Chemical: Optimization uses reaction yield/cost trade-offs. Graph problems use pipeline network routing.
- Commerce: Knapsack uses portfolio optimization with ₹ budgets. Scheduling uses bank teller allocation.

---

## 22. How Dhruv Works (Development Patterns)

1. **Cursor-primary workflow:** Runs Cursor prompts → shares terminal logs/screenshots → Claude verifies → iterates.
2. **Simplicity over complexity:** Rejects solutions that add layers without solving the root problem.
3. **Generic over hardcoded:** Fixes must be domain-agnostic. Will flag narrow solutions immediately.
4. **Surgical changes preferred:** Targeted single-file edits over full rewrites. Cursor for single-file, Claude Code for multi-file.
5. **Cost-consciousness:** Architecture decisions actively optimize API costs.
6. **Edge cases matter:** Real-world scenarios (tab switching, accidental navigation) get explicit handling.
7. **Verification loop:** Shares exact logs and screenshots after each change; expects verification before proceeding.
8. **Honest assessments:** Wants honest comparative assessments, not confirmation.
9. **Communication style:** Terse and directive.
10. **Writing preferences:** No AI-generated tone, no em dashes, bullet points, simple direct language.

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
- Always read `CLAUDE_CONTEXT.md` before responding to any development task
- Check Section 17 (architectural decisions) before suggesting changes
- Provide targeted Cursor prompts, not full file rewrites
- Follow PTCF + XML tag structure for prompt engineering changes
- Set `thinkingBudget: 0` for any structured JSON generation task
- Never use `.rpc()` for cosine similarity — always JS loop
- PPT dimensions are 10" × 5.625" — never change
- `department = "Engineering"` for all rows — filter by `branch` only
- Section-relative slot keys for Q paper — Q1–Q4 per section, not Q5–Q8
- Module assignment for Q paper is code-computed — never ask AI to pick modules