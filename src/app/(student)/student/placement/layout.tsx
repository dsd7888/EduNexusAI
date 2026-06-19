"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS: Array<{ label: string; href: string }> = [
  { label: "Overview", href: "/student/placement" },
  { label: "Prep", href: "/student/placement/prep" },
  { label: "Resume", href: "/student/placement/resume" },
  { label: "Projects", href: "/student/placement/projects" },
  { label: "Interview", href: "/student/placement/interview" },
  { label: "Find", href: "/student/placement/find" },
];

export default function PlacementLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";

  function isActive(href: string): boolean {
    // Overview matches only the exact root; the rest match their subtree too.
    if (href === "/student/placement") return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <div>
      {/* Tab bar — full width below the student nav, sticks while scrolling */}
      <div className="sticky top-0 z-10 -mx-4 mb-6 border-b border-gray-200 bg-white sm:-mx-6 lg:-mx-8">
        <nav className="flex gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">
          {TABS.map((tab) => {
            const active = isActive(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors",
                  active
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {children}
    </div>
  );
}
