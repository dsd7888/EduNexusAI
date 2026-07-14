import { cn } from "@/lib/utils";

interface Props {
  used: number;
  limit: number;
  label: string;
  className?: string;
}

/** Thin usage bar. Amber at >=80%, never red — quota running low is a nudge, not an error. */
export function QuotaMeter({ used, limit, label, className }: Props) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const warm = pct >= 80;

  return (
    <div className={cn("flex w-28 flex-col gap-1", className)}>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span className={cn("tabular-nums", warm && "font-medium text-amber-600 dark:text-amber-400")}>
          {used}/{limit}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            warm ? "bg-amber-500" : "bg-primary"
          )}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
    </div>
  );
}
