"use client";

import { createBrowserClient } from "@/lib/db/supabase-browser";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardSkeleton } from "@/components/layout/PageSkeleton";
import { ArrowUpDown, BookOpen, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildProcessedSubjectGroups } from "@/lib/student/subjectGroups";
import { cn } from "@/lib/utils";
import { useStudentSubjects, type SubjectRow } from "@/hooks/useSupabaseData";
import SubjectSearchPicker from "@/components/SubjectSearchPicker";

function SubjectCard({
  subject,
  isCurrent,
}: {
  subject: SubjectRow;
  isCurrent: boolean;
}) {
  return (
    <Card
      className={cn(
        "rounded-lg border p-4 transition-shadow hover:shadow-md sm:p-6",
        isCurrent && "border-primary/40"
      )}
    >
      <CardHeader className="p-0 pb-3 sm:pb-4">
        <Badge variant="secondary" className="w-fit font-mono text-xs">
          {subject.code}
        </Badge>
        <CardTitle className="mt-2 text-lg font-semibold leading-snug">
          {subject.name}
        </CardTitle>
      </CardHeader>
      <CardFooter className="p-0 pt-2 sm:pt-3">
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          {/* Chat is the primary action — filled and given more width so the
              hierarchy reads at a glance; Notes/Quiz are clearly secondary. */}
          <Button asChild size="sm" className="min-w-[80px] flex-[1.5]">
            <Link href={`/student/chat/${subject.id}`}>
              <MessageSquare className="mr-1 size-4" />
              Chat
            </Link>
          </Button>
          {/* Link + asChild, matching Chat and Quiz beside it — a real anchor
              a student can middle-click or open in a new tab, which an
              onClick handler is not. */}
          <Button asChild variant="outline" size="sm" className="min-w-[80px] flex-1">
            <Link href={`/student/notes/${subject.id}`}>
              <BookOpen className="mr-1 size-4" />
              Notes
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="min-w-[80px] flex-1">
            <Link href={`/student/quiz?subjectId=${subject.id}`}>Quiz</Link>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

export default function StudentSubjectsPage() {
  const [name, setName] = useState<string>("Student");
  const [branch, setBranch] = useState<string | null>(null);
  const [semester, setSemester] = useState<number | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const { subjects, isLoading: loadingSubjects } = useStudentSubjects(
    branch,
    semester
  );

  const [groupBy, setGroupBy] = useState<"semester" | "code" | "none">(
    "semester"
  );
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Search narrows the grid to one subject rather than navigating — this page's
  // value is the three actions on the card (Chat / Notes / Quiz), so search
  // should get the student to that card, not past it.
  const [focusedSubjectId, setFocusedSubjectId] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    setLoadingProfile(true);
    try {
      const supabase = createBrowserClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) {
        setBranch(null);
        setSemester(null);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, branch, semester")
        .eq("id", user.id)
        .single();
      setName(profile?.full_name?.trim() ? profile.full_name : "Student");
      setBranch(profile?.branch ?? null);
      setSemester(profile?.semester ?? null);
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const canLoadSubjects = branch != null;
  const showEmptyState =
    !loadingProfile &&
    !loadingSubjects &&
    (!canLoadSubjects || subjects.length === 0);

  const profile = useMemo(
    () => ({ semester: semester ?? 0 }),
    [semester]
  );

  const visibleSubjects = useMemo(
    () =>
      focusedSubjectId
        ? subjects.filter((s) => s.id === focusedSubjectId)
        : subjects,
    [subjects, focusedSubjectId]
  );

  const processedGroups = useMemo(
    () =>
      buildProcessedSubjectGroups(
        visibleSubjects,
        groupBy,
        sortOrder,
        profile.semester
      ),
    [visibleSubjects, groupBy, sortOrder, profile.semester]
  );

  const focusedSubject =
    focusedSubjectId != null
      ? subjects.find((s) => s.id === focusedSubjectId) ?? null
      : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{`Hi ${name} 👋`}</h1>
        <p className="text-muted-foreground text-sm">
          Branch: {branch ?? "—"} | Semester {semester ?? "—"}
        </p>
      </div>

      {loadingProfile || loadingSubjects ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : showEmptyState ? (
        <Card>
          <CardHeader>
            <CardTitle>No subjects found</CardTitle>
            <CardDescription>
              No subjects found for your branch. Please contact your admin.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* filterByBranch={false}: this page has always shown every semester
              of the student's branch (see useStudentSubjects — semester is a
              readiness gate there, not a filter). Narrowing search to the
              current semester would make it find fewer subjects than the grid
              below already displays. */}
          <SubjectSearchPicker
            filterByBranch={false}
            placeholder="Search your subjects…"
            onSelect={(s) => setFocusedSubjectId(s.id)}
          />

          {focusedSubject ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Showing</span>
              <Badge variant="secondary" className="font-mono text-xs">
                {focusedSubject.code}
              </Badge>
              <button
                type="button"
                onClick={() => setFocusedSubjectId(null)}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Show all subjects
              </button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Group by:</span>
            <div className="flex overflow-hidden rounded-md border text-xs font-medium">
              {(["semester", "code", "none"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setGroupBy(opt)}
                  className={cn(
                    "px-3 py-1.5 transition-colors",
                    groupBy === opt
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {opt === "semester"
                    ? "Semester"
                    : opt === "code"
                      ? "Subject Code"
                      : "All"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                setSortOrder((o) => (o === "asc" ? "desc" : "asc"))
              }
              className="flex items-center gap-1 rounded border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowUpDown className="size-3" />
              {sortOrder === "asc" ? "A → Z" : "Z → A"}
            </button>
          </div>

          {processedGroups.map((group) => (
            <div key={group.label ?? "all"} className="space-y-4">
              {group.label ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <h3
                      className={cn(
                        "text-sm font-semibold uppercase tracking-wide",
                        group.isCurrent
                          ? "text-primary"
                          : "text-muted-foreground"
                      )}
                    >
                      {group.label}
                    </h3>
                    {group.isCurrent ? (
                      <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        Current
                      </span>
                    ) : null}
                  </div>
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">
                    {group.items.length} subject
                    {group.items.length !== 1 ? "s" : ""}
                  </span>
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {group.items.map((s) => (
                  <SubjectCard
                    key={s.id}
                    subject={s}
                    isCurrent={(s.semester ?? 0) === (profile?.semester ?? 0)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
