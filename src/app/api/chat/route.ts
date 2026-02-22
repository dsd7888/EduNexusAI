import { buildTutorSystemPrompt } from "@/lib/ai/prompts";
import { routeAI } from "@/lib/ai/router";
import { getGeminiProvider } from "@/lib/ai/providers/gemini";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import type { NextRequest } from "next/server";

type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export async function POST(request: NextRequest) {
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
      .select("id, role, branch, semester")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return Response.json(
        { error: "Failed to load profile" },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({} as any));
    const subjectId = String(body?.subjectId ?? "").trim();
    const message = String(body?.message ?? "").trim();
    const history = Array.isArray(body?.history) ? body.history : [];

    if (!subjectId || !message) {
      return Response.json(
        { error: "subjectId and message are required" },
        { status: 400 }
      );
    }

    // 3. Fetch syllabus content
    const { data: contentRow, error: contentError } = await adminClient
      .from("subject_content")
      .select("content, reference_books")
      .eq("subject_id", subjectId)
      .maybeSingle();

    if (contentError) {
      console.error("[chat] subject_content error:", contentError);
      return Response.json(
        { error: "Failed to load syllabus content" },
        { status: 500 }
      );
    }

    if (!contentRow) {
      return Response.json(
        { error: "No syllabus content found for this subject." },
        { status: 404 }
      );
    }

    // 4. Subject details
    const { data: subject, error: subjectError } = await adminClient
      .from("subjects")
      .select("id, name, code, semester, branch")
      .eq("id", subjectId)
      .single();

    if (subjectError || !subject) {
      return Response.json(
        { error: "Subject not found" },
        { status: 404 }
      );
    }

    // ── CACHE READ ──────────────────────────────────────────
    let cachedResponse: string | null = null;
    let cacheHitId: string | null = null;
    let cacheHitCount: number = 0;
    const SIMILARITY_THRESHOLD = 0.78;

    let queryEmbedding: number[] = [];
    let embeddingForDB = "";

    try {
      const gemini = getGeminiProvider();
      queryEmbedding = await gemini.embed(message);
      embeddingForDB = `[${queryEmbedding.join(",")}]`;

      // Fetch all cache rows for this subject (no vector ops in SQL)
      const { data: cacheRows, error: cacheReadError } = await adminClient
        .from("semantic_cache")
        .select("id, query_embedding, response, hit_count")
        .eq("subject_id", subjectId);

      if (cacheReadError) {
        console.error("[chat] Cache read error:", cacheReadError.message);
      }

      if (cacheRows && cacheRows.length > 0) {
        function cosineSimilarity(a: number[], b: number[]): number {
          let dot = 0,
            normA = 0,
            normB = 0;
          for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
          }
          const denom = Math.sqrt(normA) * Math.sqrt(normB);
          return denom === 0 ? 0 : dot / denom;
        }

        let bestSimilarity = 0;
        let bestRow: (typeof cacheRows)[number] | null = null;

        for (const row of cacheRows) {
          const raw = row.query_embedding;
          const stored: number[] = String(raw ?? "")
            .replace(/^\[|\]$/g, "")
            .split(",")
            .map(Number);

          const similarity = cosineSimilarity(queryEmbedding, stored);
          if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestRow = row;
          }
        }

        console.log(
          `[chat] Best cache similarity: ${bestSimilarity.toFixed(4)}`
        );

        if (bestSimilarity >= SIMILARITY_THRESHOLD && bestRow) {
          cachedResponse = String(bestRow.response ?? "");
          cacheHitId = String(bestRow.id);
          cacheHitCount = bestRow.hit_count ?? 0;
          console.log("[chat] CACHE HIT");
        } else {
          console.log("[chat] Cache miss — calling AI");
        }
      } else {
        console.log("[chat] Cache empty — calling AI");
      }

      // ── CACHE HIT: return immediately ───────────────────────
      if (cachedResponse && cacheHitId) {
        await adminClient
          .from("semantic_cache")
          .update({
            hit_count: cacheHitCount + 1,
            last_used_at: new Date().toISOString(),
          })
          .eq("id", cacheHitId);

        return Response.json({
          response: cachedResponse,
          content: cachedResponse,
          cached: true,
        });
      }
    } catch (err) {
      console.error("[chat] Cache exception:", err);
    }

    // ── CACHE MISS: call AI ──────────────────────────────────
    const systemPrompt = buildTutorSystemPrompt({
      subjectName: subject.name,
      subjectCode: subject.code,
      semester: subject.semester,
      branch: subject.branch,
      syllabusContent: contentRow.content ?? "",
      referenceBooks: contentRow.reference_books ?? "",
    });

    const normalizedHistory: HistoryMessage[] = (history as any[])
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string"
      )
      .slice(-6);

    const messagesForAI: HistoryMessage[] = [
      ...normalizedHistory,
      { role: "user", content: message },
    ];

    const ai = await routeAI("chat", {
      systemPrompt,
      messages: messagesForAI,
    });
    const aiResponse = String(ai.content ?? "");

    // ── CACHE WRITE ──────────────────────────────────────────
    try {
      const { error: cacheWriteError } = await adminClient
        .from("semantic_cache")
        .insert({
          subject_id: subjectId,
          module_id: null,
          query_text: message,
          query_embedding: embeddingForDB,
          response: aiResponse,
          hit_count: 0,
          last_used_at: new Date().toISOString(),
        });

      if (cacheWriteError) {
        console.error("[chat] Cache write error:", cacheWriteError.message);
      } else {
        console.log("[chat] Cache write SUCCESS");
      }
    } catch (err) {
      console.error("[chat] Cache write exception:", err);
    }

    // 7. Save chat messages
    let sessionId: string | null = null;

    try {
      const { data: existingSession } = await adminClient
        .from("chat_sessions")
        .select("id")
        .eq("student_id", profile.id)
        .eq("subject_id", subjectId)
        .maybeSingle();

      if (existingSession) {
        sessionId = existingSession.id as string;
        await adminClient
          .from("chat_sessions")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", sessionId);
      } else {
        const { data: newSession, error: insertSessionError } = await adminClient
          .from("chat_sessions")
          .insert({
            student_id: profile.id,
            subject_id: subjectId,
          })
          .select("id")
          .single();

        if (!insertSessionError && newSession) {
          sessionId = newSession.id as string;
        }
      }
    } catch (err) {
      console.error("[chat] chat_sessions error:", err);
    }

    if (sessionId) {
      try {
        await adminClient.from("chat_messages").insert([
          {
            session_id: sessionId,
            role: "user",
            content: message,
          },
          {
            session_id: sessionId,
            role: "assistant",
            content: aiResponse,
          },
        ]);
      } catch (err) {
        console.error("[chat] chat_messages insert error:", err);
      }
    }

    // 8. Track usage
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data: existingUsage } = await adminClient
        .from("usage_analytics")
        .select("id, event_count")
        .eq("date", today)
        .eq("user_id", profile.id)
        .eq("subject_id", subjectId)
        .eq("event_type", "chat")
        .maybeSingle();

      if (existingUsage) {
        await adminClient
          .from("usage_analytics")
          .update({
            event_count: (existingUsage.event_count ?? 0) + 1,
          })
          .eq("id", existingUsage.id);
      } else {
        await adminClient.from("usage_analytics").insert({
          date: today,
          user_id: profile.id,
          subject_id: subjectId,
          event_type: "chat",
          event_count: 1,
        });
      }
    } catch (err) {
      console.error("[chat] usage_analytics error:", err);
    }

    return Response.json({
      response: aiResponse,
      content: aiResponse,
      cached: false,
    });
  } catch (err) {
    console.error("[chat] POST error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to process chat request";
    return Response.json({ error: message }, { status: 500 });
  }
}

