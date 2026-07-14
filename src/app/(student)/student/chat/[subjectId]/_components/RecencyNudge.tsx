"use client";

import { Globe, X } from "lucide-react";

interface Props {
  onSwitchToResearch: () => void;
  onDismiss: () => void;
}

export function RecencyNudge({ onSwitchToResearch, onDismiss }: Props) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">
      <span className="flex min-w-0 items-center gap-1.5 truncate">
        <Globe className="h-3.5 w-3.5 shrink-0" />
        This looks like a current-developments question — try Research mode
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onSwitchToResearch}
          className="h-7 rounded-md px-2 text-xs font-medium text-indigo-900 hover:bg-indigo-100 dark:text-indigo-200 dark:hover:bg-indigo-900/40"
        >
          Switch →
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="flex h-7 w-7 items-center justify-center rounded-md text-indigo-900 hover:bg-indigo-100 dark:text-indigo-200 dark:hover:bg-indigo-900/40"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
