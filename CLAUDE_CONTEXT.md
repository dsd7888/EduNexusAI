I'm building EduNexus AI. Read CLAUDE_CONTEXT.md in my project for full context.
We completed Day 2. Starting Day 3: Superadmin Upload System.
Here is the context file: [paste CLAUDE_CONTEXT.md content]



# EduNexus AI - Claude Context

## 1. Project Overview

**EduNexus AI** is an AI-powered university tutor platform.

- **Pilot scope:** 100 students, 2 branches (Chem/Mech), 12 subjects, 4 faculty
- **Pilot duration:** 1 month

## 2. Tech Stack

- **Frontend:** Next.js 16 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Supabase (Postgres, pgvector, Auth, Storage)
- **AI:** Gemini 2.5 Flash (chat/quiz), Gemini 2.5 Pro (PPT/qpaper/refine)
- **Deployment:** Vercel

## 3. File Structure (Key Files)

| File | Purpose |
|------|---------|
| `src/proxy.ts` | Auth middleware (renamed from `middleware.ts` for Next.js 16) |
| `src/lib/db/supabase-browser.ts` | Supabase client for client components |
| `src/lib/db/supabase-server.ts` | Supabase client for server components + admin |
| `src/lib/ai/providers/gemini.ts` | Gemini AI provider |
| `src/lib/ai/router.ts` | Smart AI routing (task → model mapping) |
| `supabase/migrations/20260207000000_initial_schema.sql` | Initial DB schema |

## 4. Route Structure

- **Auth:** `(auth)/login`, `(auth)/register`
- **Superadmin:** `(superadmin)/superadmin/*` — superadmin/dept_admin only
- **Faculty:** `(faculty)/faculty/*` — faculty/superadmin
- **Student:** `(student)/student/*` — students only
- **Auth loading:** `auth/loading` — role-based redirect after login
- **API:** `api/auth/callback` — Supabase auth callback

## 5. Roles

| Role | Access | How Created |
|------|--------|-------------|
| superadmin | Full access | Created manually in Supabase |
| dept_admin | Department scoped (future) | — |
| faculty | Assigned to subjects by admin | — |
| student | Self-registered | Via `/register` |

## 6. Key Decisions Made

- **Layouts are pure UI wrappers** — no auth checks in layouts
- **`proxy.ts` handles all auth/redirect logic**
- **Email confirmation disabled** for pilot testing
- **Route groups** used for layouts; pages use full path (`/faculty/dashboard` not `/dashboard`)
- **Supabase clients split:** `supabase-browser.ts` for client, `supabase-server.ts` for server (avoids `next/headers` in client bundles)
- **AI models:**
  - `gemini-2.5-flash` — flash tasks (chat, quiz)
  - `gemini-2.5-pro` — pro tasks (PPT, qpaper, refine)
  - `gemini-embedding-001` — embeddings
- **Primary AI provider** set via `PRIMARY_AI_PROVIDER` env var

## 7. Days Completed

- **Day 1:** Project setup, DB schema (15 tables), AI provider, Supabase connection
- **Day 2:** Auth system (login, register, middleware, layouts, logout)

## 8. Days Remaining

| Day | Focus |
|-----|-------|
| 3 | Superadmin Upload System (PDF upload, text extraction, embeddings) |
| 4 | RAG Chat Pipeline |
| 5 | Semantic Cache |
| 6 | Quiz Generation |
| 7 | PPT Generation |
| 8 | Q Paper Generation |
| 9 | Content Refinement |
| 10 | Faculty Analytics Dashboard |
| 11 | Student Dashboards Polish |
| 12 | Rate Limiting, Testing, Deploy |

## 9. Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
PRIMARY_AI_PROVIDER=gemini
```

## 10. Known Issues / Watch Out

- **Next.js 16** uses `proxy.ts` not `middleware.ts`
- **Route groups** need full URL segments to avoid path conflicts
- **Never add auth checks in layout files** — causes redirect loops
- **Client components:** always use `supabase-browser.ts`
- **Server components:** always use `supabase-server.ts`
- **gemini-embedding-001** uses `embedContent()` not `generateContent()`
