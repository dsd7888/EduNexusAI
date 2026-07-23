# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Authoritative context

`CLAUDE_CONTEXT.md` (in this directory) is the deep reference: full DB schema, prompt
architecture, feature inventory, roadmap, and product strategy. Read it before any
non-trivial development task. This file is the operational quick-start; that file is
the source of truth for *why* things are the way they are.

The Next.js project lives in this `edunexus-ai/` subdirectory, not the repo root. All
commands below assume you are inside `edunexus-ai/`.

## Version-control discipline (non-negotiable)

**"Committed" and "safe" are different claims. Work that is committed but unpushed
exists only on one disk and is one failure away from gone — this has already bitten
this repo (a full feature sat unpushed on a local `dev` branch while its DB schema was
live in prod).**

- **Push before reporting a checkpoint or feature "done".** A completion report MUST
  include the output of `git push` and `git log origin/<branch> -1` — proof the remote
  has it — not just `git show --stat` of a local commit. If you cannot push, say so
  explicitly and call the work "committed locally, NOT pushed".
- **Feature work goes on a branch (`dev` or a feature branch), never straight to
  `main`.** `main` is the deployed pilot. Merging to `main` = deploying to live users;
  treat it as an outward-facing action that needs explicit approval, and never
  fast-forward `main` as a side effect of "finishing".
- **Schema and code ship together.** If a migration is applied to the live DB, the code
  that uses it must be pushed in the same breath — a prod schema referencing unpushed
  code is the failure mode above.
- Concurrent sessions on this repo have repeatedly bypassed these conventions
  (unpushed branches, direct-to-`main` pushes). Do not assume the remote matches your
  local state — `git fetch` and check `origin/*` yourself before branching or merging.

## Commands

```bash
npm run dev      # Next.js dev server (localhost:3000)
npm run build    # Production build — the primary correctness gate
npm run lint     # eslint (flat config, eslint-config-next)
npm run start    # Serve a production build
```

There is **no test framework and no test suite**. `npm run build` (full type-check +
Next.js compile) and `npm run lint` are the only automated checks. Verify changes by
building and by exercising the relevant role flow manually.

### Verification protocol (checkpoint / feature completion — non-negotiable)

Build + lint + a happy-path click-through is **not** sufficient verification and
must not be reported as if it were. Browser verification of any interactive
feature MUST include:

- **at least one interrupted flow** — back-navigate mid-async, switch subject/
  entity while a request is in flight, or double-click an action; and
- **at least one concurrent flow** — two actions overlapping (e.g. two Accepts,
  or an Accept while a re-fetch is running).

Rationale, learned the hard way (Syllabus Health Audit, Jul 2026): a stale-audit
race that rendered the Health tab permanently blank passed tsc, lint, build, and
a full happy-path browser drive — because every such bug lives in the *unhappy*
path (interrupted, concurrent, or slow), never the success path. Any handler that
mutates React state after an `await` needs a staleness/concurrency guard, and the
verification that would catch a missing one must be run before calling the work
done. **If an unhappy-path case was not exercised, the completion report must say
so explicitly** rather than implying full coverage.

## Stack

Next.js 16 (App Router, React 19) · TypeScript (strict) · Tailwind v4 · shadcn/ui
(new-york style) · Supabase (Postgres + pgvector + Auth + Storage) · Gemini 2.5
(Flash/Pro/embeddings/image) via `@google/generative-ai`. Path alias: `@/*` → `src/*`.

## Architecture

Four route groups under `src/app/`, each with a **pure-UI layout (zero auth logic)**:
`(auth)`, `(student)`, `(faculty)`, `(superadmin)`. Roles: superadmin / dept_admin /
faculty / student. The product is a syllabus-locked institutional AI platform — chat,
quiz, PPT/Q-paper/notes generation, and placement prep, all grounded in per-subject
syllabus text.

**Auth & route protection — `src/proxy.ts`.** This is the Next.js 16 middleware
equivalent (the project uses `proxy.ts`, *not* `middleware.ts`). It is the single place
that enforces sessions and role gating for both pages and `/api/*`. Layouts and pages
do not re-check auth. API route handlers re-verify via `requireAuth()` / `requireRole()`
in `src/lib/api/helpers.ts` (these return a `Response` on failure — caller must check
`instanceof Response` and early-return).

**Supabase clients — `src/lib/db/`, strictly segregated:**
- `supabase-browser.ts` → `createBrowserClient()` — client components only.
- `supabase-server.ts` → `createServerClient()` (RSC/route handlers, respects RLS),
  `createAdminClient()` (service role, bypasses RLS — server only),
  `createServerClientForRequestResponse()` (used by `proxy.ts`).
- Importing the wrong one across the server/client boundary crashes that runtime.

**AI access — always go through `src/lib/ai/router.ts` `routeAI(task, params)`.**
Never call the Gemini provider directly. The router maps task → model and sets
per-task `maxTokens`. Tasks: `chat`, `quiz_gen`, `ppt_gen`, `refine`,
`answer_key_mcq`, `syllabus_extract`, `pyq_extract` → Flash; `qpaper_gen`,
`ppt_diagram`, `placement_gen` → Pro. Provider impl: `src/lib/ai/providers/gemini.ts`.
Prompt builders are split by domain (PTCF + XML-tag structure): chat/notes/suggestion
builders and `detectQueryMode` in `src/lib/ai/prompts.ts`; the PPT outline/batch
builders (`buildOutlinePrompt`, `buildBatchContentPrompt`) in `src/lib/ppt/generator.ts`;
the Imagen prompt in `src/lib/ai/imagen.ts`; Q-paper/answer-key prompts in `src/lib/qpaper/`.
`prompts.ts` also exports the `OUTLINE_PROMPT_*` / `BATCH_PROMPT_*` constants that
`generator.ts` interpolates into the PPT builders.

**Generation pipelines** (`src/lib/{ppt,quiz,qpaper,refine,placement}/`): domain logic
is in `lib/`; thin orchestration is in `src/app/api/.../route.ts`. PPT is split across
three API routes (outline → batch → build) because Vercel free tier caps functions at
60s; the **frontend** sequences them. Per-route timeouts are declared in `vercel.json`.

**Chat content rendering** (`src/components/chat/`): AI replies may contain ` ```svg `,
` ```mermaid `, or ` ```interactive-html ` fences. `MarkdownRenderer.tsx` dispatches to
`SVGDiagram.tsx` / `MermaidDiagram.tsx`; interactive HTML renders in a sandboxed iframe
via the `srcDoc` attribute (the chat page component, `InteractiveHtmlViewer`).

**PDF export** — one shared `PDFBuilder` class in `src/lib/pdf/builder.ts` backs every
`/api/.../export` route (chat, notes, quiz, placement). It is markdown-aware.

## Load-bearing constraints (do not "fix" these)

Each was discovered through debugging; changing it reintroduces a known bug. Full table
with reasons is §17 of `CLAUDE_CONTEXT.md`.

- Auth middleware is `src/proxy.ts`, **never** `middleware.ts` (Next.js 16).
- Layout files are pure UI — no auth checks (prevents redirect loops).
- Never cross the `supabase-browser` / `supabase-server` import boundary.
- Semantic-cache cosine similarity is computed in a **JS loop, never via `.rpc()`**
  (PostgREST silently truncates the 3072-dim embedding vectors). Embeddings are
  inserted as the string `` `[${embedding.join(',')}]` ``.
- `thinkingBudget: 0` for **all** structured-JSON tasks (Flash thinking tokens eat
  `maxOutputTokens`, truncating JSON).
- PPT slide dimensions are `10" × 5.625"` (16:9) — never change.
- PPT content batches = 5 slides/request; diagram batches = 1 slide/request.
- Interactive viz uses `srcDoc`, never blob URLs (React re-renders revoke blobs).
- DB invariant: `department` is `"Engineering"` for every row (single-dept pilot).
  Filter subject/user queries by `branch` only, never `department`.
- Chat sessions resume per subject within a 72h window (not new per page visit;
  `force_new=true` forces a fresh one); messages are saved for
  cache **hits and misses** alike.

## Conventions

- API handlers return `Response.json(...)`; use `apiError` / `apiSuccess` and the
  `requireAuth` / `requireRole` guard pattern from `src/lib/api/helpers.ts`.
- Add a `vercel.json` `maxDuration` entry for any new long-running AI route.
- shadcn/ui primitives in `src/components/ui/`; add via the `shadcn` CLI, don't
  hand-roll. Icons: `lucide-react`. Toasts: `sonner`.
- Student-facing rate limits live in `src/lib/utils/rate-limit.ts`; surface 429s
  gracefully in the UI rather than throwing.
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`,
  `PRIMARY_AI_PROVIDER=gemini`. SQL schema changes go in `supabase/migrations/`.
