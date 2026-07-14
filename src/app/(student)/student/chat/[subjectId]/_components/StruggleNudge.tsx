"use client";

import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import Link from "next/link";

interface Props {
  topic: string;
  subjectId: string;
  onDismiss: () => void;
}

export function StruggleNudge({ topic, subjectId, onDismiss }: Props) {
  const href = `/student/quiz?subjectId=${encodeURIComponent(
    subjectId
  )}&focusTopic=${encodeURIComponent(topic)}`;

  return (
    <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <span className="min-w-0 truncate">
        You&apos;ve asked about <span className="font-semibold">{topic}</span> a few
        times — want a quick 5-question check?
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
        >
          <Link href={href}>Quick check →</Link>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onDismiss}
          className="h-7 w-7 text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
