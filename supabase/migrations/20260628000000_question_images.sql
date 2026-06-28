-- ============================================================================
-- Question images support
--
-- Adds image_path to faculty_question_bank so faculty can optionally attach
-- an illustration to a manually-entered question.  Images are stored in the
-- private `question-images` bucket under {faculty_id}/{uuid}.{ext}.
-- Signed URLs are minted server-side (admin client) on every list/add call;
-- the client only ever sees a short-lived URL, never the storage path.
-- ============================================================================

ALTER TABLE faculty_question_bank ADD COLUMN IF NOT EXISTS image_path text;

-- ─── Storage bucket ─────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('question-images', 'question-images', false)
ON CONFLICT (id) DO NOTHING;

-- ─── Storage RLS ─────────────────────────────────────────────────────────────
-- Authenticated users can only access objects whose first path segment matches
-- their own auth.uid() — mirrors the explainer bucket's path convention
-- ({ownerId}/{id}.ext).  All server-side access goes through the service role
-- (admin client) and bypasses these checks; these policies are defence-in-depth
-- against direct browser storage calls.

DROP POLICY IF EXISTS "question_images_insert" ON storage.objects;
CREATE POLICY "question_images_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'question-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "question_images_select" ON storage.objects;
CREATE POLICY "question_images_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'question-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "question_images_delete" ON storage.objects;
CREATE POLICY "question_images_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'question-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
