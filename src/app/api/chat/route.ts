import { buildTutorSystemPrompt } from "@/lib/ai/prompts";
import { routeAI } from "@/lib/ai/router";
import { getGeminiProvider } from "@/lib/ai/providers/gemini";
import {
  createAdminClient,
  createServerClient,
} from "@/lib/db/supabase-server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limit";
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

    const rateCheck = await checkRateLimit({
      userId: user.id,
      eventType: "chat",
      limit: RATE_LIMITS.chat,
    });

    if (!rateCheck.allowed) {
      return Response.json(
        {
          error: "Daily limit reached",
          message: `You've used all ${RATE_LIMITS.chat} chat queries for today. ${rateCheck.resetAt}.`,
          limitReached: true,
        },
        { status: 429 }
      );
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
    const sessionId =
      typeof body?.sessionId === "string" ? body.sessionId.trim() : null;

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
        {
          error: "no_syllabus",
          message:
            "This subject has no content yet. Please ask your faculty to add syllabus content.",
        },
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

    } catch (err) {
      console.error("[chat] Cache exception:", err);
      console.warn("[chat] Cache unavailable, proceeding without cache");
    }

    // ── CACHE MISS: call AI ──────────────────────────────────
    let aiResponse: string | null = null;

    if (!cachedResponse) {
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

      try {
        const ai = await routeAI("chat", {
          systemPrompt,
          messages: messagesForAI,
        });
        aiResponse = String(ai.content ?? "");
        if (!aiResponse.trim()) throw new Error("Empty response");
      } catch (err) {
        console.error("[chat] AI call failed:", err);
        return Response.json(
          {
            response:
              "I'm having trouble connecting right now. Please try again in a moment.",
            content:
              "I'm having trouble connecting right now. Please try again in a moment.",
            cached: false,
            fallback: true,
          },
          { status: 200 }
        );
      }

    }

    const finalResponse = cachedResponse ?? aiResponse ?? "";

    // 7. Save chat messages
    const finalSessionId = sessionId; // comes from frontend now

    if (finalSessionId && finalResponse) {
      try {
        await adminClient.from("chat_messages").insert([
          {
            session_id: finalSessionId,
            role: "user",
            content: message,
          },
          {
            session_id: finalSessionId,
            role: "assistant",
            content: finalResponse,
          },
        ]);
      } catch (err) {
        console.error("[chat] chat_messages insert error:", err);
      }

      // Keep only last 5 sessions per student (delete older ones)
      // This runs async, don't await
      adminClient
        .from("chat_sessions")
        .select("id, created_at")
        .eq("student_id", profile.id)
        .order("created_at", { ascending: false })
        .then(({ data: allSessions }) => {
          if (allSessions && allSessions.length > 5) {
            const toDelete = allSessions.slice(5).map((s: any) => s.id);
            adminClient
              .from("chat_messages")
              .delete()
              .in("session_id", toDelete)
              .then(() => {
                adminClient
                  .from("chat_sessions")
                  .delete()
                  .in("id", toDelete);
              });
          }
        });
    }

    // 8. Cache metadata updates
    if (cachedResponse && cacheHitId) {
      try {
        await adminClient
          .from("semantic_cache")
          .update({
            hit_count: cacheHitCount + 1,
            last_used_at: new Date().toISOString(),
          })
          .eq("id", cacheHitId);
      } catch (err) {
        console.error("[chat] Cache hit update error:", err);
      }
    }

    // 9. Cache write for misses
    if (!cachedResponse && aiResponse) {
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
    }

    // 10. Track usage (only for non-cache responses to avoid double counting)
    if (!cachedResponse) {
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
    }

    if (cachedResponse) {
      return Response.json({
        response: cachedResponse,
        content: cachedResponse,
        cached: true,
      });
    }

    return Response.json({
      response: finalResponse,
      content: finalResponse,
      cached: false,
    });
  } catch (err) {
    console.error("[chat] POST error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to process chat request";
    return Response.json({ error: message }, { status: 500 });
  }
}

