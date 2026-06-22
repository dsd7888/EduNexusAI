import { requireRole, apiError } from "@/lib/api/helpers";
import { rowToBankQuestion, type FqbRow } from "@/lib/qbank/row";
import type { NextRequest } from "next/server";

const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 100;
const VALID_TYPES = new Set([
  "mcq",
  "short_answer",
  "long_answer",
  "numerical",
  "fill_blank",
]);
const VALID_SOURCES = new Set([
  "ai_generated",
  "faculty_imported",
  "pyq_inspired",
]);
const VALID_DIFFICULTY = new Set(["easy", "medium", "hard"]);

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, profile, adminClient } = authResult;

    const sp = request.nextUrl.searchParams;
    const subjectId = (sp.get("subject_id") ?? "").trim();
    if (!subjectId) return apiError("subject_id is required", 400);

    const idsOnly = sp.get("ids_only") === "true";

    const page = Math.max(1, Number(sp.get("page")) || 1);
    const perPage = Math.min(
      MAX_PER_PAGE,
      Math.max(1, Number(sp.get("per_page")) || DEFAULT_PER_PAGE)
    );
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    // ids_only mode: return just IDs for all matching rows (up to 1000), no pagination.
    if (idsOnly) {
      let idsQuery = adminClient
        .from("faculty_question_bank")
        .select("id")
        .eq("subject_id", subjectId)
        .limit(1000);

      if (profile.role === "faculty") idsQuery = idsQuery.eq("faculty_id", user.id);

      const moduleId = (sp.get("module_id") ?? "").trim();
      if (moduleId) idsQuery = idsQuery.eq("module_id", moduleId);
      const questionType = (sp.get("question_type") ?? "").trim();
      if (questionType && VALID_TYPES.has(questionType)) idsQuery = idsQuery.eq("question_type", questionType);
      const marksParam = sp.get("marks");
      if (marksParam != null && marksParam !== "") {
        const marks = Number(marksParam);
        if (Number.isFinite(marks)) idsQuery = idsQuery.eq("marks", marks);
      }
      const coCode = (sp.get("co_code") ?? "").trim();
      if (coCode) idsQuery = idsQuery.eq("co_code", coCode);
      const btlParam = sp.get("btl_level");
      if (btlParam != null && btlParam !== "") {
        const btl = Number(btlParam);
        if (Number.isInteger(btl)) idsQuery = idsQuery.eq("btl_level", btl);
      }
      const source = (sp.get("source") ?? "").trim();
      if (source && VALID_SOURCES.has(source)) idsQuery = idsQuery.eq("source", source);
      const verifiedParam = sp.get("is_verified");
      if (verifiedParam === "true" || verifiedParam === "false") idsQuery = idsQuery.eq("is_verified", verifiedParam === "true");
      const difficulty = (sp.get("difficulty") ?? "").trim();
      if (difficulty && VALID_DIFFICULTY.has(difficulty)) idsQuery = idsQuery.eq("difficulty", difficulty);
      const search = (sp.get("search") ?? "").trim();
      if (search) {
        const safe = search.replace(/[%,]/g, " ");
        idsQuery = idsQuery.ilike("question_text", `%${safe}%`);
      }

      const { data: idsData, error: idsError } = await idsQuery;
      if (idsError) {
        console.error("[qbank list ids_only] query failed:", idsError.message);
        return apiError("Failed to load question IDs", 500);
      }
      return Response.json({ ids: ((idsData ?? []) as { id: string }[]).map((r) => r.id) });
    }

    let query = adminClient
      .from("faculty_question_bank")
      .select("*", { count: "exact" })
      .eq("subject_id", subjectId);

    // Faculty see only their own bank; superadmin sees everything.
    if (profile.role === "faculty") {
      query = query.eq("faculty_id", user.id);
    }

    // ── Optional filters ─────────────────────────────────────────────────
    const moduleId = (sp.get("module_id") ?? "").trim();
    if (moduleId) query = query.eq("module_id", moduleId);

    const questionType = (sp.get("question_type") ?? "").trim();
    if (questionType && VALID_TYPES.has(questionType)) {
      query = query.eq("question_type", questionType);
    }

    const marksParam = sp.get("marks");
    if (marksParam != null && marksParam !== "") {
      const marks = Number(marksParam);
      if (Number.isFinite(marks)) query = query.eq("marks", marks);
    }

    const coCode = (sp.get("co_code") ?? "").trim();
    if (coCode) query = query.eq("co_code", coCode);

    const btlParam = sp.get("btl_level");
    if (btlParam != null && btlParam !== "") {
      const btl = Number(btlParam);
      if (Number.isInteger(btl)) query = query.eq("btl_level", btl);
    }

    const source = (sp.get("source") ?? "").trim();
    if (source && VALID_SOURCES.has(source)) {
      query = query.eq("source", source);
    }

    const verifiedParam = sp.get("is_verified");
    if (verifiedParam === "true" || verifiedParam === "false") {
      query = query.eq("is_verified", verifiedParam === "true");
    }

    const difficulty = (sp.get("difficulty") ?? "").trim();
    if (difficulty && VALID_DIFFICULTY.has(difficulty)) {
      query = query.eq("difficulty", difficulty);
    }

    const search = (sp.get("search") ?? "").trim();
    if (search) {
      // Escape PostgREST ilike wildcards/commas in the user term.
      const safe = search.replace(/[%,]/g, " ");
      query = query.ilike("question_text", `%${safe}%`);
    }

    // Sort: verified first, newest within each group.
    query = query
      .order("is_verified", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);

    const { data, count, error } = await query;
    if (error) {
      console.error("[qbank list] query failed:", error.message);
      return apiError("Failed to load questions", 500);
    }

    const questions = ((data ?? []) as FqbRow[]).map(rowToBankQuestion);
    const total = count ?? 0;

    return Response.json({
      questions,
      total,
      page,
      per_page: perPage,
      total_pages: Math.ceil(total / perPage),
    });
  } catch (err) {
    console.error("[qbank list] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to load questions";
    return apiError(message, 500);
  }
}
