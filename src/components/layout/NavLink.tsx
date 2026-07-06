"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface NavLinkProps {
  href: string;
  children: ReactNode;
  icon?: ReactNode;
  /** Icon-only rail mode: hides the label, centers the icon, and surfaces the
   *  label via `title` instead. Only meaningful when `icon` + a string label
   *  are passed (used by the collapsible faculty sidebar). */
  collapsed?: boolean;
  onNavigate?: () => void;
}

export function NavLink({
  href,
  children,
  icon,
  collapsed,
  onNavigate,
}: NavLinkProps) {
  const pathname = usePathname();

  const isActive =
    pathname === href || (href !== "/" && pathname?.startsWith(href + "/"));

  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={collapsed && typeof children === "string" ? children : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
        collapsed && "justify-center px-2",
        isActive
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      )}
      aria-current={isActive ? "page" : undefined}
    >
      {icon}
      {!collapsed && children}
    </Link>
  );
}

