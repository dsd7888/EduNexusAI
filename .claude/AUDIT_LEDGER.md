# STUDENT-FACING FEATURE AUDIT — MASTER LEDGER

The running punch-list across all audited features. Each feature session appends its
severity roll-up here as its last act. This is the input to a later FIX pass.
Append only. Trust the per-feature findings files for detail; this is the index.

Severity: S1 = blocker (pilot cannot ship) · S2 = major · S3 = minor.
Evidence tags: [RUNTIME] [EXPORT] [UI] [STATIC].

---

## Cross-cutting issues (seen in more than one feature — promote here)

- **Desktop sidebar not collapsible** — AU-CHAT. No toggle/rail state on `<aside>` in
  `src/app/(student)/layout.tsx`; only the mobile overlay has open/close. Check AU-SHELL against the
  same layout file (it's shared shell code, not chat-specific) — likely reproduces everywhere.
- **Dark mode unreachable app-wide** — AU-CHAT. No `next-themes`/`ThemeProvider`/any `.dark`-class
  toggle exists anywhere in `src/app`/`src/components`; Tailwind's dark variant is class-based, not
  `prefers-color-scheme`-based, so there is no automatic fallback either. DESIGN.md's dark-mode spec
  (night bg, `ring-paper` focus states, CP-D0 layering rules) currently reaches zero sessions. Verify
  against AU-SHELL and AU-FLASH (CP-D0 dark-surface work) — if true there too, this is a single
  platform-wide gap, not a per-feature one.
- **Touch targets under 44px** — AU-CHAT (every composer/header control: 26–36px measured). DESIGN.md
  states this platform-wide, "not just mobile Notes surfaces (extend the existing CP-N4 rule
  platform-wide)" — check AU-QUIZ/AU-PLACE-*/AU-SHELL controls too; likely a shared `Button`/pill
  sizing issue rather than N separate per-feature bugs.
- **Rate-limit check-then-increment race (`src/lib/utils/rate-limit.ts`)** — AU-CHAT. `checkRateLimit`
  reads today's usage then a later, separate write increments it — no atomicity. This helper is shared
  by every rate-limited feature (`chat`, `research`, `hint`, `quiz`, `examSim`, `notes_view`,
  `notes_export`), so the same race almost certainly reproduces in AU-QUIZ, AU-NOTES, and
  AU-PLACE-TOOLS wherever they call `checkRateLimit` — worth a single shared fix rather than N patches.
- **Shared test harness (`src/lib/testing/httpHarness.ts`) duplicates slow POST requests** — AU-CHAT
  (methodology note, not a product finding). Its wrapped `fetch` produced two real server-side
  executions per single call to a multi-second AI route in ~most cases observed; a raw `curl` to the
  same routes never duplicated. Any later `AU-*`/`_cp_*_verify` session driving a slow AI route through
  this harness should corroborate concurrency/duplication findings with raw `curl` before trusting them,
  until this is fixed.

---

## Per-feature roll-up

### AU-CHAT — Student AI chat (+visualize/export/suggestions) — 2026-08-16 — findings file: .claude/findings/AU-CHAT.md
- S1: 0
- S2: 5 — (1) rate-limit check-then-increment race lets concurrent requests exceed the daily cap
  (`src/lib/utils/rate-limit.ts`), confirmed clean with raw concurrent curl (49/50 → 51/50 with 2
  parallel calls); (2) known bug #1 confirmed — chat composer sits ~149px above the true viewport
  bottom on desktop (dead space below it), from a hardcoded `h-[calc(100vh-7rem)]` that doesn't match
  the shell's real padding; (3) known bug #2 confirmed — desktop sidebar has zero collapse control;
  (4) every interactive control in the chat composer/header measures 26–36px, under DESIGN.md's
  44px floor, on both mobile and desktop; (5) tutor system prompt has no safety/distress-handling
  clause at all — a distress-adjacent message was handled gently this run on base-model instinct alone,
  with no product-level guardrail behind it.
- S3: 3 — chat PDF export renders markdown tables as raw garbled pipe-syntax instead of a real table
  (diagrams DO export correctly, tables don't); dark mode is unreachable app-wide (cross-cutting, see
  above); no server-side double-submit/idempotency guard on `/api/chat` (client-lock-only, lower
  severity than the rate-limit race but same root cause).
- AI spend this run: ₹30.01 (~$0.36), 46 real provider calls (inflated ~2× by the harness artifact
  noted above; the one severity-bearing concurrency finding was re-verified clean of that confound via
  raw curl).
- Most important single thing: the rate-limit race — every daily-cap feature sharing
  `checkRateLimit` (chat, research, hint, quiz, examSim, notes) is very likely exploitable the same way,
  and `examSim`/`research`/reasoning are the expensive tiers, so this is a real, currently-unbounded
  cost leak, not just a chat nuisance.

---

## Master punch-list (ranked, filled as features complete)

_(S1 first, then S2, then S3 — this is what the FIX pass consumes)_

**S2**
1. Rate-limit check-then-increment race in `src/lib/utils/rate-limit.ts` — likely affects every
   rate-limited feature, not just chat. [AU-CHAT]
2. Chat composer floats ~149px above the viewport bottom on desktop (bad height calc in
   `student/chat/[subjectId]/page.tsx` vs. the shell's real padding). [AU-CHAT]
3. Desktop sidebar has no collapse control (`(student)/layout.tsx`). [AU-CHAT; check AU-SHELL]
4. Composer/header touch targets measure 26–36px, under DESIGN.md's 44px floor. [AU-CHAT; check
   other features for the same shared-component root cause]
5. Tutor system prompt (`buildTutorSystemPrompt`) has no safety/distress-handling clause. [AU-CHAT]

**S3**
6. Chat PDF export garbles markdown tables into raw pipe-syntax text (diagrams export fine). [AU-CHAT]
7. Dark mode is unreachable anywhere in the app — no theme toggle exists. [AU-CHAT; cross-cutting]
8. No server-side double-submit guard on `/api/chat` (client-lock-only). [AU-CHAT]
