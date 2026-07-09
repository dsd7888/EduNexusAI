# Checkpoint 4 — Pilot Analysis Page (superadmin)

**Date:** 2026-07-08
**Scope:** New `/superadmin/pilot-analysis` page + supporting API routes, migration,
export, and daily storage cron. The existing `/superadmin/analytics` page is untouched.
**Report status:** Not committed with the code (left untracked, same as CP1–CP3).

---

## Page

- **URL:** `/superadmin/pilot-analysis`
- **File:** `src/app/(superadmin)/superadmin/pilot-analysis/page.tsx` (client component,
  recharts + existing Card/Table/Select/Badge/Button/Input primitives — no new UI lib).
- **Nav link:** added in `src/app/(superadmin)/layout.tsx` directly under "Analytics"
  (`LineChart` icon).
- Sections, in order: (1) KPI strip + recharge-budget editor, (2) adoption funnel,
  (3) cost trend with model-split toggle, (4) feature adoption table, (5) sortable
  per-faculty table with expandable per-model cost-split drill-down, (6) system health
  (storage/DB tier bars + manual incident log + add-incident form), (7) content output
  / time-saved pitch block. Every table section has its own Export menu.

## Access control (superadmin-only, tighter than table RLS)

Every API route calls `requireRole(["superadmin"])` — **not** `dept_admin`, even though
the `ai_call_logs` / `user_sessions` / snapshot tables' RLS allows both. The DB RLS is
not relied on as the only gate. The cron route is gated by the `CRON_SECRET` bearer
header instead (no user session).

## API routes (all under `src/app/api/pilot-analysis/`, superadmin-only)

| Route | Purpose |
|---|---|
| `overview/` GET | KPI strip + funnel + hours + artifacts + spend + hours-saved estimate |
| `per-faculty/` GET | one row per faculty (+ `?sort=cost\|hours\|failures\|name`), recent-jobs model split |
| `cost-trend/` GET | daily IST spend + tokens split by flash/pro/imagen (`?days=`, default 30) |
| `feature-adoption/` GET | per-feature adopted %, calls, cost, failure rate, p50/p95 (RPC) |
| `system-health/` GET | latest storage/DB snapshot, tier %, days-to-limit projection |
| `incidents/` GET+POST | manual incident log |
| `settings/` GET+POST | Gemini recharge budget (`pilot_analysis_settings`) |
| `artifact-detail/[jobId]/` GET | every `ai_call_logs` row for a job/related_content id |
| `export/` POST | csv / xlsx / pdf, reusing the same aggregation as the display routes |
| `../cron/storage-snapshot/` GET | daily DB+storage size snapshot (CRON_SECRET-gated) |

Shared aggregation lives in `src/lib/pilot-analysis/queries.ts` (and `export.ts` for
the tabular exports) so display and export never diverge. Per-faculty joins are done in
TypeScript (pilot scale); only DB/storage size and latency percentiles use Postgres
functions.

## Migration `20260708000002_pilot_analysis.sql`

- `storage_usage_snapshots`, `system_incidents`, `pilot_analysis_settings` (all
  superadmin/dept_admin SELECT RLS + service_role ALL, same pattern as `ai_call_logs`).
- Functions (SECURITY DEFINER): `get_db_size_bytes()`, `get_storage_size_bytes()`,
  `get_feature_latency_percentiles(since_ts)` using `percentile_cont` (p50/p95 in SQL,
  not a JS approximation).

## Data sources (no parallel accounting)

- Cost / tokens / model split / latency / failures → **`ai_call_logs` only**.
- Hours / adoption timing → **`user_sessions` only**.
- Artifact counts → `generated_content` + `explainers` + `faculty_question_bank`
  (canonical produced artifacts), not raw call-row counts.
- Roster/subjects → `profiles` + `faculty_assignments`.
- `usage_analytics` is **not** touched for any cost figure.

## IST bucketing

All day/week bucketing is at read time via `src/lib/pilot-analysis/ist.ts`. IST is a
fixed UTC+5:30 with no DST, so a +330-minute epoch shift + UTC date read is exactly
equivalent to `(created_at AT TIME ZONE 'Asia/Kolkata')::date`. No IST logic in any
write path; `created_at` stays UTC/timestamptz.

## Exports

- `exceljs` added (confirmed absent before: package.json had docx/pdf-lib/pptxgenjs,
  no Excel lib).
- **csv**: every section, BOM-prefixed. **xlsx**: multi-sheet for "all", single sheet
  per section, bold headers + auto widths. **pdf**: board-ready one-pager (KPI strip +
  adoption + content-tally/time-saved only) via pdf-lib (existing dep) — the
  per-faculty table is deliberately **not** dumped to PDF (belongs in xlsx/csv).

## Part F edge-case checks

1. **Zero-activity faculty** — `getPerFaculty` seeds every `role='faculty'` profile with
   zero rows first, then layers activity on top. Zero rows appear, never dropped. ✔
2. **Dangling sessions** — `sessionDurationMs` uses `ended_at ?? last_activity_at`, so a
   never-closed session is measured to its last heartbeat, not `now()`. ✔ (see
   `queries.ts` `sessionDurationMs`).
3. **Deleted faculty** — logs/sessions with `user_id = NULL` but
   `user_role_snapshot='faculty'` are grouped into a synthetic row keyed by
   `user_email_snapshot` and flagged `deleted:true`. Cost + hours still attributed.
   **Caveat:** generation counts come from `generated_content`/`explainers`/`qbank`,
   which CASCADE on profile delete and have no snapshot — so a deleted faculty's
   artifact **counts** go to zero even though their cost/hours survive. Noted on the
   page and here; not fixable without adding snapshot columns to those tables (out of
   scope).
4. **Multiple tabs** — not deduplicated; hours summed across a person's session rows.
   A caveat label sits directly under the per-faculty table heading. ✔
5. **Currency** — displayed at 2 dp; exports keep 4 dp (matches `NUMERIC(12,4)`). ✔
6. **Empty states** — cost-trend and feature-adoption render dashed empty-state boxes
   when there's no data; tier bars show "insufficient data" when <3 snapshots. ✔

## Open questions / ambiguities I did NOT silently resolve

1. **`ppt_refine` artifact count for the hours-saved estimate.** `TIME_SAVED_MINUTES_
   PER_ARTIFACT` has a `ppt_refine` entry, but there is **no `generated_content` type**
   that cleanly maps to it (types are ppt / visual_notes / refined_notes / qpaper /
   answer_key). Interim: I count **distinct successful `ppt_refine` `job_id`s** from
   `ai_call_logs` as the artifact proxy, clearly labeled as an estimate like everything
   else in that block. **Please confirm** whether ppt_refine should map to a specific
   generated_content type (e.g. refined_notes) instead, or be dropped from the
   time-saved estimate. This is the one mapping I flagged rather than hard-coding a
   guess as if it were certain.
2. **`refined_notes` / `visual_notes` → which feature bucket?** They appear in the
   per-faculty generation columns and overview artifact tally, but are not in the
   time-saved map, so they contribute to counts but not to the hours-saved estimate.
   If Dhruv wants them in the estimate, add entries to the constants map.

## Deployment notes for Dhruv

- **`CRON_SECRET` env var** must be set in Vercel for `/api/cron/storage-snapshot` (and
  it's already used by the existing abandon-stale cron). It is **not** hardcoded. When
  unset (local dev) the route is open so it can be exercised manually.
- **`vercel.json`** now has a second cron: `/api/cron/storage-snapshot` daily at
  `0 1 * * *`. Storage/DB-size data **starts accumulating from first deploy** — the
  days-to-limit projection returns `null` with a reason until ≥3 snapshots exist, and
  the page shows "insufficient data" rather than a fake number.
- **Migrations `20260708000001` (CP3) and `20260708000002` (CP4) are NOT applied
  live** — the Supabase project (`qkbvcufwbsokwizczdnx`) is currently paused
  (INACTIVE). They need `supabase db push` / apply-on-restore once the project is
  active. `get_storage_size_bytes()` assumes `storage.objects.metadata->>'size'`; if a
  newer Supabase version changed that JSON shape, inspect `storage.objects` and adjust
  the function before relying on the storage figure.

## Build / tsc

```
npx tsc --noEmit
EXIT:0

npm run build
✓ Compiled successfully
BUILD_EXIT:0
```

Both `/superadmin/pilot-analysis` and all 10 new API routes register in the build
output.
