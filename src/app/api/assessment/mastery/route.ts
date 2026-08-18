import type { NextRequest } from "next/server";
import { handleAssessmentRequest } from "@/lib/assessment/routeHandler";
import { apiError, apiSuccess, requireRole } from "@/lib/api/helpers";
import { computePromotionProgress } from "@/lib/assessment/promotionProgress";
import type { AssessmentDifficulty } from "@/lib/assessment/types";

/** POST /api/assessment/mastery — see routeHandler.ts (modes are thin config). */
export async function POST(request: NextRequest) {
  return handleAssessmentRequest(request, "mastery");
}

/**
 * GET /api/assessment/mastery — the mastery hub (CP-Q3 Part 5B).
 *
 * Every subject the student has practiced, grouped, with a per-module
 * breakdown. RLS-safe direct read shape (student_topic_mastery is scoped to
 * auth.uid() already), but read through the admin client for the same reason
 * every other assessment route does: one read, one place the aggregation
 * logic lives, rather than duplicated in a client component.
 *
 * `readyToLevelUp`'s thresholds and this route's `promotionProgress` MUST
 * describe the same modules the landing card counts — both read from
 * landingSignals.ts via promotionProgress.ts, so they cannot drift apart.
 */

interface MasteryRow {
  subject_id: string;
  module_id: string;
  attempts_count: number;
  correct_count: number;
  accuracy: number | null;
  current_difficulty: string;
}

export async function GET() {
  try {
    const authResult = await requireRole(["student"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    const { data: masteryRows, error: masteryErr } = await adminClient
      .from("student_topic_mastery")
      .select("subject_id, module_id, attempts_count, correct_count, accuracy, current_difficulty")
      .eq("student_id", user.id);
    if (masteryErr) return apiError(masteryErr.message, 500);

    const mastery = (masteryRows ?? []) as MasteryRow[];
    if (mastery.length === 0) {
      return apiSuccess({ subjects: [] });
    }

    const subjectIds = Array.from(new Set(mastery.map((m) => m.subject_id)));
    const moduleIds = mastery.map((m) => m.module_id);

    const [subjectsRes, allModulesRes, practicedModulesRes] = await Promise.all([
      adminClient.from("subjects").select("id, name, code").in("id", subjectIds),
      adminClient.from("modules").select("id, subject_id").in("subject_id", subjectIds),
      adminClient.from("modules").select("id, name, module_number").in("id", moduleIds),
    ]);

    const subjectMeta = new Map(
      ((subjectsRes.data ?? []) as Array<{ id: string; name: string; code: string }>).map((s) => [
        s.id,
        s,
      ])
    );
    const moduleCountBySubject = new Map<string, number>();
    for (const m of (allModulesRes.data ?? []) as Array<{ id: string; subject_id: string }>) {
      moduleCountBySubject.set(m.subject_id, (moduleCountBySubject.get(m.subject_id) ?? 0) + 1);
    }
    const moduleMeta = new Map(
      ((practicedModulesRes.data ?? []) as Array<{
        id: string;
        name: string;
        module_number: number | null;
      }>).map((m) => [m.id, m])
    );

    const bySubject = new Map<string, MasteryRow[]>();
    for (const row of mastery) {
      const arr = bySubject.get(row.subject_id) ?? [];
      arr.push(row);
      bySubject.set(row.subject_id, arr);
    }

    const subjects = Array.from(bySubject.entries()).map(([subjectId, rows]) => {
      const totalAttempts = rows.reduce((n, r) => n + (r.attempts_count ?? 0), 0);
      const totalCorrect = rows.reduce((n, r) => n + (r.correct_count ?? 0), 0);
      const aggregateMastery =
        totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : null;

      const modules = rows
        .map((r) => {
          const meta = moduleMeta.get(r.module_id);
          const accuracy =
            r.accuracy != null
              ? Math.round(r.accuracy * 100)
              : r.attempts_count > 0
                ? Math.round((r.correct_count / r.attempts_count) * 100)
                : 0;
          const difficulty = r.current_difficulty as AssessmentDifficulty;
          const promotionProgress = computePromotionProgress(
            difficulty,
            r.attempts_count,
            r.correct_count
          );
          return {
            moduleId: r.module_id,
            moduleName: meta?.name ?? "Module",
            moduleNumber: meta?.module_number ?? null,
            accuracy,
            attemptsCount: r.attempts_count,
            currentDifficulty: difficulty,
            ...(promotionProgress ? { promotionProgress } : {}),
          };
        })
        .sort((a, b) => (a.moduleNumber ?? 0) - (b.moduleNumber ?? 0));

      const meta = subjectMeta.get(subjectId);
      return {
        subjectId,
        subjectName: meta?.name ?? "Subject",
        subjectCode: meta?.code ?? "",
        aggregateMastery,
        moduleCount: moduleCountBySubject.get(subjectId) ?? rows.length,
        practicedModuleCount: rows.length,
        modules,
      };
    });

    subjects.sort((a, b) => a.subjectName.localeCompare(b.subjectName));

    return apiSuccess({ subjects });
  } catch (err) {
    console.error("[assessment/mastery GET]", err);
    return apiError("Internal server error", 500);
  }
}
