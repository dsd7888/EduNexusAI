# AU-SHELL — Dashboard / Subjects / Profile / History + global nav + auth edges + mobile

Run date: 2026-08-17. HEAD at start: `3f8c00f4c104eb3c0b22b9ee5e3ac16a1fb79d25` (clean tree
except the pre-existing untracked audit scaffolding from prior checkpoints, per `git status`).

## Scope note

Unlike every prior checkpoint, most of AU-SHELL's surfaces (`dashboard`, `subjects`, `profile`,
`history`) have **no API route of their own** — they call `createBrowserClient()` directly from
client components and rely entirely on Postgres RLS for authorization. This shifted the primary
runtime method here from "hit an API route" to "issue the exact query the browser issues, through
the exact RLS-scoped client a browser holds (anon key + real user JWT)" — which is what
`httpHarness.ts`'s `.client` already provides. That method surfaced this run's headline finding.

## Method

Real HTTP + real Supabase RLS queries via `src/lib/testing/httpHarness.ts` (magic-link →
`verifyOtp`, real cookies/session — `.client` is byte-identical to what a signed-in browser tab
holds). `npm run dev` + Playwright for the four UI surfaces (desktop 1280px / mobile 390px ×
light/dark), authenticated as the shared seeded `teststudent@gmail.com` (CSE sem3, real subjects
and real chat history already in the DB from prior audit runs). Scripts live in `_audit_shell/`
(git-ignored): `priv_escalation.ts`, `priv_escalation_crosswrite.ts`, `idor_check.ts`,
`check_placement_attempts.ts`, `check_dashboard_v1v2.ts`, `history_race.ts`, `screenshots.ts`,
`check_spend.ts`. All ephemeral `cp-harness-*` accounts this run created were deleted by their own
`cleanup()`; `teststudent@gmail.com`'s data was only ever read, never mutated, by this run's scripts
(confirmed: its `profiles.role` is still `student` after the run — the escalation tests used
disposable accounts specifically so this shared account was never put at risk).

**AI spend this run: $0.00, 0 real Gemini calls** (confirmed via `ai_call_logs`, zero rows in the
lookback window). None of AU-SHELL's surfaces have an AI-calling code path — expected, not a gap.

## Universal checklist results

- **A. Happy path** — [RUNTIME]/[UI] mostly PASS: dashboard/subjects/profile/history all load real
  data for a real student and render without error. Two happy-path widgets are silently wrong —
  see S1-2 below (Quiz Average / Placement Readiness on the dashboard never reflect real activity).
- **B. Adversarial input** — not very applicable (no free-text/AI surface in this feature); the one
  real adversarial-input result is the privilege-escalation finding below, which isn't "adversarial
  input" so much as adversarial *use of an ordinary, sanctioned client call*.
- **C. Malformed/boundary** — N/A in the usual sense (no user-authored free text on these pages
  besides the password-change form, which validates length/match client-side; not independently
  fuzzed this run given the S1 above ate the bulk of the budget).
- **D. State/concurrency** — [RUNTIME] tested one real race: `/student/history`'s
  `handleSelectSession` has a staleness guard (`prev.id === session.id ? {...} : prev`). Verified
  it holds under adversarial ordering (delayed first response landing *after* a second, faster
  click) — see "Notable positives." Also verified the mobile hamburger menu correctly closes/reopens
  and doesn't leak state across route changes.
- **E. Authorization** — [RUNTIME] **the finding of this run.** `chat_sessions`/`chat_messages`
  cross-student IDOR is clean (verified, see positives) — which makes the `profiles` table result
  below stand out as a real, isolated gap rather than a systemic RLS pattern: **any authenticated
  student can rewrite their own `profiles.role` to `superadmin` via a direct client-side `.update()`
  call, and the change is honored immediately, everywhere, including by every other RLS policy and
  by `proxy.ts`'s own server-side role gate**, because both read the same column this call just
  wrote. See S1-1.
- **F. Errors & logs** — the `usePlacementHistory` hook (`src/hooks/useSupabaseData.ts:271-282`,
  feeding the dashboard's "Best Placement Score" / "Placement Readiness" cards) never checks
  `.error` on its Supabase response — see S1-2, where this silently converts a hard schema error
  into a permanently-empty widget with zero trace anywhere a developer would look.
- **G. Cost** — N/A, no AI calls in this feature's surface area. Confirmed $0 spend.
- **H. UI/UX** (DESIGN.md conformance) — [UI] confirmed: desktop sidebar has no collapse control
  (cross-cutting, reproduces here); dark mode has zero effect on any of the four pages (byte-similar
  light/dark screenshots); mobile hamburger button measures 36×36px and mobile nav-drawer links
  measure 36px tall, both under the 44px floor (cross-cutting, reproduces here with new
  measurements); **and a shell-specific finding not yet on the ledger** — the entire nav
  chrome/dashboard/subjects/profile/history surface renders in the default shadcn neutral theme
  (Geist font, oklch grays, ad hoc `sky-*`/`emerald-*`/`purple-*`/`amber-*`/`blue-600` accent
  colors) with **zero** DESIGN.md tokens or `font-plex-*` typography anywhere — see S2-2.

## Feature-specific cases (§5 AU-SHELL)

- **Menu collapsible + mobile** — [UI] CONFIRMED BROKEN (collapse) / WORKS (mobile). See S2-1.
- **No route lets a student read another student's data** — [RUNTIME] MIXED. `chat_sessions`/
  `chat_messages` are clean (verified). `profiles` is catastrophically not — S1-1.
- **Logout/session-expiry behave** — [STATIC]+[RUNTIME] logout button correctly ends the tracked
  session (`endSession`) then `signOut()`s then redirects; no double-submit guard on the button but
  a double-click just calls `signOut()` twice, harmless. Idle timeout is 2h
  (`src/lib/session/client.ts`) — not practically exercisable within this run's time budget; noted
  as UNVERIFIED (static read only), not claimed as tested.
- **Consistent design-system application across all shell surfaces** — [STATIC]+[UI] CONFIRMED NOT
  consistent — S2-2.

---

## Findings

### [S1] [RUNTIME] Any authenticated student can self-promote to `superadmin` — and immediately read/write every other user's profile — via a single ordinary Supabase client call, no server route involved

**What:** The RLS policy `"Users can update own profile" ON profiles FOR UPDATE USING (auth.uid()
= id)` (`supabase/migrations/20260207000000_initial_schema.sql:329-330`) restricts which **row** a
student can update, but not which **columns**. Every student-facing page in this app instantiates
`createBrowserClient()` (anon key + the student's own real session, e.g.
`src/app/(student)/student/profile/page.tsx:6`, `dashboard/page.tsx:9`, `subjects/page.tsx:3`,
`history/page.tsx:14` — it's the standard, sanctioned way every one of these pages already talks to
Supabase). That same client object can call:

```js
supabase.from('profiles').update({ role: 'superadmin' }).eq('id', myOwnId})
```

from literally the browser's own devtools console, using nothing but the public anon key already
shipped to every page load and the user's own already-issued session — no exploit tooling, no
token forgery, no server bug beyond the RLS policy itself.

**Evidence [RUNTIME], `_audit_shell/priv_escalation.ts`:** ephemeral student
`cp-harness-b7d2622b@…` started with `role='student'`. `s.client.from('profiles').update({role:
'superadmin'}).eq('id', s.userId})` returned `200` with **no error**:
```
update() response: {"error":null,"data":[{"id":"e508544c-…","role":"superadmin"}],"count":null,"status":200}
after (admin view): { role: 'superadmin' }
```
The same call also freely rewrote `department` (the platform's documented single-tenant invariant
per CLAUDE.md: *"`department` is `"Engineering"` for every row"*) to an arbitrary string, again with
no error.

**Blast radius, same script, same already-issued JWT, no new login:** immediately after the
self-update, `s.client.from('profiles').select('id, email, full_name, role').limit(5)` — a query
that should be blocked for a `student` role — returned **five real rows**, including the actual
seeded accounts' real emails:
```
[{"email":"teststudent@gmail.com","role":"student"},
 {"email":"unnati.shukla@ppsu.ac.in","role":"faculty"},
 {"email":"admin@edunexus.com","role":"superadmin"},
 {"email":"teststudent2@gmail.com","role":"student"},
 {"email":"teststudent3@gmail.com","role":"student"}]
```
This is the `"Admins can view all profiles"` policy firing correctly — the escalation is real
enough that the DB's own admin-tier RLS now treats the attacker as an admin.

**Write, not just read (`_audit_shell/priv_escalation_crosswrite.ts`, two disposable accounts, no
real accounts touched):** student A self-escalates, then — same client, same JWT — overwrites
student B's `branch`/`semester`/`role`:
```
A -> B cross-write response: {"error":null,"data":[{"branch":"MECH","semester":8,"role":"faculty"}]}
B row per admin after A's write attempt: { branch: 'MECH', semester: 8, role: 'faculty' }
```
B's row was modified with zero involvement from B and zero server-side check.

**Why this is not "just an RLS nuance":** `src/proxy.ts` (the app's entire page/API role gate) and
every server route's `requireRole()` (`src/lib/api/helpers.ts` per CLAUDE.md) determine access by
reading the exact same `profiles.role` column this call writes. The moment the write lands, the
*next page load* through `proxy.ts` grants the attacker's browser session real `/superadmin/*`
access too — this isn't a client-side-only compromise, it's a full authority bypass of the app's
server-side authorization model, because that model trusts a column the attacker's own client can
freely rewrite.

**Where:** `supabase/migrations/20260207000000_initial_schema.sql:329-330` (the policy itself —
needs a `WITH CHECK` clause and/or a trigger rejecting changes to `role`/`department`/other
non-self-service columns from a non-admin role; alternatively split "own-profile self-service
fields" into a narrower policy or a Postgres column-level `REVOKE`/`GRANT`). Every page instantiating
`createBrowserClient()` is an equally valid attack surface for this — it is not route-specific.

**Recommendation:** Add `WITH CHECK` logic (or a `BEFORE UPDATE` trigger) on `profiles` that
rejects any UPDATE from a non-admin session touching `role`, `department`, or any other
admin-controlled column; only allow self-service columns (e.g. `full_name`, and whatever the
profile page is actually meant to let a student change — currently nothing, since the UI is
read-only) through the "own profile" policy. Given the severity, this should be treated as a
stop-ship item, not a backlog item — audit whether this has ever been exploited in the live pilot
(check `profiles` role history / any audit log; none currently exists per this run's findings, but
check DB backups if available).

**Cleanup:** both harness runs deleted their own ephemeral accounts on exit (verified in script
output: `deleted student … (0 session(s))` ×3). `teststudent@gmail.com` and the other real seeded
accounts were only ever read, never written, by this run's scripts.

---

### [S1] [RUNTIME] Dashboard's "Placement Readiness" / "Best Placement Score" card is permanently, silently wrong — queries a table that does not exist, and the error is swallowed

**What:** `usePlacementHistory()` (`src/hooks/useSupabaseData.ts:263-285`), used by
`src/app/(student)/student/dashboard/page.tsx:67-68`, queries `placement_attempts`. That table does
not exist in the live schema — this is the same root cause AU-PLACE-CORE already ledgered as S1
(#15 in `AUDIT_LEDGER.md`: a tracked migration `ALTER`s `placement_attempts` but no tracked
migration ever `CREATE`s it). **Not re-counted as a new S1 in the ledger roll-up** — this entry
documents the previously-unexamined dashboard-side symptom of that same root cause, which is new
information: the *how it fails* here is different and worse than AU-PLACE-CORE's finding (a clean
500 on a route nobody calls). Here it fails **silently on the student's own homepage.**

**Evidence [RUNTIME], `_audit_shell/check_placement_attempts.ts`:** the exact query the dashboard
hook issues, run through the student's own RLS-scoped client:
```
{
  "error": { "code": "PGRST205", "message": "Could not find the table 'public.placement_attempts' in the schema cache" },
  "data": null, "status": 404
}
```
The hook's `.then(({ data }) => setAttempts((data ?? []) as PlacementAttemptRow[]))` never inspects
`error` — a hard schema-cache 404 and "this student has never done placement prep" render
byte-identically: `"Not started"` / an empty state prompting the student to "Practice Now." No
console error even makes it to the browser devtools (`error` is destructured out and dropped, not
logged) — confirmed via live screenshot (`dashboard-desktop-light.png`): "Best Placement Score: Not
started."

Cross-check against the dashboard's OTHER dead-table read: `recentAttempts` (dashboard/page.tsx:121)
queries `quiz_attempts` (v1, dead — already ledgered under AU-QUIZ S2 #8, "primarily an AU-SHELL
surface symptom, flagged here"). Confirmed reproducing here too (code inspection,
`dashboard/page.tsx:121-128`); not re-counted per that entry's own instruction.

**Where:** `src/hooks/useSupabaseData.ts:263-285` (`usePlacementHistory`); consumed by
`src/app/(student)/student/dashboard/page.tsx:67,73-83,180-183,384-437`.

**Recommendation:** point `usePlacementHistory` at whatever table AU-PLACE-CORE determines is
canonical (`placement_question_attempts` per the schema-cache's own hint in the error above, or
`placement_topic_mastery` for a readiness-score framing) as part of the AU-PLACE-CORE fix; separately,
as a general hygiene fix, every `.then(({ data }) => …)` pattern in this codebase that drops `error`
silently converts real failures into misleading empty states — worth a lint rule or shared wrapper,
not just a one-off fix here.

---

### [S2] [UI] Desktop sidebar has no collapse control on any AU-SHELL page — confirmed cross-cutting, and the fix already exists elsewhere in the codebase

**What:** Reproduces the AU-CHAT-ledgered cross-cutting finding on all four AU-SHELL pages
(`dashboard`, `subjects`, `profile`, `history`) — expected, since they share
`src/app/(student)/layout.tsx`, which renders a bare `<aside className="hidden lg:fixed … lg:flex
lg:w-64 …">` with no width state, no toggle button, no `localStorage` persistence.

**New information this run adds:** the shared `NavLink` component
(`src/components/layout/NavLink.tsx:13-16,24,36,39,46-47`) already accepts `icon`/`collapsed` props
specifically built for this — its own comment says *"used by the collapsible faculty sidebar"* — and
`src/components/layout/FacultyShell.tsx` is a complete, working reference implementation: a `useState`
+ `localStorage`-persisted `collapsed` flag, a `PanelLeftClose`/`PanelLeftOpen` toggle button, a
`w-16`/`w-64` width transition, and auto-collapse on navigation. The student shell shares `NavLink`
and `LogoutButton`/`UserProfile` with the faculty shell but reimplements the outer `<aside>` from
scratch without the collapse machinery. This is not a "build a new feature" fix — it's porting an
existing, already-shipped pattern from one shell to the other.

**Evidence [UI]:** `_audit_shell/screenshots/dashboard-desktop-light.png` /
`subjects-desktop-light.png` / `profile-desktop-light.png` / `history-desktop-light.png` — fixed
264px `<aside>` on every page, no toggle affordance anywhere; script probe
(`button[aria-label*="collapse"]` count) returned `0` on all four pages.

**Where:** `src/app/(student)/layout.tsx:128-130` vs. the working reference at
`src/components/layout/FacultyShell.tsx:66-158`.

**Recommendation:** port `FacultyShell.tsx`'s collapse pattern into the student layout, reusing
`NavLink`'s existing `collapsed`/`icon` props (already wired for exactly this).

---

### [S2] [STATIC]+[UI] DESIGN.md's entire visual system (color tokens, IBM Plex typography, mono-tag) is not applied to the student shell chrome or to dashboard/subjects/profile/history — the one surface every student sees on every page load

**What:** `src/app/layout.tsx:20-36` loads IBM Plex Serif/Sans/Mono deliberately as **opt-in**
`--font-plex-*` CSS variables (the code comment explains this is intentional — so existing
Geist-based text isn't repainted by accident). `grep -rl "font-plex" src/app src/components` shows
it IS opted into by Notes, Flashcards, and the (recently rebuilt) Placement pages
(`student/placement/**`, `student/placement/prep/**`, `student/placement/skill-map`,
`student/placement/interview/**`) — but **not once** in `src/app/(student)/layout.tsx` (the shared
nav shell rendered on every student page including all of the above) nor in `dashboard/page.tsx`,
`subjects/page.tsx`, `profile/page.tsx`, or `history/page.tsx`. Confirmed live: every screenshot
this run took (`_audit_shell/screenshots/*.png`) renders in the default Geist/shadcn-neutral theme.

Color-wise, per-page ad hoc accents replace DESIGN.md's single ochre accent + ink/paper tokens:
`dashboard/page.tsx:269,271,274,277,279,281,293` use `sky-*`/`emerald-500`/`purple-500`; the
dismissible tip uses `amber-*` (lines 211-223); `history/page.tsx:367` hardcodes
`bg-blue-600` for the user chat bubble (confirmed in the `history-race-result.png` screenshot). None
of these are the ochre `#C08A2E` DESIGN.md specifies as the *one* accent.

**Distinction from the already-ledgered AU-PLACE-TOOLS finding (#17):** that finding was about
individual un-migrated placement sub-pages (Resume/JD/Interview-bank/Projects) next to migrated
siblings (Skill Map/Mock Interview) within the placement feature. This finding is broader and
structurally different: it's the **shell chrome itself** — the sidebar/top-bar/nav/user-profile
widget wrapping literally every student page, including the ones that DO apply `font-plex-*` to
their own content — plus the four core navigational surfaces (dashboard/subjects/profile/history)
that a student's session begins and ends on. A student who never leaves Notes or Placement/Skill-Map
still sees an unstyled nav chrome around them at all times.

**Where:** `src/app/(student)/layout.tsx` (no `font-plex-*`/token classes anywhere);
`dashboard/page.tsx:269-307` (sky/emerald/purple accents); `history/page.tsx:367` (`bg-blue-600`).

**Recommendation:** apply the same `font-plex-*`/ink-paper-ochre migration already done for
Notes/Flashcards/Placement to `(student)/layout.tsx` and the four core pages — this is the
highest-leverage single piece of DESIGN.md work remaining, since it's rendered on every screen.

---

### [S2] [UI] Mobile touch targets under the 44px floor, confirmed with new measurements on the shell nav

**What:** Reproduces the cross-cutting ledger finding with fresh, shell-specific numbers. Mobile
top-bar hamburger (`aria-label="Open menu"`,
`src/app/(student)/layout.tsx:106-113`) measures **36×36px**. Nav links inside the open mobile
drawer (`src/app/(student)/layout.tsx:54-85`) measure **36px tall** (confirmed on all 8 links, all
4 pages, via `nav a` bounding-box evaluation in `_audit_shell/screenshots.ts`). Both are under
DESIGN.md's 44px floor ("extend the existing CP-N4 rule platform-wide").

**Where:** `src/app/(student)/layout.tsx:43-51,106-113` (button sizing: `size-8`/`size-9` = 32/36px);
`NavLink.tsx:38` (`px-3 py-2` on `text-sm` content resolves to ~36px row height).

**Recommendation:** bump the mobile hamburger/close buttons to `size-11` (44px) and give `NavLink`
enough vertical padding to clear 44px in its default (non-collapsed) mode — matches the fix already
needed for the cross-cutting instance in AU-CHAT/AU-QUIZ/AU-PLACE-TOOLS, so this is additional
evidence for a single shared component-level fix, not four separate ones.

---

### [S3] [STATIC] No `prefers-reduced-motion` handling anywhere in the stylesheet

**What:** `grep -n "prefers-reduced-motion" src/app/globals.css` returns nothing. DESIGN.md: "Respect
`prefers-reduced-motion` everywhere, no exceptions." Low severity for AU-SHELL specifically because
this feature's own surfaces have almost no motion (a couple of hover/transition-colors utility
classes); flagged here because it's a global gap this run happened to notice while reading
`globals.css`, and no prior AU-* run has logged it explicitly. Likely matters more for
AU-QUIZ's/AU-FLASH's reveal animations than for AU-SHELL's static cards.

**Where:** `src/app/globals.css` (absent), affects every animated transition app-wide.

**Recommendation:** add a global `@media (prefers-reduced-motion: reduce)` rule disabling/shortening
transition and animation durations, once, in `globals.css`.

---

## Notable positives (verified live, not just read)

- **`chat_sessions`/`chat_messages` RLS is correctly scoped.** `_audit_shell/idor_check.ts`: student
  B could not read student A's session by ID, could not read A's messages by `session_id`
  (canary-string check: a planted `"AU-SHELL-IDOR-CANARY-98214"` message never appeared in B's
  response), and an unfiltered `chat_sessions` select for B returned zero foreign rows. This is a
  real, working policy — makes the `profiles` finding above a genuine outlier, not part of a
  systemic pattern.
- **`/api/chat/export` correctly re-verifies session ownership server-side**
  (`src/app/api/chat/export/route.ts:26-36`, `.eq("student_id", user.id)` via the admin client, not
  trusted from the client) — no IDOR on chat PDF export via `sessionId` tampering.
- **History page's session-switch race is handled correctly.** `_audit_shell/history_race.ts`:
  artificially delayed session A's message fetch by 2.5s using Playwright request interception,
  clicked A then immediately B (50ms apart) — confirmed via screenshot
  (`history-race-result.png`) that B's content (and only B's) renders in the final state, even
  though A's slower response arrives after B's. The `prev.id === session.id` staleness guard in
  `handleSelectSession` (`history/page.tsx:140-144`) works as designed under adversarial ordering,
  not just the happy-path case where responses return in click order.
- Empty/error-state copy meets DESIGN.md's "plain language, state what to do next" bar everywhere
  checked: "No subjects found for your branch. Please contact your admin.", "Current password is
  incorrect." — no vague "something went wrong."
- `proxy.ts`'s page-route role gating logic itself (redirect-on-wrong-role, forced-password-change
  gate, public-path handling) reads correctly for the paths exercised; the entire finding above is
  that the *data it reads* (`profiles.role`) is attacker-controlled, not that the gating logic
  misapplies a trustworthy value.

---

## Screenshots

`_audit_shell/screenshots/` — `{dashboard,subjects,profile,history}-{desktop,mobile}-{light,dark}.png`
(16 files), plus `{page}-mobile-menu-open.png` (4 files) and `history-race-result.png`.

## Summary

- **S1: 2** — (1) any student can self-escalate to `superadmin` via a direct, sanctioned
  `createBrowserClient()` call and immediately read/write every user's profile including their
  own role/branch/department, defeating the app's entire server-side authorization model in the
  same stroke since `proxy.ts`/`requireRole()` trust the same column; (2) the dashboard's
  placement-readiness widget silently and permanently shows "Not started" for every student
  because its query targets a nonexistent table and the hook drops the resulting error.
- **S2: 3** — no desktop sidebar collapse control (fix already exists in `FacultyShell.tsx`,
  unported); DESIGN.md's color/typography system is absent from the shell chrome and all four core
  navigational pages; mobile nav touch targets measure 36px against a 44px floor.
- Most important single finding: **the `profiles.role` self-escalation (S1-1).** Every other
  finding in this and prior AU-* runs assumes the role/authorization model is at least trustworthy
  even where individual features have gaps. This one shows the foundation itself — the column every
  layer of the app (RLS policies, `proxy.ts`, `requireRole()`) trusts to decide who is a student vs.
  a superadmin — can be rewritten by any student from their own browser console today, with the
  app's own public anon key and their own ordinary session, no exploit chain beyond one `.update()`
  call. This should be fixed before any of the other findings across the whole AU-* series.
