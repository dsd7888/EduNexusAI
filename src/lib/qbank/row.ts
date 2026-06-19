/**
 * Maps a raw `faculty_question_bank` row to the API-facing BankQuestion shape.
 * Centralised so every route returns identically-normalised questions (chiefly
 * coercing the nullable `po_codes` text[] column to a non-null string[]).
 */

import type {
  BankQuestion,
  Difficulty,
  MCQOption,
  QuestionSource,
  QuestionType,
} from "./types";

export interface FqbRow {
  id: string;
  subject_id: string;
  faculty_id: string;
  module_id: string | null;
  question_text: string;
  question_type: string;
  marks: number | string;
  model_answer: string | null;
  options: unknown;
  co_code: string | null;
  btl_level: number | null;
  po_codes: string[] | null;
  difficulty: string | null;
  source: string;
  is_verified: boolean;
  usage_count: number | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToBankQuestion(row: FqbRow): BankQuestion {
  return {
    id: row.id,
    subject_id: row.subject_id,
    faculty_id: row.faculty_id,
    module_id: row.module_id,
    question_text: row.question_text,
    question_type: row.question_type as QuestionType,
    marks: Number(row.marks),
    model_answer: row.model_answer,
    options: (row.options as MCQOption[] | null) ?? null,
    co_code: row.co_code,
    btl_level: row.btl_level,
    po_codes: row.po_codes ?? [],
    difficulty: (row.difficulty as Difficulty | null) ?? null,
    source: row.source as QuestionSource,
    is_verified: row.is_verified,
    usage_count: row.usage_count ?? 0,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
