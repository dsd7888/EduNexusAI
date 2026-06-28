/**
 * Core types for the faculty Q Bank feature.
 *
 * Mirrors the `faculty_question_bank` table
 * (supabase/migrations/20260603000000_faculty_question_bank.sql) plus the
 * request/result shapes used by AI generation, CSV import, and AI tagging.
 */

export type QuestionType =
  | "mcq"
  | "short_answer"
  | "long_answer"
  | "numerical"
  | "fill_blank";

export type QuestionSource =
  | "ai_generated"
  | "faculty_imported"
  | "pyq_inspired";

export type Difficulty = "easy" | "medium" | "hard";

export interface MCQOption {
  label: "A" | "B" | "C" | "D";
  text: string;
  is_correct: boolean;
}

/** A persisted question row, as returned from `faculty_question_bank`. */
export interface BankQuestion {
  id: string;
  subject_id: string;
  faculty_id: string;
  module_id: string | null;
  question_text: string;
  question_type: QuestionType;
  marks: number;
  model_answer: string | null;
  options: MCQOption[] | null;
  co_code: string | null;
  btl_level: number | null;
  po_codes: string[];
  difficulty: Difficulty | null;
  source: QuestionSource;
  is_verified: boolean;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  /** Signed URL minted server-side per request; never stored in DB. */
  image_url?: string | null;
}

/** A single requested batch of AI-generated questions. */
export interface GenerationSlot {
  question_type: QuestionType;
  marks: number;
  count: number;
  module_id?: string; // if null, any module
  co_code?: string; // if null, any CO
  btl_level?: number; // if null, any BTL
  difficulty?: Difficulty;
  style: "fresh" | "pyq_inspired";
  // pyq_inspired: generate questions SIMILAR to PYQs
  //   (same concept, different values/context)
  // fresh: purely AI-generated from syllabus
}

/** One row parsed from a faculty CSV import. */
export interface ImportedQuestion {
  question_text: string;
  question_type: QuestionType;
  marks: number;
  model_answer?: string;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  correct_option?: "A" | "B" | "C" | "D";
  co_code?: string; // optional -- AI will infer if missing
  btl_level?: number; // optional -- AI will infer if missing
  module_name?: string; // optional -- fuzzy matched to modules table
  difficulty?: Difficulty;
}

/** Outcome of a generation or import batch. */
export interface BankOperationResult {
  added: number;
  failed: number;
  needs_tagging: BankQuestion[];
  // Questions that need CO/BTL inference before being finalized
  errors: string[];
}
