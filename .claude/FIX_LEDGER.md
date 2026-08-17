# FIX_LEDGER.md — Fix Pass Master State

Machine-readable checkpoint state for `.claude/FIX_SPEC.md`. `run-fix.sh` reads and
writes this file: it checks a row's status before running that checkpoint (skips
`done`, refuses `blocked`), and updates the row (status/SHA/date) immediately after
each `claude -p` process exits. Treat this file as generated state, not a diary — the
one-line `note` column is the only free-text slot; longer detail belongs in
`.claude/PROGRESS.md`.

Status values: `pending` (not yet attempted) · `in-progress` (runner currently on it —
should never be left in this state between runs; a stale `in-progress` row means a
prior run crashed mid-checkpoint) · `blocked` (needs a human decision before the
runner may touch it — the runner refuses and errors, it does not skip silently) ·
`halted-review` (applied locally, sitting at a HALT gate awaiting push approval) ·
`done` (committed, and pushed unless the checkpoint is HALT-only).

| CP id | status | commit SHA | date | note |
|---|---|---|---|---|
| CP-01 | done | 1551205 | 2026-08-17 | Migration applied to live DB; all 5 AU-SHELL verification checks passed (self-escalation rejected 42501, cross-write rejected, no-op write allowed, change-password admin path unaffected, superadmin cross-write still works — no residue left). Guard hook (C) refused an in-session commit of `supabase/migrations/**` as designed; committed by hand by Dhruv on `dev`. |
| CP-02 | done | 1bbc4dd | 2026-08-17 | Atomic CAS-based checkRateLimit/releaseRateLimit landed across all 8 call sites (chat, chat/visualize, notes/module, notes/subject, quiz/generate, quiz/hint, notes/export, assessment exam-sim/quiz). Originating claude -p run hit a network drop after 78 turns; remaining 4 call sites completed and verified (tsc + eslint clean) by hand. See PROGRESS.md for full detail. |
| CP-03 | done | cdcefb2a2b5a4ec9266fa06e2324e59a5acb42ea | 2026-08-17 | Not a FIX_SPEC HALT checkpoint — committed locally only because this session's run instructions had no-push as the default; fix + `_cp_03_verify` harness verified (tsc/eslint/build clean, race + error-leak fix confirmed over repeated runs). A human should review and push. |
| CP-04 | done | b21dc894db95154dde5e1fce3b2501916eb94122 | 2026-08-17 | Timer check copied from `/answer` (same 5s grace); status transition made atomic (`.eq('status','in_progress')`, claim happens before grading, not after). `_cp_04_verify` harness verified live over HTTP: late submit 409s with 0 attempt rows and session stays in_progress; concurrent race lands exactly one 200 + one 409 with exactly 5 attempt rows for a 5-question session (was 10); re-submit after completion still 409s. tsc/eslint/build clean. Committed locally only, per this session's no-push default. |
| CP-05 | done | ad97338d1dc3d1265539260b1ff6b9277ab18a77 | 2026-08-17 | Needs a schema migration (new `upsert_placement_topic_mastery` RPC) — file created (`supabase/migrations/20260817010000_placement_mastery_atomic_upsert.sql`), AWAITING MANUAL APPLICATION. No app code written this session per CLAUDE.md's "create migration, then STOP" rule; guard hook (C) would refuse a commit staging it anyway. |
| CP-06 | done | 3cccd792aa08dc90c2527d4fe4d3875b0786540c | 2026-08-17 | Needs a schema migration (new `reserve_interview_followup` RPC + `interview_followup_reservations` table) — file created (`supabase/migrations/20260817020000_interview_followup_atomic_cap.sql`), AWAITING MANUAL APPLICATION. No app code written this session per CLAUDE.md's "create migration, then STOP" rule; guard hook (C) would refuse a commit staging it anyway. |
| CP-07 | done | 5785ad9970e867016a0591318bde95928b6b1c23 | 2026-08-17 | Added `placement_resume_ats` (10/day), `placement_resume_rewrite` (30/day), `placement_jd_analyze` (15/day), `placement_interview_evaluate` (20/day) to `RATE_LIMITS`; wired `checkRateLimit`/`releaseRateLimit` into all 4 previously-uncapped placement AI routes, same reserve-before-AI-call / release-on-failure pattern as CP-02's other callers. `_cp_07_verify` harness verified live over HTTP: invalid payload never reserves quota, last-slot request succeeds, over-cap request 429s with no AI spend, concurrent race at limit-1 yields exactly one winner (CP-02's atomic CAS holding through this route), and a second route (resume/rewrite-bullet) enforces its own independent cap. tsc/eslint clean. Committed locally only, per this session's no-push default. |
| CP-08 | halted-review | 3a18f9dcf41b507b055f386f4c28d3aa6aec0f86 | 2026-08-17 | prep/submit: fixed and verified (server-side re-grading against placement_question_bank, ignores client `is_correct`). practice/submit: fix drafted and tested but held back uncommitted (`.claude/logs-fix/CP-08-practice-submit-pending.patch`) — its ground-truth table (`practice_question_bank`) doesn't exist live; migration created (`supabase/migrations/20260817030000_practice_question_bank.sql`), AWAITING MANUAL APPLICATION. prep/generate's correct_answer/explanation exposure also deferred — see PROGRESS.md. HALT checkpoint — commit locally only, human reviews before push. |
| CP-09 | done | 25e089dca7d4ef4edb51d5563c30b23760096334 | 2026-08-17 | Shared `DISTRESS_SAFETY_CLAUSE` in `src/lib/ai/prompts.ts`, wired into `buildTutorSystemPrompt` + `interview/evaluate` + `interview/mock/follow-up` (neither previously passed a `systemPrompt` at all). `_cp_09_verify` harness verified live: AU-CHAT/AU-PLACE-TOOLS distress strings get acknowledgment + named resource, ordinary inputs unaffected, concurrent + client-abort unhappy paths clean. No migration needed. Committed locally only, per this session's no-push default. |
| CP-10 | pending | | | |
| CP-11 | pending | | | Confirmed student-triggered generate-on-demand, gated by existing notes_view rate limit. |
| CP-12 | pending | | | |
| CP-13 | pending | | | |
| CP-14 | pending | | | decide canonical table alongside CP-13 |
| CP-15 | pending | | | bundles CP-35's array caps, same file |
| CP-16 | pending | | | covers both CP-16a (PPT SVG fallback) and CP-16b (Notes PDF Unicode deletion) |
| CP-17 | pending | | | |
| CP-18 | done | 7f40c02b33ee277680de3387e8f5e77d0f1555b9 | 2026-08-17 |  |
| CP-19 | pending | | | |
| CP-20 | pending | | | shared component, many call sites — does not cover placement pages (needs CP-38) |
| CP-21 | pending | | | |
| CP-22 | pending | | | |
| CP-23 | pending | | | |
| CP-24 | pending | | | |
| CP-25 | pending | | | |
| CP-26 | pending | | | |
| CP-27 | pending | | | large — own initiative, pairs with CP-38 |
| CP-28 | pending | | | |
| CP-29a | pending | | | Dark-mode infra only — real toggle (next-themes or equivalent), persisted. Does NOT add new dark: classes to unstyled pages. |
| CP-29b+ | blocked | | | deferred — bundle with CP-27/CP-38, schedule when those are scoped |
| CP-30 | pending | | | backlog — only act if double-submits show up in production telemetry |
| CP-31 | pending | | | bundle with CP-16b, same file |
| CP-32 | pending | | | |
| CP-33 | pending | | | |
| CP-34 | pending | | | |
| CP-35 | pending | | | bundle into CP-15 |
| CP-36 | pending | | | |
| CP-37 | pending | | | |
| CP-38 | pending | | | large — pairs with CP-27, own initiative |
