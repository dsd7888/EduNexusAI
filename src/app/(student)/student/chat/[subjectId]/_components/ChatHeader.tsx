"use client";

import { Badge } from "@/components/ui/badge";
import { Download, Loader2, MoreVertical, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { QuotaMeter } from "./QuotaMeter";
import type { SubjectRow } from "./types";

function formatSessionAge(createdAt: Date): string {
  const now = new Date();
  const sameDay = createdAt.toDateString() === now.toDateString();
  if (sameDay) return "Resumed from earlier today";

  const diffDays = Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000);
  if (diffDays < 7) {
    return `Resumed from ${createdAt.toLocaleDateString("en-IN", { weekday: "long" })}`;
  }
  return `Resumed from ${createdAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
}

interface Props {
  subject: SubjectRow;
  isResumed: boolean;
  sessionCreatedAt: Date | null;
  quotaUsed: number;
  quotaLimit: number;
  quotaLabel: string;
  hasMessages: boolean;
  isExporting: boolean;
  onExport: () => void;
  onStartFresh: () => void;
}

export function ChatHeader({
  subject,
  isResumed,
  sessionCreatedAt,
  quotaUsed,
  quotaLimit,
  quotaLabel,
  hasMessages,
  isExporting,
  onExport,
  onStartFresh,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-background/80 px-2 py-3 backdrop-blur">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <div className="truncate text-sm font-semibold sm:text-base">
            <span className="block sm:hidden">
              {subject.name.length > 20 ? `${subject.name.slice(0, 20)}…` : subject.name}
            </span>
            <span className="hidden sm:inline">
              {subject.name} <span className="text-muted-foreground">({subject.code})</span>
            </span>
          </div>
          <Badge className="hidden shrink-0 bg-emerald-600 text-white hover:bg-emerald-600 sm:inline-flex">
            Syllabus-locked ✓
          </Badge>
        </div>
        <div className="truncate text-[11px] text-muted-foreground sm:text-xs">
          Semester {subject.semester} • {subject.branch}
          {isResumed && sessionCreatedAt && <span> • {formatSessionAge(sessionCreatedAt)}</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <QuotaMeter used={quotaUsed} limit={quotaLimit} label={quotaLabel} className="hidden sm:flex" />

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="More actions"
            aria-expanded={menuOpen}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
              <button
                type="button"
                disabled={!hasMessages || isExporting}
                onClick={() => {
                  setMenuOpen(false);
                  onExport();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-popover-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isExporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {isExporting ? "Exporting…" : "Export PDF"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onStartFresh();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-popover-foreground hover:bg-accent"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                New session
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
