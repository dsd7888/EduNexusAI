/**
 * The exam-frequency badge (CP-N3's signal, rendered).
 *
 * AMBER, NEVER RED, for the rich case. A student reading notes the night before
 * an exam is already anxious; red reads as "you are failing this". The signal
 * being communicated is "this is worth your time", which is encouragement, not
 * alarm. Same rule the quiz landing follows for its signals strip.
 *
 * THERE IS NO THIRD CASE. `PyqSignal` has no `none` member — absence of a signal
 * is absence of the field (see the comment in pyq-frequency.ts), so a block with
 * no PYQ data never reaches this component at all. Callers guard with
 * `block.pyqSignal ? <PyqChip … /> : null` rather than passing something falsy
 * and asking the chip to render nothing.
 */
import type { PyqSignal } from "@/lib/notes/pyq-frequency";
import { cn } from "@/lib/utils";

export default function PyqChip({
  signal,
  className,
}: {
  signal: PyqSignal;
  className?: string;
}) {
  // The rich label carries the actual numbers because "3 of 5 past papers" is a
  // decision a student can act on; "appears often" is not.
  const label =
    signal.kind === "rich"
      ? `Appeared in ${signal.coveredPapers} of ${signal.totalPapers} past papers`
      : "Appeared in past papers";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight",
        signal.kind === "rich"
          ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
          : "border-border bg-muted text-muted-foreground",
        className
      )}
    >
      {label}
    </span>
  );
}
