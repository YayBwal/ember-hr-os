
-- 1. Delete any currently-rejected candidates
DELETE FROM public.candidates WHERE status::text = 'rejected';

-- 2. Build the new 4-value enum
CREATE TYPE public.candidate_status_v2 AS ENUM ('screening', 'interview', 'hired', 'rejected');

-- 3. Drop default, swap column type with mapping
ALTER TABLE public.candidates ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.candidates
  ALTER COLUMN status TYPE public.candidate_status_v2
  USING (CASE status::text
    WHEN 'sourcing' THEN 'screening'
    WHEN 'screening' THEN 'screening'
    WHEN 'hr_interview' THEN 'interview'
    WHEN 'technical_interview' THEN 'interview'
    WHEN 'assessment' THEN 'interview'
    WHEN 'final_interview' THEN 'interview'
    WHEN 'offer' THEN 'interview'
    WHEN 'approved' THEN 'interview'
    WHEN 'hired' THEN 'hired'
    ELSE 'screening'
  END)::public.candidate_status_v2;

-- 4. Replace old enum
DROP TYPE public.candidate_status;
ALTER TYPE public.candidate_status_v2 RENAME TO candidate_status;

ALTER TABLE public.candidates
  ALTER COLUMN status SET DEFAULT 'screening'::public.candidate_status;

-- 5. Auto-delete on reject
CREATE OR REPLACE FUNCTION public.candidates_delete_on_reject()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'rejected'::public.candidate_status THEN
    DELETE FROM public.candidates WHERE id = NEW.id;
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_candidates_delete_on_reject ON public.candidates;
CREATE TRIGGER trg_candidates_delete_on_reject
AFTER UPDATE OF status ON public.candidates
FOR EACH ROW EXECUTE FUNCTION public.candidates_delete_on_reject();
