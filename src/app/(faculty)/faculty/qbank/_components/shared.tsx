"use client";

/**
 * Shared types, label maps, badge helpers, and the thin REST client used by
 * the Q Bank management tabs. All question CRUD goes through the /api/qbank/*
 * routes (which enforce auth + RLS); modules / COs / stats are read directly
 * via the Supabase browser client like the other faculty pages.
 */

import type {
  BankQuestion,
  Difficulty,
  GenerationSlot,
  MCQOption,
  QuestionSource,
  QuestionType,
} from "@/lib/qbank/types";

// ─── Draft image types ────────────────────────────────────────────────────────

export interface DraftImagePayload {
  subject_id: string;
  question_type: QuestionType;
  marks: number;
  module_id?: string;
  image_base64: string;
  image_mime: string;
}

export interface DraftImageResponse {
  image_path: string;
  question_text: string;
  options: MCQOption[] | null;
  model_answer: string | null;
  co_code: string | null;
  btl_level: number | null;
  difficulty: Difficulty | null;
  module_id: string | null;
}

export async function draftImageQuestion(
  payload: DraftImagePayload
): Promise<DraftImageResponse> {
  const res = await fetch("/api/qbank/draft-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as DraftImageResponse;
}

// ─── Label maps ─────────────────────────────────────────────────────────────

export const TYPE_LABELS: Record<QuestionType, string> = {
  mcq: "MCQ",
  short_answer: "Short",
  long_answer: "Long",
  numerical: "Numerical",
  fill_blank: "Fill Blank",
};

export const SOURCE_LABELS: Record<QuestionSource, string> = {
  ai_generated: "📚 AI Generated",
  faculty_imported: "Imported",
  pyq_inspired: "PYQ-Inspired",
};

export const DIFFICULTY_CLASSES: Record<Difficulty, string> = {
  easy: "border-emerald-400/40 bg-emerald-500/10 text-emerald-300",
  medium: "border-amber-400/40 bg-amber-500/10 text-amber-300",
  hard: "border-rose-400/40 bg-rose-500/10 text-rose-300",
};

export const QUESTION_TYPES: QuestionType[] = [
  "mcq",
  "short_answer",
  "long_answer",
  "numerical",
  "fill_blank",
];

/** Normalise a CO code for display, e.g. "2" / "CO2" / "02" → "CO2". */
export function formatCo(co: string | null | undefined): string {
  if (!co) return "";
  const n = String(co).replace(/^CO/i, "").replace(/^0+/, "");
  return `CO${n || "0"}`;
}

// ─── Filters ────────────────────────────────────────────────────────────────

export interface BankFilters {
  question_type: string;
  marks: string;
  co_code: string;
  btl_level: string;
  source: string;
  needs_review: boolean;
  search: string;
}

export const EMPTY_FILTERS: BankFilters = {
  question_type: "",
  marks: "",
  co_code: "",
  btl_level: "",
  source: "",
  needs_review: false,
  search: "",
};

// ─── Reference data shared across tabs ──────────────────────────────────────

export interface ModuleRef {
  id: string;
  name: string;
  module_number: number;
}

export interface CourseOutcomeRef {
  co_code: string;
  description: string;
}

export interface BankStats {
  total: number;
  verified: number;
  needsReview: number;
  byType: Record<QuestionType, number>;
  marks: number[];
}

/** A question staged into the manual "Paper Builder" panel. */
export interface StagedQuestion {
  id: string;
  question_text: string;
  question_type: QuestionType;
  marks: number;
}

// ─── REST client ────────────────────────────────────────────────────────────

export interface ListParams extends Partial<BankFilters> {
  subject_id: string;
  page?: number;
  per_page?: number;
}

export interface ListResponse {
  questions: BankQuestion[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

function buildFilterParams(params: Partial<BankFilters> & { subject_id: string }): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("subject_id", params.subject_id);
  if (params.question_type) sp.set("question_type", params.question_type);
  if (params.marks) sp.set("marks", params.marks);
  if (params.co_code) sp.set("co_code", params.co_code);
  if (params.btl_level) sp.set("btl_level", params.btl_level);
  if (params.source) sp.set("source", params.source);
  if (params.needs_review) sp.set("is_verified", "false");
  if (params.search) sp.set("search", params.search);
  return sp;
}

export async function listQuestions(params: ListParams): Promise<ListResponse> {
  const sp = buildFilterParams(params);
  if (params.page) sp.set("page", String(params.page));
  sp.set("per_page", String(params.per_page ?? 50));

  const res = await fetch(`/api/qbank/list?${sp.toString()}`);
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as ListResponse;
}

/** Fetch all IDs matching the current filter (up to 1000) for select-all-matching. */
export async function listQuestionIds(params: ListParams): Promise<string[]> {
  const sp = buildFilterParams(params);
  sp.set("ids_only", "true");

  const res = await fetch(`/api/qbank/list?${sp.toString()}`);
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { ids: string[] };
  return data.ids;
}

export interface BulkVerifyResult {
  verified: number;
  skipped: Array<{ id: string; question_text: string }>;
}

export async function bulkVerifyQuestions(ids: string[]): Promise<BulkVerifyResult> {
  const res = await fetch("/api/qbank/bulk-verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as BulkVerifyResult;
}

export async function patchQuestion(
  id: string,
  patch: Partial<BankQuestion>
): Promise<BankQuestion> {
  const res = await fetch(`/api/qbank/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { question: BankQuestion };
  return data.question;
}

export async function deleteQuestion(id: string): Promise<void> {
  const res = await fetch(`/api/qbank/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export interface GenerateResponse {
  added: number;
  questions: BankQuestion[];
}

export async function generateQuestions(
  subjectId: string,
  slots: GenerationSlot[],
  includePyq: boolean
): Promise<GenerateResponse> {
  const res = await fetch("/api/qbank/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject_id: subjectId,
      slots,
      include_pyq: includePyq,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as GenerateResponse;
}

export interface ImportResponse {
  total_parsed: number;
  added: number;
  skipped: number;
  needs_review: number;
  errors: string[];
  questions: BankQuestion[];
}

export async function importFile(
  subjectId: string,
  file: File
): Promise<ImportResponse> {
  const form = new FormData();
  form.set("subject_id", subjectId);
  form.set("file", file);
  const res = await fetch("/api/qbank/import", { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as ImportResponse;
}

/** Session key used to hand staged questions to the Q-paper builder. */
export const STAGING_KEY = "qbank:staged";

// ─── Manual question entry ────────────────────────────────────────────────────

export interface ManualQuestionPayload {
  subject_id: string;
  question_text: string;
  question_type: QuestionType;
  marks: number;
  model_answer?: string;
  options?: MCQOption[];
  module_id?: string;
  co_code?: string;
  btl_level?: number;
  difficulty?: Difficulty;
  /** Source to record in faculty_question_bank; defaults to "faculty_imported". */
  source?: "ai_generated" | "faculty_imported";
  /** Pre-uploaded image storage path (from draft-image) — skips re-upload. */
  image_path?: string;
  /** Base64-encoded image data (no data: prefix) — used when image_path is absent. */
  image_base64?: string;
  /** MIME type of the image, e.g. "image/jpeg". */
  image_mime?: string;
}

export async function addManualQuestion(
  payload: ManualQuestionPayload
): Promise<BankQuestion> {
  const res = await fetch("/api/qbank/add-manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { question: BankQuestion };
  return data.question;
}
