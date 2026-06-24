
CREATE TYPE public.candidate_status_new AS ENUM (
  'sourcing','screening','hr_interview','technical_interview',
  'assessment','final_interview','offer','approved','hired','rejected'
);

ALTER TABLE public.candidates ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.candidates
  ALTER COLUMN status TYPE public.candidate_status_new
  USING (CASE status::text
    WHEN 'new' THEN 'sourcing'
    WHEN 'interview' THEN 'hr_interview'
    WHEN 'onboarded' THEN 'hired'
    ELSE status::text
  END)::public.candidate_status_new;

DROP TYPE public.candidate_status;
ALTER TYPE public.candidate_status_new RENAME TO candidate_status;

ALTER TABLE public.candidates
  ALTER COLUMN status SET DEFAULT 'sourcing'::public.candidate_status;

CREATE OR REPLACE FUNCTION public.approve_candidate(
  _candidate_id uuid,
  _department public.department,
  _position text,
  _monthly_base bigint,
  _team_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_cand RECORD; v_emp_id UUID;
BEGIN
  SELECT * INTO v_cand FROM public.candidates WHERE id = _candidate_id AND org_id = public.current_org_id();
  IF v_cand IS NULL THEN RAISE EXCEPTION 'candidate not found'; END IF;

  SELECT id INTO v_emp_id FROM public.employees WHERE candidate_id = _candidate_id;
  IF v_emp_id IS NULL THEN
    INSERT INTO public.employees(org_id, full_name, email, department, position, monthly_base_mmk, team_id, candidate_id, join_date)
    VALUES (v_cand.org_id, v_cand.full_name, v_cand.email, _department, _position, _monthly_base, _team_id, _candidate_id, CURRENT_DATE)
    RETURNING id INTO v_emp_id;
  END IF;

  IF _team_id IS NOT NULL THEN
    INSERT INTO public.team_members(team_id, employee_id) VALUES (_team_id, v_emp_id) ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.candidates SET status = 'hired' WHERE id = _candidate_id;
  RETURN v_emp_id;
END; $function$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'employees'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.employees';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'candidates'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.candidates';
  END IF;
END $$;
