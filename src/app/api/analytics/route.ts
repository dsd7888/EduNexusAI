import { requireRole, apiError } from "@/lib/api/helpers";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient, profile } = authResult;
    const role = profile.role;

    const url = new URL(request.url);
    let subjectId = url.searchParams.get("subjectId")?.trim() || "";

    // Fetch assigned subjects list
    let subjects: { id: string; name: string; code: string }[] = [];

    if (role === "faculty") {
      const { data: assignments, error: assignError } = await adminClient
        .from("faculty_assignments")
        .select("subject_id")
        .eq("faculty_id", user.id);

      if (assignError) {
        console.error("[analytics] faculty_assignments error:", assignError);
        return apiError("Failed to load faculty assignments", 500);
      }

      const subjectIds = [
        ...new Set(
          (assignments ?? [])
            .map((a: { subject_id: string | null }) => a.subject_id)
            .filter(Boolean)
        ),
      ] as string[];

      if (subjectIds.length > 0) {
        const { data: subs, error: subsError } = await adminClient
          .from("subjects")
          .select("id, name, code")
          .in("id", subjectIds)
          .order("code");

        if (subsError) {
          console.error("[analytics] subjects fetch error:", subsError);
          return apiError("Failed to load subjects", 500);
        }
        subjects = (subs ?? []) as typeof subjects;
      }
    } else {
      // superadmin: all subjects
      const { data: subs, error: subsError } = await adminClient
        .from("subjects")
        .select("id, name, code")
        .order("code");
      if (subsError) {
        console.error("[analytics] subjects fetch error:", subsError);
        return apiError("Failed to load subjects", 500);
      }
      subjects = (subs ?? []) as typeof subjects;
    }

    // If faculty and subjectId provided, verify assignment
    if (role === "faculty" && subjectId) {
      const { data: assignRow } = await adminClient
        .from("faculty_assignments")
        .select("id")
        .eq("faculty_id", user.id)
        .eq("subject_id", subjectId)
        .maybeSingle();
      if (!assignRow) {
        return apiError("You are not assigned to this subject", 403);
      }
    }

    // Total completed quiz_sessions across every subject this role can see —
    // computed regardless of the selected subjectId so the faculty dashboard
    // can show one aggregate number without a subject picker.
    const allSubjectIds = subjects.map((s) => s.id);
    let totalQuizAttempts = 0;
    if (allSubjectIds.length > 0) {
      const { count: sessionCount, error: sessionCountError } = await adminClient
        .from("quiz_sessions")
        .select("id", { count: "exact", head: true })
        .eq("status", "completed")
        .overlaps("subject_ids", allSubjectIds);
      if (sessionCountError) {
        console.error("[analytics] quiz_sessions count error:", sessionCountError);
      }
      totalQuizAttempts = sessionCount ?? 0;
    }

    // If no subjectId, default to first assigned
    if (!subjectId && subjects.length > 0) {
      subjectId = subjects[0].id;
    }

    // If still no subject, return early with empty stats
    if (!subjectId) {
      return Response.json({
        subjects,
        selectedSubjectId: null,
        quizStats: [],
        totalQuizAttempts,
        dailyActivity: [],
        topQuestions: [],
        cacheStats: {
          total_entries: 0,
          total_hits: 0,
          avg_hits_per_entry: 0,
        },
        generatedContent: [],
        scoreDistribution: [],
      });
    }

    // ── A. Quiz Stats ─────────────────────────────────────
    // quiz_sessions.subject_ids is an array (a session can span multiple
    // subjects, e.g. exam_sim) — group completed sessions that include this
    // subject by mode, since there is no per-quiz "title" anymore.
    const { data: sessionRows, error: quizError } = await adminClient
      .from("quiz_sessions")
      .select("mode, score")
      .eq("status", "completed")
      .contains("subject_ids", [subjectId]);

    if (quizError) {
      console.error("[analytics] quiz stats error:", quizError);
    }

    const byMode = new Map<string, number[]>();
    for (const row of (sessionRows ?? []) as Array<{ mode: string; score: number | null }>) {
      const scores = byMode.get(row.mode) ?? [];
      if (row.score != null) scores.push(row.score);
      byMode.set(row.mode, scores);
    }

    const quizStats = Array.from(byMode.entries()).map(([mode, scores]) => {
      const attempt_count = scores.length;
      const avg_score = attempt_count > 0 ? scores.reduce((sum, s) => sum + s, 0) / attempt_count : null;
      const min_score = attempt_count > 0 ? Math.min(...scores) : null;
      const max_score = attempt_count > 0 ? Math.max(...scores) : null;
      return {
        title: `${mode.replace("_", " ")} quiz`,
        attempt_count,
        avg_score,
        min_score,
        max_score,
      };
    });

    quizStats.sort((a, b) => b.attempt_count - a.attempt_count);
    const quizStatsTop10 = quizStats.slice(0, 10);

    // ── B & C need chat_sessions for this subject ──────────
    const { data: sessions, error: sessionsError } = await adminClient
      .from("chat_sessions")
      .select("id")
      .eq("subject_id", subjectId);

    if (sessionsError) {
      console.error("[analytics] chat_sessions error:", sessionsError);
    }

    const sessionIds = (sessions ?? []).map((s: { id: string }) => s.id);

    let dailyActivity: { date: string; sessions: number }[] = [];
    let topQuestions: { content: string; frequency: number }[] = [];

    if (sessionIds.length > 0) {
      const fourteenDaysAgo = new Date(
        Date.now() - 14 * 24 * 60 * 60 * 1000
      ).toISOString();

      const { data: chatMessages, error: chatError } = await adminClient
        .from("chat_messages")
        .select("session_id, created_at, role, content")
        .gt("created_at", fourteenDaysAgo)
        .in("session_id", sessionIds);

      if (chatError) {
        console.error("[analytics] chat_messages error:", chatError);
      } else {
        const byDate: Record<string, Set<string>> = {};
        const questionFreq: Record<string, number> = {};

        for (const m of chatMessages ?? []) {
          const dateStr = (m.created_at as string).slice(0, 10);
          const sessId = m.session_id as string;
          if (!byDate[dateStr]) byDate[dateStr] = new Set();
          byDate[dateStr].add(sessId);

          if ((m.role as string) === "user") {
            const content = (m.content as string).trim();
            if (!content) continue;
            questionFreq[content] = (questionFreq[content] ?? 0) + 1;
          }
        }

        dailyActivity = Object.entries(byDate)
          .map(([date, set]) => ({
            date,
            sessions: set.size,
          }))
          .sort((a, b) => a.date.localeCompare(b.date));

        topQuestions = Object.entries(questionFreq)
          .map(([content, frequency]) => ({
            content,
            frequency,
          }))
          .sort((a, b) => b.frequency - a.frequency)
          .slice(0, 10);
      }
    }

    // ── D. Cache Stats ─────────────────────────────────────
    const { data: cacheRows, count: cacheCount, error: cacheError } =
      await adminClient
        .from("semantic_cache")
        .select("hit_count", { count: "exact" })
        .eq("subject_id", subjectId);

    if (cacheError) {
      console.error("[analytics] cache stats error:", cacheError);
    }

    const total_entries = cacheCount ?? (cacheRows?.length ?? 0);
    const total_hits =
      cacheRows?.reduce(
        (sum: number, row: { hit_count: number | null }) => sum + (row.hit_count ?? 0),
        0
      ) ?? 0;
    const avg_hits_per_entry =
      total_entries > 0 ? total_hits / total_entries : 0;

    const cacheStats = {
      total_entries,
      total_hits,
      avg_hits_per_entry,
    };

    // ── E. Generated Content History ───────────────────────
    let genQuery = adminClient
      .from("generated_content")
      .select("type, title, created_at, metadata, generated_by")
      .eq("subject_id", subjectId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (role === "faculty") {
      genQuery = genQuery.eq("generated_by", user.id);
    }

    const { data: genRows, error: genError } = await genQuery;

    if (genError) {
      console.error("[analytics] generated_content error:", genError);
    }

    const generatedContent =
      genRows?.map((row: { type: string; title: string; created_at: string; metadata: unknown }) => {
        const md = (row.metadata ?? {}) as Record<string, unknown>;
        return {
          type: row.type,
          title: row.title,
          created_at: row.created_at,
          slide_count: (md.slideCount as number | undefined) ?? null,
          question_count: (md.totalQuestions as number | undefined) ?? null,
        };
      }) ?? [];

    // ── F. Quiz Score Distribution ────────────────────────
    const { data: scoreRows, error: scoreError } = await adminClient
      .from("quiz_sessions")
      .select("score")
      .eq("status", "completed")
      .contains("subject_ids", [subjectId]);

    if (scoreError) {
      console.error("[analytics] score distribution error:", scoreError);
    }

    const buckets: Record<string, number> = {
      "80-100": 0,
      "60-79": 0,
      "40-59": 0,
      "0-39": 0,
    };

    for (const row of scoreRows ?? []) {
      const score = (row.score as number) ?? 0;
      let range: string;
      if (score >= 80) range = "80-100";
      else if (score >= 60) range = "60-79";
      else if (score >= 40) range = "40-59";
      else range = "0-39";
      buckets[range] = (buckets[range] ?? 0) + 1;
    }

    const scoreDistribution = Object.entries(buckets).map(
      ([range, count]) => ({
        range,
        count,
      })
    );

    return Response.json({
      subjects,
      selectedSubjectId: subjectId,
      quizStats: quizStatsTop10,
      totalQuizAttempts,
      dailyActivity,
      topQuestions,
      cacheStats,
      generatedContent,
      scoreDistribution,
    });
  } catch (err) {
    console.error("[analytics] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to load analytics";
    return apiError(message, 500);
  }
}

