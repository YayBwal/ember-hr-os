ALTER TYPE public.candidate_status ADD VALUE IF NOT EXISTS 'trainee' BEFORE 'hired';

ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS trainee_salary_mmk bigint;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS default_trainee_salary_mmk bigint NOT NULL DEFAULT 500000;

CREATE OR REPLACE FUNCTION public.set_org_default_trainee_salary(_amount bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _amount < 0 THEN RAISE EXCEPTION 'amount must be >= 0'; END IF;
  UPDATE public.organizations SET default_trainee_salary_mmk = _amount
   WHERE id = public.current_org_id();
END; $$;