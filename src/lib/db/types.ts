// ============================================================================
// Enum-like types matching database CHECK constraints
// ============================================================================

export type UserRole = "superadmin" | "dept_admin" | "faculty" | "student";

export type DocumentType = "syllabus" | "notes" | "pyq";

export type DocumentStatus = "processing" | "ready" | "failed" | "archived";

export type ChangeRequestStatus = "pending" | "approved" | "rejected";

export type GeneratedContentType = "ppt" | "visual_notes" | "refined_notes" | "qpaper";

export type GeneratedContentStatus = "pending" | "completed" | "failed";

export type ChatMessageRole = "user" | "assistant" | "system";

export type QuizDifficulty = "easy" | "medium" | "hard";

// ============================================================================
// JSONB structures
// ============================================================================

export interface ExamSection {
  type?: string;
  name?: string;
  marks?: number;
  count?: number;
}

export interface Citation {
  document_id?: string;
  chunk_id?: string;
  page?: number;
  snippet?: string;
}

export interface QuizQuestion {
  id?: string;
  question?: string;
  options?: string[];
  correct_answer?: string | number;
  marks?: number;
}

export interface QuizAnswer {
  question_id?: string;
  answer?: string | number;
}

// ============================================================================
// Table types
// ============================================================================

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  department: string | null;
  branch: string | null;
  semester: number | null;
  created_at: string;
  updated_at: string;
}

export interface Subject {
  id: string;
  name: string;
  code: string;
  department: string;
  branch: string;
  semester: number;
  created_at: string;
  updated_at: string;
}

export interface Module {
  id: string;
  subject_id: string;
  name: string;
  module_number: number;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExamStructure {
  id: string;
  subject_id: string;
  total_marks: number;
  total_questions: number;
  time_limit_minutes: number;
  sections: ExamSection[];
  created_at: string;
  updated_at: string;
}

export interface FacultyAssignment {
  id: string;
  faculty_id: string;
  subject_id: string;
  assigned_by: string;
  assigned_at: string;
}

export interface Document {
  id: string;
  module_id: string | null;
  subject_id: string;
  type: DocumentType;
  title: string;
  file_path: string;
  year: number | null;
  uploaded_by: string;
  status: DocumentStatus;
  created_at: string;
  updated_at: string;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  content: string;
  page_number: number;
  chunk_index: number;
  embedding: number[] | null;
  created_at: string;
}

export interface NoteChangeRequest {
  id: string;
  subject_id: string;
  module_id: string;
  requested_by: string;
  reviewed_by: string | null;
  current_doc_id: string | null;
  new_file_path: string;
  reason: string;
  status: ChangeRequestStatus;
  admin_comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatSession {
  id: string;
  student_id: string;
  subject_id: string;
  module_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: ChatMessageRole;
  content: string;
  citations: Citation[];
  tokens_used: number;
  model_used: string | null;
  cost_inr: number;
  created_at: string;
}

export interface Quiz {
  id: string;
  module_id: string;
  subject_id: string;
  title: string;
  difficulty: QuizDifficulty;
  questions: QuizQuestion[];
  generated_by: string;
  created_at: string;
}

export interface QuizAttempt {
  id: string;
  quiz_id: string;
  student_id: string;
  answers: QuizAnswer[];
  score: number;
  time_taken: number | null;
  created_at: string;
}

export interface GeneratedContent {
  id: string;
  subject_id: string;
  module_id: string | null;
  type: GeneratedContentType;
  title: string;
  file_path: string | null;
  metadata: Record<string, unknown>;
  generated_by: string;
  tokens_used: number;
  cost_inr: number;
  status: GeneratedContentStatus;
  created_at: string;
  updated_at: string;
}

export interface SemanticCache {
  id: string;
  module_id: string;
  query_text: string;
  query_embedding: number[];
  response: string;
  hit_count: number;
  last_used_at: string;
  created_at: string;
}

export interface UsageAnalytics {
  id: string;
  date: string;
  user_id: string;
  subject_id: string;
  event_type: string;
  event_count: number;
  tokens_used: number | null;
  cost_inr: number | null;
  created_at: string;
}
