
-- Enum for levels
DO $$ BEGIN
  CREATE TYPE public.employee_level AS ENUM ('junior','mid','senior','lead');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Add level to employees
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS level public.employee_level NOT NULL DEFAULT 'junior';

-- Salary bands on organizations (MMK)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS salary_bands jsonb NOT NULL DEFAULT '{
    "junior": {"min": 300000,  "max": 700000},
    "mid":    {"min": 700000,  "max": 1500000},
    "senior": {"min": 1500000, "max": 3000000},
    "lead":   {"min": 3000000, "max": 6000000}
  }'::jsonb;

-- Promotion history
CREATE TABLE IF NOT EXISTS public.employee_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  from_level public.employee_level,
  to_level public.employee_level NOT NULL,
  from_base_mmk bigint,
  to_base_mmk bigint NOT NULL,
  from_position text,
  to_position text NOT NULL,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_promotions TO authenticated;
GRANT ALL ON public.employee_promotions TO service_role;

ALTER TABLE public.employee_promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members manage promotions" ON public.employee_promotions;
CREATE POLICY "org members manage promotions" ON public.employee_promotions
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

CREATE INDEX IF NOT EXISTS idx_emp_promotions_emp ON public.employee_promotions(employee_id, effective_date DESC);

-- RPC: promote_employee
CREATE OR REPLACE FUNCTION public.promote_employee(
  _employee_id uuid,
  _to_level public.employee_level,
  _to_position text,
  _to_base_mmk bigint,
  _effective_date date DEFAULT CURRENT_DATE,
  _note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_emp RECORD;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _to_base_mmk < 0 THEN RAISE EXCEPTION 'salary must be >= 0'; END IF;

  SELECT * INTO v_emp FROM public.employees
   WHERE id = _employee_id AND org_id = public.current_org_id();
  IF v_emp IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  INSERT INTO public.employee_promotions(
    employee_id, org_id, from_level, to_level,
    from_base_mmk, to_base_mmk, from_position, to_position,
    effective_date, note, created_by
  ) VALUES (
    _employee_id, v_emp.org_id, v_emp.level, _to_level,
    v_emp.monthly_base_mmk, _to_base_mmk, v_emp.position, _to_position,
    _effective_date, _note, auth.uid()
  ) RETURNING id INTO v_id;

  UPDATE public.employees
     SET level = _to_level,
         position = _to_position,
         monthly_base_mmk = _to_base_mmk
   WHERE id = _employee_id;

  PERFORM public.recompute_payroll(_employee_id, _effective_date);
  RETURN v_id;
END; $$;

-- Update approve_candidate to seed baseline promotion row
CREATE OR REPLACE FUNCTION public.approve_candidate(
  _candidate_id uuid,
  _department department,
  _position text,
  _monthly_base bigint,
  _team_id uuid DEFAULT NULL::uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_cand RECORD; v_emp_id UUID; v_new boolean := false;
BEGIN
  SELECT * INTO v_cand FROM public.candidates WHERE id = _candidate_id AND org_id = public.current_org_id();
  IF v_cand IS NULL THEN RAISE EXCEPTION 'candidate not found'; END IF;

  SELECT id INTO v_emp_id FROM public.employees WHERE candidate_id = _candidate_id;
  IF v_emp_id IS NULL THEN
    INSERT INTO public.employees(org_id, full_name, email, department, position, monthly_base_mmk, team_id, candidate_id, join_date, level)
    VALUES (v_cand.org_id, v_cand.full_name, v_cand.email, _department, _position, _monthly_base, _team_id, _candidate_id, CURRENT_DATE, 'junior')
    RETURNING id INTO v_emp_id;
    v_new := true;
  END IF;

  IF _team_id IS NOT NULL THEN
    INSERT INTO public.team_members(team_id, employee_id) VALUES (_team_id, v_emp_id) ON CONFLICT DO NOTHING;
  END IF;

  IF v_new THEN
    INSERT INTO public.employee_promotions(
      employee_id, org_id, from_level, to_level,
      from_base_mmk, to_base_mmk, from_position, to_position,
      effective_date, note, created_by
    ) VALUES (
      v_emp_id, v_cand.org_id, NULL, 'junior',
      NULL, _monthly_base, NULL, _position,
      CURRENT_DATE, 'Hired', auth.uid()
    );
  END IF;

  UPDATE public.candidates SET status = 'hired' WHERE id = _candidate_id;
  RETURN v_emp_id;
END; $$;
