"use client";

/**
 * Consistent framing for every faculty analytics surface (CP-Q4 Part 4).
 *
 * Breadcrumbs are Subject > Analytics > <panel>, always in that order, so a
 * faculty member two clicks deep into a question's item statistics can tell
 * which subject's cohort they are looking at. That matters more here than on
 * most surfaces: the numbers on a question detail page are cohort-specific and
 * look identical whichever subject produced them.
 *
 * No new dependencies. Layout only — every number, colour and bar comes from
 * the existing primitives (score.ts, Sparkline, shadcn Card).
 */

import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface Crumb {
  label: string;
  href?: string;
}

export default function FacultyAnalyticsShell({
  crumbs,
  title,
  subtitle,
  actions,
  children,
}: {
  crumbs: Crumb[];
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
      >
        {crumbs.map((c, i) => (
          <span key={`${c.label}-${i}`} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3 shrink-0" />}
            {c.href ? (
              <Link href={c.href} className="hover:text-foreground hover:underline">
                {c.label}
              </Link>
            ) : (
              <span className="text-foreground">{c.label}</span>
            )}
          </span>
        ))}
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="truncate text-xl font-semibold md:text-2xl">{title}</h1>
          {subtitle && (
            <div className="text-sm text-muted-foreground">{subtitle}</div>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {children}
    </div>
  );
}

/**
 * "Updated 47 minutes ago" — never a raw timestamp.
 *
 * Faculty read this to answer one question: "am I looking at today's data?"
 * An ISO string or a locale timestamp makes them do the subtraction
 * themselves, and they will do it wrong at midnight and around a deploy.
 */
export function humanizeAge(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "Updated recently";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "Updated just now";
  if (mins === 1) return "Updated 1 minute ago";
  if (mins < 60) return `Updated ${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return "Updated 1 hour ago";
  if (hours < 24) return `Updated ${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Updated yesterday" : `Updated ${days} days ago`;
}
