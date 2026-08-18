# EduNexus Design System

## Positioning
An institutional exam-prep tool a stressed engineering student trusts,
not a gamified consumer app and not a generic AI-product template.
Calm, precise, warm where it counts, restrained everywhere else.
Grounded in the real vernacular of Indian engineering exam culture —
module numbers, CO/BTL/PO tags, marks allocation, PYQ frequency — not
generic "edtech" decoration.

## Explicit avoidances
Do not drift toward any of these three AI-design defaults:
1. Warm cream (~#F4F1EA) + high-contrast serif + terracotta accent
   (~#D97757). We use a cooler neutral and an ochre accent instead.
2. Near-black background + single bright acid accent.
3. Broadsheet hairline-rule dense-column layout.
If a new component starts resembling any of these, stop and reconsider.

## Color

Source of truth is hex. Convert to HSL for shadcn CSS variables
(--background, --primary, etc. in globals.css / tailwind.config) —
verify each conversion visually against its hex swatch on the preview
page in Part 2, don't trust hand math.

| Token | Hex | Role | Usage rule |
|---|---|---|---|
| ink | #14293D | primary/anchor | Headers, primary buttons, primary text on light bg. The calm anchor — never decorative gradient. |
| paper | #F5F6F4 | background | Default light-mode background. Cooler than cream, deliberately. |
| ochre | #C08A2E | accent | ONE warm accent. CTAs, active states, highlights only. If more than ~10% of a screen is ochre, pull back. |
| mastery-green | #2F7B5C | success/mastery | Existing convention, keep exactly as used in quiz/analytics. |
| amber | (existing project value — do not redefine) | caution/mid-performance | Existing rule stands: amber never red for performance indicators. |
| brick-red | #B3413E | destructive/error ONLY | Never used for scores, performance, or mastery. Reserved so it stays meaningful. |
| night | #0F172A | dark-mode background | Existing value from explainer/flashcard work. Reuse the token, don't reinvent. |
| ink-50 through ink-900 | derive via standard tint/shade scale from ink | neutral text/border scale | Warm-neutral-tinted grays, not cold blue-grays. |

## Type

Family: IBM Plex Serif (display), IBM Plex Sans (UI/body), IBM Plex
Mono (data — marks, CO/BTL/PO codes, module numbers, timestamps).
Same superfamily, deliberately paired — engineering-heritage type for
an engineering product. Load via Google Fonts (already an approved
source per project conventions), self-host if the project's existing
font-loading pattern requires it — match whatever pattern next/font
already uses elsewhere in the repo.

Scale (rem, 1rem=16px base):
- display-lg: 2.5rem / 700 / Plex Serif — page-level headers only
- display-sm: 1.75rem / 600 / Plex Serif — section headers
- body-lg: 1.125rem / 400 / Plex Sans — primary reading content (notes,
  chat messages)
- body: 1rem / 400 / Plex Sans — default UI text
- body-sm: 0.875rem / 400 / Plex Sans — secondary/meta text
- label: 0.75rem / 600 / Plex Sans / uppercase / letter-spacing 0.04em
  — form labels, section eyebrows
- mono-tag: 0.75rem / 500 / Plex Mono — the signature badge type,
  see Signature section below

Never use Plex Serif below 1.25rem — it's a display face, not a body
face at small sizes.

## Signature element — the mono tag

Every real exam artifact this platform generates already carries
compact metadata: `Q1(a) [5 Marks] [CO2] [BTL3]`. This is real content
structure, not decoration. Standardize it as one visual language used
EVERYWHERE this kind of tag appears — quiz questions, notes formula
cards, PYQ frequency badges, mastery indicators, module chips,
CO/BTL/PO labels anywhere in faculty or student UI.

Spec: Plex Mono, mono-tag scale, ink text on paper bg with a 1px ink-200
border by default; ochre border + ink-900 text for an active/selected
tag; mastery-green or amber fill only when the tag IS a
mastery/performance indicator (not for structural tags like CO/BTL
codes, which stay neutral). Small radius (4px), tight padding
(2px 8px). This is the one recognizable thing across every surface —
keep it disciplined, don't let it become a generic pill/chip used for
unrelated purposes.

## Shape, spacing, motion

- Radius scale: 4px (tags, inputs), 8px (cards, buttons), 12px (large
  containers only). Never 16px+/rounded-2xl — that reads as the
  generic AI-template bubble look.
- Spacing: 4px base unit, standard 4/8/12/16/24/32/48/64 scale.
- Motion: purposeful state-change only, no ambient/decorative
  animation. Match the existing quality bar set by CP-Q3's reveal
  transition (grid-rows height animation, scale+fade, no layout
  shift). Standard duration 180ms ease-out for micro-interactions,
  240ms for larger transitions. Respect prefers-reduced-motion
  everywhere, no exceptions.
- Dividers: hairline (1px, ink-100), used deliberately at real content
  boundaries, never as dense repeating structure across a whole page.
- When several grouped elements stack with no surrounding whitespace to
  separate them (e.g. a flashcard face, not a scrollable reading page),
  don't lean on a lightness ramp to keep them visually distinct —
  adjacent dark-surface tones run out of perceptible separation fast
  (found during CP-D0's flashcard restyle: three graded dark fills only
  reached ~1.2–1.7:1 against each other, well below anything reliably
  perceptible). Vary the *kind* of treatment instead — a bordered
  outline next to a borderless table next to an accent-colored callout
  reads as distinct layers even at identical background lightness. Shape
  and border carry the grouping signal that tone can't, once a surface
  is this dark and this dense.

## Accessibility (non-negotiable, part of the identity not an afterthought)

- WCAG AA contrast minimum on all text against its actual background.
- Visible focus ring on every interactive element — never suppressed
  with outline:none without a replacement.
- Ochre fails as a focus-ring / lone-outline color: measured ~2.8:1
  against paper, short of the 3:1 WCAG 1.4.11 floor for a UI-state
  indicator (found during CP-D0's Notes restyle). Use ink-900 for
  focus rings instead — it clears the floor outright (~13.7:1) and
  still reads as the calm anchor color. This does NOT change the mono
  tag's ochre active-state border (Signature section above): there the
  border is a secondary cue and the primary one is the text-color
  change to ink-900, which is already high-contrast on its own. The
  rule above is specifically for a ring/outline standing alone as the
  ONLY indicator of state.
- On night/dark surfaces, use ring-paper; ring-ink-900 is illegible
  there (~1.2:1 — ink-900 and night sit at nearly the same lightness).
  Same principle as the rule above (visible, non-suppressed focus
  indication), surface-appropriate color: pick the ring color that
  actually clears 3:1 against the surface it's drawn on, not a fixed
  token regardless of surface.
- Touch targets ≥44px on every interactive element, not just mobile
  Notes surfaces (extend the existing CP-N4 rule platform-wide).
- Icon-only controls always paired with a visible or aria-label text
  equivalent for primary actions.
- Empty and error states: plain language, state what happened and
  what to do next. No decorative illustration standing in for actual
  guidance. Errors don't apologize and are never vague.

## Voice

Active voice. Name things by what the student/faculty controls, not
system internals — "Save changes" not "Submit." A button's label and
its resulting confirmation use the same word ("Regenerate" → "Regenerated,"
not "Updated"). No filler, no exclamation-point enthusiasm, no forced
gamified language ("You're crushing it!"). Calm and direct, matching
the positioning statement above.
