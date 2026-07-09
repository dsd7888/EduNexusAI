# Checkpoint 3 — Session Tracking + Idle Auto-Logout

**Date:** 2026-07-08
**Scope:** `user_sessions` table + 3 API routes + client idle-tracking hook + idle
auto-logout wiring. No Pilot Analysis UI (that's Checkpoint 4).
**Report status:** Not committed with the code (same convention as CP1/CP2 reports —
left untracked).

---

## Confirmed: no prior session tracking existed

- `grep onAuthStateChange src` → no matches.
- `grep user_sessions src supabase` → no matches before this checkpoint.
- Only one `supabase.auth.signOut()` call site in the whole codebase (see below).

So there was genuinely nothing to migrate away from.

---

## Files added

| File | Purpose |
|---|---|
| `supabase/migrations/20260708000001_user_sessions.sql` | New table (timestamp after `20260708000000_ai_call_logs.sql`, the latest existing) |
| `src/app/api/session/start/route.ts` | POST — insert row, return `{ sessionId }` |
| `src/app/api/session/heartbeat/route.ts` | POST `{ sessionId }` — ownership-checked `last_activity_at = now()` |
| `src/app/api/session/end/route.ts` | POST `{ sessionId, reason }` — idempotent close, auth-optional |
| `src/lib/session/client.ts` | Shared client helpers + `IDLE_TIMEOUT_MS` single source of truth |
| `src/hooks/useIdleSessionTracking.ts` | The idle timer / heartbeat / auto-logout hook |
| `src/components/layout/SessionTracker.tsx` | Invisible client mount that calls the hook |

## Files modified

| File | Change |
|---|---|
| `src/app/(faculty)/layout.tsx` | Mount `<SessionTracker />` |
| `src/app/(student)/layout.tsx` | Mount `<SessionTracker />` |
| `src/app/(superadmin)/layout.tsx` | Mount `<SessionTracker />` |
| `src/components/layout/LogoutButton.tsx` | `endSession('manual_logout')` before `signOut()` |
| `src/app/(auth)/login/page.tsx` | "Logged out due to inactivity" notice |

---

## Deliverable answers

### Every `signOut()` call site found / updated

**Exactly one** production call site: `src/components/layout/LogoutButton.tsx`.
`LogoutButton` is the single shared component rendered in all three authenticated
layouts (faculty/student/superadmin), so wrapping it once covers every surface. This
was **expected** to be centralized and it is — no surprise to flag. The only other
`signOut()` call in the codebase after this checkpoint is the idle-timeout path inside
the hook itself.

### Exact mount points confirmed

- `src/app/(faculty)/layout.tsx` — `<SessionTracker />` alongside `<FacultyShell>`.
- `src/app/(student)/layout.tsx` — `<SessionTracker />` inside the root layout div.
- `src/app/(superadmin)/layout.tsx` — `<SessionTracker />` inside the root layout div.

NOT mounted in root `src/app/layout.tsx`, NOT on `(auth)/login`, `(auth)/register`, or
the public explainer permalink route `src/app/e/[code]/route.ts`. `SessionTracker` does
zero auth gating — it only reacts to idle time — so this does not violate the
"layouts are pure UI" convention.

### "Logged out due to inactivity" UI

The idle path redirects to `/login?reason=idle_timeout`. The login page reads
`window.location.search` in a `useEffect` (deliberately not `useSearchParams`, to avoid
a Suspense-boundary build bailout) and renders a non-destructive `<Alert>` above the
sign-in form: *"You were logged out due to 2 hours of inactivity. Please sign in
again."*

### Edge cases (Part E)

1. **Multiple tabs → multiple rows.** ACCEPTED LIMITATION. `sessionStorage` is per-tab,
   so N tabs = N `user_sessions` rows for one real login. No cross-tab coordination
   (BroadcastChannel/localStorage) built — an accepted approximation for a ~25-person
   pilot. Checkpoint 4 sums across rows and labels the caveat.
2. **Dangling sessions.** No cron/cleanup built (that's CP4's query-time problem). The
   hook keeps `last_activity_at` fresh (heartbeat + visibilitychange flush) so the
   CP4 fallback (`ended_at IS NULL` → treat as ending at `last_activity_at`) has good
   data.
3. **Replaced/missing row (404).** If a heartbeat 404s (e.g. DB reset before pilot),
   the hook silently calls `/api/session/start` again and stores the fresh id. The
   `'replaced'` enum value is left reserved (unused) for a future "signed in elsewhere"
   feature — not built.
4. **`start` fires from inside the authenticated layout** (via `SessionTracker` on
   mount), never injected into the login flow — it cannot delay the post-login
   redirect. It's `await`-free from the caller's perspective (fire-and-forget).
5. **Long-running generation.** No special handling needed. The interaction listeners
   (`mousedown/keydown/touchstart/scroll`) only *advance* `lastInteractionAt`; a pending
   `fetch` never touches the timer, so a slow generation neither resets nor breaks it.
   The user almost certainly clicked "Generate" recently anyway.

### Implementation notes worth flagging

- **Interaction events:** `mousedown`, `keydown`, `touchstart`, `scroll` only — NOT
  `mousemove` (would disable idle detection).
- **Two separate throttles, not conflated:** a 5s perf throttle on the listener's ref
  write, and the 5-min heartbeat cadence. The heartbeat only fires if
  `lastInteractionAt` advanced during the window, so a genuinely idle tab sends
  nothing.
- **Idle check** runs every 60s; fires `end` (3s-timeout best-effort) → `signOut()` →
  `/login?reason=idle_timeout` at 2h.
- **`IDLE_TIMEOUT_MS`** is defined once in `src/lib/session/client.ts`; Checkpoint 4's
  `constants.ts` re-exports it rather than duplicating the literal.

---

## Open item (not a blocker for the commit)

**Migration not applied live.** The Supabase project (`qkbvcufwbsokwizczdnx`) is
currently **INACTIVE/paused** (connections time out). Waking/restoring a paused prod
project has cost implications and is Dhruv's call, not something I'll trigger to push a
migration. The migration file is committed and ready; it needs `supabase db push` (or
apply-on-restore) once the project is active. Checkpoint 2 applied its migration live
while the project was active; this one is pending purely because the project is paused.

---

## tsc

```
npx tsc --noEmit
EXIT:0
```
