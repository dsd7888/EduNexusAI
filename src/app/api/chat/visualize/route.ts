import { routeAI } from "@/lib/ai/router";
import {
  VIZ_CLASSIFY_SCHEMA,
  VIZ_DIAGRAM_SCHEMA,
  VIZ_REGISTRY,
  VIZ_TYPES,
  buildVizClassifyPrompt,
  type VizClassification,
  type VizType,
} from "@/lib/ai/vizPrompts";
import { createAdminClient } from "@/lib/db/supabase-server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/utils/rate-limit";
import { requireAuth, apiError } from "@/lib/api/helpers";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/chat/visualize — builds a visualization for one assistant message.
 *
 * Two AI calls, always in this order:
 *   CALL 1  chat_visualize/classify → which visual form fits this content
 *   CALL 2  one of chat_visualize | chat_viz_diagram | chat_viz_plot
 *
 * The client may skip call 1 by sending a `classification` it already holds —
 * that is what Regenerate does, so a regenerate costs one AI call, not two.
 * The classification is re-validated here rather than trusted: it arrives from
 * the browser and selects a model tier.
 *
 * Quota: reuses the `hint` bucket (30/day). A visualization is the same
 * comprehension-aid class as a hint, so it draws from the same allowance rather
 * than introducing a limit type students would have to reason about separately.
 * Exactly one decrement per successful click.
 */

interface VizRequestBody {
  sessionId?: unknown;
  subjectId?: unknown;
  messageId?: unknown;
  classification?: unknown;
}

/** Strips a stray markdown fence if the model ignores the no-fence instruction. */
function stripFence(raw: string): string {
  const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  return body;
}

/**
 * Un-escapes literal "\n" sequences in Mermaid source.
 *
 * Observed live: under responseSchema, Gemini frequently emits a multi-line
 * string with the backslash itself escaped, so JSON.parse yields the two
 * characters \ + n rather than a newline. Mermaid is newline-delimited, so the
 * whole diagram arrives as one unparseable line and the render fails.
 *
 * Fixed here rather than in sanitizeMermaidCode: that helper splits on real
 * newlines (so it cannot see this at all) and is shared with the PPT diagram
 * path, which has never hit this because it does not use responseSchema. A
 * literal backslash-n is never meaningful in Mermaid source — labels break with
 * <br>, not \n — so this substitution cannot damage a valid diagram.
 */
function normalizeMermaid(raw: string): string {
  return raw
    .replace(/```(?:mermaid)?/gi, "")
    .replace(/\\r\\n|\\n/g, "\n")
    .trim();
}

function isVizType(value: unknown): value is VizType {
  return (
    typeof value === "string" && (VIZ_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Validates a client-supplied classification (the Regenerate path). Returns null
 * if anything is off, which makes the caller fall back to a fresh call 1 —
 * degrade to correct-but-costlier, never trust the shape.
 */
function parseClientClassification(value: unknown): VizClassification | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  if (!isVizType(c.vizType)) return null;
  if (typeof c.coreConcept !== "string" || !c.coreConcept.trim()) return null;
  return {
    vizType: c.vizType,
    rationale: typeof c.rationale === "string" ? c.rationale.slice(0, 200) : "",
    coreConcept: c.coreConcept.slice(0, 300),
    conceptualFallback: c.conceptualFallback === true,
  };
}

export async function POST(request: NextRequest) {
  try {
    // ── 1. Auth — students only ──────────────────────────────────────────
    const authResult = await requireAuth();
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    const adminClient = createAdminClient();

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return apiError("Failed to load profile", 500);
    }
    if (profile.role !== "student") {
      return apiError("Forbidden: Student only", 403);
    }

    // ── 2. Parse body ────────────────────────────────────────────────────
    const body: VizRequestBody = await request.json().catch(() => ({}));
    const sessionId = String(body?.sessionId ?? "").trim();
    const subjectId = String(body?.subjectId ?? "").trim();
    const messageId = String(body?.messageId ?? "").trim();

    if (!sessionId || !subjectId || !messageId) {
      return apiError("sessionId, subjectId and messageId are required", 400);
    }

    // ── 3. Load the source message, scoped to a session this student owns ─
    // The session ownership check is what makes messageId safe to accept: it
    // prevents reading another student's message by guessing an id.
    const { data: session, error: sessionError } = await adminClient
      .from("chat_sessions")
      .select("id, student_id, subject_id")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionError) {
      console.error("[chat/visualize] session lookup error:", sessionError);
      return apiError("Failed to load session", 500);
    }
    if (!session || session.student_id !== profile.id) {
      return apiError("Session not found", 404);
    }
    if (session.subject_id !== subjectId) {
      return apiError("Session does not belong to this subject", 400);
    }

    const { data: sourceMessage, error: messageError } = await adminClient
      .from("chat_messages")
      .select("id, role, content")
      .eq("id", messageId)
      .eq("session_id", sessionId)
      .maybeSingle();

    if (messageError) {
      console.error("[chat/visualize] message lookup error:", messageError);
      return apiError("Failed to load message", 500);
    }
    if (!sourceMessage || sourceMessage.role !== "assistant") {
      return apiError("Message not found", 404);
    }

    const sourceContent = String(sourceMessage.content ?? "").trim();
    if (!sourceContent) {
      return apiError("Message has no content to visualize", 400);
    }

    const { data: subject } = await adminClient
      .from("subjects")
      .select("id, name, code")
      .eq("id", subjectId)
      .single();

    if (!subject) {
      return apiError("Subject not found", 404);
    }

    // ── 4. Rate limit — the `hint` bucket ────────────────────────────────
    const rateCheck = await checkRateLimit({
      userId: user.id,
      eventType: "hint",
      limit: RATE_LIMITS.hint,
    });

    if (!rateCheck.allowed) {
      return Response.json(
        {
          error: "Daily limit reached",
          message: `You've used all ${RATE_LIMITS.hint} visualizations and hints for today. ${rateCheck.resetAt}.`,
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
      relatedContentId: messageId,
      feature: "chat_visualize",
    };

    // ── 5. CALL 1 — classify (skipped when the client supplies one) ──────
    const reusedClassification = parseClientClassification(body?.classification);
    let classification: VizClassification;

    if (reusedClassification) {
      classification = reusedClassification;
    } else {
      const classifyResponse = await routeAI("chat_viz_classify", {
        messages: [
          {
            role: "user",
            content: buildVizClassifyPrompt({
              subjectName: subject.name,
              sourceContent,
            }),
          },
        ],
        responseSchema: VIZ_CLASSIFY_SCHEMA,
        thinkingBudget: 0,
        logContext: { ...logContext, feature: "chat_viz_classify" },
      });

      let parsed: unknown;
      try {
        parsed = JSON.parse(classifyResponse.content);
      } catch (err) {
        console.error("[chat/visualize] classifier JSON parse failed:", err);
        return apiError("Could not classify this content", 502);
      }

      const validated = parseClientClassification(parsed);
      if (!validated) {
        console.error(
          "[chat/visualize] classifier returned an unusable shape:",
          classifyResponse.content.slice(0, 200)
        );
        return apiError("Could not classify this content", 502);
      }
      classification = validated;
    }

    // ── 6. CALL 2 — generate, via the per-vizType registry ───────────────
    const spec = VIZ_REGISTRY[classification.vizType];

    const genResponse = await routeAI(spec.task, {
      messages: [
        {
          role: "user",
          content: spec.buildPrompt({
            subjectName: subject.name,
            coreConcept: classification.coreConcept,
            sourceContent,
          }),
        },
      ],
      // Mermaid is the only branch with a schema; the HTML branches are
      // freeform by nature and bounded by VIZ_SIZE_CONTRACT in the prompt.
      ...(spec.payloadKind === "mermaid"
        ? { responseSchema: VIZ_DIAGRAM_SCHEMA, thinkingBudget: 0 }
        : {}),
      ...(spec.task === "chat_visualize" ? { thinkingBudget: 2048 } : {}),
      ...(spec.task === "chat_viz_plot" ? { thinkingBudget: 1024 } : {}),
      logContext: { ...logContext, feature: spec.task },
    });

    let payload: string;
    if (spec.payloadKind === "mermaid") {
      try {
        const parsed = JSON.parse(genResponse.content) as { mermaid?: unknown };
        payload = normalizeMermaid(String(parsed.mermaid ?? ""));
      } catch (err) {
        console.error("[chat/visualize] diagram JSON parse failed:", err);
        return apiError("Could not build this visualization", 502);
      }
    } else {
      payload = stripFence(genResponse.content);
    }

    if (!payload) {
      return apiError("Could not build this visualization", 502);
    }

    // ── 7. Quota — one decrement per successful build ────────────────────
    // Deliberately after generation: a failed build must not cost the student a
    // visualization. Mirrors the chat route's "no quota for cache hits" stance —
    // quota tracks work delivered, not work attempted.
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data: existingUsage } = await adminClient
        .from("usage_analytics")
        .select("id, event_count")
        .eq("date", today)
        .eq("user_id", profile.id)
        .eq("subject_id", subjectId)
        .eq("event_type", "hint")
        .maybeSingle();

      if (existingUsage) {
        await adminClient
          .from("usage_analytics")
          .update({ event_count: (existingUsage.event_count ?? 0) + 1 })
          .eq("id", existingUsage.id);
      } else {
        await adminClient.from("usage_analytics").insert({
          date: today,
          user_id: profile.id,
          subject_id: subjectId,
          event_type: "hint",
          event_count: 1,
        });
      }
    } catch (err) {
      // Never fail a delivered visualization over an analytics write.
      console.error("[chat/visualize] usage_analytics error:", err);
    }

    return Response.json({
      vizType: classification.vizType,
      payload,
      payloadKind: spec.payloadKind,
      classification,
    });
  } catch (error) {
    console.error("[chat/visualize] error:", error);
    return apiError("Failed to build visualization", 500);
  }
}
