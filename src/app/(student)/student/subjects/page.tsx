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
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface SubjectRow {
  id: string;
  code: string;
  name: string;
  department: string;
  branch: string;
  semester: number;
}

export default function StudentSubjectsPage() {
  const [name, setName] = useState<string>("Student");
  const [branch, setBranch] = useState<string | null>(null);
  const [semester, setSemester] = useState<number | null>(null);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingSubjects, setLoadingSubjects] = useState(true);

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

  const fetchSubjects = useCallback(async () => {
    if (branch == null || semester == null) {
      setLoadingSubjects(false);
      setSubjects([]);
      return;
    }
    setLoadingSubjects(true);
    try {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("subjects")
        .select("id, code, name, department, branch, semester")
        .eq("branch", branch)
        .eq("semester", semester)
        .order("code");
      if (error) {
        setSubjects([]);
        return;
      }
      setSubjects((data ?? []) as SubjectRow[]);
    } finally {
      setLoadingSubjects(false);
    }
  }, [branch, semester]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    if (!loadingProfile) {
      fetchSubjects();
    }
  }, [loadingProfile, fetchSubjects]);

  const canLoadSubjects = branch != null && semester != null;
  const showEmptyState =
    !loadingProfile &&
    !loadingSubjects &&
    (!canLoadSubjects || subjects.length === 0);

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
          {[1, 2, 3].map((i) => (
            <Card key={i} className="overflow-hidden">
              <CardHeader>
                <Skeleton className="h-7 w-20" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-4 w-16" />
              </CardHeader>
              <CardFooter>
                <Skeleton className="h-9 w-full" />
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : showEmptyState ? (
        <Card>
          <CardHeader>
            <CardTitle>No subjects found</CardTitle>
            <CardDescription>
              No subjects found for your branch and semester. Please contact your
              admin.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((s) => (
            <Card
              key={s.id}
              className="transition-shadow hover:shadow-md"
            >
              <CardHeader>
                <CardTitle className="text-xl font-bold">{s.code}</CardTitle>
                <CardDescription>{s.name}</CardDescription>
                <Badge variant="secondary" className="mt-2 w-fit">
                  {s.department}
                </Badge>
              </CardHeader>
              <CardFooter>
                <Button asChild className="w-full">
                  <Link href={`/student/chat/${s.id}`}>Start Learning →</Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
