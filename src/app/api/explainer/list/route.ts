import { apiError, apiSuccess, requireRole } from "@/lib/api/helpers";

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

interface ExplainerRow {
  id: string;
  short_code: string;
  topic: string;
  duration_seconds: number | null;
  has_audio: boolean | null;
  created_at: string;
  subjects: { name: string } | null;
  modules: { name: string } | null;
}

export async function GET(request: Request) {
  const auth = await requireRole(["faculty", "superadmin", "dean", "hod"]);
  if (auth instanceof Response) return auth;
  const { user, adminClient } = auth;

  const url = new URL(request.url);
  const subjectId = url.searchParams.get("subject_id");

  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const perPageRaw = Number(url.searchParams.get("per_page")) || DEFAULT_PER_PAGE;
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, perPageRaw));
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  // Faculty's own explainers, optionally scoped to a subject, newest first.
  let query = adminClient
    .from("explainers")
    .select(
      "id, short_code, topic, duration_seconds, has_audio, created_at, subjects(name), modules(name)",
      { count: "exact" }
    )
    .eq("created_by", user.id)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (subjectId) {
    query = query.eq("subject_id", subjectId);
  }

  const { data, error, count } = await query;
  if (error) {
    console.error("[explainer/list] query failed", error);
    return apiError("Failed to load explainers", 500);
  }

  const rows = (data ?? []) as unknown as ExplainerRow[];
  // Shape matches GeneratedExplainer (minus html_player, which is the full
  // document and not stored per-row — clients open it via storage_url / the
  // /e/[code] permalink). module_name is kept as a useful extra.
  const explainers = rows.map((r) => ({
    id: r.id,
    short_code: r.short_code,
    topic: r.topic,
    subject_name: r.subjects?.name ?? null,
    storage_url: `/e/${r.short_code}`,
    has_audio: !!r.has_audio,
    duration_seconds: r.duration_seconds,
    created_at: r.created_at,
    module_name: r.modules?.name ?? null,
  }));

  return apiSuccess({
    explainers,
    page,
    per_page: perPage,
    total: count ?? explainers.length,
  });
}
