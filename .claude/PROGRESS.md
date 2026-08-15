# PLACEMENT REBUILD — PROGRESS LEDGER

This file is the memory of the build. It replaces the "long chat."
- Every checkpoint session READS this file first (to know what came before).
- Every checkpoint session APPENDS one entry here as its LAST action.
- Trust git (pushed SHAs), not prose. If an entry claims a SHA, it must exist.

Do not delete past entries. Append only.

---

## Format for each entry (copy this shape)

### CP-XX — <label> — <YYYY-MM-DD>
- **Commit SHA:** <sha>  (pushed to dev: yes/no)
- **What was built:** <1-2 lines>
- **Verified (happy path):** <what was checked and how>
- **Verified (unhappy path):** <interrupted / empty / concurrent / ineligible etc.>
- **Screenshots:** <paths, for UI checkpoints>
- **Migration needed:** <none | file created, AWAITING MANUAL APPLICATION>
- **Next checkpoint must know:** <anything non-obvious>

---

## Log

_(entries appended below by each checkpoint session)_

### CP-A1 — nextMove.ts pure function + unit tests — 2026-08-15
- **Commit SHA:** 31ae8476a6e10ffd98c56f69711073b68af054bb  (pushed to dev: yes — `git log origin/dev -1` confirms)
- **What was built:** `src/lib/placement/nextMove.ts` exporting `computeNextMoves(state, now?)`, a pure/deterministic ranking function over already-persisted state (no AI, no I/O). Implements SPEC §3 rules 1–6: setup-incomplete override, drive-sprint (weighted-weakest dimension for the drive's `company_type`, within a 14-day window, score < 60), drift (a tracked dimension idle > 14 days), lowest weighted gap for `primary_target` (score < 70), resume completeness (< 70), and the all-ready fallback (maintenance + Stage-3 mock-interview surfacing, when every dimension ≥ 70 and there is no *eligible* upcoming drive). Returns the **full** ranked list (not pre-sliced to 3) — top-N/"more" collapsing is left to CP-A2's UI layer, a deliberate contract choice documented in the file's JSDoc since SPEC §3 doesn't pin it down explicitly either way.
- **Notable repo-state finding (verify before reuse):** `prep/submit/route.ts` has no `placement_topic_mastery` track for `readiness_coding` ("coding has no track yet — keep existing score"), so the coding dimension **cannot drift** and its practice CTA routes into `/student/placement/prep/domain` (where `fill_code` technical questions live), not a `coding` track that doesn't exist. Encoded as `DIMENSION_TRACK.coding = null` — if CP-C1 (fill_code expansion) or a future checkpoint gives coding its own track, this mapping needs revisiting.
- **Narrow supporting edit:** `isDriveEligible` in `readiness.ts` had its `profile` param narrowed from `StudentPlacementProfile` to `Pick<StudentPlacementProfile, 'cgpa'>` (the only field it reads) — backward-compatible (no other caller existed), needed so `nextMove.ts` can pass its minimal fixture-shaped profile type without an unsafe cast.
- **Verified (happy path):** `npx tsx _cp_a1_verify/verify.ts` — 21 assertions, all passing, across the 6 scenarios SPEC names explicitly: happy path (single weighted gap), setup-incomplete (single move, overrides all else), drive-within-14-days (correct weighted-weakest dimension for the *drive's* company type, not the student's target), drift (idle-days computed correctly, ordered before the fallback), all-ready fallback (maintenance + mock_interview, in that order), ineligible-drive-ignored (drive excluded from both the sprint rule *and* the fallback's "no drive" check).
- **Verified (unhappy path):** the ineligible-drive scenario **is** the unhappy-path case for this checkpoint (a pure function has no interrupted/concurrent-request surface) — confirmed an ineligible drive neither fires a drive-sprint move nor blocks the all-ready fallback from treating the student as having "no drive". Also confirmed via the drift scenario that a track with zero attempts (never practiced) is *not* misclassified as drift (only tracks with `attempts_count > 0` are drift candidates).
- **Gate status:** `tsc --noEmit` clean (zero errors touching changed files). `npm run lint` — 300 pre-existing problems (154 errors/146 warnings, all in files this checkpoint didn't touch — matches SPEC §0's documented ~300 baseline exactly); zero new findings, confirmed by grepping lint output for `nextMove`/`_cp_a1_verify`/`readiness.ts` (no hits). `npm run build` exits 0, all routes compile including the unrelated existing `/student/placement/*` pages.
- **Screenshots:** none — this checkpoint is UI-less per SPEC (CP-A1 explicitly "No UI yet").
- **Migration needed:** none.
- **Next checkpoint must know (CP-A2, rebuild `/student/placement/page.tsx`):**
  1. Import `computeNextMoves`, `RankedMove`, `StageId`, `NextMoveState` etc. from `src/lib/placement/nextMove.ts` — the function returns the **full** ranked array; CP-A2's job is to slice `[0]` as the hero move, `[1..2]` as secondary cards, and collapse the rest under "more" per SPEC.
  2. `NextMoveState` needs `{ profile, studentBranch, drives, topicMastery }` — CP-A2 must fetch `placement_drives` (with joined `company:placement_company_profiles(*)` for `company_type`/`company_name`), `placement_topic_mastery`, and the user's `branch` (from the student's profile row, not `department` — per CLAUDE.md's single-dept-pilot rule) to assemble this.
  3. `tags` on each `RankedMove` are plain pre-formatted strings (e.g. `"Wipro · 11d"`, `"Domain 41/100"`) — CP-A2 decides `MonoTagVariant` per tag (this module intentionally makes no styling decision).
  4. The six-stage strip (`StageId` enum: `foundation | active_prep | drive_sprint | interview | post_outcome | competitive_exam`) is exported and ready for the "quiet horizontal stage strip" UI — Phase-2 stages (`foundation`, `post_outcome`, `competitive_exam`) never appear as a move's `stage` in this build's output, so the strip's locked-state rendering for those three is purely a UI decision, not driven by move data.