# Placement Rebuild — Implementation Spec (Pilot Phase)

**Target branch:** `dev` (all work here; `main` is production)
**Executor:** fresh Claude Code session — this document is self-contained; do not assume access to the planning conversation that produced it.
**Nature:** planning document, not code. Build against the *actual repo state*, not this spec's description of it — verify every "already exists" claim below with `git`/`grep` before trusting it. Handoff docs in this project have been stale by multiple checkpoints before; a wrong assumption here corrupts the whole build.

---

## 0. Read-first / grounding (do this before writing any code)

1. `git fetch && git checkout dev && git pull && git status` — confirm clean tree, note HEAD SHA.
2. Read `DESIGN.md` in full. It is the authority for every visual decision in this spec. Where this spec and `DESIGN.md` ever conflict, `DESIGN.md` wins on visuals; flag the conflict.
3. Read `CLAUDE_CONTEXT.md` §16 (Placement Module) and §17 (roadmap) for current state.
4. Read these files before touching them, to confirm they match this spec's assumptions:
   - `src/lib/placement/{readiness,bankManager,generator,modules,tracks,interview-prep,mini-projects}.ts`
   - `src/types/placement.ts` (readiness weights, `question_type`/`code_context` types)
   - `src/lib/ai/{router,costLogger}.ts` (task→model routing; `routeAI` already logs every call to `ai_call_logs` via `after()` — **every new AI call in this spec MUST go through `routeAI` so it is cost-logged; no direct provider calls**)
   - `src/app/(student)/student/placement/prep/page.tsx` (the long-scroll page — see §4)
   - `src/app/api/placement/prep/{generate,submit}/route.ts` (fill_code is already wired here — see §5)
   - `src/app/api/placement/resume/ats/route.ts` (JD path already exists — see §6)
   - `src/components/ui/mono-tag.tsx`, `src/components/ui/score-meter.tsx` (design-system primitives to reuse)

### Standing engineering rules (apply to every checkpoint)
- **HALT gates** at every schema migration and every access-critical route. Stop, report SHA + clean tree, wait for approval before continuing past a HALT.
- Every checkpoint report includes: the commit SHA, `git show --stat <sha>`, confirmation the branch is **pushed** (not just committed locally), and clean-tree confirmation.
- `tsc`, `eslint`, and `next build` clean before any commit. Pre-existing debt excluded from gates: `_cp_n6_verify/render_check.ts` (3 tsc errors), ~300 pre-existing eslint findings. Do not add to either.
- **No new npm dependencies without explicit approval.** If a task seems to need one, stop and ask.
- **No silent fallbacks / no coercion / hard gates.** Validate-or-null beats fallback-coercion chains.
- **`responseSchema` on every structured Gemini call.** Never duplicate the schema in prompt text.
- `repairGeminiJsonEscapes` at every new call site that parses model JSON (LaTeX/backslash corruption is silent otherwise).
- `thinkingConfig` set explicitly on every new AI call (`thinkingLevel: "minimal"` for structured tasks — never rely on `thinkingBudget: 0`, which silently eats the output budget).
- `adminClient` bypasses RLS — every route using it does explicit app-layer ownership checks.
- **Unhappy-path verification is required** in every checkpoint report, not just happy-path (interrupted flows, concurrent actions, empty/malformed data, ineligible student, empty bank).

### Verification tooling (applies to every UI checkpoint — founder requirement)
For any checkpoint that changes a rendered page, the report MUST include:
- **Screenshots** of the changed surface at desktop (~1280px) and mobile (~390px) widths, in both light and dark mode where the surface supports dark. Use a headless-browser screenshot against a locally running `next dev` (or `next build && next start`). If no screenshot tooling is available in the environment, stop and say so — do not silently skip and report "looks good."
- A **DESIGN.md conformance line** per screenshot: which tokens/scale/mono-tag rules the surface now follows, and any measured contrast ratios for text you introduced (WCAG AA is non-negotiable per DESIGN.md).
- A **functional test** of the surface's primary action (not just that it renders): the actual click-through works end to end against a seeded test student.

---

## 1. What this build is (scope boundary — do not exceed)

This is the **pilot-blocking rebuild**. It must stand on its own as a coherent, shippable, demoable product: one clean student journey with a real orchestrator and the full design system applied. It is explicitly **not** the whole roadmap.

**IN scope (this spec):**
- **A. The spine** — "Next Move" stateful orchestrator (§3)
- **B. Navigation / long-scroll fix** on the topic-browse page (§4)
- **C. Practical technical track** — expand existing `fill_code` coverage + external-practice recommendation map (§5)
- **D. JD-driven resume** — finish the existing JD path into human-like rewriting + interviewer lens (§6)
- **E. Skill-gap map** — read-only "archetype vs your delta" (§7)
- **F. Bounded mock-interview stage** — structured rounds + one capped reactive follow-up layer (§8)
- **G. Cohort/TPO analytics** — readiness-lift-over-time snapshot view (§9)
- **H. Design-system pass** across all placement student surfaces (§10, and folded into every UI checkpoint)

**OUT of scope (Phase 2 — designed-for, not built; see §11):** the agentic project copilot, full guided upskilling paths, GATE adaptive track, GRE/GMAT/IELTS guides, post-outcome stage, accreditation-grade export. Where this build creates an entry point for a Phase-2 stage, it renders a **disabled/"coming in your next stage" placeholder**, never a broken link and never a half-built feature.

**Explicitly killed (do not build):** a gallery that displays other students' finished projects for copying. It manufactures cohort sameness. Where exposure to others' work matters, §7's approach-library pattern (archetypes/framings, not copyable deliverables) is the sanctioned mechanism.

---

## 2. The stage model (the mental model the whole UI expresses)

The student moves *along a line*; the spine knows where they are and hands them the next action. Six positions:

- **Stage 0 — Foundation/upskilling** (Phase 2 placeholder this build)
- **Stage 1 — Active prep** (core of this build)
- **Stage 2 — Drive sprint** (partially built; spine surfaces it, see §3)
- **Stage 3 — Interview** (bounded build this spec, §8)
- **Stage 4 — Post-outcome** (Phase 2 placeholder)
- **Parallel — Competitive exam / GATE** (Phase 2 placeholder)

The spine (§3) is the single surface that reads state and routes into these stages. Stage plumbing must be first-class in the spine's data contract from day one so Phase-2 stages slot in without a rearchitecture.

---

## 3. Feature A — The spine ("Next Move" orchestrator)

### Intent
Turn `/student/placement` (the landing, currently a 683-line read-only dashboard) from *a dashboard you read* into *a queue that sequences*. It reads state already persisted and returns ONE ranked next action that re-orders as the student acts. **No new AI calls — pure orchestration logic over existing data.** This is the navigation fix and the honest "agentic" surface in one.

### Inputs (all already persisted — verify column names against live types)
From `student_placement_profiles`: `setup_complete`, `primary_target`, 5 readiness dimensions + overall, `resume_completeness`, `prep_streak_days`, `last_active_date`, `dream_companies`, `cgpa`, `active_backlogs`.
From `placement_drives` (+ eligibility via `isDriveEligible` in `readiness.ts`): upcoming drives with dates and eligibility.
From `placement_topic_mastery`: per-topic accuracy, `current_difficulty`, last-practiced timestamp.

### Decision logic (deterministic, ranked — implement as a pure function so it is unit-testable)
Create `src/lib/placement/nextMove.ts` exporting a pure function:
`computeNextMoves(state): RankedMove[]` where each `RankedMove` has `{ stage, kind, title, reason, href, urgency, tags }`.
Ranking rules, highest priority first:
1. **Setup incomplete** → single move: finish setup. (Nothing else shows.)
2. **Eligible drive within 14 days AND weighted-weakest dimension for that drive's company_type < 60** → drive-sprint move into the exact weak dimension's practice, `urgency: high`. Use `READINESS_WEIGHTS[company_type]` to pick the dimension that matters most for *that* drive, not the globally lowest.
3. **Drift**: a dimension that was practiced but not touched in > 14 days → "return to X" move, `urgency: medium`.
4. **Lowest weighted gap** for `primary_target` (weight ≥ 0.10 and score < 70) → standard prep move.
5. **Resume incompleteness** below a threshold → resume move.
6. Fallback when all readiness ≥ 70 and no drive → "keep sharp" maintenance move + surface Stage-3 mock interview.
Return top N (N=3) for a primary + secondary layout; the rest collapse under "more".
`reason` strings use the platform vernacular and mono-tag data (`Domain 41/100`, `Wipro · 11 days`, `CO`-style compactness) — these render as mono-tags per DESIGN.md.

### UI (rebuild `src/app/(student)/student/placement/page.tsx`)
- Top: ONE hero "Next Move" card (the #1 ranked move) — title, `reason` as mono-tags, single primary CTA (ink primary button, DESIGN.md voice: name the action the student takes).
- Below: 2–3 secondary moves as compact cards.
- Below that: a collapsed-by-default "Your readiness" section (the old dashboard content, demoted — reachable, not the first thing).
- Stage indicator: a quiet horizontal stage strip showing where the student is on the six-stage line, Phase-2 stages shown as locked/"next stage" (mono-tag `Locked`), not hidden — the line itself is a selling point to stakeholders.
- Empty/first-run state: plain-language guidance per DESIGN.md (no decorative illustration standing in for guidance).

### Checkpoints
- **CP-A1** — `nextMove.ts` pure function + unit tests (happy path, setup-incomplete, drive-within-14-days, drift, all-ready fallback, ineligible-drive-ignored). No UI yet. Gate: tsc/eslint/build clean, tests pass.
- **CP-A2 (HALT after)** — rebuild the landing page UI consuming `computeNextMoves`, design-system-conformant. Full UI verification per §0 (screenshots desktop+mobile, light+dark, conformance line, functional click-through into a real practice session). HALT for approval before proceeding to §4.

---

## 4. Feature B — Navigation / long-scroll fix

### The problem (verified)
`src/app/(student)/student/placement/prep/page.tsx` (~362 lines) renders all four tracks, and for each track expands **every** `TRACK_SECTIONS` section with **every** topic as a `<Link>` — the entire topic universe dumped in one flat vertical scroll, no search, no collapse, hard to scan. This is the specific "very long scroll, can't search a topic, painful to look at" page the founder called out.

### The fix
Rebuild this page as a **searchable, collapsible topic browser**:
- **Search box at top** (sticky): filters topics across all tracks by label as the student types. Client-side filter over the static `TRACK_SECTIONS` + `PRACTICE_MODULES` data — no backend, no cost. Focus ring uses ink-900 per DESIGN.md (ochre fails the 3:1 floor).
- **Track tabs or accordion**: each track collapsed by default to its section headers; expand to reveal topics. Default view fits on roughly one screen. Preserve deep-linkability (a `?track=` / `?topic=` query param can pre-open).
- **Per-topic mastery mono-tag** on each topic row (pull from `placement_topic_mastery`) so the browse view doubles as a progress view — a topic shows `Mastery 72` or `New` as a neutral/where-earned performance mono-tag per DESIGN.md's rule (performance fill only when the tag *is* a performance indicator).
- Preserve every existing `href` (`trackHref`, `practiceHref`) so no downstream route breaks. This is a presentation rebuild, not a routing change.
- Touch targets ≥ 44px (DESIGN.md, platform-wide rule). Respect `prefers-reduced-motion` on any expand/collapse animation (180ms ease-out max).

### Checkpoint
- **CP-B1** — rebuilt browser page. Full UI verification per §0, with explicit before/after screenshots (the "before" documents the long-scroll problem; the "after" shows the searchable/collapsed state). Functional test: type a query → correct topics filter → click one → lands in the correct practice drill. Unhappy path: empty search result state (plain-language, per DESIGN.md).

---

## 5. Feature C — Practical technical track

### What already exists (verify first)
`src/app/api/placement/prep/generate/route.ts` already produces **mixed 4-MCQ + 4-fill_code** domain sessions for topics in `FILL_CODE_TOPICS` = {SQL, DBMS, OOP, OS, Networks, DSA}, banks them (`question_type`, `code_context` columns on `placement_question_bank`), and `prep/[track]/practice/page.tsx` renders them. **Do not rebuild this. Extend it.**

### The work
1. **Expand `fill_code` topic coverage** beyond the six, driven by `modules.ts` technical modules for *all* branches (e.g. Mechanical: thermodynamics/SOM where a "fill the governing equation / complete the calc step" format fits; Electrical: circuit-analysis steps). For non-CS branches where literal code doesn't fit, the same `fill_code` mechanism becomes "complete the critical step" (fill the blanked line in a worked solution). Confirm the grader in `prep/submit/route.ts` handles the expanded set (exact-match/normalized-match on the blanked span — verify how it currently grades before extending; **do not weaken grading to a fuzzy match**, hard-validation per standing rules).
2. **External-practice recommendation map** — a **static, hand-authored, zero-AI-cost** mapping in a new `src/lib/placement/practiceRecs.ts`: per module/topic → curated pointers ("for DSA trees: these 6 LeetCode problems"; "for DBMS normalization: this one-page summary"). Surfaced on the track/practice page as a mono-tagged resource strip. Static data = no recurring cost, high practical value. No external API calls; these are curated links/labels only.
3. Bank pre-generation note: `fill_code` generation is Flash via `routeAI`; the bank-reuse pattern already amortizes it. Do **not** add a pre-gen cron in this build — the existing on-miss generation + bank is sufficient for pilot scale. (Pre-gen cron is a Phase-2 optimization gated on real traffic numbers.)

### Checkpoint
- **CP-C1 (HALT after — touches generation + grading)** — expanded `fill_code` coverage + `practiceRecs.ts` + UI resource strip. Verification: generate a session for a newly-covered topic against a test student, confirm it banks correctly, confirm grading is correct on both a right and a deliberately-wrong fill (unhappy path), confirm recommendations render. UI verification per §0 for the resource strip. HALT for approval.

---

## 6. Feature D — JD-driven resume

### What already exists (verify first)
`src/app/api/placement/resume/ats/route.ts` already accepts `jd_text`, extracts JD keywords, checks presence in the resume, and returns JD-specific ATS tips. `resume/rewrite-bullet/route.ts` already does inline bullet rewriting (3 variants). **The JD plumbing exists. Do not rebuild it.**

### The gap to close
- **JD-targeted rewriting**: extend `rewrite-bullet` (or add a sibling route) so a rewrite can be *conditioned on the pasted JD* — rewrites a bullet toward the JD's language and priorities, not generically. Reuse the existing `jd_text` intake. Same 3-variant, ghost-text UX already in the resume page.
- **Interviewer lens (not just ATS)**: the ATS route optimizes for keyword match; add a second evaluation pass that flags bullets that would *read as hollow to a human interviewer* ("led a team" with no metric, buzzword with no substance) and suggests a concrete-metric rewrite. This is the "clears ATS **and** the interviewer" requirement. One additional Flash call via `routeAI`, `responseSchema`-constrained, cost-logged; reuse resume + jd_text context already in scope.
- **Human-like output guard**: rewrites must not read as AI-generated résumé-speak. Add explicit negative constraints to the prompt (no "spearheaded/leveraged/synergized" filler unless the student's own input warrants it; keep the student's voice). This is a prompt-quality requirement, not new infra.

### Checkpoint
- **CP-D1** — JD-targeted rewrite + interviewer-lens pass, wired into the existing resume page UI. Verification: paste a real JD + a weak bullet → confirm the rewrite moves toward the JD and the interviewer-lens flags the hollow version. Cost-log row appears in `ai_call_logs` with the right `task`/`feature`. Unhappy path: empty JD, JD too short (existing 50-char guard), malformed resume. UI verification per §0.

---

## 7. Feature E — Skill-gap map (read-only)

### Intent
"Here's the placeable archetype for your branch × target, and here's your delta." High stakeholder-fascination, near-zero recurring cost, and the sanctioned replacement for the killed copy-a-project gallery: it shows the *shape of what's expected*, not copyable deliverables.

### Design
- **Archetypes are cached content, not per-student generation.** Create `src/lib/placement/archetypes.ts`: a hand-authored (or generate-once-then-store) set keyed by `branch × primary_target` — each archetype lists the capability pillars a placeable student in that slot has (e.g. service-IT CSE: DSA fundamentals, one deployed project, working tech stack, one hackathon, communication). One archetype per slot; ~a dozen slots total. **No per-student AI call for the archetype.**
- **The delta is computed in-app** from data the platform already has: the student's completed subjects/mastery, resume completeness, project count, readiness dimensions. Pure function `computeSkillGap(profile, archetype): GapReport`. Read-only, no writes, no AI.
- **UI**: a new read-only surface (e.g. `/student/placement/skill-map`) rendering pillars as met / partial / gap using mono-tags and `score-meter`, with each gap linking to the relevant existing prep track or a Phase-2 placeholder where the remedy is upskilling (Stage 0). Honest labeling: gaps that route to Phase-2 features show a "coming in your next stage" placeholder, not a dead end.

### Checkpoint
- **CP-E1** — `archetypes.ts` + `computeSkillGap` pure function + unit tests + read-only UI. Verification: unit tests for gap computation across at least 3 branch×target slots including an all-met and an all-gap student. UI verification per §0. Confirm zero AI calls made by this feature (grep the route; it should touch no `routeAI`).

---

## 8. Feature F — Bounded mock-interview stage (Stage 3)

### What already exists (verify first)
`src/lib/placement/interview-prep.ts` — a **static** `InterviewQuestion[]` bank (~11 questions, hand-authored, HR + technical rounds). `api/placement/interview/evaluate/route.ts` already evaluates an answer via `routeAI`. **The evaluation path exists.**

### The build
- **Expand the static bank** meaningfully (target ≥ 30 across introduction/motivation/behavioral/situational/technical_cs/project_deep_dive/stress, tagged by `company_types` and `difficulty`). Static = zero generation cost.
- **Structured round flow**: a mock "round" = an ordered sequence pulled from the static bank appropriate to the student's `primary_target` (HR round, technical round). New page `/student/placement/interview/mock` running the sequence with per-question framing (the bank already carries `why_asked`, `answer_framework`, `dos`, `donts`).
- **ONE reactive follow-up layer, hard-capped**: after the student answers a `project_deep_dive` or resume-tied question, ONE Flash follow-up (via `routeAI`, `responseSchema`, thinking minimal, cost-logged) that reacts to *their actual resume/project text* — the personalized bit that makes it feel real. **Hard cap: at most one reactive follow-up per question, and a per-session ceiling (e.g. ≤ 5 reactive calls/session).** This cap is a cost gate, not a nicety — enforce it server-side, do not trust the client. Everything else in the flow is static.
- Feedback uses the existing `evaluate` route; keep its no-red / amber-not-red performance rule (DESIGN.md).

### Checkpoint
- **CP-F1 (HALT after — introduces per-session AI ceiling)** — expanded bank + mock round flow + capped reactive layer. Verification: run a full mock round as a test student; confirm the reactive follow-up fires and reacts to real resume text; **confirm the per-session cap is enforced server-side** (attempt to exceed it and confirm it's refused — unhappy path). Cost-log rows present and attributable. UI verification per §0. HALT for approval.

---

## 9. Feature G — Cohort / TPO analytics (management-facing win)

### Intent
The buyer-facing demo: readiness lift over time + a cohort table. Reuse the existing analytics snapshot pattern (`api/cron/refresh-analytics-snapshots`, `src/lib/analytics/*`) — snapshot-based, not live-recompute, so it's cheap and privacy-respecting.

### The build
- Extend the existing TPO dashboard (`/faculty/placement-dashboard`, `api/placement/tpo/dashboard`) with **readiness-lift-over-time**: cohort average readiness per dimension across snapshots, so management sees the tool *moving the needle*, not just a static snapshot.
- Respect the existing aggregate privacy floor (`MIN_COHORT_FOR_AGGREGATE`, currently 5) — no per-student data exposed below cohort threshold; verify the constant and reuse it, don't reinvent.
- Snapshot source: reuse/extend the nightly cron; do not add live per-request recompute. If a new snapshot field is needed, that's a **schema migration → HALT gate.**

### Checkpoint
- **CP-G1 (HALT if a migration is needed)** — readiness-lift view on the TPO dashboard. Verification: seed multiple snapshots for a test cohort ≥ 5, confirm the lift renders correctly and the < 5 cohort is suppressed (unhappy path / privacy floor). UI verification per §0. If a migration was required, HALT after it, before the UI.

---

## 10. Feature H — Design-system pass (cross-cutting)

Not a standalone checkpoint at the end — **folded into every UI checkpoint above** (each rebuilt surface must land design-system-conformant, verified by §0 tooling). This section is the reference the per-surface conformance lines check against.

- Colors, type, radius, spacing, motion: exactly per `DESIGN.md`. Hex is source of truth; verify HSL conversions visually against the design-tokens preview page (`src/app/(superadmin)/superadmin/dev/design-tokens/page.tsx`), don't trust hand math.
- The **mono-tag** (`src/components/ui/mono-tag.tsx`) is the signature element and the spine's native vocabulary — every readiness score, dimension label, drive countdown, mastery indicator, CO/BTL-style datum renders as a mono-tag. Structural tags neutral; performance fill (mastery-green/amber) only where the tag *is* a performance indicator. Never red for performance; brick-red is destructive/error only.
- Focus rings: ink-900 on light surfaces, paper on night/dark (ochre fails the 3:1 floor — do not use it as a lone ring/outline).
- Voice: active, name the student's action, label↔confirmation word-match ("Regenerate"→"Regenerated"), no gamified filler, errors don't apologize and are never vague.
- Avoid the three named AI-design defaults in DESIGN.md's "Explicit avoidances." If a rebuilt surface starts resembling one, stop and reconsider.

---

## 11. Phase 2 — designed-for, NOT built in this spec

Render entry points as disabled "next stage" placeholders (mono-tag `Locked`), never broken links or half-features. Do **not** begin scoping or building these:
- **Agentic project copilot** (topic → discuss → PRD → milestone plan → per-step setup/code/test help). The most cost-hostile, un-cacheable item on the roadmap. **Gate before any Phase-2 build:** real traffic numbers (live student count, expected sessions/student/week) to price the per-student conversational cost — this number does not exist yet and must not be invented. The reusable *scaffolds* (PRD templates, tech-stack decision trees, project archetypes, milestone checklists) are what get seeded/cached; only a thin reactive layer is ever live per-student.
- **Full guided upskilling paths** (Stage 0) — sequenced, resource-linked, tied to the student's actual platform subjects; borrows Notes/syllabus/CO infrastructure rather than building parallel.
- **GATE adaptive track** — gated on demonstrated demand from a pilot cohort, not built speculatively; borrows the existing syllabus/CO/BTL infra.
- **GRE/GMAT/IELTS** — guide-level only, and only if a mostly-Indian-engineering audience shows demand.
- **Stage 4 (post-outcome)** and **accreditation-grade analytics export.**

---

## 12. Suggested checkpoint order (respecting HALT gates)

1. **CP-A1** — spine pure function + tests
2. **CP-A2 (HALT)** — spine UI (landing rebuild)
3. **CP-B1** — navigation/long-scroll fix
4. **CP-C1 (HALT)** — practical technical track (generation+grading)
5. **CP-D1** — JD-driven resume
6. **CP-E1** — skill-gap map
7. **CP-F1 (HALT)** — mock-interview stage (per-session AI ceiling)
8. **CP-G1 (HALT if migration)** — cohort analytics

Each checkpoint: build → tsc/eslint/build clean → screenshots + design conformance + functional test → commit → **push** → report SHA + `git show --stat` + clean tree + unhappy-path notes → wait at HALT gates.

Do not batch multiple checkpoints into one commit. Do not report a checkpoint complete on a local commit that has not been pushed.

---

## 13. What "done" means for this spec

A pilot-ready placement module where: a student lands on a surface that tells them what to do next; can find any topic in seconds; practices real technical questions (not just aptitude) with external-practice pointers; tailors a résumé to a real JD that reads human and survives both ATS and an interviewer; sees exactly where they stand against a placeable peer; runs a mock interview that reacts to their actual profile; and a TPO/management surface shows readiness moving over time — all design-system-conformant, all cost-disciplined, with Phase-2 stages visibly present as locked next steps. That is the "can't stop using it / can't say no to it" bar this build is aiming at.