import { requireRole, apiError } from "@/lib/api/helpers";
import {
  parseImportCsv,
  parseImportTxt,
  matchModuleId,
  type ModuleRef,
} from "@/lib/qbank/parser";
import { tagQuestions } from "@/lib/qbank/tagger";
import { hasUnsupportedNotation } from "@/lib/text/latexSegments";
import { rowToBankQuestion, type FqbRow } from "@/lib/qbank/row";
import type { ImportedQuestion, MCQOption } from "@/lib/qbank/types";
import type { NextRequest } from "next/server";

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_QUESTIONS = 200;

/** Build MCQ options from the flat option_a..d / correct_option columns. */
function buildOptions(q: ImportedQuestion): MCQOption[] | null {
  if (q.question_type !== "mcq") return null;
  const pairs: Array<["A" | "B" | "C" | "D", string | undefined]> = [
    ["A", q.option_a],
    ["B", q.option_b],
    ["C", q.option_c],
    ["D", q.option_d],
  ];
  const opts = pairs
    .filter(([, text]) => text && text.trim())
    .map(([label, text]) => ({
      label,
      text: (text as string).trim(),
      is_correct: q.correct_option === label,
    }));
  return opts.length > 0 ? opts : null;
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(["faculty", "superadmin", "dean", "hod"]);
    if (authResult instanceof Response) return authResult;
    const { user, adminClient } = authResult;

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return apiError("Expected multipart/form-data", 400);
    }

    const subjectId = String(form.get("subject_id") ?? "").trim();
    if (!subjectId) return apiError("subject_id is required", 400);

    const file = form.get("file");
    if (!(file instanceof File)) return apiError("file is required", 400);
    if (file.size === 0) return apiError("file is empty", 400);
    if (file.size > MAX_FILE_BYTES) {
      return apiError("file exceeds 2MB limit", 400);
    }

    const name = file.name.toLowerCase();
    const isTxt = name.endsWith(".txt");
    const isCsv = name.endsWith(".csv");
    if (!isTxt && !isCsv) {
      return apiError("Only .csv or .txt files are accepted", 400);
    }

    const text = await file.text();
    const parsed = isCsv ? parseImportCsv(text) : parseImportTxt(text);

    const errors = [...parsed.errors];
    let questions = parsed.questions;
    if (questions.length > MAX_QUESTIONS) {
      const ignored = questions.length - MAX_QUESTIONS;
      questions = questions.slice(0, MAX_QUESTIONS);
      errors.push(
        `Import capped at ${MAX_QUESTIONS} questions; ${ignored} additional row(s) ignored`
      );
    }

    if (questions.length === 0) {
      return Response.json({
        total_parsed: 0,
        added: 0,
        skipped: parsed.errors.length,
        needs_review: 0,
        errors,
        questions: [],
      });
    }

    // ── Subject context for fuzzy module match + AI tagging ──────────────
    const { data: subject, error: subjectError } = await adminClient
      .from("subjects")
      .select("name")
      .eq("id", subjectId)
      .single();
    if (subjectError || !subject) return apiError("Subject not found", 404);

    const { data: moduleRows } = await adminClient
      .from("modules")
      .select("id, name, description")
      .eq("subject_id", subjectId)
      .order("module_number");
    const modules = (moduleRows ?? []) as {
      id: string;
      name: string;
      description: string | null;
    }[];
    const moduleRefs: ModuleRef[] = modules.map((m) => ({
      id: m.id,
      name: m.name,
    }));

    const { data: coRows } = await adminClient
      .from("course_outcomes")
      .select("co_code, description")
      .eq("subject_id", subjectId);

    // ── Tag questions missing CO or BTL ──────────────────────────────────
    // Faculty-supplied CO+BTL ⇒ trusted (is_verified=true). AI-inferred ⇒
    // needs review (is_verified=false).
    const untaggedIdx: number[] = [];
    const toTag: ImportedQuestion[] = [];
    questions.forEach((q, i) => {
      if (!q.co_code || q.btl_level == null) {
        untaggedIdx.push(i);
        toTag.push(q);
      }
    });

    const inferred = new Map<number, { co: string; btl: number; diff: string }>();
    if (toTag.length > 0) {
      const tagged = await tagQuestions(toTag, {
        subject_name: (subject as { name: string }).name,
        modules: modules.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description ?? "",
        })),
        course_outcomes: (coRows ?? []) as {
          co_code: string;
          description: string;
        }[],
      });
      tagged.forEach((t, i) => {
        inferred.set(untaggedIdx[i], {
          co: t.inferred_co_code,
          btl: t.inferred_btl_level,
          diff: t.inferred_difficulty,
        });
      });
    }

    // ── Build insert rows ────────────────────────────────────────────────
    const rows = questions.map((q, i) => {
      // Unsupported/malformed math or chemistry notation forces needs-review
      // (is_verified=false) regardless of tag completeness, so a reviewer catches
      // it before it renders as literal source in a paper. Same generic check
      // used by manual/image entry and the CSV preview.
      const verified =
        Boolean(q.co_code) &&
        q.btl_level != null &&
        !hasUnsupportedNotation(q.question_text, q.model_answer);
      const inf = inferred.get(i);
      return {
        subject_id: subjectId,
        faculty_id: user.id,
        module_id: matchModuleId(q.module_name, moduleRefs),
        question_text: q.question_text,
        question_type: q.question_type,
        marks: q.marks,
        model_answer: q.model_answer ?? null,
        options: buildOptions(q),
        co_code: q.co_code ?? inf?.co ?? null,
        btl_level: q.btl_level ?? inf?.btl ?? null,
        po_codes: null,
        difficulty: q.difficulty ?? inf?.diff ?? null,
        source: "faculty_imported",
        is_verified: verified,
      };
    });

    const { data: inserted, error: insertError } = await adminClient
      .from("faculty_question_bank")
      .insert(rows)
      .select("*");
    if (insertError) {
      console.error("[qbank import] insert failed:", insertError.message);
      return apiError("Failed to save imported questions", 500);
    }

    const saved = ((inserted ?? []) as FqbRow[]).map(rowToBankQuestion);
    const needsReview = saved.filter((q) => !q.is_verified).length;

    return Response.json({
      total_parsed: parsed.questions.length,
      added: saved.length,
      skipped: parsed.errors.length,
      needs_review: needsReview,
      errors,
      questions: saved,
    });
  } catch (err) {
    console.error("[qbank import] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to import questions";
    return apiError(message, 500);
  }
}
