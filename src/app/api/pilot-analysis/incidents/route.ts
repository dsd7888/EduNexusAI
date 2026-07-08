import type { NextRequest } from "next/server";
import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";

// Manually-maintained incident/downtime log. NOT automated uptime monitoring (an app
// can't reliably record its own downtime — real uptime % comes from an external
// monitor Dhruv configures separately). Superadmin only.

export async function GET() {
  const auth = await requireRole(["superadmin"]);
  if (auth instanceof Response) return auth;
  try {
    const { data, error } = await auth.adminClient
      .from("system_incidents")
      .select("id, occurred_at, duration_minutes, cause, created_at")
      .order("occurred_at", { ascending: false });
    if (error) throw error;
    return apiSuccess({ incidents: data ?? [] });
  } catch (err) {
    console.error("[pilot-analysis/incidents GET]", err);
    return apiError("Failed to load incidents", 500);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(["superadmin"]);
  if (auth instanceof Response) return auth;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      occurred_at?: string;
      duration_minutes?: number | string;
      cause?: string;
    };
    const occurredAt = String(body.occurred_at ?? "").trim();
    if (!occurredAt || Number.isNaN(new Date(occurredAt).getTime())) {
      return apiError("Valid occurred_at is required", 400);
    }
    const durationRaw = body.duration_minutes;
    const duration =
      durationRaw === undefined || durationRaw === null || durationRaw === ""
        ? null
        : Math.max(0, Math.round(Number(durationRaw)));
    if (duration !== null && Number.isNaN(duration)) {
      return apiError("duration_minutes must be a number", 400);
    }

    const { data, error } = await auth.adminClient
      .from("system_incidents")
      .insert({
        occurred_at: new Date(occurredAt).toISOString(),
        duration_minutes: duration,
        cause: body.cause ? String(body.cause).slice(0, 2000) : null,
        created_by: auth.user.id,
      })
      .select("id, occurred_at, duration_minutes, cause, created_at")
      .single();
    if (error) throw error;
    return apiSuccess({ incident: data }, 201);
  } catch (err) {
    console.error("[pilot-analysis/incidents POST]", err);
    return apiError("Failed to create incident", 500);
  }
}
