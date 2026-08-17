# FIX_SPEC.md — EduNexus AI Fix Pass

Mirrors the build-checkpoint convention. Source: `.claude/AUDIT_LEDGER.md` +
8 findings files (AU-CHAT/NOTES/FLASH/QUIZ/PLACE-CORE/PLACE-TOOLS/EXPORTS/SHELL).
59 raw ledger entries clustered into 38 checkpoints. Ordered: systemic/security → S1 → S2 → S3.

Guard assumption (Step 3, unverified — confirm before running):
This session needs a *build*-mode guard: `src/**` edits allowed, commits gated on clean
`tsc`/`eslint`/build, `main` branch and destructive ops still blocked. If the existing
`run-spec.sh`/build-guard from prior CP-sessions already does this, reuse it as-is. If not,
CP-01 is the first commit and should stand up the minimal version of it before touching
`profiles` RLS. **Confirm which is true before Claude Code starts.**

Every checkpoint below ends with: `tsc`/`eslint`/build clean → commit SHA → clean working
tree → push confirmed, same as every prior session. Checkpoints marked **HALT** require your
explicit go-ahead before the fix is applied, not just before it's committed.

---

## Splittable vs. keep-together (Step 4)

**Keep in a broad-context session** (touches shared modules / needs to see multiple call
sites at once): CP-01, CP-02, CP-08, CP-09, CP-20, CP-27/CP-38 (design migrations).

**Safe to hand to a fresh chat** (self-contained, only needs `CLAUDE_CONTEXT.md` + its own
prompt): everything else. Copy-paste prompts given below for CP-01 through CP-16 (the
security/S1 tier) and CP-17 through CP-24 (the highest-value S2s). The remaining S2/S3
checkpoints follow the identical template — ask me to expand any of them into a full prompt
when you're ready to run it.

---

## SECURITY / SYSTEMIC (fix before anything else)

### CP-01 — `profiles.role` privilege escalation — **HALT (migration)**
**Files:** new migration under `supabase/migrations/`.
**Finding:** RLS "own profile" UPDATE policy restricts row, not columns. Any student can
`.update({role:'superadmin'})` on their own row via the ordinary `createBrowserClient()`, and
`proxy.ts`/`requireRole()` trust that same column — full server-side auth bypass.
**Fix:** Add a `WITH CHECK` clause (or `BEFORE UPDATE` trigger) on `profiles` rejecting any
UPDATE from a non-admin session that changes `role`, `department`, or any other
admin-controlled column. Only self-service columns (currently: none, the profile UI is
read-only — confirm with Dhruv whether `full_name` etc. should be added to the allow-list)
pass through the "own profile" policy.
**Verify:** Re-run AU-SHELL's `priv_escalation.ts` shape — disposable student account attempts
`.update({role:'superadmin'})` on itself, expect rejection. Then attempt the cross-write
(`priv_escalation_crosswrite.ts` shape) — student A writing student B's row — expect rejection.
**HALT before applying to the live pilot DB** — this changes a policy faculty/students are
actively using. Confirm timing with Dhruv (off-peak window recommended).

```
Prompt: "Fix the profiles RLS privilege-escalation gap. Read CLAUDE_CONTEXT.md first.
The 'Users can update own profile' policy on `profiles` (auth.uid()=id) restricts the row but
not the columns, letting any student rewrite their own role to superadmin. Write a migration
adding a WITH CHECK clause or BEFORE UPDATE trigger that rejects non-admin UPDATEs touching
`role`/`department` (confirm the full admin-controlled column list by reading the profiles
schema). Do NOT apply the migration — HALT and show me the SQL first. Once I approve, apply it,
then verify: as a disposable test student, attempt `.update({role:'superadmin'}).eq('id', self)`
via the anon-key browser client and confirm it's rejected; attempt writing another user's row
and confirm rejection. tsc/eslint/build clean, commit with SHA, confirm push."
```

### CP-02 — Atomic `checkRateLimit` (fixes chat/research/hint/quiz/examSim/notes_view/notes_export)
**Files:** `src/lib/utils/rate-limit.ts` only, but audit every caller first.
**Finding:** check-then-increment TOCTOU — confirmed on chat via raw concurrent curl (49/50 → 51/50).
**Fix:** Replace the read-then-later-increment with a single atomic upsert
(`UPDATE usage_analytics SET event_count = event_count + 1 WHERE ... RETURNING event_count`,
reject/rollback if over limit) or a Postgres advisory lock around the read-then-write.
**Verify:** 2 concurrent raw `curl --http1.1` POSTs at limit-1 usage on `/api/chat` — expect
exactly one to succeed once the fix lands. Re-run the same shape against one notes route
(`notes_view`) since that call site was never independently concurrency-tested.

```
Prompt: "Fix the check-then-increment race in checkRateLimit (src/lib/utils/rate-limit.ts).
It reads today's usage_analytics total, returns allowed, then increments later in
persistTurn() — no atomicity. Callers: chat, research, hint, quiz, examSim, notes_view,
notes_export (grep DAILY_LIMITS usage to confirm the full list before changing the contract).
Make check-and-increment a single atomic operation (upsert with RETURNING, checked against
limit; or advisory lock). Preserve the existing return shape so callers don't need changes.
Verify with 2 concurrent raw curl --http1.1 POSTs to /api/chat at limit-1 usage — expect one
rejected. Also test the same shape against /api/notes/subject/:id (notes_view) once, since
that call site was never independently concurrency-tested in the audit. tsc/eslint/build
clean, commit SHA, confirm push."
```

### CP-03 — Notes concurrent-generation race + raw error leak
**Files:** `src/lib/notes/generator.ts:442-479`, `api/notes/module/[moduleId]/route.ts`.
**Fix:** (1) Don't leak `insertError.message` to the client — log server-side, return generic
plain-language copy. (2) Lock on `(subjectId, moduleId)` before generating, or catch the unique
constraint violation and re-read the winner's row instead of discarding the loser's paid call.
**Verify:** 2 genuinely parallel `GET /api/notes/module/:id` at a zero-notes module — confirm
only one Gemini call bills (`ai_call_logs`), confirm no raw constraint string in either response.

### CP-04 — Assessment `/submit`: timer enforcement + atomic completion
**Files:** `api/assessment/submit/route.ts` (compare `api/assessment/answer/route.ts:126-134`).
**Fix:** (1) Copy the timer-expiry check from `/answer` into `/submit` — reject or grade only
persisted pre-deadline answers. (2) Make the status transition atomic:
`.update({status:'completed',...}).eq('id',id).eq('status','in_progress')`, treat 0-rows-affected
as the existing "already completed" 409.
**Verify:** real 1-minute exam-sim session left to expire, then `/submit` with a full late
payload — expect rejection (was: 200/graded). 2 concurrent `/submit` calls on one session —
expect exactly 5 `student_question_attempts` rows for a 5-question session (was: 10).

### CP-05 — Placement `prep/submit` mastery: atomic upsert
**Files:** `api/placement/prep/submit/route.ts:245-315`.
**Fix:** Replace JS-computed read-then-write with a single atomic UPDATE
(`attempts_count = attempts_count + $1`, etc.), not a fetch-then-compute-then-write.
**Verify:** fire the same honest submission twice via `Promise.all` — expect `sessions_count`
to land at 2, not 1.

### CP-06 — `interview/mock/follow-up` atomic cap
**Files:** `api/placement/interview/mock/follow-up/route.ts:17-19`.
**Fix:** Same check-then-act shape, worse (100% bypass on 8-way burst). Atomic
insert-with-count-guard or advisory lock on `(user_id, window)`.
**Verify:** 8-way concurrent burst from a fresh student — expect ≤5 through, not 8/8.

### CP-07 — Placement AI routes: add rate limiting (depends on CP-02 landing first)
**Files:** `src/lib/utils/rate-limit.ts` (`DAILY_LIMITS`), `resume/ats`, `resume/rewrite-bullet`,
`jd-analyze`, `interview/evaluate` routes.
**Fix:** Add `placement` (or per-route keys) to `DAILY_LIMITS`; call `checkRateLimit` in all 4
routes — `placement` currently isn't in the map at all.
**Verify:** 3+ rapid sequential `interview/evaluate` calls past the new cap — expect throttling.

### CP-08 — Placement client-trusted grading (multi-file, keep in one session)
**Files:** `api/placement/prep/submit/route.ts`, `api/placement/prep/generate/route.ts`,
`api/placement/practice/submit/route.ts`.
**Finding:** `prep/submit` trusts client `is_correct` verbatim and writes it straight into
canonical readiness scores (forged 100% on an all-wrong session, confirmed live).
`prep/generate` ships `correct_answer`/`explanation` in the pre-answer payload.
`practice/submit` scores entirely client-fabricated Q&A with no bank lookup.
**Fix:** On submit, look up `placement_question_bank.correct_answer` server-side for every
submitted `question_id` and compute `is_correct` from that — ignore the client's claim
entirely. Strip `correct_answer`/`explanation` from the pre-answer `generate` response; return
them only after the student has locked in an answer, or in the submit response for that
question. Apply the same re-grading fix to `practice/submit`.
**Verify:** answer all 8 questions of a real session wrong, forge `is_correct:true` — expect
rejection/correction, not a 100% mastery write. Confirm `correct_answer` absent from `generate`'s
response body.
**HALT before merging if it changes the readiness-score formula's public contract** — check
whether any cached/displayed readiness values need a one-time recompute.

### CP-09 — Missing distress/safety clause
**Files:** `src/lib/ai/prompts.ts` (`buildTutorSystemPrompt`), `interview/evaluate/route.ts`,
`interview/mock/follow-up/route.ts`.
**Fix:** One shared, short safety clause (acknowledge distress, name institutional
counseling/helpline, continue only if the student wants to) added to all three prompt builders.
**Verify:** re-run both distress-adjacent test strings from AU-CHAT and AU-PLACE-TOOLS —
expect an acknowledgment + resource pointer in the response, not a bare tutoring/scoring reply.

### CP-10 — Assessment engine: subject-scope check
**Files:** `src/lib/assessment/routeHandler.ts`, `engine.ts`; port pattern from
`src/lib/notes/access.ts` (`assertNotesSubjectAccess`).
**Verify:** CSE-sem3 student requesting a subject offered only to another branch — expect 403,
not a generated quiz (was: 200 + 5 real questions).

---

## S1 (non-security)

### CP-11 — Notes v2 cold-start generation path
**Files:** `src/app/(student)/student/notes/[subjectId]/page.tsx` (ErrorState), likely a new
orchestration point calling `generateModuleNotes` per uncovered module.
**Decision needed from Dhruv before writing code:** (a) student-triggered — the "Generate
notes" button calls `generateModuleNotes` for each uncovered module, gated by the existing
`notes_view` limit; or (b) faculty-provisioned — ship the faculty regenerate UI that currently
doesn't exist, treat every live subject as needing a one-time backfill. Recommend (a) for pilot
speed unless faculty ownership of content timing matters more.
**Verify:** a real zero-notes subject, click "Generate notes," confirm `study_notes` rows
appear and the page renders real content (was: 0 rows, infinite loop).

### CP-12 — Quiz export + dashboard dead-table cleanup
**Files:** `api/quiz/export/route.ts` (rebuild against `quiz_sessions`), `ResultCtas.tsx` (wire
in the export button), `student/dashboard/page.tsx:122-123`, `faculty/dashboard/page.tsx`,
`api/analytics/route.ts:104-114,258-260` (repoint from `quiz_attempts`/`quizzes`). Delete the
dead `api/quiz/*` v1 routes once the rebuild lands.
**Verify:** complete a real quiz, confirm it appears on the student's own dashboard and exports
a real PDF via the new UI button.

### CP-13 — Delete legacy placement test/practice subsystem
**Files:** `/student/placement/test/[companyId]`, `/practice/[moduleId]`, their 6 backing
routes, the `history` page's `placement_attempts` reference, the orphaned
`20260328120000_placement_attempts_detail_columns.sql` migration reference.
**Recommendation:** delete rather than fix — the new prep flow already fully supersedes it per
`CLAUDE_CONTEXT.md`'s route inventory, and no migration ever created the table it needs.
**Verify:** grep confirms zero remaining references; `history` page no longer queries a
nonexistent table.

### CP-14 — Dashboard placement-readiness widget
**Files:** `src/hooks/useSupabaseData.ts:263-285` (`usePlacementHistory`).
**Fix:** point at the correct canonical table (`placement_topic_mastery` or
`placement_question_attempts` — decide alongside CP-13), and stop swallowing `.error` — surface
a real error/empty distinction instead of "Not started" for both.
**Verify:** a student with real placement activity shows real numbers, not "Not started."

### CP-15 — Resume autosave: upsert + validation (bundle with CP-35's array caps, same file)
**Files:** `api/placement/resume/route.ts`.
**Fix:** `.update()` → `.upsert({student_id, resume_data, resume_completeness}, {onConflict:
'student_id'})`. Add shape validation on `education`/`technical_skills`/`projects` before
`computeCompleteness` runs (400, not 500, on malformed payload). While in this file: also add
server-side array-size caps matching the client's `MAX_PROJECTS=4` etc. (S3 finding, same file,
same session).
**Verify:** fresh student (no prior profile row) POSTs a resume → immediate GET returns the
same data (was: `full_name:""`). Malformed payload → 400. 200-project payload → rejected or
capped, not silently accepted.

```
Prompt: "Fix api/placement/resume/route.ts. Three issues in one file:
(1) POST uses .update() which silently no-ops (200, no error) when the student's
student_placement_profiles row doesn't exist yet — change to .upsert({student_id, resume_data,
resume_completeness}, {onConflict:'student_id'}), matching the working pattern in
api/placement/profile/route.ts.
(2) No schema validation — computeCompleteness() throws uncaught on a payload missing
education/technical_skills/projects, surfacing as a bare 500. Add a presence/shape check before
calling it, return 400 with the specific missing field.
(3) No server-side size limits — client caps (MAX_PROJECTS=4, MAX_BULLETS=3, etc. in
resume/page.tsx) are UI-only. Enforce the same caps server-side.
Verify: fresh student POSTs a full resume, immediate GET returns matching data. Malformed
payload -> 400 not 500. 200-project payload -> rejected/capped not silently saved.
tsc/eslint/build clean, commit SHA, confirm push."
```

### CP-16 — PPT SVG fallback + Notes PDF Unicode deletion (2 standalone, same tier — separate sessions ok)

**CP-16a — PPT SVG fallback.** `src/lib/ppt/generator.ts` (`svgToBase64`, `addImage` call
~line 2043, and the `dual_visual` right-panel path ~line 2275). Rasterize via the existing
`svgCodeToPngBytes` helper (`src/lib/pdf/builder.ts`) before `addImage`, instead of handing
pptxgenjs raw SVG bytes labeled as PNG. Verify: unzip a real generated `.pptx`, confirm
`ppt/media/image-*.png` is detected as PNG by `file`, not SVG.

**CP-16b — Notes PDF Unicode deletion.** `src/lib/pdf/builder.ts:162-229` (`sanitizeForPDF`).
Substitute a visible placeholder (`?` or `□`, matching the qpaper convention) instead of silent
deletion; log when the branch strips a character. Verify: generate a PDF with the stress string
(Devanagari + emoji + logic symbols + `café`) — confirm visible placeholders, not vanished text.

```
Prompt (16a): "Fix the PPT SVG diagram fallback in src/lib/ppt/generator.ts. svgToBase64()
hands pptxgenjs a raw SVG data URI; pptxgenjs writes those same SVG bytes into the media part
it labels image/png (confirmed: unzip a generated .pptx, ppt/media/image-N-1.png is detected as
SVG by `file`, not PNG). This is the default diagram render type (no explicit renderHint ->
'svg'). Fix: rasterize the SVG to a real PNG via the existing svgCodeToPngBytes helper in
src/lib/pdf/builder.ts (sharp-based) before calling addImage, both at the main diagram-slide
call site and the dual_visual right-panel path (~line 2275, same svgToBase64 pattern). Verify:
generate a real .pptx with an SVG diagram slide, unzip it, confirm the media part `file`-detects
as PNG. tsc/eslint/build clean, commit SHA, confirm push."

Prompt (16b): "Fix silent Unicode deletion in src/lib/pdf/builder.ts's sanitizeForPDF
(lines ~162-229). It replaces a curated ~40-symbol allowlist then does
.replace(/[^\x00-\x7F]/g, '') — deleting everything else with no trace. Change the catch-all to
substitute a visible placeholder (? or □, matching the convention already used in
src/lib/qpaper/builder.ts's own sanitize()) instead of deleting, and log a warning when this
branch actually strips something. Verify: generate a Notes PDF containing Devanagari text, an
emoji, and logic symbols (∴ ⊂ ⇒) outside the allowlist — confirm visible placeholders survive
in the output, not silent deletion. tsc/eslint/build clean, commit SHA, confirm push."
```

---

## S2 (non-security)

### CP-17 — `true_false` renders zero answer controls
**Files:** `src/lib/assessment/types.ts:224-226` (`typeHasOptions`),
`AnswerInput.tsx:174-244`. Add a dedicated True/False render branch (2 buttons, no option
letters) rather than relying on the MCQ `options.map()` path. Currently latent (not in any
mode's default types) — low urgency but cheap fix.

### CP-18 — Chat composer height gap
**Files:** `student/chat/[subjectId]/page.tsx:667` vs. `(student)/layout.tsx:148`. Derive the
chat column's height from real flex ancestry (shell `<main>` gets `h-dvh`, chat page uses
`h-full`) instead of the mismatched `h-[calc(100vh-7rem)]` guess. Trivial CSS fix.

### CP-19 — Desktop sidebar collapse (student shell)
**Files:** `(student)/layout.tsx`. Port `FacultyShell.tsx`'s existing collapse pattern
(`useState` + localStorage `collapsed` flag, `PanelLeftClose/Open` toggle, `w-16`/`w-64`
transition) — `NavLink.tsx` already has the `icon`/`collapsed` props built for this. Not a new
feature, a port.

### CP-20 — Touch-target floor (shared component, keep in one session — many call sites)
**Files:** shared `Button`/pill component, `Composer.tsx`, `ChatHeader.tsx`, mobile hamburger in
`(student)/layout.tsx`, `NavLink.tsx` row padding. Bump min-height to 44px (padding, not just
font-size). This alone fixes chat composer/header, mobile hamburger, mobile nav-drawer links.
Does **not** fix the un-migrated placement pages (Resume/JD/Interview-bank/Projects) — those
build on ad hoc classes, not the shared `h-11` pattern, and need CP-38 (design migration) to
inherit this fix.

### CP-21 — Resume PDF/DOCX export null-guard
**Files:** `api/placement/resume/export/{pdf,docx}/route.ts`. Add the same
`resume.technical_skills ?? {languages:[],frameworks:[],tools:[],concepts:[]}` guard
`resume/ats/route.ts` already uses. Add equivalent defaults for `education[0]`, `projects`,
`internships`, `certifications`, `achievements`.

### CP-22 — `setup_complete` without CGPA
**Files:** `api/placement/profile/route.ts`. Require `cgpa`/`primary_target` non-null before
accepting `setup_complete:true`, or thread an explicit "CGPA not set" state through
`isDriveEligible` instead of silently coalescing to `0`.

### CP-23 — Empty Next-Move queue for a ready student
**Files:** `src/lib/placement/nextMove.ts` (`computeNextMoves`, Rules 2 and 6). Add a rule for
"eligible in-window drive + no weak relevant dimension" that surfaces a positive/confirmatory
move instead of an empty array.

### CP-24 — SQL-injection-shaped input → raw HTML in logs (2 instances, shared validation helper)
**Files:** `src/lib/assessment/engine.ts:220-228` (`subjectIds`),
`api/placement/prep/submit/route.ts` (`topic`). Add a cheap UUID-shape check for `subjectIds`
and a known-label check for `topic` (it's meant to be from `TRACK_SECTIONS`, not arbitrary
text) before either reaches the query; return clean 400 instead of letting an upstream HTML
error page get dumped via `console.error`. Cap what any upstream error's message gets logged.

### CP-25 — Notes PDF worked-example markdown tables
**Files:** `src/lib/notes/pdf/formulaRenderer.ts:91-97` (`drawWorkedExample`). Route
`example.problem`/`example.solution` through a table-aware draw path (mirroring
`drawSymbolsTable`'s `builder.drawTable()` call in the same file) instead of plain
`textOrMath`.

### CP-26 — Q Paper PDF page-break orphaning
**Files:** `src/lib/qpaper/builder.ts`. Add a keep-with-next check — measure the first
sub-part's height before committing a question header to the current page — so a header and
its first sub-part never split across a page boundary.

### CP-27 — DESIGN.md tokens for shell chrome (large — own initiative)
**Files:** `(student)/layout.tsx`, `dashboard/page.tsx`, `subjects/page.tsx`, `profile/page.tsx`,
`history/page.tsx`. Apply the `font-plex-*`/ink-paper-ochre migration already done for
Notes/Flashcards/Placement. Highest-leverage single design fix (rendered on every screen) but
genuinely multi-file — scope as its own checkpoint cluster when you're ready, not bundled here.

---

## S3 (polish — compact specs, expand any into a full prompt on request)

| CP | Finding | File(s) | Note |
|---|---|---|---|
| 28 | Chat PDF markdown tables garbled | `PDFBuilder.markdown()` in `src/lib/pdf/builder.ts` | Give it a real table renderer (grid + cells) |
| 29 | Dark mode unreachable app-wide | none exist — `next-themes`/toggle | **Product decision needed**: ship a real toggle (multi-file) or mark DESIGN.md's dark-mode section as not-yet-shipped (docs-only, trivial). Ask Dhruv before scoping. |
| 30 | No chat double-submit guard | `api/chat/route.ts` | Backlog — only act if double-submits show up in production telemetry, per the audit's own framing |
| 31 | Generic PDF branding (Tailwind-blue/Helvetica) | `src/lib/pdf/builder.ts` `COLORS`, font embedding | Swap to DESIGN.md hex values + IBM Plex via `fontkit`; fixes every PDF export at once, good ROI, bundle with CP-16b (same file) |
| 32 | Formula `symbol` field holds full phrases | `src/lib/notes/prompts.ts` `FORMULA_SCHEMA` | Add a bad-example pair, low priority |
| 33 | fill_code+MCQ not interleaved | `prep/generate/route.ts` (bank path + `generateFillCodeMix`) | Shuffle combined array, not each half separately |
| 34 | Stage strip has no scroll affordance | `(student)/student/placement/page.tsx` `StageStrip` | Edge-fade mask or scroll chevron |
| 35 | Resume unbounded array sizes | `api/placement/resume/route.ts` | Bundle into CP-15 |
| 36 | Duplicate `ResumeProject`/etc. type declarations | `src/types/placement.ts:101-128` vs `:369-437` | Delete the first block, keep the second (the one actually used) |
| 37 | No `prefers-reduced-motion` handling | `src/app/globals.css` | One global media-query rule |
| 38 | Design migration: Resume/JD/Interview-bank/Projects pages | those 4 page files | Large — pairs with CP-27, own initiative |

---

## Recommended execution order

1. **CP-01** (profiles RLS) — highest severity, needs your explicit HALT approval before applying.
2. **CP-02** (atomic rate-limit) — single file, fixes 7 features at once.
3. **CP-08** (placement grading trust) — second-highest severity, needs your review before merge.
4. CP-03 through CP-10 in any order (all standalone once CP-02's pattern exists).
5. S1 non-security (CP-11 through CP-16) — CP-11 needs your (a)/(b) decision first.
6. S2, then S3, in the order listed.