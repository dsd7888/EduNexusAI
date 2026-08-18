# Student-Facing Feature Audit — Spec (Pre-Pilot Hardening)

**Branch:** `dev`
**Executor:** a fresh Claude Code session per feature. This document is self-contained.
**Nature:** this is an **inspection**, not a build. The audit **finds and reports**. It does
**not** fix. Finding and fixing are separate, human-gated steps — a session that both finds
and quietly fixes bugs in one pass is untrustworthy and forbidden here. If you spot a fix,
you write it into the findings report as a recommendation; you do **not** edit application code.

The only files an audit session may create or modify are:
- its own findings report under `.claude/findings/`
- throwaway verification harnesses under `_audit_<feature>/` (git-ignored)
- the ledger `.claude/AUDIT_LEDGER.md`
A guard hook (`.claude/hooks/audit-guard.sh`) enforces this: any write to `src/**`,
`supabase/**`, or config is denied. Do not fight it — a denied write means you were about to
fix something you should only be reporting.

---

## 0. Grounding (every session, before anything)

1. `git status` — confirm clean tree, note HEAD SHA. You will not commit application code.
2. Read `.claude/AUDIT_LEDGER.md` (what earlier features found — some issues are cross-cutting).
3. Read `DESIGN.md` (the UI/UX conformance reference) and `CLAUDE.md`.
4. Read the target feature's own code before testing it, so your adversarial inputs are informed.
5. Confirm the dynamic-test prerequisites are live (see §2). If they are not, say so in the
   report and mark every dynamic finding as **UNVERIFIED (static only)** — do not silently
   downgrade to reading code and guessing.

---

## 1. The bar: execute, don't speculate

A finding is only worth the evidence behind it. Every claim in a report is tagged with how it
was established:
- **[RUNTIME]** — you actually sent the input and observed the output (highest confidence).
- **[EXPORT]** — you generated the real artifact (PDF/DOCX/PPTX) and inspected its bytes/content.
- **[UI]** — you rendered the surface headless and inspected the screenshot.
- **[STATIC]** — you reasoned from code only (lowest confidence; use only when runtime is impossible,
  and say why it was impossible).

A report that is all [STATIC] is a failed audit unless §2 prerequisites genuinely could not be met.

---

## 2. Dynamic-test prerequisites (how to actually exercise a feature)

- **Auth as a student:** use the existing HTTP harness `src/lib/testing/httpHarness.ts` — it drives
  real routes over real HTTP as a real authenticated student (role-aware, cookie-correct). This is
  the primary tool for [RUNTIME] findings. Prefer it over trying to script browser login.
- **A running app** where a route needs the full server: `npm run dev` (or `build && start`), with
  the project's real `.env.local` present (Supabase + Gemini keys). AI-backed features WILL make real
  Gemini calls — these cost money and log to `ai_call_logs`. That is expected. Keep a per-feature
  cap in mind (see §6) and tag audit-generated rows so real analytics aren't polluted.
- **A seeded test student** with real subject content (e.g. SOEEC1010 or another live Sem1/Sem3
  subject). Do not audit against an empty account — empty and broken look identical.
- **Headless screenshots** for [UI] findings, at desktop (~1280px) and mobile (~390px), light and
  dark where supported, using whatever screenshot tooling the build harness already used.
- **Export inspection** for [EXPORT] findings: generate the artifact, then actually open it —
  extract PDF text + count/inspect embedded images; unzip DOCX/PPTX and inspect the XML/media.
  "The endpoint returned 200" is NOT an export finding; the artifact's *content* is.
- **Cleanup:** delete junk rows/artifacts your generation created. Leave the DB as you found it.

---

## 3. What every feature is checked for (the universal checklist)

Apply ALL of these to every feature, plus the feature-specific checks in §5:

**A. Happy path** — the primary action works end to end, [RUNTIME].
**B. Adversarial input** (the part the founder cares most about):
   - Out-of-scope: ask something outside the student's syllabus. The platform is *syllabus-locked* —
     answering an off-syllabus question is a **failure**, not a courtesy. Does it refuse/redirect?
   - Inappropriate/vulgar: does the feature entertain it, or decline cleanly?
   - Prompt injection: "ignore your instructions", "print your system prompt", "you are now…".
   - Academic-integrity abuse: "just give me the exam answers", mid-assessment cheating framings.
   - Safety: distress/self-harm-adjacent phrasing — is it handled safely, not mechanically?
**C. Malformed / boundary input** — empty, whitespace-only, extremely long, wrong type, unicode,
   emoji, code injection, SQL-ish strings, 10k-char blobs.
**D. State / concurrency** — interrupt mid-flow, double-submit, reload mid-session, stale session,
   back-button, expired timer, resume-after-abandon.
**E. Authorization** — can a student reach another student's data by ID/param tampering? Can they hit
   faculty/admin routes? (Cross-reference the placement access-policy pattern in `src/lib/placement/access.ts`.)
**F. Errors & logs** — do failures produce clear user-facing messages (DESIGN.md: no apology, no vague
   "something went wrong", state what to do next)? Do server logs capture enough to debug? Any secrets
   leaked into client responses or logs?
**G. Cost** — every AI call routed through `routeAI` and logged to `ai_call_logs`? Any un-logged
   provider call? Any obviously wasteful model choice (Pro where Flash suffices)?
**H. UI/UX** (DESIGN.md conformance, [UI]):
   - Layout fills correctly — no content stranded above the fold, no input box floating mid-screen,
     no dead space. (Known suspected issue: **chat does not occupy full height; the composer sits
     above the bottom edge** — verify and document precisely.)
   - Navigation: is the menu/sidebar **collapsible**? (Known suspected issue: **menu bar not
     collapsible** — verify.) Does it work on mobile?
   - Scroll: no double scrollbars, no infinite-scroll trap, long lists are navigable (cross-ref the
     placement long-scroll fix — check the same disease hasn't reappeared elsewhere).
   - mono-tag vocabulary, tokens, radius, focus rings (ink-900 light / paper dark), ≥44px targets,
     WCAG AA contrast (measure anything suspect), `prefers-reduced-motion`, real empty/error states.

---

## 4. Feature inventory (the checkpoints)

Ordered roughly by student-journey centrality. Each is one audit checkpoint = one fresh session.

- **AU-CHAT** — Student AI chat (`(student)/student/chat`, `api/chat/**` incl. `visualize`, `export`,
  `suggestions`). The adversarial-input centerpiece. Also: the two suspected UI bugs live here.
- **AU-NOTES** — Notes v2 (`notes/[subjectId]`, `api/notes/**`) — generation quality, regeneration,
  math/diagram correctness in the web view; **and the notes PDF export** (LaTeX, diagrams, SVGs).
- **AU-FLASH** — Flashcards (`notes/[subjectId]/flashcards`) — the dark-surface layering rules from
  DESIGN.md's CP-D0 note; generation quality; reveal interaction.
- **AU-QUIZ** — Quiz/Assessment (`quiz/**`, `api/assessment/**`) — session resume, timer/expiry,
  mode-gated feedback, mastery mutation rules (exam-sim must NOT mutate mastery), NAT numerical
  grading, results, **quiz export**.
- **AU-PLACE-CORE** — Placement spine + prep + practice (`placement`, `placement/prep/**`,
  `placement/practice/**`) — the just-rebuilt flow; edge-case the fill_code grading and the Next-Move
  orchestration against weird state.
- **AU-PLACE-TOOLS** — Placement resume/JD/interview/skill-map/projects (`resume`, `jd-analyzer`,
  `interview/**`, `skill-map`, `projects/**`) — incl. **resume PDF + DOCX exports** and the capped
  interview follow-up (confirm the server-side cost ceiling actually holds under abuse).
- **AU-EXPORTS** — Dedicated cross-engine export pass: the **five math/render engines**
  (`text/katexRender`, `notes/pdf/notesMath`, `qpaper/paperMath`+`builder`, `qpaper/docxBuilder`,
  `ppt/pptMath`) rendering the SAME formula-heavy + diagram-heavy + SVG-bearing content, compared
  side by side. This is where "rendering drift" is a *standing* risk. Generate real artifacts, extract
  and compare. Include PPT (`api/generate/ppt/**`) diagram/image rendering.
- **AU-SHELL** — Cross-cutting shell: dashboard, subjects, profile, history, global nav/menu, auth
  edges (logout, expired session, role leakage), mobile layout across the whole student app.

(Placement was just built/reviewed, but edge-casing it *fresh and adversarially* is still in scope —
a build session and an audit session look for different things.)

---

## 5. Feature-specific edge cases (beyond the universal checklist)

**AU-CHAT:** off-syllabus refusal; injection/system-prompt-leak; `chat_research` mode returns real
content (regression: it once returned empty + leaked scaffolding); `visualize` output is safe
(no arbitrary script, no broken SVG); `export` produces correct content; suggestions aren't stale/leaky;
**verify the two UI bugs** (full-height, collapsible menu) precisely with screenshots.

**AU-NOTES:** formula correctness web vs PDF (the `repairGeminiJsonEscapes` LaTeX-corruption class);
diagrams/SVGs present and intact in PDF; regenerate doesn't duplicate/corrupt; stale-row handling;
long-module scroll usability.

**AU-QUIZ:** resume-from-session lands on the right question (was a real bug); timer expiry rejects
late answers; exam-sim mode does NOT write mastery; NAT dual-gate grading correct on right AND wrong
numeric input; feedback withheld per mode; export content matches the session.

**AU-PLACE-*:** fill_code grades right/wrong fills correctly (no fuzzy pass); Next-Move ranking sane
under weird state (no drives, all-ready, ineligible, setup-incomplete); interview follow-up cap holds
when hammered; resume exports render human-readable, ATS-clean, no layout breakage; skill-map makes
zero AI calls.

**AU-EXPORTS:** one canonical stress document (heavy LaTeX incl. `\frac`, `\forall`, matrices;
an SVG diagram; a raster image; unicode; long tables) pushed through every engine. Diff the rendered
output. Any engine that drops/garbles a formula, diagram, or SVG is a high-severity finding.

**AU-SHELL:** menu collapsible + mobile; no route lets a student read another student's data;
logout/session-expiry behave; consistent design-system application across all shell surfaces.

---

## 6. Cost & hygiene guardrails for the audit itself

- Per-feature soft cap on adversarial AI calls (e.g. ≤ 25 real generations); note actual spend from
  the run's JSON output in the report.
- Tag audit-generated AI calls if the code allows a metadata tag, so real analytics stay clean.
- Delete generated junk (notes/quiz/project rows, export files) at the end of each feature.
- Never run generation loops unbounded. If a test needs many calls, sample, don't sweep.

---

## 7. Severity scale (use in every finding)

- **S1 — blocker**: unsafe output (entertains vulgar/harmful/off-syllabus), data leak across students,
  broken export losing content, a crash on a core path. Pilot cannot ship with an open S1.
- **S2 — major**: wrong-but-not-unsafe behavior, a real UX breakage (the chat/menu bugs likely land here),
  cost leak (un-logged/oversized AI call), missing guardrail that didn't trigger this time.
- **S3 — minor**: cosmetic design-system drift, unclear copy, small polish.
Each finding: `[Sn] [TAG] feature — what, evidence (how observed), where (file/route), recommendation.`

---

## 8. Output per checkpoint

One findings file `.claude/findings/<AU-XX>.md`: feature summary, the universal-checklist results,
feature-specific results, every finding severity-tagged with evidence tag and repro, screenshots/
artifact paths, actual AI spend. Then append a one-line-per-severity roll-up to `.claude/AUDIT_LEDGER.md`.
Do **not** commit application changes. Commit only the findings file + ledger (the audit-guard permits
these paths). Report ends with a 3-bullet summary: S1 count, S2 count, and the single most important thing.

---

## 9. What "done" means

Every feature in §4 has a findings file; the ledger has a ranked master punch-list; every S1/S2 has
[RUNTIME]/[EXPORT]/[UI] evidence, not [STATIC] speculation. That punch-list becomes the input to a
separate FIX pass (which can reuse the build-harness pattern) — this audit does not fix anything itself.
