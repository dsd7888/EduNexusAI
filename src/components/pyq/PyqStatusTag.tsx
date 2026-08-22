"use client";

/**
 * The compact past-paper state indicator, sitting beside a subject picker.
 *
 * Built on `<MonoTag>` (DESIGN.md's signature element), which was written
 * generically for exactly this — "compact exam-artifact metadata chip" — and
 * has so far only been used inside Notes. PYQ coverage IS an exam-artifact
 * metadata chip, and it is the same signal the Notes reading view already
 * renders with the amber-fill variant, so reusing it here keeps one visual
 * language for one concept across the student and faculty sides.
 *
 * Deliberately NOT a sentence and not a call to action. Its job is passive
 * recognition across many visits: by the time the faculty reaches a control
 * that PYQ absence has disabled, "NO PAST PAPERS" is already a familiar object
 * rather than a new thing to read. The persuading happens at the disabled
 * control, once, where it costs them something concrete.
 *
 * Renders nothing while coverage is null (still loading) — a chip that flickers
 * "NO PAST PAPERS" on every subject switch before correcting itself would train
 * faculty to ignore it.
 */

import { MonoTag } from "@/components/ui/mono-tag";
import type { PyqCoverage } from "@/lib/pyq/coverage";
import { cn } from "@/lib/utils";

export function PyqStatusTag({
  coverage,
  onClick,
  className,
}: {
  coverage: PyqCoverage | null;
  /** Optional — when given, the tag becomes the shortcut to the upload dialog. */
  onClick?: () => void;
  className?: string;
}) {
  if (!coverage) return null;

  const isEmpty = coverage.state === "none";

  const label = isEmpty
    ? "NO PAST PAPERS"
    : `${coverage.papers} PAPER${coverage.papers === 1 ? "" : "S"}`;

  const title = isEmpty
    ? "No past papers uploaded for this subject — click to add some"
    : `${coverage.papers} paper(s), ${coverage.questions} questions read` +
      (coverage.state === "thin"
        ? " — one more year would make mirroring reliable"
        : "");

  const tag = (
    <MonoTag
      // amber-fill is DESIGN.md's variant for a signal that IS a performance /
      // readiness indicator, which is precisely what an empty state is here.
      variant={isEmpty ? "amber-fill" : "default"}
      className={cn("shrink-0", className)}
    >
      {label}
    </MonoTag>
  );

  if (!onClick) return <span title={title}>{tag}</span>;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      // Focus ring is the neutral ink ring, never ochre: DESIGN.md records that
      // ochre sits at ~2.8:1 on paper and fails the 3:1 WCAG 1.4.11 floor when
      // it is the lone indicator of state.
      className="rounded-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
    >
      {tag}
    </button>
  );
}
