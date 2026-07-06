"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  BarChart2,
  BookOpen,
  FileText,
  GraduationCap,
  Lightbulb,
  LayoutDashboard,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  PlayCircle,
  Presentation,
  Sparkles,
  User,
} from "lucide-react";

import { NavLink } from "@/components/layout/NavLink";
import { LogoutButton } from "@/components/layout/LogoutButton";
import { UserProfile } from "@/components/layout/UserProfile";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const STANDALONE_TOP: NavItem[] = [
  { href: "/faculty/dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
  { href: "/faculty/syllabus", label: "Syllabus", icon: <BookOpen className="size-4" /> },
];

const CONTENT_GROUP: NavItem[] = [
  { href: "/faculty/generate", label: "Generate PPT", icon: <Presentation className="size-4" /> },
  { href: "/faculty/refine", label: "Refine Content", icon: <Sparkles className="size-4" /> },
  { href: "/faculty/explainer", label: "Explainer", icon: <PlayCircle className="size-4" /> },
  { href: "/faculty/delivery-guide", label: "Delivery Guide", icon: <Lightbulb className="size-4" /> },
];

const ASSESSMENT_GROUP: NavItem[] = [
  { href: "/faculty/qbank", label: "Q Bank", icon: <Library className="size-4" /> },
  { href: "/faculty/qpaper", label: "Q Paper", icon: <FileText className="size-4" /> },
];

const STANDALONE_BOTTOM: NavItem[] = [
  { href: "/faculty/analytics", label: "Analytics", icon: <BarChart2 className="size-4" /> },
  { href: "/faculty/profile", label: "Profile", icon: <User className="size-4" /> },
];

function NavGroupLabel({ collapsed, label }: { collapsed: boolean; label?: string }) {
  if (collapsed || !label) return <div className="my-2 mx-2 border-t" />;
  return (
    <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
      {label}
    </div>
  );
}

export function FacultyShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Reset-on-navigation is done during render (React's documented pattern
  // for "adjust state when a prop changes") rather than in an effect, to
  // avoid an extra post-navigation render.
  // Start expanded on both server and client render to keep hydration in
  // sync; the saved preference (if any) is applied after mount.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem("faculty_nav_collapsed");
    if (saved === "true") setCollapsed(true);
  }, []);
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setCollapsed(true);
  }

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("faculty_nav_collapsed", String(next));
      return next;
    });
  };

  const renderItem = (item: NavItem) => (
    <NavLink key={item.href} href={item.href} icon={item.icon} collapsed={collapsed}>
      {item.label}
    </NavLink>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-20 flex flex-col border-r bg-card transition-[width] duration-200 ease-in-out",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <div
          className={cn(
            "flex items-center border-b py-4",
            collapsed ? "justify-center px-2" : "gap-2 px-4"
          )}
        >
          {!collapsed && (
            <>
              <GraduationCap className="size-6 shrink-0 text-primary" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold">EduNexus AI</span>
                <span className="truncate text-xs text-muted-foreground">
                  Faculty Workspace
                </span>
              </div>
            </>
          )}
          <button
            type="button"
            onClick={toggle}
            title={collapsed ? "Expand menu" : "Collapse menu"}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
          {STANDALONE_TOP.map(renderItem)}

          <NavGroupLabel collapsed={collapsed} label="Content" />
          {CONTENT_GROUP.map(renderItem)}

          <NavGroupLabel collapsed={collapsed} label="Assessments" />
          {ASSESSMENT_GROUP.map(renderItem)}

          <NavGroupLabel collapsed={collapsed} />
          {STANDALONE_BOTTOM.map(renderItem)}
        </nav>

        {!collapsed && (
          <div className="shrink-0 px-4 py-4">
            <div className="mb-3">
              <UserProfile />
            </div>
            <LogoutButton />
          </div>
        )}
      </aside>

      <main
        className={cn(
          "flex-1 overflow-auto p-6 transition-[margin] duration-200 ease-in-out",
          collapsed ? "ml-16" : "ml-64"
        )}
      >
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </div>
  );
}
