import type { NextRequest } from "next/server";
import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";

export const maxDuration = 30;

// ─── Types ────────────────────────────────────────────────────────────────────

interface SppFields {
  cgpa: number | null;
  primary_target: string | null;
  dream_companies: string[] | null;
  readiness_overall: number;
  readiness_aptitude: number;
  readiness_verbal: number;
  readiness_domain: number;
  readiness_coding: number;
  readiness_communication: number;
  resume_completeness: number;
  setup_complete: boolean;
  last_active_date: string | null;
  prep_streak_days: number;
}

interface RawProfileRow {
  id: string;
  full_name: string | null;
  branch: string | null;
  semester: number | null;
  email: string | null;
  student_placement_profiles: SppFields | SppFields[] | null;
}

export interface StudentRow {
  id: string;
  full_name: string | null;
  branch: string | null;
  semester: number | null;
  email: string | null;
  cgpa: number | null;
  primary_target: string | null;
  dream_companies: string[];
  readiness_overall: number;
  readiness_aptitude: number;
  readiness_verbal: number;
  readiness_domain: number;
  readiness_coding: number;
  readiness_communication: number;
  resume_completeness: number;
  setup_complete: boolean;
  last_active_date: string | null;
  prep_streak_days: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(["superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;

    const { adminClient } = authResult;
    const { searchParams } = new URL(request.url);
    const branchFilter = searchParams.get("branch") ?? null;
    const semesterFilter = searchParams.get("semester") ?? null;

    // ── Step 1: Fetch students with placement profiles ─────────────────────────
    let query = adminClient
      .from("profiles")
      .select(
        `
        id,
        full_name,
        branch,
        semester,
        email,
        student_placement_profiles!inner(
          cgpa,
          primary_target,
          dream_companies,
          readiness_overall,
          readiness_aptitude,
          readiness_verbal,
          readiness_domain,
          readiness_coding,
          readiness_communication,
          resume_completeness,
          setup_complete,
          last_active_date,
          prep_streak_days
        )
      `
      )
      .eq("role", "student");

    if (branchFilter) query = query.eq("branch", branchFilter);
    if (semesterFilter)
      query = query.eq("semester", parseInt(semesterFilter, 10));

    const { data: profileRows, error: profileError } = await query;

    if (profileError) {
      console.error("[tpo/dashboard] profiles fetch failed:", profileError);
      return apiError("Failed to fetch student data.", 500);
    }

    const students: StudentRow[] = (
      (profileRows ?? []) as unknown as RawProfileRow[]
    ).map((row) => {
      const sppRaw = row.student_placement_profiles;
      const spp = Array.isArray(sppRaw) ? sppRaw[0] : sppRaw;
      return {
        id: row.id,
        full_name: row.full_name,
        branch: row.branch,
        semester: row.semester,
        email: row.email,
        cgpa: spp?.cgpa ?? null,
        primary_target: spp?.primary_target ?? null,
        dream_companies: spp?.dream_companies ?? [],
        readiness_overall: spp?.readiness_overall ?? 0,
        readiness_aptitude: spp?.readiness_aptitude ?? 0,
        readiness_verbal: spp?.readiness_verbal ?? 0,
        readiness_domain: spp?.readiness_domain ?? 0,
        readiness_coding: spp?.readiness_coding ?? 0,
        readiness_communication: spp?.readiness_communication ?? 0,
        resume_completeness: spp?.resume_completeness ?? 0,
        setup_complete: spp?.setup_complete ?? false,
        last_active_date: spp?.last_active_date ?? null,
        prep_streak_days: spp?.prep_streak_days ?? 0,
      };
    });

    // ── Step 2: Fetch upcoming drives ──────────────────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const { data: driveRows, error: drivesError } = await adminClient
      .from("placement_drives")
      .select("*, company:placement_company_profiles(*)")
      .gte("drive_date", today)
      .order("drive_date", { ascending: true });

    if (drivesError) {
      console.error("[tpo/dashboard] drives fetch failed:", drivesError);
    }

    const drives = driveRows ?? [];

    // ── Step 3: Compute aggregates in JS ───────────────────────────────────────
    const started = students.filter((s) => s.readiness_overall > 0);

    const dimAvgs = {
      aptitude: avg(started.map((s) => s.readiness_aptitude)),
      verbal: avg(started.map((s) => s.readiness_verbal)),
      domain: avg(started.map((s) => s.readiness_domain)),
      coding: avg(started.map((s) => s.readiness_coding)),
      communication: avg(started.map((s) => s.readiness_communication)),
    };

    const weakestEntry =
      started.length > 0
        ? Object.entries(dimAvgs).sort(([, a], [, b]) => a - b)[0]
        : null;

    const stats = {
      total_students: students.length,
      setup_complete: students.filter((s) => s.setup_complete).length,
      ready: students.filter((s) => s.readiness_overall >= 75).length,
      developing: students.filter(
        (s) => s.readiness_overall >= 50 && s.readiness_overall < 75
      ).length,
      early: students.filter(
        (s) => s.readiness_overall > 0 && s.readiness_overall < 50
      ).length,
      not_started: students.filter((s) => s.readiness_overall === 0).length,
      avg_aptitude: dimAvgs.aptitude,
      avg_verbal: dimAvgs.verbal,
      avg_domain: dimAvgs.domain,
      avg_coding: dimAvgs.coding,
      avg_communication: dimAvgs.communication,
      avg_overall: avg(started.map((s) => s.readiness_overall)),
      weakest_dimension: weakestEntry ? weakestEntry[0] : null,
      avg_resume_completeness: avg(students.map((s) => s.resume_completeness)),
      resumes_complete: students.filter((s) => s.resume_completeness >= 80)
        .length,
      active_this_week: students.filter((s) => {
        if (!s.last_active_date) return false;
        const daysSince =
          (Date.now() - new Date(s.last_active_date).getTime()) /
          (1000 * 60 * 60 * 24);
        return daysSince <= 7;
      }).length,
    };

    return apiSuccess({
      students,
      stats,
      drives,
      filters: { branch: branchFilter, semester: semesterFilter },
    });
  } catch (error) {
    console.error(
      "[tpo/dashboard] Error:",
      error instanceof Error ? error.message : error
    );
    return apiError("Failed to load dashboard.", 500);
  }
}
