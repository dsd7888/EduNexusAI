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
| CP-03 | pending | | | |
| CP-04 | pending | | | |
| CP-05 | pending | | | |
| CP-06 | pending | | | |
| CP-07 | pending | | | CP-02 dependency resolved (2026-08-17) — clear to run |
| CP-08 | pending | | | HALT checkpoint — commit locally only, human reviews before push |
| CP-09 | pending | | | |
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
