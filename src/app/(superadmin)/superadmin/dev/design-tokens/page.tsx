/**
 * Isolated preview of the DESIGN.md token system (CP-D0). Renders using
 * ONLY the new `ink`/`paper`/`ochre`/`mastery-green`/`amber`/`brick-red`/
 * `night` + `font-plex-*` + `text-display-*`/`text-body*`/`text-label`/
 * `text-mono-tag` + `rounded-4/8/12` tokens wired in globals.css — no
 * shadcn primitives, no `bg-background`/`text-foreground`/`bg-primary`.
 * Gated to /superadmin/* by src/proxy.ts; not linked from any nav.
 */

import type { ReactNode } from "react";

const COLOR_SWATCHES: { name: string; hex: string; className: string }[] = [
  { name: "ink", hex: "#14293D", className: "bg-ink" },
  { name: "paper", hex: "#F5F6F4", className: "bg-paper border border-ink-200" },
  { name: "ochre", hex: "#C08A2E", className: "bg-ochre" },
  { name: "mastery-green", hex: "#2F7B5C", className: "bg-mastery-green" },
  { name: "amber", hex: "#D97706", className: "bg-amber" },
  { name: "brick-red", hex: "#B3413E", className: "bg-brick-red" },
  { name: "night", hex: "#0F172A", className: "bg-night" },
];

const INK_SCALE = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

const BUTTON_VARIANTS: {
  name: string;
  base: string;
  focusDemo: string;
  disabled: string;
}[] = [
  {
    name: "Primary (ink)",
    base: "bg-ink text-paper hover:bg-ink-800",
    focusDemo: "bg-ink text-paper outline outline-2 outline-offset-2 outline-ochre",
    disabled: "bg-ink-200 text-ink-400",
  },
  {
    name: "Accent (ochre)",
    base: "bg-ochre text-ink-900 hover:bg-ink-900 hover:text-paper",
    focusDemo: "bg-ochre text-ink-900 outline outline-2 outline-offset-2 outline-ochre",
    disabled: "bg-ink-100 text-ink-300",
  },
  {
    name: "Destructive (brick-red)",
    base: "bg-brick-red text-paper hover:bg-ink-900",
    focusDemo: "bg-brick-red text-paper outline outline-2 outline-offset-2 outline-ochre",
    disabled: "bg-ink-100 text-ink-300",
  },
];

function MonoTag({
  children,
  variant = "default",
}: {
  children: ReactNode;
  variant?: "default" | "active" | "mastery" | "amber";
}) {
  const styles: Record<string, string> = {
    default: "border-ink-200 bg-paper text-ink",
    active: "border-ochre bg-paper text-ink-900",
    mastery: "border-mastery-green bg-mastery-green text-paper",
    amber: "border-amber bg-amber text-ink",
  };
  return (
    <span
      className={`inline-flex items-center rounded-4 border px-2 py-0.5 font-plex-mono text-mono-tag ${styles[variant]}`}
    >
      {children}
    </span>
  );
}

export default function DesignTokensPreviewPage() {
  return (
    <div className="min-h-screen bg-paper font-plex-sans text-ink">
      <div className="mx-auto max-w-5xl px-6 py-12 sm:px-10">
        <header className="mb-16">
          <p className="mb-2 font-plex-sans text-label uppercase tracking-[0.04em] text-ink-500">
            CP-D0 — tokens only, not applied elsewhere
          </p>
          <h1 className="font-plex-serif text-display-lg font-bold text-ink">
            EduNexus Design Tokens
          </h1>
          <p className="mt-3 max-w-2xl font-plex-sans text-body-lg text-ink-600">
            Isolated preview of the color, type, and component tokens defined
            in DESIGN.md. Nothing on this page uses shadcn defaults or the
            existing app palette — every swatch, weight, and radius below is
            a token from the table.
          </p>
        </header>

        {/* Color swatches */}
        <section className="mb-16">
          <h2 className="font-plex-serif text-display-sm font-semibold text-ink">
            Color
          </h2>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {COLOR_SWATCHES.map((c) => (
              <div key={c.name} className="overflow-hidden rounded-8 border border-ink-200">
                <div className={`h-20 w-full ${c.className}`} />
                <div className="bg-paper px-3 py-2">
                  <p className="font-plex-sans text-body-sm font-medium text-ink">
                    {c.name}
                  </p>
                  <p className="font-plex-mono text-mono-tag text-ink-500">{c.hex}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-8 font-plex-sans text-label uppercase tracking-[0.04em] text-ink-500">
            ink-50 through ink-900
          </p>
          <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-10">
            {INK_SCALE.map((step) => (
              <div key={step} className="text-center">
                <div
                  className="h-12 w-full rounded-4 border border-ink-200"
                  style={{ backgroundColor: `var(--ink-${step})` }}
                />
                <p className="mt-1 font-plex-mono text-mono-tag text-ink-500">{step}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Type scale */}
        <section className="mb-16">
          <h2 className="font-plex-serif text-display-sm font-semibold text-ink">
            Type
          </h2>
          <div className="mt-6 space-y-6 divide-y divide-ink-100">
            <div className="pt-6 first:pt-0">
              <p className="font-plex-mono text-mono-tag text-ink-500">
                display-lg / 2.5rem / 700 / Plex Serif
              </p>
              <p className="mt-2 font-plex-serif text-display-lg font-bold text-ink">
                Module 4: Transform &amp; Conquer
              </p>
            </div>
            <div className="pt-6">
              <p className="font-plex-mono text-mono-tag text-ink-500">
                display-sm / 1.75rem / 600 / Plex Serif
              </p>
              <p className="mt-2 font-plex-serif text-display-sm font-semibold text-ink">
                Course Outcomes &amp; Mapping
              </p>
            </div>
            <div className="pt-6">
              <p className="font-plex-mono text-mono-tag text-ink-500">
                body-lg / 1.125rem / 400 / Plex Sans
              </p>
              <p className="mt-2 font-plex-sans text-body-lg text-ink">
                Dynamic programming solves a problem by breaking it into
                overlapping subproblems, solving each once, and storing the
                result — trading memory for a large reduction in repeated work.
              </p>
            </div>
            <div className="pt-6">
              <p className="font-plex-mono text-mono-tag text-ink-500">
                body / 1rem / 400 / Plex Sans
              </p>
              <p className="mt-2 font-plex-sans text-body text-ink">
                12 modules across 3 units, weighted 100% to the End Semester
                Exam per the sanctioned syllabus.
              </p>
            </div>
            <div className="pt-6">
              <p className="font-plex-mono text-mono-tag text-ink-500">
                body-sm / 0.875rem / 400 / Plex Sans
              </p>
              <p className="mt-2 font-plex-sans text-body-sm text-ink-600">
                Last generated 2 hours ago from the faculty-submitted syllabus.
              </p>
            </div>
            <div className="pt-6">
              <p className="font-plex-mono text-mono-tag text-ink-500">
                label / 0.75rem / 600 / Plex Sans / uppercase
              </p>
              <p className="mt-2 font-plex-sans text-label font-semibold uppercase tracking-[0.04em] text-ink">
                Module Weightage
              </p>
            </div>
            <div className="pt-6">
              <p className="font-plex-mono text-mono-tag text-ink-500">
                mono-tag / 0.75rem / 500 / Plex Mono
              </p>
              <p className="mt-2">
                <MonoTag>Q1(a) [5 Marks] [CO2] [BTL3]</MonoTag>
              </p>
            </div>
          </div>
        </section>

        {/* Signature mono-tag */}
        <section className="mb-16">
          <h2 className="font-plex-serif text-display-sm font-semibold text-ink">
            Signature element — the mono tag
          </h2>
          <p className="mt-2 max-w-2xl font-plex-sans text-body-sm text-ink-600">
            Default (structural), active/selected, and mastery/amber fill
            (performance indicators only) — shown inline as they appear on a
            real question.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2 rounded-8 border border-ink-200 bg-paper p-4">
            <MonoTag variant="default">Q1(a)</MonoTag>
            <MonoTag variant="default">[5 Marks]</MonoTag>
            <MonoTag variant="active">[CO2]</MonoTag>
            <MonoTag variant="default">[BTL3]</MonoTag>
            <MonoTag variant="mastery">Mastered</MonoTag>
            <MonoTag variant="amber">In progress</MonoTag>
          </div>
        </section>

        {/* Buttons */}
        <section className="mb-16">
          <h2 className="font-plex-serif text-display-sm font-semibold text-ink">
            Buttons
          </h2>
          <div className="mt-6 space-y-8">
            {BUTTON_VARIANTS.map((v) => (
              <div key={v.name}>
                <p className="font-plex-sans text-label uppercase tracking-[0.04em] text-ink-500">
                  {v.name}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    className={`rounded-8 px-4 py-2 font-plex-sans text-body font-medium transition-colors duration-180 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ochre ${v.base}`}
                  >
                    Default
                  </button>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden="true"
                    className={`pointer-events-none rounded-8 px-4 py-2 font-plex-sans text-body font-medium ${v.base}`}
                  >
                    Hover (simulated)
                  </button>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden="true"
                    className={`pointer-events-none rounded-8 px-4 py-2 font-plex-sans text-body font-medium ${v.focusDemo}`}
                  >
                    Focus (simulated)
                  </button>
                  <button
                    type="button"
                    disabled
                    className={`cursor-not-allowed rounded-8 px-4 py-2 font-plex-sans text-body font-medium ${v.disabled}`}
                  >
                    Disabled
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Example card */}
        <section>
          <h2 className="font-plex-serif text-display-sm font-semibold text-ink">
            Example card
          </h2>
          <div className="mt-6 max-w-md rounded-12 border border-ink-200 bg-paper p-6">
            <p className="font-plex-sans text-label uppercase tracking-[0.04em] text-ink-500">
              Module 6
            </p>
            <h3 className="mt-1 font-plex-serif text-display-sm font-semibold text-ink">
              Greedy Algorithms
            </h3>
            <p className="mt-2 font-plex-sans text-body-sm text-ink-600">
              8 hours · weighted 12% of the End Semester Exam.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <MonoTag variant="default">CO4</MonoTag>
              <MonoTag variant="default">BTL3</MonoTag>
              <MonoTag variant="mastery">On track</MonoTag>
            </div>
            <button
              type="button"
              className="mt-5 rounded-8 bg-ochre px-4 py-2 font-plex-sans text-body font-medium text-ink-900 transition-colors duration-180 ease-out hover:bg-ink-900 hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ochre"
            >
              Regenerate notes
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
