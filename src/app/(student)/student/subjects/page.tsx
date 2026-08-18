"use client";

import { createBrowserClient } from "@/lib/db/supabase-browser";
import { MonoTag } from "@/components/ui/mono-tag";
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
    <div
      className={cn(
        "flex flex-col justify-between gap-3 rounded-8 border border-ink-200 bg-paper p-4 transition-colors duration-180 ease-out hover:border-ink-400 sm:p-6",
        isCurrent && "border-ochre"
      )}
    >
      <div className="space-y-2">
        <MonoTag className="w-fit">{subject.code}</MonoTag>
        <p className="font-plex-sans text-body font-semibold leading-snug text-ink">
          {subject.name}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {/* Chat is the primary action — filled and given more width so the
            hierarchy reads at a glance; Notes/Quiz are clearly secondary. */}
        <Link
          href={`/student/chat/${subject.id}`}
          className="flex min-h-11 min-w-[80px] flex-[1.5] items-center justify-center gap-1 rounded-8 bg-ink px-3 font-plex-sans text-body-sm font-medium text-paper transition-colors duration-180 ease-out hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2"
        >
          <MessageSquare className="size-4" />
          Chat
        </Link>
        <Link
          href={`/student/notes/${subject.id}`}
          className="flex min-h-11 min-w-[80px] flex-1 items-center justify-center gap-1 rounded-8 border border-ink-200 px-3 font-plex-sans text-body-sm font-medium text-ink-700 transition-colors duration-180 ease-out hover:border-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2"
        >
          <BookOpen className="size-4" />
          Notes
        </Link>
        <Link
          href={`/student/quiz?subjectId=${subject.id}`}
          className="flex min-h-11 min-w-[80px] flex-1 items-center justify-center rounded-8 border border-ink-200 px-3 font-plex-sans text-body-sm font-medium text-ink-700 transition-colors duration-180 ease-out hover:border-ink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2"
        >
          Quiz
        </Link>
      </div>
    </div>
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
        <h1 className="font-plex-serif text-display-sm font-semibold text-ink">{`Hi ${name}`}</h1>
        <p className="mt-1 font-plex-sans text-body-sm text-ink-500">
          Branch: {branch ?? "—"} · Semester {semester ?? "—"}
        </p>
      </div>

      {loadingProfile || loadingSubjects ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : showEmptyState ? (
        <div className="rounded-8 border border-ink-200 bg-paper p-4">
          <p className="font-plex-sans text-body-sm font-semibold text-ink">No subjects found</p>
          <p className="mt-1 font-plex-sans text-body-sm text-ink-500">
            No subjects found for your branch. Please contact your admin.
          </p>
        </div>
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
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-plex-sans text-body-sm text-ink-500">Showing</span>
              <MonoTag>{focusedSubject.code}</MonoTag>
              <button
                type="button"
                onClick={() => setFocusedSubjectId(null)}
                className="rounded-4 font-plex-sans text-body-sm text-ink-500 underline-offset-2 transition-colors duration-180 ease-out hover:text-ink-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
              >
                Show all subjects
              </button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-plex-sans text-body-sm text-ink-500">Group by:</span>
            <div className="flex overflow-hidden rounded-8 border border-ink-200 font-plex-sans text-body-sm font-medium">
              {(["semester", "code", "none"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setGroupBy(opt)}
                  className={cn(
                    "min-h-11 px-3 py-1.5 transition-colors duration-180 ease-out",
                    groupBy === opt
                      ? "bg-ink text-paper"
                      : "text-ink-500 hover:bg-ink-50"
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
              className="flex min-h-11 items-center gap-1 rounded-8 border border-ink-200 px-2 py-1.5 font-plex-sans text-body-sm text-ink-500 transition-colors duration-180 ease-out hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900"
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
                        "font-plex-sans text-label font-semibold uppercase tracking-[0.04em]",
                        group.isCurrent
                          ? "text-ochre"
                          : "text-ink-500"
                      )}
                    >
                      {group.label}
                    </h3>
                    {group.isCurrent ? <MonoTag variant="active">Current</MonoTag> : null}
                  </div>
                  <div className="h-px flex-1 bg-ink-100" />
                  <span className="font-plex-sans text-xs text-ink-500">
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
