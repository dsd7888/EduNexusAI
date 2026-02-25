"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart2,
  Brain,
  ChevronRight,
  FileText,
  Presentation,
  Sparkles,
  Zap,
} from "lucide-react";

import { createBrowserClient } from "@/lib/db/supabase-browser";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Profile {
  full_name: string | null;
  department: string | null;
}

interface SubjectRow {
  id: string;
  name: string;
  code: string;
}

interface GeneratedContentRow {
  type: string;
  title: string;
  created_at: string;
  metadata: Record<string, any> | null;
}

interface Stats {
  quizAttempts: number;
  pptGenerated: number;
  qpapersGenerated: number;
}

export default function FacultyDashboard() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [assignedSubjects, setAssignedSubjects] = useState<SubjectRow[]>([]);
  const [recentContent, setRecentContent] = useState<GeneratedContentRow[]>([]);
  const [stats, setStats] = useState<Stats>({
    quizAttempts: 0,
    pptGenerated: 0,
    qpapersGenerated: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      try {
        const supabase = createBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setIsLoading(false);
          return;
        }

        // 1. Profile
        const { data: profileRow } = await supabase
          .from("profiles")
          .select("full_name, department")
          .eq("id", user.id)
          .single();

        const profileData: Profile = {
          full_name: profileRow?.full_name ?? null,
          department: profileRow?.department ?? null,
        };
        setProfile(profileData);

        // 2. Assigned subjects
        const { data: subjectRows } = await supabase
          .from("faculty_assignments")
          .select("subjects(id, name, code)")
          .eq("faculty_id", user.id);

        const subjects: SubjectRow[] =
          (subjectRows ?? [])
            .map((row: any) => row.subjects)
            .filter(Boolean) ?? [];
        setAssignedSubjects(subjects);

        const assignedIds = subjects.map((s) => s.id);

        // 3. Recent generated content
        const { data: contentRows } = await supabase
          .from("generated_content")
          .select("type, title, created_at, metadata")
          .eq("generated_by", user.id)
          .eq("status", "ready")
          .order("created_at", { ascending: false })
          .limit(5);

        setRecentContent((contentRows ?? []) as GeneratedContentRow[]);

        // 4. Stats
        const [{ count: pptCount }, { count: qpaperCount }] =
          await Promise.all([
            supabase
              .from("generated_content")
              .select("id", { count: "exact", head: true })
              .eq("generated_by", user.id)
              .eq("type", "ppt"),
            supabase
              .from("generated_content")
              .select("id", { count: "exact", head: true })
              .eq("generated_by", user.id)
              .eq("type", "qpaper"),
          ]);

        let quizAttempts = 0;
        if (assignedIds.length > 0) {
          const { data: quizAggRows } = await supabase
            .from("quiz_attempts")
            .select("id, quizzes(subject_id)")
            .not("quizzes", "is", null);

          quizAttempts =
            quizAggRows?.filter(
              (row: any) =>
                row.quizzes &&
                assignedIds.includes(row.quizzes.subject_id as string)
            ).length ?? 0;
        }

        setStats({
          quizAttempts,
          pptGenerated: pptCount ?? 0,
          qpapersGenerated: qpaperCount ?? 0,
        });
      } catch (err) {
        console.error("[faculty/dashboard] load error:", err);
      } finally {
        setIsLoading(false);
      }
    };

    run();
  }, []);

  const fullName = profile?.full_name || "Faculty";
  const assignedCount = assignedSubjects.length;

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  const typeMeta = (type: string) => {
    if (type === "ppt") {
      return {
        label: "PPT",
        icon: Presentation,
        badgeVariant: "secondary" as const,
      };
    }
    if (type === "qpaper") {
      return {
        label: "Q Paper",
        icon: FileText,
        badgeVariant: "secondary" as const,
      };
    }
    return {
      label: "Other",
      icon: Sparkles,
      badgeVariant: "outline" as const,
    };
  };

  return (
    <div className="space-y-8">
      {/* HEADER */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome, {fullName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {assignedCount} subjects assigned
          {profile?.department ? ` · ${profile.department} Department` : ""}
        </p>
      </div>

      {/* STATS ROW */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              PPTs Generated
            </CardTitle>
            <Presentation className="size-5 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading ? "—" : stats.pptGenerated}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Q Papers Generated
            </CardTitle>
            <FileText className="size-5 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading ? "—" : stats.qpapersGenerated}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Student Quiz Attempts
            </CardTitle>
            <Brain className="size-5 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {isLoading ? "—" : stats.quizAttempts}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* QUICK ACTIONS */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Quick Actions</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Link href="/faculty/generate">
            <Card className="h-full cursor-pointer border-dashed transition-colors hover:border-primary hover:bg-primary/5">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="text-sm font-semibold">Generate PPT</p>
                  <p className="text-xs text-muted-foreground">
                    Create visual slides for any module.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Presentation className="size-6 text-primary" />
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/faculty/qpaper">
            <Card className="h-full cursor-pointer border-dashed transition-colors hover:border-primary hover:bg-primary/5">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="text-sm font-semibold">Generate Q Paper</p>
                  <p className="text-xs text-muted-foreground">
                    Design a question paper from your syllabus.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <FileText className="size-6 text-emerald-500" />
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/faculty/refine">
            <Card className="h-full cursor-pointer border-dashed transition-colors hover:border-primary hover:bg-primary/5">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="text-sm font-semibold">Refine Content</p>
                  <p className="text-xs text-muted-foreground">
                    Improve existing notes with AI assistance.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Sparkles className="size-6 text-amber-500" />
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/faculty/analytics">
            <Card className="h-full cursor-pointer border-dashed transition-colors hover:border-primary hover:bg-primary/5">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="text-sm font-semibold">View Analytics</p>
                  <p className="text-xs text-muted-foreground">
                    See how students are performing.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <BarChart2 className="size-6 text-sky-500" />
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* ASSIGNED SUBJECTS */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Your Subjects</h2>
        </div>
        {assignedSubjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No subjects assigned yet. Contact your admin.
          </p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {assignedSubjects.map((s) => (
              <Card
                key={s.id}
                className="min-w-[220px] cursor-default px-4 py-3"
              >
                <p className="text-xs font-medium text-muted-foreground">
                  {s.code}
                </p>
                <p className="truncate text-sm font-semibold">{s.name}</p>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* RECENT CONTENT */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recently Generated</h2>
        </div>
        {recentContent.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing generated yet — use Quick Actions above.
          </p>
        ) : (
          <Card>
            <CardContent className="divide-y px-0">
              {recentContent.map((item, idx) => {
                const meta = typeMeta(item.type);
                const Icon = meta.icon;
                return (
                  <div
                    // eslint-disable-next-line react/no-array-index-key
                    key={idx}
                    className="flex items-center justify-between px-6 py-3 text-sm"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                        <Icon className="size-5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {item.title ?? "Untitled"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(item.created_at)}
                        </p>
                      </div>
                    </div>
                    <Badge variant={meta.badgeVariant}>{meta.label}</Badge>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>

      {/* HINT / FOOTER */}
      <Card className="border-sky-200 bg-sky-50/60">
        <CardContent className="flex items-start gap-3 py-4 text-sm">
          <Zap className="mt-0.5 size-4 text-sky-500" />
          <p className="text-sky-900">
            Use these tools together: generate PPTs for lectures, question
            papers for assessments, and analytics to close learning gaps.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

