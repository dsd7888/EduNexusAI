# EduNexus AI — Complete Project Context

*Last updated: June 7, 2026 | Solo developer: Dhruv | Stack: Next.js 16 + Supabase + Gemini*
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
  chat: "flash",              // maxTokens: 16384
  quiz_gen: "flash",          // maxTokens: 8192
  ppt_gen: "flash",           // maxTokens: 32768
  ppt_diagram: "pro",         // maxTokens: 16384 — diagram-only batches
  ppt_extract: "flash",       // maxTokens: 512 — topic/level detection
  ppt_refine: "flash",        // maxTokens: 16384 — PPT content refinement batches
  qpaper_gen: "pro",          // maxTokens: 8192 per section
  answer_key_mcq: "flash",    // maxTokens: 2048
  refine: "flash",            // maxTokens: 8192
  placement_gen: "pro",       // maxTokens: 32768
  syllabus_extract: "flash",  // maxTokens: 8192
  pyq_extract: "flash",       // maxTokens: 4096
  qbank_generate: "flash",    // maxTokens: 8192
  qbank_tag: "flash",         // maxTokens: 2048
  explainer_ideate: "flash",  // maxTokens: 8192, thinking ON (thinkingBudget: 2048 via ChatParams)
  explainer_extract: "pro",   // maxTokens: 16384, thinkingBudget: 0 (structured JSON + responseSchema)
}
```

**CRITICAL:** `thinkingBudget: 0` for ALL structured JSON tasks. Gemini 2.5 Flash's thinking tokens consume `maxOutputTokens`, causing JSON truncation. Hard-won discovery.

**`ChatParams` extended fields (added June 2026):**
- `responseSchema?: object` — forces `responseMimeType: application/json` + schema-constrained output. Guarantees valid JSON on first call, no parse retry needed.
- `thinkingBudget?: number` — caps (not disables) thinking for tasks that need reasoning but must leave output headroom. Takes priority over the `isStructuredTask` default.

**Thinking budget rules:**
- `explainer_ideate`: thinking ON, capped at 2048 via `thinkingBudget: 2048` in ChatParams
- All other non-structured tasks: thinking uncapped (Flash default)
- All structured JSON tasks (in `isStructuredTask` list): `thinkingBudget: 0`

**Answer key generation:** 6 parallel calls per paper (2× Flash MCQ, 4× Pro main+alternatives).

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
- `qpaper_templates`: id, subject_id, created_by, name, is_default, university_name, exam_title, duration_minutes, total_marks, instructions text[], structure jsonb
- `pyq_questions`: id, document_id, subject_id, section_name, q_number, question_text, question_type, marks, co, btl, po, options jsonb, year

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
│   │   │   ├── qpaper/                             ✅ Q paper builder
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
│   │       ├── generate/ppt/outline/ + batch/ + build/ + content/[id]/ + image/[id]/[idx]/ + rebuild/ + refine/ ✅
│   │       ├── generate/qpaper/ + answer-key/ + regenerate-question/ + export/ + export-docx/ ✅
│   │       ├── qpaper/templates/ + templates/[id]/ ✅
│   │       ├── qbank/generate/ + import/ + list/ + [id]/ + questions/ + sample-csv/ ✅
│   │       ├── ppt-refine/extract/ + refine/       ✅
│   │       ├── refine/                             ✅
│   │       ├── explainer/generate/ + list/ + [id]/ ✅ (routes exist, UI under development)
│   │       ├── placement/generate/ + submit/ + export/ ✅
│   │       └── placement/practice/generate/ + submit/ + export/ ✅
│   ├── components/ui/ + layout/ + chat/ + ppt/ + ErrorBoundary.tsx ✅
│   ├── hooks/useSupabaseData.ts                    ✅
│   └── lib/
│       ├── ai/providers/types.ts + gemini.ts       ✅ (responseSchema + thinkingBudget added to ChatParams)
│       ├── ai/router.ts + prompts.ts + imagen.ts   ✅
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
│       ├── qpaper/generator.ts + sectionGen.ts + moduleAssignment.ts + answerKeyGen.ts + templates.ts + builder.ts + bankFill.ts + docxBuilder.ts ✅
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
│   └── 20260604000001_dean_hod_roles.sql           ✅ applied
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
- Drag-drop builder, 3 presets, CO/PO/BTL mapping, module-weighted distribution (code-computed)
- 4 source options: All Fresh | PYQ + Fresh Mix | PYQ Style Only | From Q Bank
- PYQ structured RAG always fed regardless of mode
- Per-question regeneration, inline edit, inline save-to-bank
- Answer key generation (CONFIDENTIAL PDF, 6 parallel calls)
- Word (.docx) export — exact structure match to PDF

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

**Known issues (pending fix):**
- HTML tags (<b>, <i>) from Gemini appearing as literal text in new slides
- Body text overflow on image-heavy slides
- Empty title placeholder handling on slides with no original title

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
- "From Q Bank": type+marks match (exact then ±0.5 tolerance)
- Order: is_verified DESC, usage_count ASC, RANDOM()
- Dedup via shared used_ids set, fallback to AI for unfilled slots

---

## 12. Question Paper Generation System

### Question Sources
1. All Fresh — pure AI from syllabus
2. PYQ + Fresh Mix — AI with PYQ style reference
3. PYQ Style Only — similar to PYQs (same concept, different values — NOT identical)
4. From Q Bank — draws from faculty_question_bank, AI fills gaps

### Key rules
- Module assignment computed in code (moduleAssignment.ts) — AI never picks modules
- Section-relative slot keys Q1–Q4 per section
- PYQ RAG always fed regardless of source mode
- CO normalization: "CO1", "CO 1", "01", "co1" all → "01"

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
- PPT Refinement — full pipeline with XML patching
- Q Bank — bulk generation, CSV/TXT import, Q paper integration, Word export
- Q paper Word (.docx) export
- Animated Explainers infrastructure (pipeline + storage + routes built; UI under development)

### Priority Order (current)

**Tier 1 — Fix before showing anyone (quick wins):**
1. PPT refinement: HTML tags in new slides (strip <b>/<i> in refiner)
2. PPT refinement: empty title placeholder INSERT logic
3. PPT refinement: body overflow on image-heavy slides
4. Q paper answer key Q3 main/OR swap (splitQuestionsForBlocks)
5. Q bank sessionStorage handoff to Q paper page
6. Resume builder PDF/Word export QA
7. Expand interview prep bank to 30+ questions
8. Test TPO dashboard with real student batch

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
| Q paper answer key Q3 main/OR swap | Active | splitQuestionsForBlocks fix pending |
| PPT refinement: HTML tags in new slides | Active | Strip <b>/<i> in refiner.ts parseRefineBatchResponse |
| PPT refinement: body overflow on image slides | Active | Image-aware body height + normAutofit |
| PPT refinement: empty title = "Click to add title" | Active | INSERT text logic for empty placeholders |
| Q bank UX too complex | Active | Simplification needed |
| Q bank sessionStorage handoff | Active | qpaper page not wired to consume staged questions |
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
| Answer key Pro: maxTokens 12288 | Full answers exceed 8192 |
| adm-zip NOT unzipper | Turbopack build failure with unzipper |
| XML patching for PPT refinement | Round-trip parse/rebuild re-encodes nodes, breaks PowerPoint |
| get_my_role() SECURITY DEFINER for RLS | Breaks profiles→profiles recursion |
| Faculty access via faculty_assignments only | Cross-school teaching support |
| subject_content.created_by nullable | Seeded data has no creating user |
| responseSchema on structured AI calls | Guarantees valid JSON, eliminates parse retry loops |
| thinkingBudget: 2048 for explainer_ideate | Caps thinking, reserves ~6k tokens for narrative output |
| Explainer renderer = pattern library | AI classifies content type, code renders it -- not AI specifying pixel coords |

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