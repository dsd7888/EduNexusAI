# EduNexus AI — Complete Project Context (Updated)

## 1. Project Overview
- AI-powered university tutor + institutional intelligence platform
- Current: Pilot — 80 students, 2 branches (Chem + Mech), 12 subjects, 4 faculty, 1 month
- Vision: Scalable SaaS for T-2 and private universities across India
- Grant approved: ₹10,000 (ask) for pilot phase
- Stack owner: Solo developer (Dhruv), using Cursor AI + Claude for development
- Repo: https://github.com/dsd7888/EduNexusAI

---

## 2. Tech Stack (Final)
- Frontend: Next.js 16 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- Backend: Next.js API Routes (serverless)
- Database: Supabase (PostgreSQL + pgvector + Auth + Storage)
- AI Primary: Gemini 2.5 Flash (chat/quiz/suggestions) + Gemini 2.5 Pro (PPT/qpaper/refine)
- AI Embeddings: gemini-embedding-001 (3072-dimensional vectors)
- PDF Parsing: LlamaParse (replaces pdf-parse — handles equations, tables, scanned PDFs)
- Deployment: Vercel (Pro plan for 300s function timeout)
- Repo: https://github.com/dsd7888/EduNexusAI

---

## 3. Role Hierarchy & Permissions

### SUPERADMIN (Dhruv, for pilot)
- Created manually in Supabase dashboard
- Upload: syllabus PDFs, notes PDFs, PYQ PDFs (RAG source of truth)
- Approve OR reject faculty note-change requests (with comments)
- Assign faculty to specific subjects
- View ALL analytics across entire platform
- Access to all generated content

### DEPT_ADMIN (post-pilot)
- Same as superadmin but scoped to their department only

### FACULTY (4 people, assigned to subjects by superadmin)
- Can only access assigned subjects
- CANNOT upload directly to RAG (must go through admin approval)
- Submit note-change requests (pending → superadmin approval)
- Generate: PPT, Visual Notes, Refined Notes, Question Paper
- View analytics for assigned subjects only

### STUDENT (80 students, self-registered)
- Chat with AI tutor (syllabus-locked)
- Self-generate quizzes for knowledge check
- Placement readiness prep (aptitude + technical)
- View own quiz history, scores, placement readiness score

---

## 4. Content Architecture

### Pilot approach (TEXT-BASED, no PDF RAG yet):
- Superadmin pastes syllabus text into subject_content table
- This text is injected into Gemini system prompt as full context
- No chunking, no pgvector search for chat (too small for pilot)
- Semantic cache (JS cosine similarity, threshold 0.78) prevents repeated API calls

### Post-pilot (FULL PDF RAG via LlamaParse):
- LlamaParse replaces pdf-parse entirely
- LlamaParse free tier: 1,000 pages/day (enough for all pilot content in 4 days)
- Paid: $0.003/page — 3,360 pages = ~₹850 one-time
- Flow: PDF upload → LlamaParse API → clean markdown → chunked → embedded → pgvector
- Handles: tables, LaTeX equations, multi-column, scanned PDFs (OCR)
- LlamaParse API call pattern (REST, no Python needed):
  ```typescript
  // Upload
  POST https://api.cloud.llamaindex.ai/api/parsing/upload
  Authorization: Bearer ${LLAMA_CLOUD_API_KEY}
  Body: formData (PDF file)
  → returns { id }
  
  // Poll result (10-30s)
  GET https://api.cloud.llamaindex.ai/api/parsing/job/${id}/result/markdown
  → returns { markdown } // clean text with structure preserved
  ```

---

## 5. Database Schema (18 tables)

### Core Tables:
- profiles: id, email, full_name, role, department, branch, semester
- subjects: id, name, code, department, branch, semester
- modules: id, subject_id, name, module_number, description
- exam_structures: id, subject_id, total_marks, total_questions, time_limit_minutes, sections (jsonb)
- faculty_assignments: id, faculty_id, subject_id, assigned_by, assigned_at

### Content Tables:
- subject_content: id, subject_id (UNIQUE), content (TEXT), reference_books (TEXT), created_by
- documents: id, module_id, subject_id, type, title, file_path, year, uploaded_by, status
- document_chunks: id, document_id, content, page_number, chunk_index, embedding vector(3072), metadata jsonb
- note_change_requests: id, subject_id, module_id, requested_by, reviewed_by, current_doc_id, new_file_path, reason, status, admin_comment, reviewed_at

### Chat Tables:
- chat_sessions: id, student_id, subject_id (NEW: session created fresh per page visit)
- chat_messages: id, session_id, role, content, citations (jsonb), tokens_used, model_used, cost_inr

### Quiz Tables:
- quizzes: id, module_id, subject_id, title, difficulty, questions (jsonb), generated_by
- quiz_attempts: id, quiz_id, student_id, answers (jsonb), score, time_taken

### Generation Tables:
- generated_content: id, subject_id, module_id, type, title, file_path, metadata (jsonb), generated_by, tokens_used, cost_inr, status

### Placement Tables (NEW - to build):
- placement_companies: id, name, branches (TEXT[]), aptitude_pattern (jsonb), difficulty, avg_package_lpa
- placement_questions: id, company_id, branch (TEXT[]), category, subcategory, question, options (jsonb), answer, explanation, difficulty, syllabus_mapped (boolean)
- placement_attempts: id, student_id, company_id, score, category_scores (jsonb), time_taken, created_at

### System Tables:
- semantic_cache: id, subject_id, module_id, query_text, query_embedding vector(3072), response, hit_count, last_used_at
- usage_analytics: id, date, user_id, subject_id, event_type, event_count, tokens_used, cost_inr

---

## 6. Critical Technical Decisions (DO NOT CHANGE)

### Auth:
- proxy.ts handles ALL auth (Next.js 16 — NOT middleware.ts)
- Layouts are PURE UI — zero auth checks
- supabase-browser.ts → client components ONLY
- supabase-server.ts → server components + API routes ONLY

### Embedding:
- gemini-embedding-001 = 3072 dimensions (NOT 768)
- All vector columns: vector(3072)
- Insert format: `[${embedding.join(',')}]` (string, not raw array)
- Read back: `String(row).replace(/^\[|\]$/g,'').split(',').map(Number)`

### Semantic Cache:
- NEVER use Supabase .rpc() for cosine similarity — PostgREST truncates 3072-dim vectors silently
- Use JavaScript cosine similarity instead (fetch all rows, compute in JS)
- Threshold: 0.78

### Chat Sessions (FIXED BUG):
- NEW SESSION created every time student opens a subject chat page
- Session ID created via POST /api/chat/session on mount
- Session ID passed from frontend in every chat API call
- Never look up existing session server-side (was causing all messages in one session forever)
- Messages saved for BOTH cache hits and cache misses (was a bug — cache hits skipped saving)
- Keep max 5 sessions per student (async cleanup after save)

### PPT Generation:
- Split into 3 routes for Vercel free tier compatibility (each call < 60s):
  * POST /api/generate/ppt/outline → slide structure JSON
  * POST /api/generate/ppt/batch → content for 8 slides at a time
  * POST /api/generate/ppt/build → PPTX buffer + Storage upload
- Correct slide dimensions: 10" × 5.625" (NOT 7.5" — was root of overflow bug)
- cap() strips markdown only, never truncates
- capTitle() for titles only (max 90 chars)
- Dynamic font sizing: bullets ≤4 → 15pt, ≤6 → 14pt, >6 → 13pt
- autoFit: true on all text boxes

### PDF Export (FIXED):
- All exports use shared /lib/pdf/builder.ts (PDFBuilder class)
- Parses markdown: ## headings, **bold**, - bullets, 1. numbered lists
- Never dumps raw markdown as text
- Chat export: user messages blue-tinted, AI messages green-tinted, full markdown rendering
- Quiz export: ✓ green correct, ✗ red wrong, options color-coded
- Notes export: full markdown rendered with section headings

### AI Router:
- chat → gemini-2.5-flash
- quiz_gen → gemini-2.5-flash
- ppt_gen → gemini-2.5-flash (Pro has 0 free quota)
- qpaper_gen → gemini-2.5-pro
- refine → gemini-2.5-pro
- embed → gemini-embedding-001
- Fallback: 429 → try next provider

---

## 7. File Structure (Current State)

```
edunexus-ai/
├── src/
│   ├── proxy.ts                              ← Auth middleware
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx               ✅
│   │   │   └── register/page.tsx            ✅
│   │   ├── (superadmin)/
│   │   │   ├── layout.tsx
│   │   │   └── superadmin/
│   │   │       ├── dashboard/page.tsx       ✅
│   │   │       ├── upload/page.tsx          ✅
│   │   │       ├── approvals/page.tsx       ✅
│   │   │       ├── faculty/page.tsx         ✅
│   │   │       ├── subjects/page.tsx        ✅
│   │   │       └── analytics/page.tsx       ✅
│   │   ├── (faculty)/
│   │   │   ├── layout.tsx
│   │   │   └── faculty/
│   │   │       ├── dashboard/page.tsx       ✅
│   │   │       ├── generate/page.tsx        ✅ PPT generation
│   │   │       ├── qpaper/page.tsx          ✅ Question paper
│   │   │       ├── request-change/page.tsx  ✅
│   │   │       ├── refine/page.tsx          ✅
│   │   │       └── analytics/page.tsx       ✅
│   │   ├── (student)/
│   │   │   ├── layout.tsx                   ✅ Mobile hamburger menu
│   │   │   └── student/
│   │   │       ├── dashboard/page.tsx       ✅
│   │   │       ├── subjects/page.tsx        ✅ Quick Notes modal per subject
│   │   │       ├── chat/[subjectId]/page.tsx ✅ Creates new session on mount
│   │   │       ├── quiz/page.tsx            ✅ Multi-subject, match MCQ, pagination
│   │   │       ├── history/page.tsx         ✅ Last 3 sessions, subject-labeled
│   │   │       └── placement/page.tsx       ← TODO (next build)
│   │   ├── api/
│   │   │   ├── auth/callback/route.ts       ✅
│   │   │   ├── subjects/content/route.ts    ✅
│   │   │   ├── upload/route.ts              ✅ (upgrade to LlamaParse)
│   │   │   ├── faculty/assign/route.ts      ✅
│   │   │   ├── approvals/route.ts           ✅
│   │   │   ├── chat/route.ts                ✅ Rate limit + session fix
│   │   │   ├── chat/session/route.ts        ← TODO (new session creation)
│   │   │   ├── chat/suggestions/route.ts    ✅
│   │   │   ├── chat/export/route.ts         ✅ PDFBuilder
│   │   │   ├── quiz/generate/route.ts       ✅
│   │   │   ├── quiz/submit/route.ts         ✅
│   │   │   ├── quiz/hint/route.ts           ✅
│   │   │   ├── notes/route.ts              ✅
│   │   │   ├── notes/export/route.ts       ✅ PDFBuilder
│   │   │   ├── generate/ppt/outline/route.ts ✅
│   │   │   ├── generate/ppt/batch/route.ts  ✅ Retry logic
│   │   │   ├── generate/ppt/build/route.ts  ✅
│   │   │   ├── generate/qpaper/route.ts     ✅
│   │   │   ├── refine/route.ts              ✅
│   │   │   └── placement/
│   │   │       ├── generate/route.ts        ← TODO
│   │   │       └── submit/route.ts          ← TODO
│   │   ├── auth/loading/page.tsx            ✅
│   │   ├── layout.tsx
│   │   └── page.tsx                         ✅ Role-based redirect
│   ├── components/
│   │   ├── ui/                              ✅ shadcn
│   │   ├── layout/
│   │   │   ├── NavLink.tsx                  ✅
│   │   │   ├── LogoutButton.tsx             ✅
│   │   │   ├── UserProfile.tsx              ✅
│   │   │   └── PageSkeleton.tsx             ✅
│   │   └── ErrorBoundary.tsx                ✅
│   └── lib/
│       ├── ai/
│       │   ├── providers/gemini.ts          ✅
│       │   ├── router.ts                    ✅
│       │   ├── prompts.ts                   ✅
│       │   └── cache.ts                     ✅
│       ├── db/
│       │   ├── supabase-browser.ts          ✅
│       │   ├── supabase-server.ts           ✅
│       │   ├── types.ts                     ✅
│       │   └── queries.ts                   ✅
│       ├── pdf/
│       │   ├── builder.ts                   ✅ PDFBuilder (all exports)
│       │   ├── parser.ts                    ← Upgrade to LlamaParse
│       │   └── chunker.ts                   ← Post-pilot
│       ├── ppt/
│       │   └── generator.ts                 ✅ Fixed dimensions + cap/capTitle
│       ├── quiz/
│       │   └── generator.ts                 ✅ Match as MCQ
│       ├── placement/
│       │   └── generator.ts                 ← TODO
│       └── utils/
│           └── rate-limit.ts                ✅
├── supabase/migrations/
├── vercel.json                              ✅
└── CLAUDE_CONTEXT.md
```

---

## 8. Environment Variables
```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
PRIMARY_AI_PROVIDER=gemini
LLAMA_CLOUD_API_KEY=          ← ADD THIS (from cloud.llamaindex.ai)
```

---

## 9. Completed Features

### Days 1-3 ✅
- Next.js 16 + Supabase + pgvector + Gemini setup
- Auth (login, register, proxy.ts, role-based redirect)
- PDF upload (Supabase Storage), faculty assignment, approvals queue

### Day 4 ✅
- subject_content table (plain text syllabus)
- Student subjects selector, full chat UI
- /api/chat — JS cosine cache + Gemini Flash + session management
- Semantic cache working (0.78 threshold)

### Day 5 ✅
- Quiz generation (MCQ, True/False, Short Answer, Match-as-MCQ)
- Socratic hints, quiz submit + scoring
- Multi-subject quiz, results pagination (10/page)

### Days 6-7 ✅
- PPT generation (3-route split, correct dimensions, no overflow)
- chunkBullets fix (no orphan continuation slides)
- Gemini refusal detection + fallback placeholder slides

### Day 8 ✅
- Question paper generation (PYQ-aware, PDF output)

### Day 9 ✅
- Content refinement (faculty paste text → Gemini Pro refines)
- Note change request flow

### Day 10 ✅
- Rate limiting (50 chat/20 quiz/30 hints per student per day)
- User profile in sidebar (name, role badge, semester)
- Root page redirect by role
- Error boundaries + loading skeletons
- Mobile responsive (hamburger menu, touch targets, iOS zoom fix)
- All 3 dashboards (superadmin/faculty/student) with real data
- Chat history page (last 3 sessions, subject-labeled, export PDF)
- Quick Notes (per subject, cached, export PDF)
- Chat session bug fixed (new session per page visit, cache hits save messages)
- All PDF exports rebuilt with PDFBuilder (markdown-aware, visually clean)

---

## 10. Known Issues / Watch Out For

- **Next.js 16:** proxy.ts not middleware.ts
- **Embeddings:** 3072 dimensions, string format for Supabase insert
- **Supabase cosine similarity:** NEVER use .rpc() — use JS cosine in loop
- **Cache hits:** must save messages to DB (was bug — fixed)
- **Session creation:** must come from frontend (POST /api/chat/session on mount)
- **PPT dimensions:** 10" × 5.625" — never change
- **Gemini Flash free tier:** 15 RPM — stagger batch calls with 800ms delay
- **Supabase India ISP:** DNS block since Feb 2026. Fix: Cloudflare DNS (1.1.1.1) or WARP VPN
- **Supabase free:** projects pause after 1 week inactivity — keep active before demo
- **Vercel free:** 60s timeout — PPT split routes each stay under 60s
- **Email confirmation:** disabled for pilot — RE-ENABLE before go-live
- **RLS:** temporarily disabled on profiles and documents — RE-ENABLE on Day 11

---

## 11. Placement Readiness Module (NEXT BUILD — 3 days)

### Vision
Not generic aptitude prep. Company-specific + branch-adaptive.
- TCS/Infosys/Wipro/L&T/Bosch/Capgemini each have known aptitude patterns
- Mech students get Thermodynamics/Fluid Mechanics technical questions from their syllabus
- Chemical students get Process Engineering technical questions
- CS students get DSA technical questions
- Same engine, same API — fully adaptive via syllabus content injection

### Question Mix per company test (30 questions, 30 min):
- Quantitative (40%): number series, percentages, time-distance, profit-loss
- Logical (30%): syllogisms, blood relations, coding-decoding, arrangements
- Verbal (20%): reading comprehension, fill blanks, error correction
- Technical (10%): branch-specific from student's actual syllabus

### Generation approach:
- AI generates questions dynamically via Gemini Flash (no manual question bank needed)
- Company pattern + branch + syllabus content → Gemini → 30 questions JSON
- Technical questions grounded in student's actual subject syllabus
- Returns: [{question, options:[A,B,C,D], answer, explanation, subcategory}]

### Skill radar:
- 5-axis: Quantitative / Verbal / Logical / Technical / Speed
- Updates after each attempt
- Shows gap vs company benchmark ("TCS needs 70% quant, you're at 58%")

### New tables needed:
```sql
placement_companies (id, name, branches[], aptitude_pattern jsonb, difficulty, avg_package_lpa)
placement_questions (id, company_id, branch[], category, subcategory, question, options jsonb, answer, explanation, difficulty, syllabus_mapped bool)
placement_attempts (id, student_id, company_id, score, category_scores jsonb, time_taken, created_at)
```

### New routes:
- POST /api/placement/generate — generate test for company + student branch
- POST /api/placement/submit — score + save attempt + update skill radar

### New pages:
- /student/placement/page.tsx — company grid + skill radar + recent attempts
- /student/placement/test/[companyId]/page.tsx — 30Q test (reuse quiz UI)
- Add "Placement" to student sidebar

---

## 12. Visual Learning Gap (NEXT BUILD — add to chat)

### Problem
Chat gives text answers only. Engineering needs diagrams (cycles, mechanisms, processes).

### Fix: Mermaid diagrams inline in chat
- Add `remark-mermaidjs` package to chat UI
- Update system prompt: AI generates ```mermaid blocks for processes/cycles/structures
- Renders inline in ReactMarkdown — no extra API calls, no cost
- Exports cleanly in PDF (as image via mermaid-js render)

### Diagram types to generate:
- Flowchart: processes, workflows (Carnot cycle steps, distillation process)
- Graph: relationships between concepts
- Pie/bar: data distributions when relevant

### In Quick Notes:
- Same addition — notes auto-include Mermaid diagrams for applicable topics

---

## 13. LlamaParse Integration (NEXT BUILD — 2 hours)

### Replace pdf-parse in /api/upload/route.ts:
```typescript
const LLAMA_API = 'https://api.cloud.llamaindex.ai/api/parsing'

async function parseWithLlamaParse(fileBuffer: Buffer, fileName: string): Promise<string> {
  const formData = new FormData()
  formData.append('file', new Blob([fileBuffer]), fileName)
  
  // Upload
  const upload = await fetch(`${LLAMA_API}/upload`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.LLAMA_CLOUD_API_KEY}` },
    body: formData
  })
  const { id } = await upload.json()
  
  // Poll (max 60s)
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const result = await fetch(`${LLAMA_API}/job/${id}/result/markdown`, {
      headers: { 'Authorization': `Bearer ${process.env.LLAMA_CLOUD_API_KEY}` }
    })
    if (result.ok) {
      const { markdown } = await result.json()
      return markdown
    }
  }
  throw new Error('LlamaParse timeout')
}
```

### Benefits unlocked:
- Tables in PDFs → preserved as markdown tables
- Equations → preserved as LaTeX
- Scanned notes (handwritten) → OCR'd correctly
- Multi-column layouts → linearized properly
- Full RAG becomes viable (no more garbage chunks from bad parsing)

---

## 14. Infrastructure & Scaling

### Supabase limits:
- Free: 500MB DB, 1GB Storage, 50K MAUs
- Pro ($25/month = ~₹2,100): 8GB DB, 100GB Storage
- Storage risk: PPTs ~3MB each → 150 PPTs = 450MB → hits free limit
- Recommendation: Upgrade to Pro before pilot launch
- pgvector on Pro handles millions of embeddings — no switch needed

### Vercel:
- Free (Hobby): 60s max function timeout
- Pro ($20/month = ~₹1,650): 300s timeout for PPT generation
- Split PPT routes already handle 60s limit — Hobby plan is workable

### Multi-tenancy (post-pilot):
- Currently single-tenant (one university, one DB)
- For scaling to multiple universities: need tenant_id on all tables + RLS isolation
- Architecture: one Supabase project, row-level tenant isolation
- Each university gets subdomain: university-name.edunexus.ai

---

## 15. Product Vision & Roadmap

### What EduNexus IS (vs competitors):
- Not a generic AI tutor (ChatGPT, OpenMAIC, EaseLearn)
- Institutional intelligence platform — syllabus-locked, governance-enforced, accreditation-aware
- OpenMAIC = immersive classroom for any topic (consumer, no governance)
- EaseLearn = K-12 voice doubts (consumer, different market)
- EduNexus = university-specific curriculum intelligence with admin control

### The 3 things that create institutional lock-in:
1. **Syllabus lock** — content is their RAG. Can't replicate without their PDFs.
2. **Faculty workflow** — PPTs, Q papers, refine all live here. Moving = losing content library.
3. **Accreditation data** — once generating NAAC reports, embedded in regulatory process.

### Version roadmap:
**V1 (Current — pilot):**
- Syllabus-locked AI chat, quiz gen, PPT gen, Q paper gen, content refine
- Role governance (superadmin/faculty/student)
- Basic analytics

**V2 (Month 1-2 post-pilot):**
- LlamaParse PDF ingestion (proper RAG)
- Placement readiness (aptitude + skill radar)
- Mermaid visual diagrams in chat
- Bulk CSV student onboarding
- Student struggle detection alerts
- NAAC auto-report generator (Criteria 2 + 6)

**V3 (Month 3-4):**
- Multi-tenant architecture
- OBE/Bloom's taxonomy tagging on quiz questions (CO/PO mapping)
- Exam paper formatter (matches university board paper pattern exactly)
- Department-level admin dashboard
- Camera ask (Vision) — point phone at diagram, get explanation
- University logo toggle on PPT title slide

**V4 (Month 5-6):**
- WhatsApp bot integration (Twilio/WATI, same RAG pipeline)
- Voice doubt resolution (Web Speech API + TTS)
- Immersive classroom module (OpenMAIC-style, premium tier)
- Hindi + Gujarati/Marathi regional language support
- Cross-university anonymised benchmarking

**V5 (Month 7-12 — data moat):**
- National skill-gap index across enrolled universities
- Placement outcome tracking (which students got placed where)
- Curriculum gap detector (syllabus vs what students actually ask)
- Annual India Engineering Education Report (publishable)

### Pricing (when going commercial):
- Pilot tier: ₹15,000/month — up to 500 students, 2 departments
- Standard tier: ₹35,000/month — up to 2,000 students, all departments, NAAC reports
- Enterprise tier: ₹75,000/month — unlimited students, white-label, custom integrations

### The pitch to a dean:
"EduNexus ensures students only learn exactly what your syllabus says, faculty spend half the time on content creation, and your NAAC auditor gets a 40-page usage report without anyone lifting a finger."

---

## 16. Unique Add-On Features (Optional / Chargeable)

### Camera Ask (Vision) — V3
- Student points phone camera at handwritten problem or diagram
- Gemini 1.5 Pro Vision processes image + question
- Answer grounded in their syllabus (same RAG pipeline)
- Implementation: pass base64 image in chat API body alongside question
- 2 days to build, massive adoption driver on mobile

### Immersive Classroom (V4 — premium)
- AI teacher explains topic in structured narrative
- AI "students" ask the questions real confused students ask
- Triggered by faculty for specific hard topics only
- Not for all content — too expensive. But premium wow moment.
- Inspired by OpenMAIC but syllabus-locked and faculty-controlled

### University Logo on PPT (V3 — easy win)
- Toggle in generate page: "Add university logo to title slide"
- Faculty uploads logo once in settings
- Embedded on slide 1 as official institutional notes
- Makes content feel official → increases faculty adoption

---

## 17. Student Intelligence Features (V2)

### Struggle Detection
Already have the data — just need to surface it:
- Same concept asked 3+ times in chat → weak concept flag
- Quiz score < 40% on topic X across 2 attempts → weak topic
- No platform activity for 5 days → engagement drop
- Combine signals → risk score per student (Low/Medium/High)
- Faculty sees: "3 students at risk this week. Riya failed Bernoulli's twice and hasn't logged in since Tuesday."

### Dropout Signals
- Engagement drop: logins/week trending down 3 weeks in a row
- Quiz attempt frequency dropping
- Chat session length decreasing
- Faculty + admin get weekly alert digest

### Curriculum Gap Detector
- Compare syllabus topics with what students actually ask about in chat
- If 40% of Thermodynamics questions are on topics not in syllabus text → flag to admin
- Generates "Syllabus coverage report" quarterly

---

## 18. How to Start New Chat With Claude

Paste this at start of new chat:
```
I am building EduNexus AI, a university AI tutor + institutional intelligence platform.
I am a solo developer (Dhruv) using Cursor + Claude.
Completed: Days 1-10 (full pilot feature set).
Next build: [FEATURE NAME].
Full context: [paste this file]
Build approach: Give me 4-5 prompts per part (Part A, Part B...).
I run them, share Cursor summary for cross-check, then continue.
```

---

## 19. Current Build Queue (In Priority Order)

1. **Chat session fix** — POST /api/chat/session + session ID from frontend (bug fix)
2. **LlamaParse integration** — replace pdf-parse in upload route (2 hours)
3. **Placement readiness module** — DB tables + generate API + submit API + UI (3 days)
4. **Mermaid diagrams in chat** — remark-mermaidjs + system prompt update (2 hours)
5. **University logo toggle on PPT** — settings + generate page toggle (1 hour)
6. **Verify PPT diagram slides** — open generated PPTX in PowerPoint, check SVGs render
7. **Supabase Pro upgrade** — before pilot launch (Storage limit)
8. **Re-enable RLS** on profiles and documents
9. **Re-enable email confirmation** before go-live
Additional but important: Check every prompting code, if the prompts are highly optimised according to official documentation. i.e. Finest Prompt engineering. 

TODO: Aptitude engine, management side, soft skills