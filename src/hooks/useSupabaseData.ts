"use client";

import { useState, useEffect } from "react";
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

  useEffect(() => {
    const supabase = createBrowserClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setIsLoading(false); return; }

      const { data: assignments } = await supabase
        .from("faculty_assignments")
        .select("subject_id")
        .eq("faculty_id", user.id);

      const ids = [...new Set(
        (assignments ?? []).map((a) => a.subject_id).filter(Boolean)
      )];

      if (ids.length === 0) { setIsLoading(false); return; }

      const { data: subs } = await supabase
        .from("subjects")
        .select("id, name, code")
        .in("id", ids)
        .order("code");

      setSubjects((subs ?? []) as SubjectRow[]);
      setIsLoading(false);
    });
  }, []);

  return { subjects, isLoading };
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
 * Fetches subjects for a student filtered by branch and semester.
 * Only runs when both branch and semester are provided.
 */
export function useStudentSubjects(branch: string | null, semester: number | null) {
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!branch || !semester) { setSubjects([]); return; }
    setIsLoading(true);
    const supabase = createBrowserClient();
    supabase
      .from("subjects")
      .select("id, name, code, department, branch, semester")
      .eq("branch", branch)
      .order("semester", { ascending: true })
      .order("code", { ascending: true })
      .then(({ data }) => {
        setSubjects((data ?? []) as SubjectRow[]);
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
