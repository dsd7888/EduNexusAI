"use client";

import { useState, useEffect, useCallback } from "react";
import { createBrowserClient } from "@/lib/db/supabase-browser";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubjectRow {
  id: string;
  name: string;
  code: string;
  department?: string;
  branch?: string;
  semester?: number;
}

export interface ModuleRow {
  id: string;
  name: string;
  module_number: number;
  description?: string | null;
  subject_id: string;
}

export interface ProfileRow {
  full_name: string | null;
  department?: string | null;
  role?: string | null;
  branch?: string | null;
  semester?: number | null;
}

export interface PlacementAttemptRow {
  id: string;
  company_id: string;
  score: number;
  category_scores: Record<string, number>;
  time_taken: number;
  created_at: string;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Fetches the current user's profile from the profiles table.
 * Works for any role.
 */
export function useCurrentUser() {
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const supabase = createBrowserClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { setIsLoading(false); return; }
      setUserId(user.id);
      supabase
        .from("profiles")
        .select("full_name, department, role, branch, semester")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          setProfile(data ?? null);
          setIsLoading(false);
        });
    });
  }, []);

  return { profile, userId, isLoading };
}

/**
 * Fetches subjects assigned to the current faculty user.
 */
export function useFacultySubjects() {
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refetchToken, setRefetchToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const supabase = createBrowserClient();
    supabase.auth.getUser()
      .then(async ({ data: { user } }) => {
        if (cancelled) return;
        if (!user) { setIsLoading(false); return; }

        const { data: assignments } = await supabase
          .from("faculty_assignments")
          .select("subject_id")
          .eq("faculty_id", user.id);

        const ids = [...new Set(
          (assignments ?? []).map((a) => a.subject_id).filter(Boolean)
        )];

        if (ids.length === 0) { if (!cancelled) setIsLoading(false); return; }

        const { data: subs } = await supabase
          .from("subjects")
          .select("id, name, code")
          .in("id", ids)
          .order("code");

        if (cancelled) return;
        setSubjects((subs ?? []) as SubjectRow[]);
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load subjects");
        setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [refetchToken]);

  const refetch = useCallback(() => setRefetchToken((t) => t + 1), []);

  return { subjects, isLoading, error, refetch };
}

/**
 * Fetches modules for a given subject id.
 * Only runs when subjectId is non-null.
 */
export function useSubjectModules(subjectId: string | null) {
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!subjectId) { setModules([]); return; }
    setIsLoading(true);
    const supabase = createBrowserClient();
    supabase
      .from("modules")
      .select("id, name, module_number, description, subject_id")
      .eq("subject_id", subjectId)
      .order("module_number")
      .then(({ data }) => {
        setModules((data ?? []) as ModuleRow[]);
        setIsLoading(false);
      });
  }, [subjectId]);

  return { modules, isLoading };
}

/**
 * Fetches subjects for a student's branch (all semesters — the page groups by
 * semester client-side). `semester` is only used as a readiness gate: we wait
 * until the profile is loaded before querying, matching prior behaviour, but it
 * is intentionally NOT a filter — a student can see every subject in their
 * branch, not just their current semester.
 *
 * Resolves through subject_offerings rather than filtering `subjects` directly —
 * a subject's content (name/code) can be offered under multiple branch/semester
 * combos, so branch+semester live on the offering, not the content row.
 */
export function useStudentSubjects(branch: string | null, semester: number | null) {
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!branch || !semester) { setSubjects([]); return; }
    setIsLoading(true);
    const supabase = createBrowserClient();
    supabase
      .from("subject_offerings")
      .select("branch, semester, subject:subjects(id, name, code, department)")
      .eq("branch", branch)
      .then(({ data }) => {
        type OfferingRow = {
          branch: string;
          semester: number;
          subject: { id: string; name: string; code: string; department?: string } | null;
        };
        const rows = ((data ?? []) as unknown as OfferingRow[])
          .filter((r) => r.subject)
          .map((r) => ({
            id: r.subject!.id,
            name: r.subject!.name,
            code: r.subject!.code,
            department: r.subject!.department,
            branch: r.branch,
            semester: r.semester,
          }))
          .sort((a, b) => a.semester - b.semester || a.code.localeCompare(b.code));
        setSubjects(rows as SubjectRow[]);
        setIsLoading(false);
      });
  }, [branch, semester]);

  return { subjects, isLoading };
}

/**
 * Fetches all subjects ordered by code.
 * For superadmin pages.
 */
export function useAllSubjects() {
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const supabase = createBrowserClient();
    supabase
      .from("subjects")
      .select("id, name, code, department, branch, semester")
      .order("code")
      .then(({ data }) => {
        setSubjects((data ?? []) as SubjectRow[]);
        setIsLoading(false);
      });
  }, []);

  return { subjects, isLoading };
}

/**
 * Fetches recent placement attempts for the current student.
 */
export function usePlacementHistory(limit = 5) {
  const [attempts, setAttempts] = useState<PlacementAttemptRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const supabase = createBrowserClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { setIsLoading(false); return; }
      supabase
        .from("placement_attempts")
        .select("id, company_id, score, category_scores, time_taken, created_at")
        .eq("student_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit)
        .then(({ data }) => {
          setAttempts((data ?? []) as PlacementAttemptRow[]);
          setIsLoading(false);
        });
    });
  }, [limit]);

  return { attempts, isLoading };
}
