"use client";

import { useState, useEffect, useCallback } from "react";
import { createBrowserClient } from "@/lib/db/supabase-browser";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OfferingRef {
  branch: string;
  semester: number;
}

export interface SubjectRow {
  id: string;
  name: string;
  code: string;
  department?: string;
  branch?: string;
  semester?: number;
  // The specific branch/semester offerings the faculty teaches this subject in.
  // A subject can be taught in several (one faculty, multiple branches). Populated
  // by useFacultySubjects; other consumers may leave it undefined.
  offerings?: OfferingRef[];
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

// `placement_attempts` never existed as a real table (CP-13 deleted the dead
// legacy test/practice code that referenced it). Canonical per-topic readiness
// data lives in `placement_topic_mastery` — see CLAUDE_CONTEXT.md §"Placement".
export interface PlacementMasteryRow {
  id: string;
  track: string;
  topic: string;
  recent_accuracy: number;
  sessions_count: number;
  current_difficulty: "easy" | "medium" | "hard";
  last_practiced_at: string | null;
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

    const supabase = createBrowserClient();
    Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        setIsLoading(true);
        setError(null);
        return supabase.auth.getUser();
      })
      .then(async (result) => {
        if (cancelled || !result) return;
        const { data: { user } } = result;
        if (!user) { setIsLoading(false); return; }

        const { data: assignments } = await supabase
          .from("faculty_assignments")
          .select("subject_id")
          .eq("faculty_id", user.id);

        const ids = [...new Set(
          (assignments ?? []).map((a) => a.subject_id).filter(Boolean)
        )];

        if (ids.length === 0) { if (!cancelled) setIsLoading(false); return; }

        // Fetch subjects (content) and, in parallel, the specific offerings this
        // faculty teaches (branch/semester) via faculty_offerings → subject_offerings.
        const [{ data: subs }, { data: facOfferings }] = await Promise.all([
          supabase.from("subjects").select("id, name, code").in("id", ids).order("code"),
          supabase
            .from("faculty_offerings")
            .select("subject_offering:subject_offerings(subject_id, branch, semester)")
            .eq("faculty_id", user.id),
        ]);

        if (cancelled) return;

        // Group this faculty's offerings by subject_id, sorted for stable display.
        type FacOfferingRow = {
          subject_offering: { subject_id: string; branch: string; semester: number } | null;
        };
        const offeringsBySubject = new Map<string, OfferingRef[]>();
        for (const r of (facOfferings ?? []) as unknown as FacOfferingRow[]) {
          const o = r.subject_offering;
          if (!o) continue;
          const list = offeringsBySubject.get(o.subject_id) ?? [];
          list.push({ branch: o.branch, semester: o.semester });
          offeringsBySubject.set(o.subject_id, list);
        }
        for (const list of offeringsBySubject.values()) {
          list.sort((a, b) => a.semester - b.semester || a.branch.localeCompare(b.branch));
        }

        const enriched = ((subs ?? []) as SubjectRow[]).map((s) => ({
          ...s,
          offerings: offeringsBySubject.get(s.id) ?? [],
        }));

        setSubjects(enriched);
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
    let cancelled = false;
    const supabase = createBrowserClient();
    Promise.resolve().then(() => {
      if (cancelled) return;
      if (!subjectId) { setModules([]); return; }
      setIsLoading(true);
      supabase
        .from("modules")
        .select("id, name, module_number, description, subject_id")
        .eq("subject_id", subjectId)
        .order("module_number")
        .then(({ data }) => {
          if (cancelled) return;
          setModules((data ?? []) as ModuleRow[]);
          setIsLoading(false);
        });
    });
    return () => { cancelled = true; };
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
    let cancelled = false;
    const supabase = createBrowserClient();
    Promise.resolve().then(() => {
      if (cancelled) return;
      if (!branch || !semester) { setSubjects([]); return; }
      setIsLoading(true);
      supabase
        .from("subject_offerings")
        .select("branch, semester, subject:subjects(id, name, code, department)")
        .eq("branch", branch)
        .then(({ data }) => {
          if (cancelled) return;
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
    });
    return () => { cancelled = true; };
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
 * Fetches the current student's most recently practiced placement topics
 * (readiness activity), ordered by recency.
 */
export function usePlacementHistory(limit = 5) {
  const [attempts, setAttempts] = useState<PlacementMasteryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const supabase = createBrowserClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled) return;
      if (!user) { setIsLoading(false); return; }
      supabase
        .from("placement_topic_mastery")
        .select("id, track, topic, recent_accuracy, sessions_count, current_difficulty, last_practiced_at")
        .eq("student_id", user.id)
        .not("last_practiced_at", "is", null)
        .order("last_practiced_at", { ascending: false, nullsFirst: false })
        .limit(limit)
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error) setError(error.message);
          setAttempts((data ?? []) as PlacementMasteryRow[]);
          setIsLoading(false);
        });
    });

    return () => { cancelled = true; };
  }, [limit]);

  return { attempts, isLoading, error };
}
