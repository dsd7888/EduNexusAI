"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpCircle, Lightbulb, Zap } from "lucide-react";

const ICONS = [Lightbulb, HelpCircle, Zap, Lightbulb] as const;

interface GridProps {
  prompts: string[];
  onSelect: (text: string) => void;
}

export function SuggestionGrid({ prompts, onSelect }: GridProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {prompts.slice(0, 4).map((text, idx) => {
        const Icon = ICONS[idx] ?? Lightbulb;
        return (
          <button key={idx} type="button" onClick={() => onSelect(text)} className="text-left">
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <CardTitle className="min-w-0 text-sm font-semibold">{text}</CardTitle>
                <Icon className="size-5 shrink-0 text-muted-foreground" />
              </CardHeader>
            </Card>
          </button>
        );
      })}
    </div>
  );
}

export function SuggestionChip({
  text,
  onSelect,
}: {
  text: string;
  onSelect: (text: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(text)}
      className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
    >
      <Zap className="h-3 w-3" />
      {text}
    </button>
  );
}
