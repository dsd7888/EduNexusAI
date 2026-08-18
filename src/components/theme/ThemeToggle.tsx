"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";

// next-themes resolves the persisted/system theme only after mount; this
// reads mount-status as an external store rather than useState-in-an-effect,
// which avoids the extra cascading render react-hooks/set-state-in-effect
// flags (same pattern as usePrefersReducedMotion in the flashcards page).
function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={mounted ? (isDark ? "Switch to light mode" : "Switch to dark mode") : "Toggle theme"}
      aria-label={mounted ? (isDark ? "Switch to light mode" : "Switch to dark mode") : "Toggle theme"}
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center justify-center rounded-8 border border-ink-200 bg-paper text-ink-500 transition-colors duration-180 ease-out hover:bg-ink-50 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900",
        className
      )}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
