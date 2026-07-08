import { requireRole, apiError } from "@/lib/api/helpers";
import { createAdminClient } from "@/lib/db/supabase-server";
import { rowToBankQuestion, type FqbRow } from "@/lib/qbank/row";
import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

type AdminClient = ReturnType<typeof createAdminClient>;

const VALID_TYPES = new Set([
  "mcq",
  "short_answer",
  "long_answer",
  "numerical",
  "fill_blank",
]);
const VALID_DIFFICULTY = new Set(["easy", "medium", "hard"]);

/** Load a question row and confirm the caller may mutate it. */
async function loadOwned(
  adminClient: AdminClient,
  id: string,
  userId: string,
  role: string
): Promise<FqbRow | Response> {
  const { data, error } = await adminClient
    .from("faculty_question_bank")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[qbank patch] load failed:", error.message);
    return apiError("Failed to load question", 500);
  }
  if (!data) return apiError("Question not found", 404);
  const row = data as FqbRow;
  if (role !== "superadmin" && row.faculty_id !== userId) {
    return apiError("Forbidden: not your question", 403);
  }
  return row;
}

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;
    const { id } = await ctx.params;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return apiError("Invalid JSON body", 400);
    }

    const owned = await loadOwned(adminClient, id, user.id, profile.role);
    if (owned instanceof Response) return owned;

    // ── Whitelist editable fields ────────────────────────────────────────
    const update: Record<string, unknown> = {};

    if (typeof body.question_text === "string" && body.question_text.trim()) {
      update.question_text = body.question_text.trim();
    }
    if (
      typeof body.question_type === "string" &&
      VALID_TYPES.has(body.question_type)
    ) {
      update.question_type = body.question_type;
    }
    if (typeof body.marks === "number" && body.marks > 0) {
      update.marks = body.marks;
    }
    if (body.model_answer === null || typeof body.model_answer === "string") {
      update.model_answer = body.model_answer;
    }
    if (body.options === null || Array.isArray(body.options)) {
      update.options = body.options;
    }
    if (body.co_code === null || typeof body.co_code === "string") {
      update.co_code = body.co_code;
    }
    if (body.btl_level === null) {
      update.btl_level = null;
    } else if (
      typeof body.btl_level === "number" &&
      Number.isInteger(body.btl_level) &&
      body.btl_level >= 1 &&
      body.btl_level <= 6
    ) {
      update.btl_level = body.btl_level;
    }
    if (
      body.difficulty === null ||
      (typeof body.difficulty === "string" &&
        VALID_DIFFICULTY.has(body.difficulty))
    ) {
      update.difficulty = body.difficulty;
    }
    if (body.module_id === null || typeof body.module_id === "string") {
      update.module_id = body.module_id;
    }
    if (Array.isArray(body.po_codes)) {
      update.po_codes = body.po_codes.map((p) => String(p));
    }

    let verifiedTransition = false;
    if (typeof body.is_verified === "boolean") {
      update.is_verified = body.is_verified;
      verifiedTransition = body.is_verified === true && !owned.is_verified;
    }

    if (Object.keys(update).length === 0) {
      return apiError("No editable fields provided", 400);
    }
    update.updated_at = new Date().toISOString();

    const { data: updated, error: updateError } = await adminClient
      .from("faculty_question_bank")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();
    if (updateError || !updated) {
      console.error("[qbank patch] update failed:", updateError?.message);
      return apiError("Failed to update question", 500);
    }

    // Log a verification event (best-effort; never blocks the response).
    if (verifiedTransition) {
      await logReviewEvent(adminClient, user.id, owned.subject_id, "qbank_verify").catch(
        (e) => console.error("[qbank patch] usage_analytics error:", e)
      );
    }

    return Response.json({ question: rowToBankQuestion(updated as FqbRow) });
  } catch (err) {
    console.error("[qbank patch] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to update question";
    return apiError(message, 500);
  }
}

export async function DELETE(request: NextRequest, ctx: RouteContext) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;
    const { id } = await ctx.params;

    const owned = await loadOwned(adminClient, id, user.id, profile.role);
    if (owned instanceof Response) return owned;

    // A "reason=rejected" delete is an explicit review decision (distinct from
    // a plain destructive delete elsewhere in the UI) — log it the same way
    // approvals are logged, before the row is gone.
    const isReject = request.nextUrl.searchParams.get("reason") === "rejected";
    if (isReject) {
      await logReviewEvent(adminClient, user.id, owned.subject_id, "qbank_reject").catch(
        (e) => console.error("[qbank delete] usage_analytics error:", e)
      );
    }

    const { error: deleteError } = await adminClient
      .from("faculty_question_bank")
      .delete()
      .eq("id", id);
    if (deleteError) {
      console.error("[qbank delete] delete failed:", deleteError.message);
      return apiError("Failed to delete question", 500);
    }

    return Response.json({ success: true, id });
  } catch (err) {
    console.error("[qbank delete] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to delete question";
    return apiError(message, 500);
  }
}

/** Upsert-increment a per-day review-decision event in usage_analytics. */
async function logReviewEvent(
  adminClient: AdminClient,
  userId: string,
  subjectId: string,
  eventType: "qbank_verify" | "qbank_reject"
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: existing } = await adminClient
    .from("usage_analytics")
    .select("id, event_count")
    .eq("date", today)
    .eq("user_id", userId)
    .eq("subject_id", subjectId)
    .eq("event_type", eventType)
    .maybeSingle();

  if (existing) {
    await adminClient
      .from("usage_analytics")
      .update({
        event_count: ((existing as { event_count: number }).event_count ?? 0) + 1,
      })
      .eq("id", (existing as { id: string }).id);
  } else {
    await adminClient.from("usage_analytics").insert({
      date: today,
      user_id: userId,
      subject_id: subjectId,
      event_type: eventType,
      event_count: 1,
    });
  }
}
