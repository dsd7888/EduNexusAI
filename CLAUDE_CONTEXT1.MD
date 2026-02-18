Create/replace CLAUDE_CONTEXT.md in the project root with this complete content:

# EduNexus AI - Complete Project Context

## 1. Project Overview
- AI-powered university tutor platform
- Pilot: 100 students, 2 branches (Chem + Mech), 12 subjects, 4 faculty, 1 month
- Goal: Syllabus-locked AI tutor with content generation
- Grant: ₹3,000 approved for pilot
- Stack owner: Solo developer (Dhruv), using Cursor AI for code generation

## 2. Tech Stack
- Frontend: Next.js 16 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- Backend: Next.js API Routes (serverless)
- Database: Supabase (PostgreSQL + pgvector + Auth + Storage)
- AI Primary: Gemini 2.5 Flash (chat/quiz) + Gemini 2.5 Pro (PPT/qpaper/refine)
- AI Embeddings: gemini-embedding-001
- Deployment: Vercel (free tier)
- Repo: https://github.com/dsd7888/EduNexusAI

## 3. Role Hierarchy & Permissions

### SUPERADMIN (you - Dhruv, for pilot)
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
- Chat with RAG (approved content only, syllabus-locked)
- Self-generate quizzes for knowledge check
- View own quiz history and scores
- Cannot access faculty or admin features

## 4. Content Lifecycle

### Initial Setup (Superadmin uploads once):
1. Syllabus PDF → uploaded at subject level (not module level)
2. Notes PDFs → uploaded per module (or one big PDF split by module)
3. PYQ PDFs → uploaded per subject, tagged with year (2022, 2023, 2024)
All three become the RAG knowledge base → chunked → embedded → stored in pgvector

### Faculty Note Change Request Flow:
1. Faculty goes to /faculty/request-change
2. Selects subject (from assigned subjects only) + module
3. Uploads new PDF version of notes
4. Writes reason for change
5. Submits → status = 'pending'
6. Superadmin sees it in /superadmin/approvals
7. Superadmin views side-by-side: current notes vs new notes
8. Superadmin approves:
   - Old notes archived (status = 'archived' in documents table)
   - New notes go live (status = 'ready')
   - Old vectors deleted from document_chunks
   - New PDF re-chunked and re-embedded
   - Semantic cache cleared for that module
9. OR Superadmin rejects with comment → faculty notified

### Content Generation Flow (Faculty):
- All generation reads ONLY from approved (status='ready') documents
- Generated content stored in generated_content table
- Faculty can download as PDF or PPTX
- Students cannot see generated content directly (faculty decides what to share)

## 5. Database Schema (15 tables)

### Core Tables:
- profiles: id, email, full_name, role, department, branch, semester
- subjects: id, name, code, department, branch, semester
- modules: id, subject_id, name, module_number, description
- exam_structures: id, subject_id, total_marks, total_questions, time_limit_minutes, sections (jsonb)
- faculty_assignments: id, faculty_id, subject_id, assigned_by, assigned_at

### Content Tables:
- documents: id, module_id, subject_id, type ('syllabus'/'notes'/'pyq'), title, 
  file_path, year (PYQs only), uploaded_by, status ('processing'/'ready'/'failed'/'archived')
- document_chunks: id, document_id, content, page_number, chunk_index, 
  embedding vector(768), metadata jsonb
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
- semantic_cache: id, module_id, query_text, query_embedding vector(768), 
  response, hit_count, last_used_at
- usage_analytics: id, date, user_id, subject_id, event_type, 
  event_count, tokens_used, cost_inr

## 6. File Structure (Current State)
edunexus-ai/
├── src/
│   ├── proxy.ts                          ← Auth middleware (Next.js 16 = proxy.ts not middleware.ts)
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx            ← Email + password, show/hide, keyboard nav
│   │   │   └── register/page.tsx         ← Full registration with role/branch/semester
│   │   ├── (superadmin)/
│   │   │   ├── layout.tsx                ← Pure UI sidebar, NO auth checks
│   │   │   └── superadmin/
│   │   │       ├── dashboard/page.tsx
│   │   │       ├── upload/page.tsx        ← TODO Day 3
│   │   │       ├── approvals/page.tsx     ← TODO Day 3
│   │   │       └── faculty/page.tsx       ← TODO Day 3
│   │   ├── (faculty)/
│   │   │   ├── layout.tsx                ← Pure UI sidebar, NO auth checks
│   │   │   └── faculty/
│   │   │       ├── dashboard/page.tsx
│   │   │       ├── generate/page.tsx      ← TODO Day 7
│   │   │       ├── qpaper/page.tsx        ← TODO Day 8
│   │   │       ├── request-change/page.tsx ← TODO Day 9
│   │   │       └── analytics/page.tsx     ← TODO Day 10
│   │   ├── (student)/
│   │   │   ├── layout.tsx                ← Pure UI sidebar, NO auth checks
│   │   │   └── student/
│   │   │       ├── dashboard/page.tsx
│   │   │       ├── chat/page.tsx          ← TODO Day 4
│   │   │       └── quiz/page.tsx          ← TODO Day 6
│   │   ├── api/
│   │   │   ├── auth/callback/route.ts
│   │   │   ├── upload/route.ts            ← TODO Day 3
│   │   │   ├── chat/route.ts              ← TODO Day 4
│   │   │   ├── quiz/generate/route.ts     ← TODO Day 6
│   │   │   ├── quiz/submit/route.ts       ← TODO Day 6
│   │   │   ├── generate/ppt/route.ts      ← TODO Day 7
│   │   │   ├── generate/qpaper/route.ts   ← TODO Day 8
│   │   │   └── approvals/route.ts         ← TODO Day 3
│   │   ├── auth/loading/page.tsx          ← Role-based redirect after login
│   │   ├── layout.tsx                     ← Root layout
│   │   └── page.tsx                       ← Home (placeholder)
│   ├── components/
│   │   ├── ui/                            ← shadcn components
│   │   ├── layout/
│   │   │   ├── NavLink.tsx               ← Client, usePathname for active state
│   │   │   └── LogoutButton.tsx          ← Client, signOut + router.push('/login')
│   │   ├── auth/                          ← Empty, reserved
│   │   ├── chat/                          ← TODO Day 4
│   │   └── admin/                         ← TODO Day 3
│   └── lib/
│       ├── ai/
│       │   ├── providers/
│       │   │   ├── types.ts              ← AIProvider, ChatParams, ChatResponse interfaces
│       │   │   └── gemini.ts             ← Gemini Flash/Pro/Embedding implementation
│       │   ├── router.ts                 ← routeAI(task, params) with smart routing
│       │   ├── cache.ts                  ← TODO Day 5
│       │   └── prompts.ts                ← TODO (all system prompts go here)
│       ├── db/
│       │   ├── supabase-browser.ts       ← createBrowserClient() - client components ONLY
│       │   ├── supabase-server.ts        ← createServerClient(), createAdminClient(),
│       │   │                                createServerClientForRequestResponse()
│       │   ├── types.ts                  ← All DB TypeScript types
│       │   └── queries.ts                ← Common reusable DB queries
│       ├── pdf/
│       │   ├── parser.ts                 ← TODO Day 3
│       │   ├── chunker.ts                ← TODO Day 3
│       │   ├── embedder.ts               ← TODO Day 3
│       │   └── creator.ts                ← TODO Day 7/8
│       ├── ppt/
│       │   ├── generator.ts              ← TODO Day 7
│       │   └── templates.ts              ← TODO Day 7
│       ├── quiz/
│       │   └── generator.ts              ← TODO Day 6
│       ├── qpaper/
│       │   └── generator.ts              ← TODO Day 8
│       └── utils/
│           ├── auth.ts                   ← TODO
│           └── rate-limit.ts             ← TODO Day 11
├── supabase/
│   └── migrations/
│       └── 20260207000000_initial_schema.sql
├── CLAUDE_CONTEXT.md                     ← This file
├── .env.local                            ← Never commit
├── .env.example
└── package.json

## 7. Key Technical Decisions (DO NOT CHANGE)

### Auth Architecture:
- proxy.ts handles ALL auth logic and redirects
- Layout files are PURE UI - zero auth checks, zero redirects
- Layouts show static role badge (not fetched from DB)
- User profile shown in sidebar fetched via client component (TODO)
- supabase-browser.ts → client components only
- supabase-server.ts → server components and API routes only
- NEVER import cookies() or next/headers in client components

### Next.js 16 Specifics:
- middleware.ts is DEPRECATED → use proxy.ts
- Route groups (faculty) need full URL: /faculty/dashboard not just /dashboard
- Multiple route groups cannot share same URL segment (causes parallel page error)

### AI Router Logic:
- chat → gemini-2.5-flash
- quiz_gen → gemini-2.5-flash
- ppt_gen → gemini-2.5-pro
- qpaper_gen → gemini-2.5-pro
- refine → gemini-2.5-pro
- embed → gemini-embedding-001
- Fallback: if 429 rate limit → try next provider

### Cost Controls:
- Semantic cache with 0.92 cosine similarity threshold
- Rate limit: 50 queries/student/day
- Only approved documents in RAG
- Flash for cheap tasks, Pro for generation only

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
- Supabase project + 15 table schema with RLS
- pgvector extension enabled
- Gemini AI provider (Flash + Pro + Embedding)
- Smart AI router with task-based model selection
- shadcn/ui component library
- Test routes verified working

### Day 2 ✅
- proxy.ts auth middleware (renamed from middleware.ts)
- Login page (email/password, show/hide, keyboard nav, auto-focus)
- Register page (role-based fields, per-field validation, keyboard nav)
- Auth callback route
- Auth loading page (role-based redirect)
- Route group layouts (superadmin/faculty/student) - pure UI sidebars
- NavLink component (active state detection)
- LogoutButton component
- handle_new_user trigger fixed (reads role from metadata)
- Superadmin account created manually
- Email confirmation disabled for pilot
### Day 3 ✅
- PDF upload system (/superadmin/upload)
  * Upload syllabus, notes, PYQs to Supabase Storage
  * Store metadata in documents table with status='processing'
  * File naming: {type}_{subjectCode}_{timestamp}.pdf
  * Storage path: {type}/{subjectId}/{filename}
- Faculty assignment page (/superadmin/faculty)
  * Assign faculty to subjects (many-to-many)
  * View all current assignments grouped by faculty
  * Remove assignments with confirmation
  * Duplicate prevention
- Approvals page (/superadmin/approvals)
  * View all note-change requests (pending/approved/rejected)
  * Approve: archives old document, creates new document record
  * Reject: adds admin comment, cleans up uploaded file
  * Filter by status tabs
- API routes:
  * /api/upload - Handle PDF uploads
  * /api/faculty/assign - POST (assign), DELETE (remove)
  * /api/approvals - POST (approve/reject requests)
- RLS policies temporarily disabled on profiles and documents (re-enable on Day 11)


## 10. Remaining Build Plan

### Day 4: RAG Chat Pipeline
- Chat UI for students (/student/student/chat)
- match_documents SQL function (vector similarity search)
- Semantic cache check before API call
- Context building from top 5 chunks
- Gemini Flash with strict system prompt
- Citation extraction and display
- Chat session management
- /api/chat route

### Day 5: Semantic Cache
- Cache implementation in /lib/ai/cache.ts
- match_cache SQL function
- Cache hit/miss logging
- Cache invalidation on document update

### Day 6: Quiz Generation
- Quiz generation UI for students
- /lib/quiz/generator.ts
- JSON output parsing and validation
- Quiz taking UI with timer
- Score calculation
- /api/quiz/generate and /api/quiz/submit

### Day 7: PPT Generation
- Faculty generate page UI
- Gemini Pro generates slide structure (JSON)
- pptxgenjs creates actual PPTX
- Mermaid for flowcharts/algorithms
- Imagen for conceptual diagrams
- Download as PPTX
- /api/generate/ppt

### Day 8: Question Paper Generation
- Faculty qpaper page UI
- Exam structure from DB
- PYQ similarity check (embedding comparison)
- Generate novel questions only
- Format as proper exam PDF (pdf-lib)
- /api/generate/qpaper

### Day 9: Content Refinement
- Faculty request-change page
- Upload new notes version
- Pending queue in superadmin approvals
- Side-by-side comparison UI
- Approve → re-embed, cache clear
- Reject → notify faculty with comment

### Day 10: Analytics Dashboard
- Faculty analytics page
- Usage charts (recharts)
- Topic heatmap (quiz scores)
- Cost tracking display
- Cache hit rate

### Day 11: Polish + Rate Limiting
- Rate limiting (50 queries/student/day)
- Error boundaries
- Loading skeletons
- Mobile responsive check
- User profile in sidebar (client component)
- Root page redirect based on role

### Day 12: Testing + Deploy
- Full flow testing (all 3 roles)
- Vercel deployment
- Environment variables on Vercel
- Supabase email confirmation re-enabled
- Faculty training session prep
- Student onboarding docs

## 11. Known Issues / Watch Out For

- Next.js 16: use proxy.ts not middleware.ts
- Route groups: pages need full URL path to avoid parallel page conflicts
- Never auth check in layouts - causes redirect loops
- supabase-browser.ts in client components ONLY
- gemini-embedding-001: use embedContent() not generateContent()
- pdf-parse has Node version warning (ignore, works fine)
- Supabase free tier: 2 emails/hour rate limit
- Gemini free tier: region restrictions, use personal Google account
- Email confirmation: disabled for pilot dev, RE-ENABLE before go-live
- Always clear .next cache after moving files: rm -rf .next

## 12. How To Start New Chat With Claude

Paste this at start of new chat:
"I am building EduNexus AI, a university AI tutor platform.
I am a solo developer using Cursor + Claude.
We have completed Days 1 and 2.
Next task is [DAY X: FEATURE NAME].
Here is my complete project context: [paste this entire file]
Please continue from where we left off."