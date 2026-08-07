/**
 * The signature mono tag (DESIGN.md "Signature element"). Plex Mono, tight
 * padding, small radius — the one recognizable visual language used for every
 * compact exam-artifact metadata chip across the platform (marks, CO/BTL/PO
 * codes, PYQ frequency, mastery indicators, module chips).
 *
 * Generic on purpose: this component knows nothing about Notes, quiz
 * questions, or any other caller. `mastery-fill`/`amber-fill` are for tags
 * that ARE a mastery/performance indicator — structural tags (CO2, BTL3, a
 * module chip) stay on `default`/`active` and never take a fill, per
 * DESIGN.md's explicit warning against this becoming a generic pill.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type MonoTagVariant = "default" | "active" | "mastery-fill" | "amber-fill";

const VARIANT_STYLES: Record<MonoTagVariant, string> = {
  default: "border-ink-200 bg-paper text-ink",
  active: "border-ochre bg-paper text-ink-900",
  "mastery-fill": "border-mastery-green bg-mastery-green text-paper",
  "amber-fill": "border-amber bg-amber text-ink",
};

export function MonoTag({
  children,
  variant = "default",
  className,
}: {
  children: ReactNode;
  variant?: MonoTagVariant;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-4 border px-2 py-0.5 font-plex-mono text-mono-tag font-medium leading-tight",
        VARIANT_STYLES[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

export default MonoTag;
