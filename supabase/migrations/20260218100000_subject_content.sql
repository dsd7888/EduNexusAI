-- subject_content: syllabus text and reference books per subject
CREATE TABLE subject_content (
  subject_id UUID PRIMARY KEY REFERENCES subjects(id) ON DELETE CASCADE,
  content TEXT DEFAULT '',
  reference_books TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER subject_content_updated_at BEFORE UPDATE ON subject_content
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Public read for RAG/chat; admins manage
ALTER TABLE subject_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read subject_content" ON subject_content FOR SELECT USING (true);
CREATE POLICY "Admins manage subject_content" ON subject_content FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('superadmin', 'dept_admin'))
);
