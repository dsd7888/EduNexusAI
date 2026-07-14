import {
  buildResearchTutorPrompt,
  buildTutorSystemPrompt,
  detectQueryMode,
  isRecencyIntent,
} from "@/lib/ai/prompts";
import { routeAI, routeAIStream } from "@/lib/ai/router";
import {
  getGeminiProvider,
  isGeminiRateLimitError,
} from "@/lib/ai/providers/gemini";
import { createAdminClient } from "@/lib/db/supabase-server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limit";
import { requireAuth, apiError } from "@/lib/api/helpers";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Request tier resolved from the (optional) client `mode`. This is distinct
// from the semantic_cache `mode` column, which stores detectQueryMode()'s
// exam_prep/problem_solving/conceptual classification of the query text.
type EffectiveMode = "standard" | "reasoning" | "research";

type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type StruggleResult = { struggle_detected: true; topic: string } | null;

// ── Struggle detection: pure string processing, zero AI tokens ─────────
const STRUGGLE_STOPWORDS = new Set([
  "what", "is", "the", "a", "an", "how", "does", "do", "in", "of", "for",
  "and", "or", "to", "it",
]);

// If the latest message explicitly pivots away, do not nudge.
const STRUGGLE_OPT_OUT = ["now explain", "different topic", "move on", "next"];

function tokenizeForStruggle(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0 && !STRUGGLE_STOPWORDS.has(t))
  );
}

/**
 * Returns the token (>4 chars) that appears in 3+ of the last 6 user
 * messages, or null. Deterministic: highest frequency wins, then longest.
 */
function detectStruggleTopic(userMessages: string[]): string | null {
  const recent = userMessages.slice(-6);
  if (recent.length < 3) return null;

  const counts = new Map<string, number>();
  for (const msg of recent) {
    for (const token of tokenizeForStruggle(msg)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [token, count] of counts) {
    if (count < 3 || token.length < 4) continue;
    if (
      count > bestCount ||
      (count === bestCount && (best === null || token.length > best.length))
    ) {
      best = token;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Cache-bypass heuristic — numerical / personal / pasted-content queries must
 * never be served from (or written to) the semantic cache. Logic UNCHANGED
 * from the prior route; relocated to module scope only.
 */
function shouldBypassCache(message: string): boolean {
  const m = message;

  // 1. Numerical arrays or sets: [5, 3, 8], {1, 2, 3}
  if (/[\[{][\d\s,.-]+[\]}]/.test(m)) return true;

  // 2. Specific numeric values with units or in calculation context
  // Matches: 300K, 15cm, 70kg, 8.5%, 180/120, 0.05 mol/L
  if (
    /\b\d+\.?\d*\s*(K|°C|°F|cm|mm|m|km|kg|g|mg|μg|L|mL|mol|Pa|kPa|MPa|bar|rpm|Hz|kHz|MHz|V|A|W|kW|MW|%|mmHg|psi|kcal|kJ|MJ)\b/i.test(
      m
    )
  )
    return true;

  // 3. Inline math/calculations with specific numbers
  if (/\b\d+\s*[+\-*/^=]\s*\d+/.test(m)) return true;

  // 4. "calculate/find/solve/evaluate/determine" + any number
  if (
    /\b(calculate|compute|solve|evaluate|determine|find|derive|estimate)\b.*\d+/i.test(
      m
    )
  )
    return true;

  // 5. "given that", "given:", "where X =" patterns with values
  if (/\b(given\s*(that)?|where|assume|let)\b.*[=:]\s*\d+/i.test(m))
    return true;

  // 6. Personal pronouns indicating personal context
  if (/\b(my|mine|our|i got|i have|i need|i am|i'm|i've|i was|i did)\b/i.test(m))
    return true;

  // 7. "this/the following/below" suggesting pasted content follows
  if (
    /\b(this (code|equation|reaction|formula|passage|text|problem|question|case|diagram)|the following|as follows|given below)\b/i.test(
      m
    )
  )
    return true;

  // 8. Code blocks pasted inline (``` or significant indented blocks)
  if (/```[\s\S]{20,}```/.test(m) || (m.match(/\n {4}/g) ?? []).length > 3)
    return true;

  // 9. Proper nouns that suggest specific case studies or named problems
  // Patient names, company names in analysis context, specific case references
  if (/\b(mr\.?|mrs\.?|ms\.?|dr\.?|patient|case study|case of)\s+[A-Z][a-z]+/i.test(m))
    return true;

  // 10. Specific named examples in analysis/compare context
  // "analyse X", "critique X", "evaluate X" where X looks like a specific title
  if (/\b(analyse|analyze|critique|evaluate|review|assess)\b\s+["']?[A-Z]/.test(m))
    return true;

  // 11. Long messages — likely contain pasted content or highly specific context
  // A genuine conceptual question is rarely >400 chars
  if (m.length > 400) return true;

  return false;
}

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

// SIMILARITY_THRESHOLD raised 0.78 → 0.92 (Jul 2026). At 0.78, near-but-distinct
// questions collided and a student was served a confidently WRONG cached answer;
// 0.92 keeps hits to genuine paraphrases, trading a slightly lower hit-rate for
// correctness on the student-facing path.
const SIMILARITY_THRESHOLD = 0.92;

const HISTORY_LIMIT = 12;
const CACHE_MAX_ROWS_PER_SUBJECT = 500;

export async function POST(request: NextRequest) {
  try {
    // ── 1. Auth + profile ───────────────────────────────────────────────
    const authResult = await requireAuth();
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const adminClient = createAdminClient();

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role, branch, semester")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return apiError("Failed to load profile", 500);
    }
    const profileId = profile.id;

    // ── 2. Parse body ────────────────────────────────────────────────────
    const body: {
      subjectId?: unknown;
      message?: unknown;
      sessionId?: unknown;
      mode?: unknown;
    } = await request.json().catch(() => ({}));
    const subjectId = String(body?.subjectId ?? "").trim();
    const message = String(body?.message ?? "").trim();
    const sessionId =
      typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    const requestedMode = String(body?.mode ?? "auto").trim();

    if (!subjectId || !message) {
      return apiError("subjectId and message are required", 400);
    }
    if (!sessionId) {
      return apiError("sessionId is required", 400);
    }

    // ── 3. Resolve effective mode ────────────────────────────────────────
    // Explicit non-"auto" tier wins. In "auto", problem_solving intent →
    // reasoning, everything else → standard. research is NEVER auto-selected.
    const queryMode = detectQueryMode(message); // exam_prep|problem_solving|conceptual
    let effectiveMode: EffectiveMode;
    if (
      requestedMode === "standard" ||
      requestedMode === "reasoning" ||
      requestedMode === "research"
    ) {
      effectiveMode = requestedMode;
    } else {
      effectiveMode = queryMode === "problem_solving" ? "reasoning" : "standard";
    }
    const recencySuggested =
      isRecencyIntent(message) && effectiveMode !== "research";

    // ── 4. Load subject + subject_content ────────────────────────────────
    const { data: contentRow, error: contentError } = await adminClient
      .from("subject_content")
      .select("content, reference_books")
      .eq("subject_id", subjectId)
      .maybeSingle();

    if (contentError) {
      console.error("[chat] subject_content error:", contentError);
      return apiError("Failed to load syllabus content", 500);
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

    const { data: subject, error: subjectError } = await adminClient
      .from("subjects")
      .select("id, name, code, semester, branch")
      .eq("id", subjectId)
      .single();

    if (subjectError || !subject) {
      return apiError("Subject not found", 404);
    }

    // ── 5. Server-side history: last N rows for this session, ascending ───
    const { data: historyRows } = await adminClient
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);

    const history: HistoryMessage[] = (historyRows ?? [])
      .slice()
      .reverse()
      .filter(
        (r) =>
          (r.role === "user" || r.role === "assistant") &&
          typeof r.content === "string"
      )
      .map((r) => ({
        role: r.role as "user" | "assistant",
        content: String(r.content ?? ""),
      }));

    const messagesForAI: HistoryMessage[] = [
      ...history,
      { role: "user", content: message },
    ];

    // ── 6. Embed ONCE — only when the cache is actually in play ──────────
    const bypassCache = shouldBypassCache(message);
    const cacheEligible = effectiveMode === "standard" && !bypassCache;

    let embeddingForDB = "";
    let queryEmbedding: number[] = [];
    if (cacheEligible) {
      try {
        const gemini = getGeminiProvider();
        queryEmbedding = await gemini.embed(message);
        embeddingForDB = `[${queryEmbedding.join(",")}]`;
      } catch (err) {
        console.error("[chat] Embed failed, skipping cache:", err);
        queryEmbedding = [];
        embeddingForDB = "";
      }
    }

    // ── Shared persistence (runs on every non-error path) ────────────────
    // Inserts the user + assistant rows, runs struggle detection, optionally
    // increments usage_analytics and writes the cache. Any failure logs and
    // continues — a saved-state failure must never kill a generated answer.
    async function persistTurn(opts: {
      assistantText: string;
      modelUsed: string | null;
      outputTokens: number | null;
      costInr: number | null;
      citations: { title: string; uri: string }[] | null;
      incrementUsage: boolean;
      usageEventType: "chat" | "research";
      writeCache: boolean;
      // False when the streaming path already persisted the user row eagerly,
      // before generation started (see the pre-stream insert below) — avoids
      // a duplicate row. Cache-hit/research callers pass true: they never take
      // that eager-insert branch, so this is still their only insert.
      insertUserRow: boolean;
    }): Promise<{ messageId: string | null; struggle: StruggleResult }> {
      let messageId: string | null = null;
      let struggle: StruggleResult = null;

      // Insert user row (skipped when already eagerly persisted pre-stream).
      if (opts.insertUserRow) {
        try {
          await adminClient
            .from("chat_messages")
            .insert({ session_id: sessionId, role: "user", content: message });
        } catch (err) {
          console.error("[chat] user message insert error:", err);
        }
      }

      // Insert assistant row (with cost/model metadata + citations).
      try {
        const { data: inserted, error: insErr } = await adminClient
          .from("chat_messages")
          .insert({
            session_id: sessionId,
            role: "assistant",
            content: opts.assistantText,
            model_used: opts.modelUsed,
            tokens_used: opts.outputTokens,
            cost_inr: opts.costInr,
            citations: opts.citations,
          })
          .select("id")
          .single();
        if (insErr) console.error("[chat] assistant insert error:", insErr);
        messageId = inserted?.id ? String(inserted.id) : null;
      } catch (err) {
        console.error("[chat] assistant message insert error:", err);
      }

      // Session-cap cleanup intentionally NOT done here. It is scoped per
      // (student_id, subject_id) and runs only on new-session creation in
      // src/app/api/chat/session/route.ts. Doing it here (per student, across
      // all subjects, on every message) deleted other subjects' sessions and
      // broke the 72h-window resume model.

      // Struggle detection — string processing only, no AI, no tokens.
      try {
        const lower = message.toLowerCase();
        const optedOut = STRUGGLE_OPT_OUT.some((p) => lower.includes(p));
        if (!optedOut) {
          const { data: recentRows } = await adminClient
            .from("chat_messages")
            .select("role, content, created_at")
            .eq("session_id", sessionId)
            .order("created_at", { ascending: false })
            .limit(10);

          const userMsgs = (recentRows ?? [])
            .slice()
            .reverse()
            .filter((r) => r.role === "user")
            .map((r) => String(r.content ?? ""));

          const topic = detectStruggleTopic(userMsgs);
          if (topic) struggle = { struggle_detected: true, topic };
        }
      } catch (err) {
        console.error("[chat] struggle detection error:", err);
      }

      // usage_analytics increment (skipped for cache hits — they consumed no
      // quota and made no AI call).
      if (opts.incrementUsage) {
        try {
          const today = new Date().toISOString().slice(0, 10);
          const { data: existingUsage } = await adminClient
            .from("usage_analytics")
            .select("id, event_count")
            .eq("date", today)
            .eq("user_id", profileId)
            .eq("subject_id", subjectId)
            .eq("event_type", opts.usageEventType)
            .maybeSingle();

          if (existingUsage) {
            await adminClient
              .from("usage_analytics")
              .update({ event_count: (existingUsage.event_count ?? 0) + 1 })
              .eq("id", existingUsage.id);
          } else {
            await adminClient.from("usage_analytics").insert({
              date: today,
              user_id: profileId,
              subject_id: subjectId,
              event_type: opts.usageEventType,
              event_count: 1,
            });
          }
        } catch (err) {
          console.error("[chat] usage_analytics error:", err);
        }
      }

      // Cache write — standard mode, non-bypassed, successful generation only.
      if (opts.writeCache && embeddingForDB) {
        try {
          const { error: cacheWriteError } = await adminClient
            .from("semantic_cache")
            .insert({
              subject_id: subjectId,
              module_id: null,
              query_text: message,
              query_embedding: embeddingForDB,
              response: opts.assistantText,
              mode: queryMode,
              hit_count: 0,
              last_used_at: new Date().toISOString(),
            });
          if (cacheWriteError) {
            console.error("[chat] Cache write error:", cacheWriteError.message);
          } else {
            // Eviction: keep only the newest 500 rows (by last_used_at) per
            // subject. supabase-js can't express a subquery DELETE, so we
            // resolve the stale ids then issue ONE .in() delete (not a loop).
            const { count } = await adminClient
              .from("semantic_cache")
              .select("id", { count: "exact", head: true })
              .eq("subject_id", subjectId);
            if ((count ?? 0) > CACHE_MAX_ROWS_PER_SUBJECT) {
              const { data: staleRows } = await adminClient
                .from("semantic_cache")
                .select("id")
                .eq("subject_id", subjectId)
                .order("last_used_at", { ascending: false })
                .range(CACHE_MAX_ROWS_PER_SUBJECT, count ?? 0);
              const staleIds = (staleRows ?? []).map((r) => r.id);
              if (staleIds.length > 0) {
                await adminClient
                  .from("semantic_cache")
                  .delete()
                  .in("id", staleIds);
              }
            }
          }
        } catch (err) {
          console.error("[chat] Cache write exception:", err);
        }
      }

      return { messageId, struggle };
    }

    // ── 7. CACHE READ — standard + cache-eligible only ───────────────────
    if (cacheEligible && embeddingForDB) {
      try {
        const { data: cacheRows, error: cacheReadError } = await adminClient
          .from("semantic_cache")
          .select("id, query_embedding, response, hit_count")
          .eq("subject_id", subjectId)
          .eq("mode", queryMode);

        if (cacheReadError) {
          console.error("[chat] Cache read error:", cacheReadError.message);
        }

        if (cacheRows && cacheRows.length > 0) {
          let bestSimilarity = 0;
          let bestRow: (typeof cacheRows)[number] | null = null;

          for (const row of cacheRows) {
            const stored: number[] = String(row.query_embedding ?? "")
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
            console.log("[chat] CACHE HIT");
            const cachedResponse = String(bestRow.response ?? "");

            // Rate limit is NOT consumed on a hit.
            const { struggle } = await persistTurn({
              assistantText: cachedResponse,
              modelUsed: null,
              outputTokens: null,
              costInr: null,
              citations: null,
              incrementUsage: false,
              usageEventType: "chat",
              writeCache: false,
              insertUserRow: true,
            });

            // Update hit metadata.
            try {
              await adminClient
                .from("semantic_cache")
                .update({
                  hit_count: (bestRow.hit_count ?? 0) + 1,
                  last_used_at: new Date().toISOString(),
                })
                .eq("id", bestRow.id);
            } catch (err) {
              console.error("[chat] Cache hit update error:", err);
            }

            return Response.json({
              response: cachedResponse,
              cached: true,
              mode: effectiveMode,
              recencySuggested,
              struggle,
            });
          }
        }
        console.log("[chat] Cache miss — proceeding to generation");
      } catch (err) {
        console.error("[chat] Cache exception:", err);
      }
    }

    // ── 8. RATE LIMIT — after the cache lookup ───────────────────────────
    const usageEventType: "chat" | "research" =
      effectiveMode === "research" ? "research" : "chat";
    const rateLimit =
      usageEventType === "research" ? RATE_LIMITS.research : RATE_LIMITS.chat;

    const rateCheck = await checkRateLimit({
      userId: user.id,
      eventType: usageEventType,
      limit: rateLimit,
    });

    if (!rateCheck.allowed) {
      return Response.json(
        {
          error: "Daily limit reached",
          message: `You've used all ${rateLimit} ${
            usageEventType === "research" ? "research" : "chat"
          } queries for today. ${rateCheck.resetAt}.`,
          limitReached: true,
        },
        { status: 429 }
      );
    }

    const jobId = crypto.randomUUID();
    const logContext = {
      userId: user.id,
      userEmail: user.email ?? null,
      userRole: profile.role,
      subjectId,
      subjectCode: subject.code ?? null,
      jobId,
      relatedContentId: null,
      feature: "chat",
    };

    // ── 9/10/11. RESEARCH — non-streamed JSON with citations ─────────────
    if (effectiveMode === "research") {
      const systemPrompt = buildResearchTutorPrompt({
        subjectName: subject.name,
        subjectCode: subject.code,
        semester: subject.semester,
        branch: subject.branch,
        syllabusContent: contentRow.content ?? "",
        referenceBooks: contentRow.reference_books ?? "",
      });

      let ai;
      try {
        ai = await routeAI("chat_research", {
          systemPrompt,
          messages: messagesForAI,
          logContext,
        });
      } catch (err) {
        console.error("[chat] research generation failed:", err);
        if (isGeminiRateLimitError(err)) {
          return Response.json(
            { error: "busy", retryable: true },
            { status: 429 }
          );
        }
        return Response.json(
          { error: "generation_failed", retryable: false },
          { status: 500 }
        );
      }

      const responseText = String(ai.content ?? "");
      const citations = ai.citations ?? null;

      const { struggle } = await persistTurn({
        assistantText: responseText,
        modelUsed: ai.modelUsed ?? null,
        outputTokens: ai.tokensUsed?.output ?? null,
        costInr: ai.costInr ?? null,
        citations,
        incrementUsage: true,
        usageEventType: "research",
        writeCache: false,
        insertUserRow: true,
      });

      return Response.json({
        response: responseText,
        citations: citations ?? undefined,
        mode: "research",
        cached: false,
        recencySuggested,
        struggle,
      });
    }

    // ── Eager user-row persist (streaming modes only) ────────────────────
    // Written BEFORE generation starts so a dropped connection, refresh, or
    // mid-stream failure never loses the student's own question — only the
    // assistant's reply (and the quota it would have consumed) depends on the
    // stream actually completing. If this insert itself fails, persistTurn's
    // insertUserRow fallback (below) still attempts it at completion, so the
    // message is never silently dropped on both ends.
    let userRowInserted = false;
    try {
      await adminClient
        .from("chat_messages")
        .insert({ session_id: sessionId, role: "user", content: message });
      userRowInserted = true;
    } catch (err) {
      console.error("[chat] eager user message insert error:", err);
    }

    // ── 9/10/11. STANDARD / REASONING — SSE stream ───────────────────────
    const isReasoning = effectiveMode === "reasoning";
    const systemPrompt = buildTutorSystemPrompt({
      subjectName: subject.name,
      subjectCode: subject.code,
      semester: subject.semester,
      branch: subject.branch,
      syllabusContent: contentRow.content ?? "",
      referenceBooks: contentRow.reference_books ?? "",
      mode: isReasoning ? "problem_solving" : queryMode,
    });

    let streamResult;
    try {
      streamResult = await routeAIStream(isReasoning ? "chat_reasoning" : "chat", {
        systemPrompt,
        messages: messagesForAI,
        logContext,
      });
    } catch (err) {
      // Pre-first-chunk failure (incl. exhausted flash 429 same-model retry).
      // Surface a clean JSON response — never an opened-then-empty SSE stream.
      console.error("[chat] stream open failed:", err);
      if (isGeminiRateLimitError(err)) {
        return Response.json(
          { error: "busy", retryable: true },
          { status: 429 }
        );
      }
      return Response.json(
        { error: "generation_failed", retryable: false },
        { status: 500 }
      );
    }

    const encoder = new TextEncoder();
    const sse = (event: string, data: unknown) =>
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const sseBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(
          sse("meta", { mode: effectiveMode, recencySuggested })
        );

        let assistantText = "";
        try {
          for await (const chunk of streamResult.stream) {
            const text = chunk?.text ?? "";
            if (!text) continue;
            assistantText += text;
            controller.enqueue(sse("chunk", { text }));
          }
        } catch (streamErr) {
          // Error AFTER the first chunk — emit an error frame, then close.
          // routeAIStream already logged this to ai_call_logs (logOnce); the
          // route must not write a second row.
          console.error("[chat] mid-stream error:", streamErr);
          controller.enqueue(
            sse("error", { message: "The response was interrupted. Please try again." })
          );
          controller.close();
          return;
        }

        // Real token counts / cost / model from usageMetadata.
        let modelUsed: string | null = null;
        let outputTokens: number | null = null;
        let costInr: number | null = null;
        try {
          const final = await streamResult.finalize();
          modelUsed = final.modelUsed ?? null;
          outputTokens = final.tokensUsed?.output ?? null;
          costInr = final.costInr ?? null;
        } catch (err) {
          console.error("[chat] finalize error:", err);
        }

        const { messageId, struggle } = await persistTurn({
          assistantText,
          modelUsed,
          outputTokens,
          costInr,
          citations: null,
          incrementUsage: true,
          usageEventType: "chat",
          writeCache: effectiveMode === "standard" && !bypassCache,
          insertUserRow: !userRowInserted,
        });

        controller.enqueue(sse("done", { messageId, struggle }));
        controller.close();
      },
    });

    return new Response(sseBody, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("[chat] POST error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to process chat request";
    return apiError(message, 500);
  }
}
