-- EduNexus AI - Initial Database Schema
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- 1. PROFILES (extends auth.users)
-- ============================================================================

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('superadmin', 'dept_admin', 'faculty', 'student')),
  department TEXT,
  branch TEXT,
  semester INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_department ON profiles(department);
CREATE INDEX idx_profiles_email ON profiles(email);

-- Trigger to auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 2. SUBJECTS
-- ============================================================================

CREATE TABLE subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  department TEXT NOT NULL,
  branch TEXT NOT NULL,
  semester INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subjects_department ON subjects(department);
CREATE INDEX idx_subjects_branch_semester ON subjects(branch, semester);

-- ============================================================================
-- 3. MODULES
-- ============================================================================

CREATE TABLE modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  module_number INTEGER NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(subject_id, module_number)
);

CREATE INDEX idx_modules_subject ON modules(subject_id);

-- ============================================================================
-- 4. EXAM_STRUCTURES
-- ============================================================================

CREATE TABLE exam_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  total_marks INTEGER NOT NULL,
  total_questions INTEGER NOT NULL,
  time_limit_minutes INTEGER NOT NULL,
  sections JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(subject_id)
);

CREATE INDEX idx_exam_structures_subject ON exam_structures(subject_id);

-- ============================================================================
-- 5. FACULTY_ASSIGNMENTS
-- ============================================================================

CREATE TABLE faculty_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(faculty_id, subject_id)
);

CREATE INDEX idx_faculty_assignments_faculty ON faculty_assignments(faculty_id);
CREATE INDEX idx_faculty_assignments_subject ON faculty_assignments(subject_id);

-- ============================================================================
-- 6. DOCUMENTS
-- ============================================================================

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID REFERENCES modules(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('syllabus', 'notes', 'pyq')),
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,
  year INTEGER,
  uploaded_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT documents_year_pyq CHECK (type != 'pyq' OR year IS NOT NULL)
);

CREATE INDEX idx_documents_module ON documents(module_id);
CREATE INDEX idx_documents_subject ON documents(subject_id);
CREATE INDEX idx_documents_type ON documents(type);
CREATE INDEX idx_documents_status ON documents(status);

-- ============================================================================
-- 7. DOCUMENT_CHUNKS (with vector embeddings)
-- ============================================================================

CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  embedding vector(768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(document_id, chunk_index)
);

CREATE INDEX idx_document_chunks_document ON document_chunks(document_id);
CREATE INDEX idx_document_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================================
-- 8. NOTE_CHANGE_REQUESTS
-- ============================================================================

CREATE TABLE note_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  current_doc_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  new_file_path TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_note_change_requests_subject ON note_change_requests(subject_id);
CREATE INDEX idx_note_change_requests_status ON note_change_requests(status);
CREATE INDEX idx_note_change_requests_requested_by ON note_change_requests(requested_by);

-- ============================================================================
-- 9. CHAT_SESSIONS
-- ============================================================================

CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  module_id UUID REFERENCES modules(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_sessions_student ON chat_sessions(student_id);
CREATE INDEX idx_chat_sessions_subject ON chat_sessions(subject_id);

-- ============================================================================
-- 10. CHAT_MESSAGES
-- ============================================================================

CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  citations JSONB DEFAULT '[]',
  tokens_used INTEGER DEFAULT 0,
  model_used TEXT,
  cost_inr DECIMAL(10, 6) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);

-- ============================================================================
-- 11. QUIZZES
-- ============================================================================

CREATE TABLE quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  questions JSONB NOT NULL DEFAULT '[]',
  generated_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quizzes_module ON quizzes(module_id);
CREATE INDEX idx_quizzes_subject ON quizzes(subject_id);

-- ============================================================================
-- 12. QUIZ_ATTEMPTS
-- ============================================================================

CREATE TABLE quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  answers JSONB NOT NULL DEFAULT '[]',
  score INTEGER NOT NULL DEFAULT 0,
  time_taken INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quiz_attempts_quiz ON quiz_attempts(quiz_id);
CREATE INDEX idx_quiz_attempts_student ON quiz_attempts(student_id);

-- ============================================================================
-- 13. GENERATED_CONTENT
-- ============================================================================

CREATE TABLE generated_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  module_id UUID REFERENCES modules(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('ppt', 'visual_notes', 'refined_notes', 'qpaper')),
  title TEXT NOT NULL,
  file_path TEXT,
  metadata JSONB DEFAULT '{}',
  generated_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tokens_used INTEGER DEFAULT 0,
  cost_inr DECIMAL(10, 6) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_generated_content_subject ON generated_content(subject_id);
CREATE INDEX idx_generated_content_module ON generated_content(module_id);
CREATE INDEX idx_generated_content_status ON generated_content(status);

-- ============================================================================
-- 14. SEMANTIC_CACHE (with vector embeddings)
-- ============================================================================

CREATE TABLE semantic_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  query_text TEXT NOT NULL,
  query_embedding vector(768) NOT NULL,
  response TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_semantic_cache_module ON semantic_cache(module_id);
CREATE INDEX idx_semantic_cache_query_embedding ON semantic_cache USING ivfflat (query_embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_semantic_cache_last_used ON semantic_cache(last_used_at);

-- ============================================================================
-- 15. USAGE_ANALYTICS
-- ============================================================================

CREATE TABLE usage_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 1,
  tokens_used INTEGER DEFAULT 0,
  cost_inr DECIMAL(10, 6) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(date, user_id, subject_id, event_type)
);

CREATE INDEX idx_usage_analytics_date ON usage_analytics(date);
CREATE INDEX idx_usage_analytics_user ON usage_analytics(user_id);
CREATE INDEX idx_usage_analytics_subject ON usage_analytics(subject_id);

-- ============================================================================
-- HELPER: Get subjects assigned to faculty
-- ============================================================================

CREATE OR REPLACE FUNCTION get_faculty_subject_ids(p_faculty_id UUID)
RETURNS SETOF UUID AS $$
  SELECT subject_id FROM faculty_assignments WHERE faculty_id = p_faculty_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- PROFILES: Users see own profile; admins see all
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles" ON profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
  );

CREATE POLICY "Admins can update all profiles" ON profiles
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
  );

-- SUBJECTS, MODULES, DOCUMENTS: Public read (RLS disabled - full access)
-- Per requirements: RLS not enabled on these tables; they are publicly readable.

-- EXAM_STRUCTURES
ALTER TABLE exam_structures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read exam_structures" ON exam_structures FOR SELECT USING (true);
CREATE POLICY "Admins and faculty manage exam_structures" ON exam_structures FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
  OR EXISTS (SELECT 1 FROM faculty_assignments fa WHERE fa.faculty_id = auth.uid() AND fa.subject_id = exam_structures.subject_id)
);

-- FACULTY_ASSIGNMENTS
ALTER TABLE faculty_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Faculty see own assignments" ON faculty_assignments FOR SELECT USING (faculty_id = auth.uid());
CREATE POLICY "Admins manage faculty_assignments" ON faculty_assignments FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);

-- DOCUMENT_CHUNKS (read with documents; write by admins/faculty)
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read document_chunks" ON document_chunks FOR SELECT USING (true);
CREATE POLICY "Faculty and admins manage document_chunks" ON document_chunks FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin', 'faculty'))
);

-- NOTE_CHANGE_REQUESTS
ALTER TABLE note_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students see own requests" ON note_change_requests FOR SELECT USING (requested_by = auth.uid());
CREATE POLICY "Students create requests" ON note_change_requests FOR INSERT WITH CHECK (requested_by = auth.uid());
CREATE POLICY "Faculty see requests for assigned subjects" ON note_change_requests FOR SELECT USING (
  subject_id IN (SELECT get_faculty_subject_ids(auth.uid()))
);
CREATE POLICY "Admins and faculty manage note_change_requests" ON note_change_requests FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
  OR subject_id IN (SELECT get_faculty_subject_ids(auth.uid()))
);

-- CHAT_SESSIONS
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students see own chat_sessions" ON chat_sessions FOR ALL USING (student_id = auth.uid());
CREATE POLICY "Faculty see chat_sessions for assigned subjects" ON chat_sessions FOR SELECT USING (
  subject_id IN (SELECT get_faculty_subject_ids(auth.uid()))
);
CREATE POLICY "Admins see all chat_sessions" ON chat_sessions FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);

-- CHAT_MESSAGES
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see chat_messages for own sessions" ON chat_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM chat_sessions cs WHERE cs.id = session_id AND cs.student_id = auth.uid())
);
CREATE POLICY "Students insert chat_messages for own sessions" ON chat_messages FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM chat_sessions cs WHERE cs.id = session_id AND cs.student_id = auth.uid())
);
CREATE POLICY "Faculty and admins see chat_messages" ON chat_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM chat_sessions cs JOIN faculty_assignments fa ON fa.subject_id = cs.subject_id WHERE cs.id = session_id AND fa.faculty_id = auth.uid())
  OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);

-- QUIZZES
ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read quizzes" ON quizzes FOR SELECT USING (true);
CREATE POLICY "Faculty manage quizzes for assigned subjects" ON quizzes FOR ALL USING (
  subject_id IN (SELECT get_faculty_subject_ids(auth.uid()))
);
CREATE POLICY "Admins manage all quizzes" ON quizzes FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);

-- QUIZ_ATTEMPTS
ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students see own quiz_attempts" ON quiz_attempts FOR SELECT USING (student_id = auth.uid());
CREATE POLICY "Students insert own quiz_attempts" ON quiz_attempts FOR INSERT WITH CHECK (student_id = auth.uid());
CREATE POLICY "Faculty see quiz_attempts for assigned subjects" ON quiz_attempts FOR SELECT USING (
  quiz_id IN (SELECT q.id FROM quizzes q WHERE q.subject_id IN (SELECT get_faculty_subject_ids(auth.uid())))
);
CREATE POLICY "Admins see all quiz_attempts" ON quiz_attempts FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);

-- GENERATED_CONTENT
ALTER TABLE generated_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Faculty see own generated_content" ON generated_content FOR SELECT USING (generated_by = auth.uid());
CREATE POLICY "Faculty manage generated_content for assigned subjects" ON generated_content FOR ALL USING (
  subject_id IN (SELECT get_faculty_subject_ids(auth.uid())) AND generated_by = auth.uid()
);
CREATE POLICY "Admins see all generated_content" ON generated_content FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);

-- SEMANTIC_CACHE (internal - faculty and admins)
ALTER TABLE semantic_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Faculty and admins manage semantic_cache" ON semantic_cache FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin', 'faculty'))
);
-- Service role can always access (for API usage)
CREATE POLICY "Service role full access semantic_cache" ON semantic_cache FOR ALL TO service_role USING (true);

-- USAGE_ANALYTICS
ALTER TABLE usage_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own usage_analytics" ON usage_analytics FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users insert own usage_analytics" ON usage_analytics FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins see all usage_analytics" ON usage_analytics FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER subjects_updated_at BEFORE UPDATE ON subjects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER modules_updated_at BEFORE UPDATE ON modules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER exam_structures_updated_at BEFORE UPDATE ON exam_structures
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER documents_updated_at BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER note_change_requests_updated_at BEFORE UPDATE ON note_change_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER chat_sessions_updated_at BEFORE UPDATE ON chat_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER generated_content_updated_at BEFORE UPDATE ON generated_content
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
