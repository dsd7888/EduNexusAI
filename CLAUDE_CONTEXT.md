# EduNexus AI - Complete Project Context

## 1. Project Overview
- AI-powered university tutor platform
- Pilot: 100 students, 2 branches (Chem + Mech), 12 subjects, 4 faculty, 1 month
- Goal: Syllabus-locked AI tutor with content generation
- Stack owner: Solo developer (Dhruv), using Cursor AI for code generation

## 2. Tech Stack
- Frontend: Next.js 16 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- Backend: Next.js API Routes (serverless)
- Database: Supabase (PostgreSQL + pgvector + Auth + Storage)
- AI Primary: Gemini 2.5 Flash (chat/quiz) + Gemini 2.5 Pro (PPT/qpaper/refine)
- AI Embeddings: gemini-embedding-001 (returns 3072-dimension vectors)
- Deployment: Vercel (free tier)
- Repo: https://github.com/dsd7888/EduNexusAI

## 3. Role Hierarchy & Permissions

### SUPERADMIN (Dhruv, for pilot)
- Created manually in Supabase dashboard (never via registration)
- Upload: syllabus PDFs, notes PDFs, PYQ PDFs (these become the RAG source of truth)
- Approve OR reject faculty note-change requests (with comments)
- Assign faculty to specific subjects
- Create/manage faculty accounts
- View ALL analytics across entire platform
- See all generated content across all faculty
- Can do everything faculty can do

### DEPT_ADMIN (future - post pilot)
- Same as superadmin but scoped to their department only
- Cannot touch other departments

### FACULTY (4 people, assigned to subjects by superadmin)
- Can only access subjects they are assigned to
- CANNOT upload directly to RAG (must go through admin approval)
- Can submit note-change requests:
  * Upload new version of notes for a module
  * Add reason for change
  * Goes to superadmin pending queue
  * Students cant see until approved
- Can generate (from approved content only):
  * PPT (visual presentation for any module/topic)
  * Visual Notes (enhanced visual version of existing notes)
  * Refined Notes (improved readability version)
  * Question Paper (new questions not seen in PYQs)
- Can view analytics for their assigned subjects only:
  * Student quiz scores by topic
  * Most asked questions in chat
  * Cache hit rate
  * Usage stats

### STUDENT (100 students, self-registered)
- Chat with AI tutor (syllabus-locked, text-based content)
- Self-generate quizzes for knowledge check
- View own quiz history and scores
- Cannot access faculty or admin features

## 4. Content Architecture (PILOT APPROACH)

### No PDF RAG for pilot — text-based syllabus instead:
- Superadmin pastes syllabus text directly into subject_content table
- This text becomes the AI tutor's knowledge source
- Full PDF RAG (chunking + pgvector search) deferred to post-pilot
- This approach ships faster, works for any subject, and is easier to manage

### Content Flow:
1. Superadmin → Subjects → Syllabus Content tab → paste syllabus + reference books → Save
2. Student selects subject → chat opens with that subject's syllabus locked in context
3. AI answers ONLY from that syllabus + its own broader knowledge (marked as "Extra insight")
4. Semantic cache stores responses → repeated/similar questions served instantly

### Faculty Note Change Request Flow (for post-pilot PDF upgrade):
1. Faculty goes to /faculty/request-change
2. Selects subject + module, uploads new PDF, writes reason
3. Superadmin reviews → approves (re-embeds) or rejects (with comment)

## 5. Database Schema (16 tables)

### Core Tables:
- profiles: id, email, full_name, role, department, branch, semester
- subjects: id, name, code, department, branch, semester
- modules: id, subject_id, name, module_number, description
- exam_structures: id, subject_id, total_marks, total_questions, time_limit_minutes, sections (jsonb)
- faculty_assignments: id, faculty_id, subject_id, assigned_by, assigned_at

### Content Tables:
- subject_content: id, subject_id (UNIQUE), content (TEXT), reference_books (TEXT),
  created_by, created_at, updated_at
  → This is the pilot's primary knowledge source (plain text syllabus)
- documents: id, module_id, subject_id, type ('syllabus'/'notes'/'pyq'), title,
  file_path, year (PYQs only), uploaded_by, status ('processing'/'ready'/'failed'/'archived')
- document_chunks: id, document_id, content, page_number, chunk_index,
  embedding vector(3072), metadata jsonb
- note_change_requests: id, subject_id, module_id, requested_by, reviewed_by,
  current_doc_id, new_file_path, reason, status ('pending'/'approved'/'rejected'),
  admin_comment, reviewed_at

### Chat Tables:
- chat_sessions: id, student_id, subject_id, module_id
- chat_messages: id, session_id, role, content, citations (jsonb),
  tokens_used, model_used, cost_inr

### Quiz Tables:
- quizzes: id, module_id, subject_id, title, difficulty, questions (jsonb), generated_by
- quiz_attempts: id, quiz_id, student_id, answers (jsonb), score, time_taken

### Generation Tables:
- generated_content: id, subject_id, module_id, type, title, file_path,
  metadata (jsonb), generated_by, tokens_used, cost_inr, status

### System Tables:
- semantic_cache: id, subject_id (nullable FK), module_id (nullable FK),
  query_text, query_embedding vector(3072), response, hit_count, last_used_at, created_at
  → CHECK constraint: subject_id IS NOT NULL OR module_id IS NOT NULL
  → subject_id used for chat cache, module_id reserved for future module-level cache
- usage_analytics: id, date, user_id, subject_id, event_type,
  event_count, tokens_used, cost_inr

## 6. Critical Technical Decisions

### Embedding Dimensions: 3072 (NOT 768)
- gemini-embedding-001 returns 3072-dimensional vectors
- Both document_chunks.embedding and semantic_cache.query_embedding must be vector(3072)
- Original schema had vector(768) — was migrated via ALTER TABLE

### Semantic Cache: JavaScript cosine similarity (NOT pgvector RPC)
- DO NOT use Supabase .rpc() for vector similarity — PostgREST truncates large payloads
  (3072-dim embedding = ~40,000 chars) causing silent failures where every similarity = 1
- Solution: fetch all cache rows for subject, compute cosine similarity in JavaScript
- Similarity threshold: 0.78 (catches typos, keywords, rephrasing; misses different topics)
- Works reliably for pilot scale (few hundred cache rows max)
- For scale (10k+ rows): migrate to pgvector with proper connection pooling, not PostgREST

### Embedding Format for Supabase Inserts:
- Always format as string: `[${embedding.join(',')}]` before inserting into Supabase
- Raw JS arrays silently fail on vector columns via Supabase JS client
- When reading back from DB, parse: `String(row.query_embedding).replace(/^\[|\]$/g,'').split(',').map(Number)`

### Auth Architecture:
- proxy.ts handles ALL auth logic and redirects (NOT middleware.ts — deprecated in Next.js 16)
- Layout files are PURE UI — zero auth checks, zero redirects
- supabase-browser.ts → client components ONLY
- supabase-server.ts → server components and API routes ONLY
- NEVER import cookies() or next/headers in client components

### AI Router Logic:
- chat → gemini-2.5-flash
- quiz_gen → gemini-2.5-flash
- ppt_gen → gemini-2.5-pro
- qpaper_gen → gemini-2.5-pro
- refine → gemini-2.5-pro
- embed → gemini-embedding-001
- Fallback: if 429 rate limit → try next provider

### AI Tutor Prompt Design:
- Complexity adapts to semester: ≤2 = beginner, 3-4 = intermediate, ≥5 = advanced
- Syllabus text injected directly into system prompt (full context, no chunking)
- AI can use broader knowledge but must mark it as "💡 Extra insight:"
- Out-of-scope questions: AI refuses and lists 2-3 actual syllabus topics
- Citations format: "📚 Ref: Unit X / {referenceBook}"

### Output Rendering:
- Assistant messages rendered via ReactMarkdown + remark-math + rehype-katex
- katex/dist/katex.min.css imported for LaTeX math rendering
- Handles: bold, bullets, numbered lists, tables, LaTeX equations ($$...$$)

## 7. File Structure (Current State)

```
edunexus-ai/
├── src/
│   ├── proxy.ts                          ← Auth middleware
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── register/page.tsx
│   │   ├── (superadmin)/
│   │   │   ├── layout.tsx                ← Pure UI sidebar
│   │   │   └── superadmin/
│   │   │       ├── dashboard/page.tsx
│   │   │       ├── upload/page.tsx       ✅ Syllabus + PYQ upload
│   │   │       ├── approvals/page.tsx    ✅ Note-change approvals
│   │   │       ├── faculty/page.tsx      ✅ Faculty assignment
│   │   │       └── subjects/page.tsx     ✅ Subjects + Modules + Syllabus Content tabs
│   │   ├── (faculty)/
│   │   │   ├── layout.tsx
│   │   │   └── faculty/
│   │   │       ├── dashboard/page.tsx
│   │   │       ├── generate/page.tsx      ← TODO Day 7
│   │   │       ├── qpaper/page.tsx        ← TODO Day 8
│   │   │       ├── request-change/page.tsx ← TODO Day 9
│   │   │       └── analytics/page.tsx     ← TODO Day 10
│   │   ├── (student)/
│   │   │   ├── layout.tsx
│   │   │   └── student/
│   │   │       ├── dashboard/page.tsx     ✅ Links to subjects + quiz
│   │   │       ├── subjects/page.tsx      ✅ Subject selector grid
│   │   │       ├── chat/[subjectId]/page.tsx ✅ Full chat UI
│   │   │       └── quiz/page.tsx          ← TODO Day 5
│   │   ├── api/
│   │   │   ├── auth/callback/route.ts     ✅
│   │   │   ├── subjects/content/route.ts  ✅ GET (all roles) + POST (superadmin only)
│   │   │   ├── upload/route.ts            ✅
│   │   │   ├── faculty/assign/route.ts    ✅
│   │   │   ├── approvals/route.ts         ✅
│   │   │   ├── chat/route.ts              ✅ Full chat + JS cosine cache
│   │   │   ├── chat/suggestions/route.ts  ✅ 4 suggested prompts
│   │   │   ├── quiz/generate/route.ts     ← TODO Day 5
│   │   │   └── quiz/submit/route.ts       ← TODO Day 5
│   │   ├── auth/loading/page.tsx          ✅
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── ui/                            ✅ shadcn components
│   │   └── layout/
│   │       ├── NavLink.tsx                ✅
│   │       └── LogoutButton.tsx           ✅
│   └── lib/
│       ├── ai/
│       │   ├── providers/
│       │   │   ├── types.ts               ✅
│       │   │   └── gemini.ts              ✅ Flash + Pro + Embedding
│       │   ├── router.ts                  ✅ task-based model routing
│       │   └── prompts.ts                 ✅ buildTutorSystemPrompt + buildSuggestedPromptsRequest
│       ├── db/
│       │   ├── supabase-browser.ts        ✅
│       │   ├── supabase-server.ts         ✅
│       │   ├── types.ts                   ✅
│       │   └── queries.ts                 ✅
│       ├── pdf/                           ← TODO post-pilot
│       ├── ppt/                           ← TODO Day 7
│       ├── quiz/
│       │   └── generator.ts              ← TODO Day 5
│       └── qpaper/                        ← TODO Day 8
├── supabase/
│   └── migrations/
│       └── 20260207000000_initial_schema.sql
├── CLAUDE_CONTEXT.md                      ← This file
├── .env.local
└── package.json
```

## 8. Environment Variables
```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
PRIMARY_AI_PROVIDER=gemini
```

## 9. Completed Features

### Day 1 ✅
- Next.js 16 project setup
- Supabase project + 15 table schema with RLS + pgvector
- Gemini AI provider (Flash + Pro + Embedding)
- Smart AI router with task-based model selection
- shadcn/ui component library

### Day 2 ✅
- proxy.ts auth middleware
- Login + Register pages (full validation, keyboard nav)
- Auth callback + loading page (role-based redirect)
- Route group layouts (superadmin/faculty/student) — pure UI sidebars
- NavLink + LogoutButton components
- handle_new_user trigger fixed
- Superadmin account created manually

### Day 3 ✅
- PDF upload system (/superadmin/upload) — Syllabus + PYQ tabs
- Faculty assignment page (/superadmin/faculty)
- Approvals page (/superadmin/approvals)
- API routes: /api/upload, /api/faculty/assign, /api/approvals
- Notes tab hidden for pilot (placeholder shown)

### Day 4 ✅
- subject_content table added (plain text syllabus storage)
- Superadmin Syllabus Content tab (/superadmin/subjects → "Syllabus Content")
- /api/subjects/content (GET: all roles, POST: superadmin only)
- /lib/ai/prompts.ts — buildTutorSystemPrompt + buildSuggestedPromptsRequest
- Student subjects page (/student/subjects) — branch+semester filtered grid
- Student chat page (/student/chat/[subjectId]) — full chat UI with:
  * 4 AI-generated suggested prompt cards
  * Markdown + LaTeX rendering (ReactMarkdown + KaTeX)
  * User/assistant message bubbles
  * Auto-scroll, Enter to send
- /api/chat — full pipeline:
  * JS cosine similarity cache check (threshold: 0.78)
  * Gemini Flash with full syllabus in context
  * Cache write on miss, hit_count update on hit
  * chat_sessions + chat_messages saved
  * usage_analytics tracked
- /api/chat/suggestions — 4 subject-specific prompts with fallback defaults
- Semantic cache working correctly:
  * Same question → instant cache hit
  * Typos/keywords/rephrasing → cache hit (0.78 threshold)
  * Different topics → cache miss, new AI call

  Day 5 ✅

/lib/quiz/generator.ts — buildQuizPrompt, buildSocraticHintPrompt, parseQuizResponse
/api/quiz/generate — generates from subject_content, saves to quizzes table
/api/quiz/submit — scores answers, saves to quiz_attempts
/api/quiz/hint — single Socratic hint per question (no answer revealed)
/student/quiz/page.tsx — full 3-view flow (setup → taking → results)

Module/topic selection filters quiz to specific content
Socratic Mode toggle — shows 💡 hint button per question during quiz
Results show full breakdown with explanations



Day 6 ✅

/lib/ppt/generator.ts — two-phase generation (outline + batch content)

buildOutlinePrompt, buildBatchContentPrompt
generatePPTXBuffer using pptxgenjs
SVG diagrams embedded as base64 images
stripMd() helper to clean Gemini markdown artifacts


/api/generate/ppt — full pipeline: outline → 3 content batches → PPTX → Supabase Storage → download URL
/faculty/generate/page.tsx — module dropdown OR custom topic, depth selector, rotating status messages
Supabase Storage bucket: generated-content (public)
Known: gemini-2.5-pro has 0 free tier quota — using Flash for pilot

## 10. Known Issues / Watch Out For

- **Next.js 16:** use proxy.ts not middleware.ts
- **Embedding dimensions:** gemini-embedding-001 = 3072, NOT 768. All vector columns must be vector(3072)
- **Supabase + vectors:** NEVER use .rpc() for cosine similarity — PostgREST truncates large payloads silently. Use JS cosine similarity instead for pilot scale.
- **Embedding insert format:** always convert to string `[x,x,x,...]` before Supabase insert. Raw JS arrays silently fail.
- **Semantic cache threshold:** 0.78 — lower catches more rephrasing, higher is more strict. Do not go below 0.75 (risk of wrong cache hits across different topics).
- **Route groups:** pages need full URL path (/student/chat not /chat)
- **Never auth check in layouts** — causes redirect loops
- **supabase-browser.ts in client components ONLY**
- **gemini-embedding-001:** uses embedContent() not generateContent()
- **Email confirmation:** disabled for pilot dev, RE-ENABLE before go-live
- **Gemini free tier:** 20 RPD limit on gemini-2.5-flash (hit during testing). Use sparingly or upgrade.
- **Always clear .next cache after moving files:** rm -rf .next

- PPT generation takes 60-120s (3 sequential API calls) — expected, UI handles it
- 4 faculty simultaneously = fine. 10+ faculty = Gemini rate limit risk — needs pay-as-you-go billing post-pilot
- Markdown stripping applied to all slide text (Gemini adds **bold** despite instructions)

## 11. Pending Features / Backlog

### Report Answer Button (PLANNED — add before go-live)
Students and faculty should be able to report incorrect or unhelpful AI responses.
This is critical because:
- Semantic cache might serve a wrong cached response to a semantically similar but different question
- AI might hallucinate despite syllabus grounding
- Faculty need a way to flag bad responses for review

Proposed implementation:
- Thumbs down / "Report" button on every assistant message in chat
- Options: "Wrong answer", "Off-topic", "Incomplete", "Other"
- Stores in a `reported_responses` table: message_id, reporter_id, reason, details, resolved
- Superadmin sees reported responses in a new /superadmin/reports page
- If a reported response came from cache: admin can delete that cache entry
- Analytics: track report rate per subject (high report rate = syllabus content needs update)

Add this to Day 11 (Polish) or as a Day 12 task.

## 12. Remaining Build Plan

### Day 5: Quiz Generation (Student Feature)
- /lib/quiz/generator.ts — buildQuizPrompt + parseQuizResponse
- /api/quiz/generate — generate from subject_content, save to quizzes table
- /api/quiz/submit — score calculation, save to quiz_attempts
- /student/quiz/page.tsx — setup → taking → results flow
- Question types: MCQ, True/False, Short Answer
- Difficulty: Easy / Medium / Hard / Mixed

### Day 6: Semantic Cache Tuning (if needed) + Usage Analytics groundwork
- Verify cache performance with real student usage patterns
- Add cache hit rate logging

### Day 7: PPT Generation (Faculty Feature)
- Faculty generate page UI (form: subject, module, topics, depth, includes)
- /lib/ppt/generator.ts — Gemini Pro generates slide JSON
- pptxgenjs creates actual PPTX file
- Mermaid for flowcharts/algorithms, Imagen for conceptual diagrams
- /api/generate/ppt

### Day 8: Question Paper Generation (Faculty Feature)
- Faculty qpaper page UI
- Exam structure from exam_structures table
- Generate novel questions not seen in PYQs
- Format as PDF (pdf-lib)
- /api/generate/qpaper

### Day 9: Content Refinement (Faculty Feature)
- Faculty request-change page (upload new notes version)
- Admin side-by-side comparison UI
- Approve → re-embed, cache clear
- Reject → notify faculty with comment

### Day 10: Analytics Dashboard (Faculty)
- Usage charts (recharts)
- Topic heatmap (quiz scores by topic)
- Cache hit rate display
- Cost tracking

### Day 11: Polish + Rate Limiting + Report Feature
- Rate limiting (50 queries/student/day)
- Report answer button on chat messages
- /superadmin/reports page
- Error boundaries + loading skeletons
- Mobile responsive check
- User profile in sidebar
- Root page redirect based on role
- Re-enable RLS policies

### Day 12: Testing + Deploy
- Full flow testing (all 3 roles)
- Vercel deployment
- Environment variables on Vercel
- Supabase email confirmation re-enabled
- Faculty training session prep
- Student onboarding docs

## 13. How To Start New Chat With Claude

Paste this at start of new chat:
"I am building EduNexus AI, a university AI tutor platform.
I am a solo developer (Dhruv) using Cursor + Claude.
We have completed Days 1-4.
Next task is [DAY X: FEATURE NAME].
Here is my complete project context: [paste this entire file]
Please continue from where we left off."