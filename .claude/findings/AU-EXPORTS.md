# AU-EXPORTS — Cross-engine export pass: 5 math/render engines + PPT diagrams/SVG

**Audited:** 2026-08-17 · **HEAD:** `dc130bf` (branch `dev`, dirty tree pre-existing from prior
audit sessions — not touched by this one)
**Scope:** the five render engines named in the checkpoint brief — `src/lib/text/katexRender.ts`
(shared MathJax→PNG rasteriser), `src/lib/notes/pdf/notesMath.ts` + `src/lib/pdf/builder.ts`
(Notes PDF), `src/lib/qpaper/paperMath.ts` + `src/lib/qpaper/builder.ts` (Q Paper PDF),
`src/lib/qpaper/docxBuilder.ts` (Q Paper Word), `src/lib/ppt/pptMath.ts` + `src/lib/ppt/generator.ts`
(PPT, incl. `svg`/`mermaid`/`imagen` diagram render types) — plus the routes that actually call
them: `api/notes/subject/[subjectId]/export`, `api/generate/qpaper/export`,
`api/generate/qpaper/export-docx`, `api/generate/ppt/build`. All four are confirmed reachable from
real UI call sites (`DoneView.tsx` for both qpaper exports, `faculty/generate/page.tsx` for PPT
build, `student/notes/[subjectId]/page.tsx` for the notes PDF) — this feature does **not**
reproduce the ledger's "export route with zero UI call site" pattern found in AU-NOTES/AU-QUIZ/
AU-PLACE-CORE.

**Method:** [EXPORT], primarily. All five engines are **deterministic — none of them call
Gemini** (`katexRender.ts` is MathJax + `sharp`; the PDF/DOCX/PPT builders are pure layout code).
This meant the intended method — "one canonical stress document pushed through every engine" —
could be done by calling the exact library functions the routes call, directly, with `tsx`, no
`npm run dev` / auth / DB required, and it exercises the *real* production code paths (verified by
diffing each harness script's calls against its route's actual imports — e.g.
`api/generate/qpaper/export-docx/route.ts` calls `loadPaperImages` + `renderPaperMath` +
`generateQpaperDocx({answerKey, images, math})`, byte-identical to `_audit_exports/gen_qpaper.ts`).
The one live network dependency exercised was `mermaid.ink` (PPT's Mermaid render path) — real,
not mocked, and it succeeded. **Zero Gemini calls were made this run** (AI spend: **$0.00**) — the
Imagen diagram-render path (`renderHint: "imagen"`) was read but not exercised live, since it is a
pure `generateImagenImage` passthrough with no engine-specific logic to drift (flagged as
UNVERIFIED below, not silently skipped). No DB rows or Storage objects were created or need
cleanup — every artifact was generated to local files under `_audit_exports/out/` (git-ignored,
not committed) with no admin-client/Storage/DB calls anywhere in the harness.

**Canonical stress content** (`_audit_exports/stress_content.ts`), pushed through every engine
identically: a fraction ODE, a `\forall`/`\exists` quantifier, a 2×2 matrix-vector product, a
`\ce{...}` chemistry reaction, a definite integral, a 10-row markdown table, a >6-primitive valid
SVG diagram, a valid Mermaid flowchart, and one Unicode string combining Devanagari
(`मापदंड`), an emoji (`🔬`), math/logic symbols outside both PDF sanitizers' curated allowlists
(`∴ ⊂ ⇒ ζ ξ`), an em-dash, and an accented Latin character (`café`).

---

## Checklist results (adapted to a deterministic, non-AI feature)

**A. Happy path** — [EXPORT] All four export calls (Notes PDF, Q Paper PDF, Q Paper DOCX incl.
answer-key variant, PPT incl. SVG+Mermaid diagram slides) completed successfully with the stress
content and produced valid, openable artifacts. Math rendering itself (the one thing all five
engines genuinely share, via `katexRender.ts`) is excellent everywhere it was checked: fractions,
integrals, `\forall`/`\exists`, 2×2 matrices, and `\ce{...}` chemistry all rendered as crisp,
correctly-typeset raster images in Notes PDF, Q Paper PDF, Q Paper DOCX, and PPT alike (visually
confirmed via `pdftoppm` screenshots and DOCX/PPTX media inspection — see `notes_stress_page-1.png`,
`qpaper_page-1.png`). **The architectural goal of one shared rasteriser feeding every engine is
working as designed for math itself** — the drift found below is entirely in each builder's
surrounding *text* handling, not in `katexRender.ts`.

**B. Adversarial input** — N/A in the chat/prompt-injection sense (these are deterministic
renderers with no AI call and no free-text-to-a-model surface); the adversarial axis that applies
here is malformed/hostile *markup*, covered under C.

**C. Malformed / boundary input** — [EXPORT] Pushed an unclosed-brace LaTeX span (`$\frac{a}{b$`),
an undefined-command span (`$\notarealcommand{x}$`), an empty span (`$$`), and a 3000-token/~9KB
single math span through both PDF engines (`_audit_exports/gen_malformed.ts`). **Zero crashes.**
Both engines degrade the same documented way: `renderLatexToImage` returns `ok:false`, the map
entry is `null`, and both `drawFormulaExpression`/`mathLine` (notes) and the qpaper equivalent fall
back to the literal source text rather than dropping it or throwing. This is a genuine positive —
the malformed-LaTeX resilience design (§ the file-header comments in `paperMath.ts`/`notesMath.ts`
promise) holds under real adversarial markup, not just in the happy path.

**D. State / concurrency** — N/A: these are synchronous, single-call, side-effect-free rendering
functions (no shared mutable state across calls other than the intentional `katexRender.ts`
MathJax-document singleton, which is read-only after construction). Not applicable to this
feature's checklist the way it is to a stateful API route.

**E. Authorization** — Out of scope for the render engines themselves (they take an already-
assembled document, not an ID); the routes that call them (`requireRole(["faculty", ...])` for
qpaper/ppt, `requireAuth` + `assertNotesSubjectAccess` for notes) were read, not independently
re-exercised over HTTP this run — this checkpoint's brief is the rendering layer, and the auth
gates were already covered by AU-NOTES/AU-QUIZ/AU-PLACE-* for their respective routes.

**F. Errors & logs** — [EXPORT] Confirmed via C above: render failures degrade to a literal-text
fallback with a single batched `console.warn` (notes) — never a per-item throw, never a silent
empty gap. No secrets or stack traces would reach a client response on a render failure (the
failure is swallowed at the `renderLatexToImage` layer, well before any HTTP response is built).

**G. Cost / logging** — [EXPORT] Confirmed: none of the five engines call `routeAI` or Gemini.
**AI spend this run: $0.00, 0 real Gemini calls** — trivially under the ≤25-call cap, because this
feature (unlike the AI-generation checkpoints) makes none by design. The Mermaid diagram path
makes one real (non-AI, non-billed) network call to `mermaid.ink` per Mermaid slide.

**H. UI/UX (DESIGN.md)** — Not applicable in the usual sense (these are downloaded documents, not
app screens); DESIGN.md's ink/ochre/Plex system does not extend to generated PDF/DOCX/PPT
artifacts, which correctly use their own print-appropriate typography (Helvetica/Times/Arial/
Calibri) — this was not treated as a design-system violation.

---

## Feature-specific cases (§5) — the cross-engine diff

This is the core of the checkpoint: the same stress content, run through all engines, diffed.

| Aspect | Notes PDF | Q Paper PDF | Q Paper DOCX | PPT |
|---|---|---|---|---|
| LaTeX/chemistry math | ✅ crisp, correct | ✅ crisp, correct | ✅ crisp, correct | ✅ crisp, correct |
| Malformed LaTeX | ✅ literal fallback, no crash | ✅ literal fallback, no crash | (not separately tested; shares `paperMath.ts`) | (not separately tested this run) |
| Markdown table | ❌ raw pipe-syntax, unrendered | ✅ real bordered table | ✅ real bordered table | N/A (no markdown-table slide type) |
| Unicode (Devanagari/emoji/logic symbols) | ❌ **silently deleted, no trace** | ⚠️ replaced with literal `?` | ✅ full fidelity | ✅ full fidelity |
| Raster image | ✅ (not tested this file; notes has no image concept) | ✅ correct, sized, embedded | ✅ correct, sized, embedded | N/A (imagen path unverified, see below) |
| SVG diagram | N/A | N/A | N/A | ❌ **PNG fallback is broken, see S1 below** |
| Mermaid diagram | N/A | N/A | N/A | ✅ real PNG via mermaid.ink |

---

## Findings

**[S1] [EXPORT] PPT "svg" diagram slides — the DEFAULT diagram render type — embed a broken PNG
fallback: pptxgenjs writes the raw SVG source into the file it labels as the compatibility PNG,
so any viewer without Microsoft's 2016+ SVG-extension support renders a blank/broken image.**

- **What:** `svgToBase64()` (`src/lib/ppt/generator.ts:906`) hands pptxgenjs a
  `data:image/svg+xml;base64,...` URI for a diagram slide's `addImage`. pptxgenjs's own SVG
  handling (`node_modules/pptxgenjs/dist/pptxgen.cjs.js:2000-2021`) is supposed to write **two**
  media parts per SVG image — a real PNG fallback (for viewers without the SVG extension, per the
  OOXML spec's `<a:blip r:embed="rIdPNG">` primary reference) and the SVG itself (referenced only
  via the `asvg:svgBlip` extension that modern Office reads on top). Its own source shows the "PNG"
  part is created with `data: strImageData` — **the same SVG string**, not a rasterisation of it —
  so the file it labels `image/png` and gives a `.png` extension is actually raw SVG bytes.
  Confirmed on a real generated deck: `image-4-1.png` (the primary/fallback blip target) is
  detected by `file`/PIL as `SVG Scalable Vector Graphics image`, not PNG, and Pillow raises
  `UnidentifiedImageError` trying to open it as an image. The crisp, correct SVG *is* present
  (`image-4-2.svg`, referenced via the `asvg:svgBlip` extension) — so a fully current PowerPoint or
  Office 365 build renders the diagram fine — but any consumer that reads only the primary blip
  (older PowerPoint versions, Keynote, Google Slides import, LibreOffice Impress, third-party PPTX
  viewers/converters, and PowerPoint mobile apps on older OS builds) gets an unopenable image in
  place of the diagram, with **no on-slide indication anything failed**.
- **Why this is S1, not S2:** per `src/lib/ppt/generator.ts:471-475`, a `"diagram"` slide with no
  explicit `renderHint` defaults to `"svg"` — this is not a rare render path, it is the fallback
  every under-specified diagram slide takes. This is an institutional platform (CLAUDE_CONTEXT:
  single-department Indian engineering pilot) where classroom/lab machines and projectors
  frequently run older Office or LibreOffice, not necessarily the newest Office 365 build — exactly
  the population this bug silently fails for, with the failure being invisible until someone opens
  the deck on the "wrong" machine mid-lecture.
- **Evidence:** [EXPORT] `_audit_exports/gen_ppt.ts` generated a real `.pptx` with an SVG diagram
  slide; `unzip` + `file`/Pillow inspection of `ppt/media/image-4-1.png` inside it. Reproducible
  with any valid SVG, not specific to the stress content.
- **Where:** `src/lib/ppt/generator.ts` (`svgToBase64`, and the `addImage({data: svgToBase64(...)})`
  call at line ~2043) — the gap is that the codebase already has a working SVG→real-PNG rasteriser
  two files over (`svgCodeToPngBytes` in `src/lib/pdf/builder.ts`, `sharp`-based) but the PPT path
  doesn't use it.
- **Recommendation:** Before calling `addImage`, rasterise the SVG to a real PNG via the existing
  `svgCodeToPngBytes` helper (or an equivalent `sharp` call local to `ppt/generator.ts`) and embed
  *that* — either as the sole image (simplest; loses vector crispness but is universally
  compatible, and a diagram is small enough at 300 DPI that the crispness loss is unlikely to be
  visible), or investigate whether pptxgenjs exposes a lower-level API to supply a genuine PNG
  fallback alongside the real SVG blip (this run did not find one in the version installed —
  `pptxgenjs@4.0.1` always derives the "PNG" part from the same `data` it was given). Given
  `isAcceptableDiagramSVG`'s own quality gate already treats a sparse SVG as worth a Pro retry, the
  fix should sit next to that gate rather than at the raw `addImage` call, so it applies uniformly
  to every SVG-render diagram and the `dual_visual` right-panel path (which reuses `svgToBase64`
  the same way at line ~2275).

**[S1] [EXPORT] Notes PDF export silently deletes any Unicode character outside a small curated
allowlist — no placeholder, no log, no visual trace — while the Q Paper PDF (same student-facing
concern, sibling export) at least substitutes a visible `?` for the identical input.**

- **What:** `sanitizeForPDF()` (`src/lib/pdf/builder.ts:162-229`), which backs every text-drawing
  call in the shared `PDFBuilder` class (`text()`, `mathLine()`'s literal fallback, `drawTableMath`,
  `addPageHeader`) — and therefore every export that uses this builder, currently Notes PDF (per
  CLAUDE.md, "one shared `PDFBuilder` class... backs every export route") — replaces a curated list
  of ~40 known symbols (₹, →, Greek letters, arithmetic operators, smart quotes, …) and then runs
  `.replace(/[^\x00-\x7F]/g, "")` on whatever is left: **every remaining non-ASCII character is
  deleted outright**, with no substitute glyph, no logging, and no on-page indication that anything
  was removed.
- **Evidence:** [EXPORT] Generated a real Notes PDF (`_audit_exports/out/notes_stress.pdf`)
  containing the stress Unicode string `Sample text मापदंड 🔬 with symbols: ∴ A ⊂ B, P ⇒ Q,
  damping ζ and ξ, em—dash, café`. Extracted text (`pdftotext -layout`) and a rendered screenshot
  (`notes_stress_page-1.png`) both show it collapsed to `Sample text  with symbols:  A  B, P  Q,
  damping  and , em--dash, caf` — the Devanagari word (मापदंड), the emoji (🔬), all four flagged
  logic/math symbols (∴ ⊂ ⇒), both Greek letters (ζ ξ), and even the accented `é` in `café` are
  gone, leaving only double-spaces and an occasional silently-mangled word (`café`→`caf`) as the
  trace. A student reading generated notes containing a Hindi gloss, a non-curated symbol, or an
  accented name would see it vanish with the sentence around it silently reflowing — nothing
  flags the loss to the student, to faculty, or in any log.
- **Contrast with the sibling engine, same run:** the Q Paper PDF builder's own, *different*
  sanitizer (`sanitize()` in `src/lib/qpaper/builder.ts:166-210`) handles the identical input by
  substituting a literal `?` per unsupported character (confirmed: the same stress string became
  `Sample text ?????? ?? with symbols: ? A ? B, P ? Q, damping ? and ?, em?dash, café` in
  `qpaper_stress.pdf` — `qpaper_page-1.png`). This is also degraded and ugly on a real exam paper,
  but it is *visible* — a human proofreading the paper would notice six consecutive `?` marks and
  investigate, where Notes' silent deletion gives no such signal. Note `café`'s `é` (Latin-1,
  `0xE9`) survives correctly in the Q Paper PDF because `qpaper/builder.ts` uses `TimesRoman`
  (WinAnsi/Latin-1-capable) and only strips `> 0xFF`, whereas Notes' `PDFBuilder` uses standard
  Helvetica and strips everything `> 0x7F` — two different fonts, two different thresholds, two
  different failure modes for the same class of input.
- **Where:** `src/lib/pdf/builder.ts:162-229` (`sanitizeForPDF`), called from `text()` (:672),
  `mathLine()`'s fallback path (:410), `drawTableMath` (:986), and `addPageHeader` (:1222-1224).
- **Recommendation:** At minimum, substitute a visible placeholder (`?` or `□`, matching the
  qpaper convention) instead of silent deletion, so data loss is at least detectable on the page.
  Better: log a warning (mirroring `notesMath.ts`'s own convention for failed math spans) so a
  content-quality pass can catch subjects/notes that are losing real content to this filter — this
  is exactly the kind of silent, unmeasured corruption CLAUDE.md's `repairGeminiJsonEscapes`
  changelog (in `latexSegments.ts`) describes fixing for LaTeX; this is the same failure shape
  (silent character-level loss) one layer further downstream, undetected because nothing scans PDF
  *output* the way `scan-escape-corruption.ts` scans stored *input*.

**[S2] [EXPORT] Notes PDF's worked-example text does not parse markdown — a markdown table
embedded in a formula block's worked-example problem renders as raw, unreadable pipe-syntax,
while the identical table renders correctly as a real bordered table everywhere else in the same
document (including two other block kinds in the very same PDF).**

- **What:** `drawWorkedExample()` (`src/lib/notes/pdf/formulaRenderer.ts:84-98`) calls
  `builder.textOrMath(example.problem, ...)` — a plain math-aware text draw with no markdown
  parsing — while the sibling `drawSymbolsTable` (same file) and the comparison-block renderer both
  correctly call `builder.drawTable(...)`. A worked-example problem containing a markdown table (a
  realistic shape: "given the following measurements...") ships as literal
  `| Trial | Load (N) | ... |` text instead of a table.
- **Evidence:** [EXPORT] `notes_stress.pdf` / `notes_stress_page-1.png` — the `Example` section
  under "Damped Harmonic Oscillator" shows the 10-row stress table as one unbroken line of
  pipe-delimited text, while the Symbol/Meaning/Unit table three lines above it and the Damping
  Regimes comparison table below it both render as proper bordered tables in the same document.
- **Cross-reference:** this is the same defect class the ledger already carries from AU-CHAT
  ("chat PDF export renders markdown tables as raw garbled pipe-syntax instead of a real table") —
  but reproduced here in a **second, independent export engine** (Notes PDF, not chat's PDF
  export), on a surface (worked-example text) the AU-CHAT session never exercised. Since Q Paper
  PDF/DOCX both correctly render the identical markdown table in their own free-text fields (via
  `parseMarkdownLite`/`blocksFromSegments`), this is specifically a **gap in the Notes-PDF-specific
  `textOrMath` call**, not evidence the shared markdown parser itself is broken — the fix is
  narrower than the AU-CHAT finding implied (route worked-example problem/solution text through
  the same `richBody`/table-aware path qpaper already uses, not a platform-wide parser rewrite).
- **Where:** `src/lib/notes/pdf/formulaRenderer.ts:91-97` (`drawWorkedExample`).
- **Recommendation:** Route `example.problem`/`example.solution` through a markdown-table-aware
  draw path (the equivalent of qpaper's `richBody`) instead of `textOrMath`, consistent with how
  `drawSymbolsTable`/comparison tables are already handled in the same file.

**[S2] [EXPORT] Q Paper PDF: a question's marks/CO/BTL/PO tag row can print with empty values on
one page while the question's actual sub-part content (and the tag *values* that belong to that
empty row) print on the next page — an orphaned, disconnected header.**

- **What:** In the generated stress paper, Q-2 (an MCQ question) started near the bottom of page 1:
  its header line printed (`Q-2 [05]` plus empty `CO / BTL / PO` column labels with **no values**
  under them), then the page broke. Page 2 opens directly with the sub-part text `(a) Which damping
  ratio...` followed by its tag values (`CO2  2`) floating at the top-right with no repeated
  column-header context connecting them back to Q-2's header on the previous page.
- **Evidence:** [EXPORT]/[UI] `qpaper_page-1.png` (bottom: "Q - 2 [05]" with blank CO/BTL/PO
  columns) and `qpaper_page-2.png` (top: "(a) Which damping ratio..." with "CO2  2" floating
  disconnected at the top-right, no header row). A grader or student re-reading a printed physical
  copy would see a question number with no visible marks/CO/BTL context, and disconnected tag
  values on the following page with no clear referent.
- **Where:** `src/lib/qpaper/builder.ts` — the MCQ question header (draws marks/CO/BTL/PO column
  labels immediately) and the sub-part renderer are laid out without a page-break lookahead/keep-
  together rule between a question header and its first sub-part.
- **Recommendation:** Add a keep-with-next check (measure the sub-part's height before committing
  the header to the current page, matching whatever `wrapWords`/page-break logic already exists
  elsewhere in this builder for questions) so a question header and its immediately following
  content never split across a page boundary this way.

---

## Not independently re-verified (UNVERIFIED, stated explicitly per audit protocol)

- **Imagen diagram/illustration render path** (`diagramRenderType: "imagen"`/`"illustration"`,
  and `dual_visual`'s left panel) — read (`src/lib/ai/imagen.ts`, the `generateImagenImage` call
  site in `generator.ts:1990-2025`) but not exercised live: it is a real, billed Gemini image call,
  and this checkpoint's cost/hygiene guardrail favours not spending the ≤25-call budget on a path
  with no engine-specific rendering logic to drift (the returned PNG is embedded via the same
  `addImage` call as any other raster). Flagged, not silently skipped.
- **PPT text/DOCX malformed-LaTeX resilience** — the malformed-LaTeX boundary test (§C) was run
  against the two PDF engines only; PPT's `renderPptTextImage`/`pptMath.ts` and the Word builder's
  `mathImageRun` share the same underlying `renderLatexToImage` fallback contract (`ok:false` →
  `null` → literal-source fallback, verified by reading the code), but this was not independently
  re-run as a live artifact for PPT/DOCX this session, for time budget reasons.
- **Visual PPTX rendering** — no LibreOffice/PowerPoint headless renderer was available in this
  environment (`soffice`/`libreoffice` not found) to produce a true visual screenshot of the
  `.pptx`; the PPT findings above rest on `unzip` + XML/media inspection, which the audit spec
  explicitly names as valid EXPORT evidence for DOCX/PPTX, but is a deliberate substitute for a
  screenshot, not equivalent to one. Stated explicitly, not silently downgraded.
- **`answerKeyGen.ts`/`buildAnswerKeyPDF`** — the *separate*, AI-generated PDF answer-key pipeline
  (`api/generate/qpaper/answer-key`, distinct from the deterministic `generatePPSUPaperPDF` this
  run exercised) was read but not run: it fans out into up to 3 Pro-model AI calls per section,
  and this run's canonical-stress-content approach specifically avoided AI spend. It imports
  `renderPaperMath` and helpers from `builder.ts`, so the S1 Unicode-drift and S2 page-break
  findings above plausibly apply there too, but this is inference, not confirmed reproduction.

---

## Positive findings (ran clean, verified with real artifacts, not just read)

- **Math rendering itself is excellent and consistent** across all four artifact types — the
  single shared `katexRender.ts` design (MathJax→sharp) achieves genuine cross-engine consistency
  for the one thing it's responsible for; every drift found above is in each builder's surrounding
  text/markup handling, not in the math rasteriser.
- **Malformed LaTeX never crashes either PDF engine** — unclosed braces, undefined commands, empty
  spans, and a ~9KB single math blob all degraded gracefully to literal-text fallback with no
  exception, confirmed live (§C).
- **Mermaid diagram rendering works end-to-end**, including the real live `mermaid.ink` network
  call — produced a correct, valid PNG embedded in the deck (`image-5-1.png`, 432×594, confirmed
  openable).
- **Raster image embedding is correct and consistent** between Q Paper PDF and DOCX — same
  synthetic 300×200 PNG rendered at matching proportions in both, confirmed via
  `imageDisplaySize`'s shared sizing rule and direct pixel-dimension inspection of the embedded
  DOCX media part.
- **All four export routes are reachable from real UI** — unlike the ledgered "generated but
  nothing calls it" pattern from AU-NOTES (S1), AU-QUIZ (S1), and AU-PLACE-CORE (S1's legacy
  subsystem), every engine tested here backs a route with a confirmed real call site.
- **Answer-key DOCX correctly separates confidential content into the document header** (`ANSWER
  KEY – CONFIDENTIAL`, verified in `word/header1.xml`, distinct from `word/document.xml`) with
  model answers rendered in green (`Answer:` runs, `color: GREEN`) — confirmed via real generated
  bytes, not just code reading.

---

## Artifacts

- `_audit_exports/stress_content.ts` — the one canonical stress document (LaTeX, chemistry,
  Unicode, markdown table, SVG, Mermaid) shared by every generator script below.
- `_audit_exports/gen_notes_pdf.ts`, `gen_qpaper.ts`, `gen_ppt.ts`, `gen_malformed.ts` — throwaway
  harnesses calling the real production builder functions directly (no HTTP/DB/AI needed for the
  four core engines).
- `_audit_exports/out/notes_stress.pdf` (+ `.txt`, `_page-1.png`), `qpaper_stress.pdf`/`.docx`
  (+ `_key.pdf`/`.docx`, `_page-1.png`, `_page-2.png`, `.txt`), `ppt_stress.pptx`,
  `notes_malformed.pdf`, `qpaper_malformed.pdf` — the real generated artifacts this report's
  evidence is drawn from.
- `_audit_exports/out/docx_unzip/`, `docxkey_unzip/`, `pptx_unzip/` — unzipped DOCX/PPTX package
  contents (XML + media) inspected for this report.

**AI spend this run:** $0.00 (~₹0.00), 0 real Gemini calls — every engine tested is deterministic
by design; well under the ≤25-call soft cap.
