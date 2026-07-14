"use client";

import { cn } from "@/lib/utils";
import { Globe, Sparkles, Zap } from "lucide-react";
import type { RequestedMode } from "./types";

const OPTIONS: { value: RequestedMode; label: string; icon: typeof Sparkles }[] = [
  { value: "auto", label: "Auto", icon: Sparkles },
  { value: "reasoning", label: "Deep", icon: Zap },
  { value: "research", label: "Research", icon: Globe },
];

interface Props {
  value: RequestedMode;
  onChange: (mode: RequestedMode) => void;
  disabled?: boolean;
}

export function ModeControl({ value, onChange, disabled }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Response mode"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-muted/50 p-0.5"
    >
      {OPTIONS.map(({ value: optValue, label, icon: Icon }) => {
        const active = value === optValue;
        const isResearch = optValue === "research";
        return (
          <button
            key={optValue}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(optValue)}
            className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              active
                ? isResearch
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
