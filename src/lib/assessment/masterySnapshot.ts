/**
 * Mastery "before" snapshot (CP-Q3 Part 5A).
 *
 * The results page needs to show before→after mastery movement for a mastery
 * session, but `student_topic_mastery` only ever carries the CURRENT state —
 * by the time a student reaches /student/quiz/results/[sessionId], the
 * `submit` write-back has already overwritten "before" with "after". Rather
 * than a schema change, the "before" state is captured into
 * `quiz_sessions.config.masterySnapshot` (a jsonb key, not a column) at
 * session-creation time, for mode='mastery' sessions only.
 *
 * The results route then reads snapshot (before) against the CURRENT
 * student_topic_mastery row (after). This is exact as long as no other
 * mastery session for the same module completed in between — the same
 * assumption every "your last session" surface in this product already makes.
 *
 * Scope: every module of the requested subject(s), narrowed to moduleIds when
 * the caller scoped the session that way. Not just modules the student has
 * already touched — a module first practiced in THIS session must show
 * before=0/'easy', not be silently absent from the snapshot.
 */

import type { createAdminClient } from "@/lib/db/supabase-server";
import type { AssessmentDifficulty } from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface MasterySnapshotEntry {
  subjectId: string;
  moduleId: string;
  moduleName: string;
  attemptsBefore: number;
  correctBefore: number;
  accuracyBefore: number | null;
  difficultyBefore: AssessmentDifficulty;
}

const LADDER: AssessmentDifficulty[] = ["easy", "medium", "hard"];

export async function buildMasterySnapshot(
  admin: AdminClient,
  studentId: string,
  subjectIds: string[],
  moduleIds?: string[]
): Promise<MasterySnapshotEntry[]> {
  if (subjectIds.length === 0) return [];

  let moduleQuery = admin
    .from("modules")
    .select("id, subject_id, name")
    .in("subject_id", subjectIds);
  if (moduleIds && moduleIds.length > 0) {
    moduleQuery = moduleQuery.in("id", moduleIds);
  }
  const { data: moduleRows } = await moduleQuery;
  const modules = (moduleRows ?? []) as Array<{
    id: string;
    subject_id: string;
    name: string;
  }>;
  if (modules.length === 0) return [];

  const { data: masteryRows } = await admin
    .from("student_topic_mastery")
    .select("subject_id, module_id, attempts_count, correct_count, current_difficulty")
    .eq("student_id", studentId)
    .in(
      "module_id",
      modules.map((m) => m.id)
    );
  const existing = new Map(
    ((masteryRows ?? []) as Array<{
      subject_id: string;
      module_id: string;
      attempts_count: number;
      correct_count: number;
      current_difficulty: string;
    }>).map((r) => [r.module_id, r])
  );

  return modules.map((m) => {
    const prev = existing.get(m.id);
    const attemptsBefore = prev?.attempts_count ?? 0;
    const correctBefore = prev?.correct_count ?? 0;
    const difficultyBefore = (LADDER.includes(
      prev?.current_difficulty as AssessmentDifficulty
    )
      ? (prev!.current_difficulty as AssessmentDifficulty)
      : "easy") as AssessmentDifficulty;
    return {
      subjectId: m.subject_id,
      moduleId: m.id,
      moduleName: m.name,
      attemptsBefore,
      correctBefore,
      accuracyBefore: attemptsBefore > 0 ? correctBefore / attemptsBefore : null,
      difficultyBefore,
    };
  });
}
