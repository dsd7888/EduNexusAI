"use client";

/**
 * GENERATING — a per-practical checklist that flips as each REQUEST resolves
 * (§7). Deliberately not an optimistic timer: a faculty watching a fake ticker
 * that finishes before the content does learns to distrust the whole screen.
 */

import { Check, Info, Loader2, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export type GenItemStatus = "pending" | "running" | "done" | "failed" | "cached";

export interface GenItem {
  practicalNo: number;
  title: string;
  status: GenItemStatus;
}

export function GeneratingStage({ items }: { items: GenItem[] }) {
  const settled = items.filter(
    (i) => i.status === "done" || i.status === "failed" || i.status === "cached",
  ).length;
  const pct = items.length ? Math.round((settled / items.length) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="space-y-2 text-center">
        <h2 className="text-lg font-semibold">Writing the lab manual</h2>
        <p className="text-muted-foreground text-sm">
          Each practical is a separate AI call — theory, worked example, scaffold,
          model solution, viva and the conduct guide. This takes a moment.
        </p>
      </div>

      <Progress value={pct} />
      <p className="text-muted-foreground text-center text-xs tabular-nums">
        {settled} of {items.length} done
      </p>

      <div className="flex items-center justify-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
        <Info className="size-3.5 shrink-0" />
        Keep this tab open until it finishes — generation can&rsquo;t be resumed
        mid-way.
      </div>

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {items.map((i) => (
              <li
                key={i.practicalNo}
                className="flex items-center gap-3 px-3 py-2 text-sm"
              >
                <span className="w-5 shrink-0">
                  {i.status === "running" && (
                    <Loader2 className="text-muted-foreground size-4 animate-spin" />
                  )}
                  {(i.status === "done" || i.status === "cached") && (
                    <Check className="size-4 text-emerald-600" />
                  )}
                  {i.status === "failed" && (
                    <X className="text-destructive size-4" />
                  )}
                  {i.status === "pending" && (
                    <span className="bg-muted block size-2 rounded-full" />
                  )}
                </span>
                <span className="text-muted-foreground w-8 shrink-0 tabular-nums">
                  #{i.practicalNo}
                </span>
                <span
                  className={`flex-1 truncate ${
                    i.status === "pending" ? "text-muted-foreground" : ""
                  }`}
                >
                  {i.title}
                </span>
                {i.status === "cached" && (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    reused
                  </span>
                )}
                {i.status === "failed" && (
                  <span className="text-destructive shrink-0 text-xs">
                    failed
                  </span>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
