
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS cv_storage_path text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS telegram_chat_id bigint;

CREATE INDEX IF NOT EXISTS candidates_telegram_chat_id_idx
  ON public.candidates(telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

-- Storage RLS for the candidate-cvs bucket (bucket created via storage tool)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='hr_read_candidate_cvs'
  ) THEN
    CREATE POLICY hr_read_candidate_cvs
      ON storage.objects FOR SELECT
      TO authenticated
      USING (bucket_id = 'candidate-cvs');
  END IF;
END$$;
