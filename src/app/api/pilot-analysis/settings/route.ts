import type { NextRequest } from "next/server";
import { requireRole, apiError, apiSuccess } from "@/lib/api/helpers";
import { RECHARGE_BUDGET_SETTING_KEY } from "@/lib/pilot-analysis/constants";

// GET/POST the manually-entered Gemini recharge budget (INR), so the page can show
// "₹X of ₹Y used" instead of a bare spend figure. Superadmin only.

export async function GET() {
  const auth = await requireRole(["superadmin"]);
  if (auth instanceof Response) return auth;
  try {
    const { data } = await auth.adminClient
      .from("pilot_analysis_settings")
      .select("value")
      .eq("key", RECHARGE_BUDGET_SETTING_KEY)
      .maybeSingle();
    const value = data ? (data as { value: number | null }).value : null;
    return apiSuccess({ rechargeBudgetInr: value });
  } catch (err) {
    console.error("[pilot-analysis/settings GET]", err);
    return apiError("Failed to load settings", 500);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(["superadmin"]);
  if (auth instanceof Response) return auth;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      rechargeBudgetInr?: number | string;
    };
    const raw = body.rechargeBudgetInr;
    const value = raw === "" || raw === undefined || raw === null ? null : Number(raw);
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      return apiError("rechargeBudgetInr must be a non-negative number", 400);
    }
    const { error } = await auth.adminClient.from("pilot_analysis_settings").upsert(
      {
        key: RECHARGE_BUDGET_SETTING_KEY,
        value,
        updated_at: new Date().toISOString(),
        updated_by: auth.user.id,
      },
      { onConflict: "key" }
    );
    if (error) throw error;
    return apiSuccess({ rechargeBudgetInr: value });
  } catch (err) {
    console.error("[pilot-analysis/settings POST]", err);
    return apiError("Failed to save settings", 500);
  }
}
