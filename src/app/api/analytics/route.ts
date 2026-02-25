import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return Response.json(
        { error: "Failed to load profile" },
        { status: 500 }
      );
    }

    const role = (profile as { role?: string }).role;
    if (role !== "faculty" && role !== "superadmin") {
      return Response.json(
        { error: "Forbidden: Faculty or Superadmin only" },
        { status: 403 }
      );
    }

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
        return Response.json(
          { error: "Failed to load faculty assignments" },
          { status: 500 }
        );
      }

      const subjectIds = [
        ...new Set(
          (assignments ?? [])
            .map((a: any) => a.subject_id as string | null)
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
          return Response.json(
            { error: "Failed to load subjects" },
            { status: 500 }
          );
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
        return Response.json(
          { error: "Failed to load subjects" },
          { status: 500 }
        );
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
        return Response.json(
          { error: "You are not assigned to this subject" },
          { status: 403 }
        );
      }
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
    const { data: quizRows, error: quizError } = await adminClient
      .from("quizzes")
      .select("id, title, quiz_attempts(score)")
      .eq("subject_id", subjectId);

    if (quizError) {
      console.error("[analytics] quiz stats error:", quizError);
    }

    const quizStats =
      quizRows?.map((q: any) => {
        const attempts = (q.quiz_attempts ?? []) as { score: number }[];
        const scores = attempts.map((a) => a.score);
        const attempt_count = attempts.length;
        const avg_score =
          scores.length > 0
            ? scores.reduce((sum, s) => sum + s, 0) / scores.length
            : null;
        const min_score =
          scores.length > 0 ? Math.min(...scores) : null;
        const max_score =
          scores.length > 0 ? Math.max(...scores) : null;

        return {
          title: q.title as string,
          attempt_count,
          avg_score,
          min_score,
          max_score,
        };
      }) ?? [];

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

    const sessionIds = (sessions ?? []).map((s: any) => s.id) as string[];

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
        (sum: number, row: any) => sum + (row.hit_count ?? 0),
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
      genRows?.map((row: any) => {
        const md = (row.metadata ?? {}) as any;
        return {
          type: row.type as string,
          title: row.title as string,
          created_at: row.created_at as string,
          slide_count: md.slideCount ?? null,
          question_count: md.totalQuestions ?? null,
        };
      }) ?? [];

    // ── F. Quiz Score Distribution ────────────────────────
    const { data: scoreRows, error: scoreError } = await adminClient
      .from("quiz_attempts")
      .select("score, quizzes!inner(subject_id)")
      .eq("quizzes.subject_id", subjectId);

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
    return Response.json({ error: message }, { status: 500 });
  }
}

