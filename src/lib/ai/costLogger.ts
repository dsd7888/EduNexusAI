import { createAdminClient } from "@/lib/db/supabase-server";
import { USD_TO_INR } from "./pricing";
import type { AILogContext } from "./providers/types";

interface LogAICallParams {
  logContext: AILogContext;
  task: string;
  model: "flash" | "pro" | "imagen";
  unitType: "tokens" | "images";
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  imageCount?: number;
  costUsd: number;
  costInr: number;
  status: "success" | "error" | "rate_limited";
  errorMessage?: string;
  latencyMs?: number;
}

export async function logAICall(params: LogAICallParams): Promise<void> {
  try {
    const adminClient = createAdminClient();
    const { error } = await adminClient.from("ai_call_logs").insert({
      user_id: params.logContext.userId,
      user_email_snapshot: params.logContext.userEmail,
      user_role_snapshot: params.logContext.userRole,
      subject_id: params.logContext.subjectId,
      subject_code_snapshot: params.logContext.subjectCode,
      task: params.task,
      feature: params.logContext.feature,
      model: params.model,
      unit_type: params.unitType,
      input_tokens: params.inputTokens ?? 0,
      output_tokens: params.outputTokens ?? 0,
      thinking_tokens: params.thinkingTokens ?? 0,
      image_count: params.imageCount ?? 0,
      cost_usd: params.costUsd,
      cost_inr: params.costInr,
      fx_rate: USD_TO_INR,
      status: params.status,
      error_message: params.errorMessage ?? null,
      latency_ms: params.latencyMs ?? null,
      attempt_number: params.logContext.attemptNumber ?? 1,
      job_id: params.logContext.jobId,
      related_content_id: params.logContext.relatedContentId,
      metadata: params.logContext.metadata ?? {},
    });
    if (error) {
      // Logging must never break the actual feature. Log to console and swallow.
      console.error("[costLogger] insert failed:", error, "task:", params.task);
    }
  } catch (err) {
    console.error("[costLogger] unexpected failure:", err);
  }
}

// Call after a generation job's final DB row is created, to link every log row
// from that job to the artifact it produced (enables per-artifact drill-down).
export async function backfillRelatedContentId(
  jobId: string,
  relatedContentId: string
): Promise<void> {
  try {
    const adminClient = createAdminClient();
    const { error } = await adminClient
      .from("ai_call_logs")
      .update({ related_content_id: relatedContentId })
      .eq("job_id", jobId);
    if (error)
      console.error("[costLogger] backfill failed:", error, "jobId:", jobId);
  } catch (err) {
    console.error("[costLogger] backfill unexpected failure:", err);
  }
}
