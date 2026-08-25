# CP-QC — Q Paper Faculty Control Plan

*Planned Aug 2026. Addresses three faculty-reported defects from the PPSU pilot.*
*Status: PLAN ONLY — nothing implemented yet.*

Faculty feedback, verbatim intent:

1. Question types are a closed menu. Faculty wanted "pseudocode with the main
   logic blanked out" — not short/long/MCQ/fill-blank. No way to express it.
2. Regenerating one question silently changes its topic, the replacement is
   often worse, and there is **no way back** to the question it replaced.
3. Generated with 3 units selected; unit 3 never appeared in the paper, with
   **no explanation**. Regenerating to fix it destroys the 3–4 questions they
   already liked.

---

## 0. Findings from code audit (these reshape the fix)

### 0.1 Bug 3 is a lossy set→range encoding, NOT a weightage artifact

The faculty's module selection is **never sent to the generation API**. The
route loads *every* module for the subject (`route.ts:287–294`) and filters
each section purely by `section.module_range` (`modulesForSection`,
`route.ts:78–94`).

Selection reaches the server only after being squeezed through
`moduleRangeForSection` (`shared.tsx:609–632`), which returns
`[min(selected), max(selected)]`. Two independent failure modes:

**(a) Phantom inclusion.** Select modules 1, 2, 5 → range `[1,5]` → the server
re-expands to modules 1,2,3,4,5. Modules 3 and 4 were explicitly *deselected*
and still get questions. Silent.

**(b) Silent drop — the reported bug.** `moduleRangeForSection` first filters by
`m.section_number == null || m.section_number === sectionNumber`
(`shared.tsx:615–619`). `section_number` is a `modules` table column that the
Q-paper builder never displays and faculty cannot edit. A selected module whose
`section_number` doesn't match any section index in the chosen template is
dropped from **every** section. The `inSection.length === 0` fallback
(`shared.tsx:620`) only rescues a section that is *entirely* empty — a partial
drop is invisible.

That is exactly "3 units selected, unit 3 never appeared, no reason shown".

Secondary contributors, real but smaller:
- `assignModulesToSlots` returns `[]` for a section with zero modules
  (`moduleAssignment.ts:714`) — a section can silently generate nothing.
- `[0,0]` is returned when nothing is selected (`shared.tsx:622`) — matches no
  module, produces an empty paper with no error.
- `pickModule` is marks-shortfall based; with few slots a low-weightage module
  can legitimately round to zero. Real, but only *after* (a)/(b) are fixed.

**Consequence for the fix:** a "coverage floor" heuristic would paper over a
data-integrity bug. Fix the encoding first, then surface reasons, then add the
floor as a last-resort guarantee.

### 0.2 Generated questions have no stable identity

`GeneratedQuestion` (`builder.ts:65–105`) has no id. `regenerate-question`
(`regenerate-question/route.ts`) accepts no question id — it takes a synthetic
`template_question` shape and the client splices the result back **by array
index**. Nothing persists the pre-regeneration text.

This single gap is why undo (fix 2) and carry-forward (fix 3) are both
impossible today. One primitive unblocks both.

### 0.3 Confirmed dead code in the blast radius (~1,400 lines)

| Target | Lines | Evidence |
|---|---|---|
| `src/lib/qpaper/generator.ts` | 1,173 | **Zero importers.** Every exported symbol (`buildQPaperPrompt`, `generateQPaperPDF`, `generateStructuredQPaperPDF`, `parseQPaperResponse`, `structuredSectionsToQPaperConfig`, `generateQPaper`, …) greps to zero references outside the file. Drags in `pdf-lib`. |
| BTL-tier preset machinery in `moduleAssignment.ts` | ~230 | `previewBtlDistribution`, `renormalizeTierWeights`, `achievableTiersForLevels`, `resolveTierWeights`, `BTL_TIER`, `BtlDistributionPreview` all have **zero** external references. `apportionBtlTiers` / `capTierWeightsToCeilings` / `PRESET_TIER_WEIGHTS` are reachable only via the guard `ctx.difficultyPreset && !ctx.btlRange` (`moduleAssignment.ts:941`) — and the UI *always* sends `btlRange` (`page.tsx:508,524,941,968`) and *never* sends `difficultyPreset`. The branch cannot fire in production. |
| `DifficultyPreset` / `CustomBtlWeights` threading | ~40 | Plumbed through `route.ts` → `sectionGen.ts` → `moduleAssignment.ts` where it is now inert. |

Note: `src/lib/assessment/generator.ts` is a *different, live* file. Do not
confuse the two.

`exam_structures` (superseded by `qpaper_templates`) and the orphaned migration
`20260328120000_placement_attempts_detail_columns.sql` are also dead but out of
scope here — log them, don't touch them in this checkpoint.

### 0.4 Mechanisms that already exist and should be reused, not rebuilt

- **Binding free-text instruction.** `instructionLineFor` (`sectionGen.ts:267–276`)
  already injects a template block's `instruction` as
  `"BINDING — the question(s) in this slot MUST comply"`. Fix 1 needs no new
  prompt plumbing.
- **Guaranteed-inclusion slot reservation.** `preferredQuestionIds` +
  `forcedKeysBySection` (`route.ts:517–555`) already implements "these specific
  questions must land in compatible slots, the percentage mix governs only what
  is left". Fix 3's carry-forward is this mechanism pointed at generated
  questions instead of bank rows.
- **Per-question module pinning.** `pinnedModuleId` exists on both
  `TemplateQuestion` and `PoolCompositionEntry`.
- **Mutation tracking.** `setPaperAndClearKey` (`page.tsx:155–159`) already
  wraps every post-generation mutation.
- **Verification harnesses.** 34 existing `_cp_*_verify/` dirs, split
  `pure.ts` (no DB) / `api.mts` / `ui.mts`.

---

## 1. Shared backbone (build first — fixes 2 and 3 both depend on it)

### 1.1 Stable question identity

Add to `GeneratedQuestion`, `SubQuestion`, `QuestionPart`, `PoolItem`:

```ts
/** Stable client-side identity, assigned at assembly. Survives edit,
 *  regeneration and history-resume; NOT a DB id. */
localId: string;
```

Assigned once server-side at paper assembly (`crypto.randomUUID()`), carried
through `structure_summary` so it survives history-resume. Regeneration
**preserves** the `localId` of the slot it replaces — the question changes, its
identity does not.

Backfill: any paper resumed from `qpaper_history` without `localId` gets ids
minted on hydrate, deterministically from `sectionIdx:qIdx:partIdx` so a
re-hydrate of the same row is stable.

**Why not array index:** index shifts under section edits and is unstable
across the debounced history autosave, which would corrupt undo and locks.

### 1.2 Bounded undo stack

```ts
/** Per-question undo ring, newest last. Capped — this is an undo affordance,
 *  not an audit log. */
undoStack?: Array<{ at: string; reason: string; snapshot: ... }>;
```

- **Depth cap 3**, enforced on push (`shift()` past the cap).
- Lives in the same jsonb already autosaved (`qpaper_drafts.builder_state` /
  `qpaper_history.structure_summary`). **No new table.**
- Size guard: cap serialized stack at ~32 KB per paper; drop oldest first.
  A pool block with 20 items × 3 snapshots is the worst case and must not
  bloat the autosave payload.

### 1.3 Carry-forward lock

```ts
/** Faculty pinned this question — a whole-paper regeneration must preserve
 *  it verbatim rather than regenerate its slot. */
locked?: boolean;
```

---

## 2. Fix 1 — Open/custom question format

**Do not add `pseudocode_fill_blank` as an enum member.** The next request will
be diagram-labelling, matching-pairs, code-trace tables. Add one escape hatch.

### 2.1 Model

- New `TemplateQuestionType` member: `"custom"`.
- On the block: `format_spec: string` — **mandatory, non-empty** (this is the
  difference from `instruction`, which is optional and cosmetic-leaning).
- New optional field on `GeneratedQuestion`: `custom_body: string` (markdown,
  fenced code allowed). Do **not** force pseudocode into `SubQuestion` /
  `QuestionPart` — faculty formats vary too much for a rigid schema.

### 2.2 Generation

- Reuse `instructionLineFor`'s binding-directive path; add a `custom` branch to
  the output-schema block in `sectionGen.ts` that emits
  `{ slotKey, label, marks, custom_body, co, btl, po }`.
- Preserve `thinkingBudget: 0` (structured JSON task — non-negotiable per
  CLAUDE.md).
- Token budget: add a `custom` profile to `estimateMaxOutputTokens`
  (`tokenBudget.ts`). A blanked pseudocode listing is materially longer than a
  short answer; reusing the descriptive profile risks silent JSON truncation.
- BTL: `TYPE_BTL_RANGE` has no `custom` key, so `assignModulesToSlots` falls
  back to `[2,3]` (`moduleAssignment.ts:770`). Add an explicit `custom: [2,5]`
  entry — a fill-the-logic question is genuinely Apply/Analyse, not Understand.

### 2.3 Rendering (4 surfaces, all must agree)

`RichQuestionText.tsx` (web) · `builder.ts` (PDF) · `docxBuilder.ts` (Word) ·
answer-key export.

The load-bearing detail: **fenced code must render monospace with whitespace
and blank-line structure preserved.** `parseMarkdownLite` currently targets
prose. Extend it with a fenced-code segment type rather than special-casing
`custom` at each of the four call sites.

Blank rendering: normalise `____`, `___`, `<BLANK>` to a single canonical
blank token at parse time so PDF/Word/web look identical.

### 2.4 Answer key

`answerKeyGen.ts` splits by block type. A `custom` block has no `parts`/
`sub_parts`, so it must route to the descriptive (Pro) path with `custom_body`
as the question text — otherwise it is silently skipped and the key ships
incomplete. **This is the highest-risk regression in fix 1.**

### 2.5 Q Bank

Migration: add `'custom'` to the `faculty_question_bank.question_type` CHECK
constraint. Without it, a good custom question cannot be saved and inherits
exactly the "generated something great, lost it" pain of fix 2.

### 2.6 Edge cases

| Case | Handling |
|---|---|
| `format_spec` empty | Block validation fails **before** the AI call; inline error on the builder row. Never spend a Pro call on an unspecified format. |
| AI ignores the format | Faculty sees `custom_body` verbatim in review; regenerate-with-custom-instruction (fix 2) is the recovery path. |
| Math + code fence collide | Code fences are extracted *before* `extractLatexSegments` runs, so `$` inside code is never treated as math. |
| Marks accounting | `custom` carries `total_marks` like `descriptive`; no sub-part split. Section totals unaffected. |
| Bank sourcing | `custom` slots are AI-only in v1 — `bankType` has no match, so exclude from bank allocation rather than mis-matching. |
| Legacy templates | No `custom` blocks exist; purely additive. |

---

## 3. Fix 2 — Regenerate modes, steering, and undo

### 3.1 Modes

Replace the single silent ↻ with a small menu, on all four existing regenerate
sites (`regenerateQuestion` / `regenerateSubPart` / `regeneratePart` /
`regeneratePoolItem`, `ReviewAndValidateStage.tsx:356–660`) — all four already
funnel into one route, so this is one route change plus one shared UI control.

1. **Same topic, reroll** — today's behaviour (keeps the `<avoid>` block).
2. **Different topic, same module** — new directive: pick a different concept
   *within the assigned module*. Note the current `<avoid>` text already says
   "on a related topic" (`regenerate-question/route.ts:119`), which actively
   fights this mode — it must become mode-dependent.
3. **Custom instruction** — free-text, appended as a binding block. Also serves
   as the ad-hoc path for fix 1 ("make this a pseudocode fill-in-the-logic").
4. **N alternatives** — `alternatives_count` (cap **5**); returns an array,
   faculty picks one in a chooser. Only mode 4 changes the response shape.

Dropped: a separate "random topic" mode. It is the same lever as mode 2 with
noisier wording; two near-identical options is worse UX than one clear one.

### 3.2 Route changes (`regenerate-question/route.ts`)

- New body fields: `mode`, `custom_instruction` (cap 1,000 chars),
  `alternatives_count`.
- **Add `responseSchema`.** The route currently hand-rolls fence-stripping and
  brace-slicing (`:145–160`) — fragile, and it becomes worse with an array
  response. A schema guarantees parseable JSON on the first call (per
  CLAUDE_CONTEXT §3) and lets the brace-slice hack be deleted.
- Keep `repairGeminiJsonEscapes` at the parse site (§13 requirement).
- `maxTokens`: currently a flat 2048. For `alternatives_count = 5` that will
  truncate. Scale via `estimateMaxOutputTokens`.
- Sanitize `custom_instruction`: strip anything resembling a system-prompt
  override before interpolation, and always fence it in a labelled block so it
  reads as data, not instruction.

### 3.3 Undo

- Push the pre-regeneration snapshot **before** the network call resolves,
  keyed by `localId`.
- Surface as an inline "Undo" next to the just-changed question — not a
  separate history panel.
- Undo restores content *and* CO/BTL tags *and* any `validation` verdict, so an
  undone question does not resurface with a stale mismatch flag.

### 3.4 Edge cases (this is where the real bugs live)

Per CLAUDE.md's verification protocol, every one of these is a required test,
not a nicety:

| Case | Handling |
|---|---|
| **Double-click regenerate** | Per-`localId` in-flight guard; button disabled while pending. Two concurrent regens of one slot must not both splice. |
| **Regenerate A, then B, A resolves last** | Result applied by `localId` lookup, never by captured index. Stale result whose `localId` no longer exists is **discarded silently**. |
| **Section edited mid-flight** | Same `localId` guard covers it — index shifts are irrelevant. |
| **Subject switched mid-flight** | Generation-token guard (mirrors the Jul 2026 stale-audit race): bump a ref on subject change, drop any result whose token is stale. |
| **Undo after paper re-export** | Undo sets `paperEditedSinceGeneration = true` via `setPaperAndClearKey`, re-arming the stale-PDF banner. Undo is an edit. |
| **Undo stack + history autosave** | Debounced autosave already writes `structure_summary`; the capped stack rides inside it. Verify payload size on a 60-question paper. |
| **Alternatives dialog dismissed** | No mutation, no undo push, no cost claim. |
| **Regen fails / 429** | Original preserved, undo stack untouched, toast surfaced. Never leave a blank question. |
| **Pool item regen** | Must preserve `pool_expected_count`; padding logic must not treat a regenerated item as a shortfall. |

---

## 4. Fix 3 — Real module coverage, with visible reasoning

Three layers: **fix the encoding**, **explain every omission**, **let faculty
keep what they liked**.

### 4.1 Layer 1 — stop encoding a set as a range (the actual bug fix)

- Add `module_numbers: number[]` to the section payload (`TemplateSection`),
  authoritative when present.
- Keep `module_range` populated for backward compatibility with stored
  templates and the answer-key route's own `modulesForSection`
  (`answer-key/route.ts:41–60`), which must be updated in the same change or
  the key will drift from the paper.
- `modulesForSection` (both copies) prefers `module_numbers`, falls back to
  `module_range`. **Deduplicate these two implementations into
  `src/lib/qpaper/` rather than leaving two copies that can diverge.**
- Send `selectedModuleIds` in the generation request as a defence-in-depth
  cross-check; the server intersects and reports any discrepancy.
- Remove the hidden `section_number` gate from selection→range derivation.
  A module the faculty explicitly selected must never be dropped by an
  invisible DB column. If `section_number` is to influence *placement*, it must
  be surfaced as an editable control — otherwise it is silent data loss.

### 4.2 Layer 2 — the coverage ledger (the "tell me WHY" requirement)

A structured, machine-generated explanation for every selected module that
received fewer questions than expected. Built server-side during allocation
(where the reason is actually known) and returned on the response —
**not** reverse-engineered in the UI.

```ts
type CoverageReason =
  | { kind: "ok"; slots: number }
  | { kind: "not_in_any_section"; moduleNumber: number;
      sectionRanges: Array<[number, number]> }
  | { kind: "rounded_out"; weightagePct: number; sectionMarks: number;
      slotsAvailable: number }   // weightage × slots < 1 question
  | { kind: "btl_incompatible"; moduleBtl: number[];
      requestedRange: [number, number] }
  | { kind: "co_filtered"; moduleCos: string[]; targetedCos: string[] }
  | { kind: "displaced_by_pins"; pinnedSlots: number }
  | { kind: "displaced_by_bank"; bankSlots: number }
  | { kind: "ai_shortfall"; expected: number; returned: number };
```

Rendered in `ReviewAndValidateStage` as a coverage panel, each row phrased as
cause **and** remedy — the faculty needs to know what to change:

> **Unit 3 — Trees & Graphs: 0 questions.**
> Its BTL levels (1–2) don't overlap the paper's BTL range (3–5), so no slot
> could accept it. → *Widen the BTL range to 2–5, or update the unit's BTL
> levels in Syllabus.*

> **Unit 5 — Hashing: 0 questions.**
> Not covered by any section — sections draw from units 1–4.
> → *Extend a section's unit range, or add a section.*

Plus a **pre-flight** version of the same ledger in `ScopeAndDifficultyStage`,
computed client-side from the existing dry-run allocation (no AI call, same
code path as the CO-achievability preview already there). Catching "unit 3 will
get 0 questions" *before* spending a Pro call is worth more than explaining it
after.

### 4.3 Layer 3 — coverage floor

In `pickModule`: when a module is explicitly selected and
`totalSlots >= selectedModules.length`, guarantee it ≥1 slot, overriding
weightage rounding for that floor only. Emit `{ kind: "rounded_out" }` into the
ledger when the floor fires, so the faculty still learns their weightage was
the cause.

Must **not** override BTL incompatibility — a module that genuinely cannot
satisfy the BTL range should report the reason, not be force-fitted into a slot
it can't fill honestly.

### 4.4 Layer 4 — carry-forward

- Lock toggle per question (§1.3).
- `handleRegenerate` (`DoneView.tsx:210`) stops being all-or-nothing:
  partition locked vs unlocked, pass locked questions as guaranteed-include,
  regenerate only unlocked slots.
- Reuses the `forcedKeysBySection` reservation machinery (`route.ts:517–555`)
  — locked questions claim their compatible slots first, and the sourcing mix
  governs only the remainder. This is the same code path as preferred bank
  questions, pointed at generated content.
- The confirm dialog becomes accurate: *"Regenerate 14 unlocked questions?
  4 locked questions will be kept."* — replacing today's blanket
  "will discard them".
- Unplaceable locked questions must surface exactly like unplaceable preferred
  bank rows do today (`route.ts:550–555` currently only `console.warn`s — that
  warning needs to reach the UI, for both cases).

### 4.5 Edge cases

| Case | Handling |
|---|---|
| All questions locked | Regenerate is a no-op; say so instead of burning a Pro call. |
| Locked question's module deselected | Lock survives (it is verbatim content, not a slot claim), but the ledger reports the module as out-of-scope-but-retained. |
| Locked + template structure changed | Lock claims a compatible slot by type+marks; if none exists, report as unplaceable — never drop silently. |
| Zero modules selected | Blocked at the builder with a clear message. Today this yields `[0,0]` and an empty paper. |
| Single module, many sections | Every section legitimately draws from it; ledger reports `ok`, not a warning. |
| `section_number` all null | Common case; must behave identically to today. |
| Module deleted between draft save and regenerate | Resolve by id, report `not_in_any_section`, do not crash. |

---

## 5. Sequencing

Order is dependency-driven, and each phase is independently shippable.

| Phase | Content | Why here |
|---|---|---|
| **P0** | Delete `qpaper/generator.ts`; delete dead BTL-preset machinery; dedupe `modulesForSection`. | Shrinks the surface every later phase touches. Pure deletion — behaviour must be provably identical. |
| **P1** | Backbone: `localId`, undo stack, `locked` flag + hydrate/backfill. | Fixes 2 and 3 both block on it. |
| **P2** | **Fix 3 Layer 1 + 2** — encoding fix + coverage ledger. | The actual data-correctness bug and the "tell me why" ask. Highest user value; independent of P1. |
| **P3** | **Fix 2** — regenerate modes + undo. | Depends on P1. |
| **P4** | **Fix 3 Layers 3 + 4** — coverage floor + carry-forward. | Depends on P1 + P2. |
| **P5** | **Fix 1** — custom format, all 4 render surfaces + answer key + bank migration. | Largest render surface; benefits from P3's custom-instruction path already existing. |

Migrations required: **one** (`faculty_question_bank.question_type` += `'custom'`,
P5). Per CLAUDE.md the commit hook refuses schema migrations — create the file,
stop, and note it in `.claude/PROGRESS.md` for manual application.

---

## 6. Verification plan

Per CLAUDE.md: build + lint + happy path is **not** verification. Every phase
ships a `_cp_qc<N>_verify/` harness following the existing 34-harness
convention (`pure.ts` no-DB · `api.mts` route-level · `ui.mts` browser).

Harness rules from CLAUDE.md that apply here: execute `after()` in the
`workAsyncStorage` shim (copy CP-Q2's, not CP-Q1's) so `routeAI` spend actually
lands in `ai_call_logs`; register `SIGINT/SIGTERM/SIGPIPE/SIGHUP` cleanup, not
just `finally`; redirect output to a file rather than piping; and query the
touched tables for residue afterwards and report it.

### P0 — deletion is behaviour-preserving

`pure.ts`: snapshot `assignModulesToSlots` output for ~8 fixture
(modules × template) combinations **before** deletion; assert byte-identical
after. This is the only honest way to prove the preset machinery was truly
unreachable. Plus `npm run build` (the real gate — there is no test framework).

### P1 — identity survives every persistence path

`pure.ts`: `localId` uniqueness across sections/parts/pool items; stable
re-hydrate from a legacy `structure_summary` with no ids; undo cap enforced at
3; payload stays under the size guard for a 60-question paper.

### P2 — the coverage fix (the important one)

`pure.ts`, no AI spend:
- Select modules **1, 2, 5** → assert modules 3 and 4 receive **zero** slots
  (today they receive questions — this test **must fail before the fix**).
- Selected module with `section_number = 2` against a **1-section** template →
  assert it is included, and that pre-fix it was dropped.
- Each `CoverageReason` variant has a fixture that produces exactly it —
  including `btl_incompatible` (module BTL 1–2 vs requested 3–5) and
  `not_in_any_section`.
- `[0,0]` / empty-selection path is blocked, not silently empty.

`api.mts`: one real generation on a live 3-unit subject (Sem 1 CSE, per
CLAUDE_CONTEXT §8 — Sem 2 and 4–7 have no content and will generate nothing);
assert every selected unit appears in the assembled paper **or** carries a
ledger reason. Assert paper and answer key agree on module scope.

### P3 — regenerate concurrency (where the real bugs are)

`ui.mts` — the interrupted/concurrent flows CLAUDE.md mandates:
- Double-click regenerate → exactly one splice, one AI call in `ai_call_logs`.
- Regenerate Q2 then Q5, force Q2 to resolve last → each lands in its own slot.
- Switch subject mid-flight → stale result discarded, no state corruption.
- Undo → content, tags, and validation verdict all restored; stale-PDF banner
  re-armed.
- 5-alternatives → no truncation (the `maxTokens: 2048` regression check).
- Regenerate failure → original intact.

### P4 — carry-forward

`api.mts`: lock 4 questions, regenerate → assert all 4 present **byte-identical**
in the new paper, unlocked slots changed, and locked-question `localId`s
preserved. Then the adversarial case: lock 4, change the template so one no
longer has a compatible slot → assert it is surfaced as unplaceable, not
dropped.

### P5 — custom format across every surface

`api.mts` + `ui.mts`: generate a pseudocode fill-the-logic question; assert
code fences render monospace with preserved whitespace in **web, PDF, Word, and
answer key**; assert the answer key includes it (§2.4 — the silent-skip risk);
assert saving it to Q Bank succeeds post-migration.

### Manual click-through (required, per CLAUDE.md)

Desktop + mobile, light + dark, with measured contrast for any new text, plus
at least one interrupted and one concurrent flow per phase. **If an
unhappy-path case is not exercised, the completion report must say so
explicitly** rather than implying coverage.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Deleting the BTL-preset machinery changes generation subtly | P0 snapshot test proves identical output before merging. |
| `module_numbers` breaks stored templates | Additive; `module_range` retained and still written. Resume-from-history exercised in P2. |
| Answer key drifts from paper after the module-scope change | Both `modulesForSection` copies deduped into one shared function in the same commit. |
| Undo stack bloats the autosave payload | Depth cap 3 + 32 KB guard + explicit 60-question payload measurement. |
| Custom questions silently missing from answer key | Explicit P5 assertion (§2.4). |
| Locked questions crowd out module coverage | Ledger reports `displaced_by_pins` so the cause is visible rather than mysterious. |

---

## 8. Open decisions for Dhruv

1. **`section_number`** — remove its influence entirely, or surface it as an
   editable control in the builder? Plan currently assumes *remove from
   selection logic*; it is invisible data loss as it stands.
2. **Custom questions in Q Bank** — v1 or defer? Costs one migration.
3. **Undo depth** — 3 assumed. Deeper means a larger autosave payload.
4. **Alternatives cap** — 5 assumed (faculty's own number); it drives the
   token budget.
