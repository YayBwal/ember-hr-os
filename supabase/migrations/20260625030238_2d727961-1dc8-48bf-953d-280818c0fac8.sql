-- Add trainee level
ALTER TYPE public.employee_level ADD VALUE IF NOT EXISTS 'trainee' BEFORE 'junior';

-- Add columns to employee_promotions
ALTER TABLE public.employee_promotions
  ADD COLUMN IF NOT EXISTS kpi_adjustment numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS period_month date;

-- Backfill period_month from effective_date
UPDATE public.employee_promotions
  SET period_month = date_trunc('month', effective_date)::date
  WHERE period_month IS NULL;

CREATE INDEX IF NOT EXISTS idx_emp_promotions_emp_period
  ON public.employee_promotions(employee_id, period_month);

-- Update promote_employee to accept kpi_adjustment and require note
CREATE OR REPLACE FUNCTION public.promote_employee(
  _employee_id uuid,
  _to_level employee_level,
  _to_position text,
  _to_base_mmk bigint,
  _effective_date date DEFAULT CURRENT_DATE,
  _note text DEFAULT NULL::text,
  _kpi_adjustment numeric DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_emp RECORD;
  v_id uuid;
  v_adj numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _to_base_mmk < 0 THEN RAISE EXCEPTION 'salary must be >= 0'; END IF;
  IF _note IS NULL OR length(trim(_note)) = 0 THEN RAISE EXCEPTION 'reason required'; END IF;

  v_adj := GREATEST(-50, LEAST(50, COALESCE(_kpi_adjustment, 0)));

  SELECT * INTO v_emp FROM public.employees
   WHERE id = _employee_id AND org_id = public.current_org_id();
  IF v_emp IS NULL THEN RAISE EXCEPTION 'employee not found'; END IF;

  INSERT INTO public.employee_promotions(
    employee_id, org_id, from_level, to_level,
    from_base_mmk, to_base_mmk, from_position, to_position,
    effective_date, note, created_by, kpi_adjustment, period_month
  ) VALUES (
    _employee_id, v_emp.org_id, v_emp.level, _to_level,
    v_emp.monthly_base_mmk, _to_base_mmk, v_emp.position, _to_position,
    _effective_date, _note, auth.uid(), v_adj, date_trunc('month', _effective_date)::date
  ) RETURNING id INTO v_id;

  UPDATE public.employees
     SET level = _to_level,
         position = _to_position,
         monthly_base_mmk = _to_base_mmk
   WHERE id = _employee_id;

  PERFORM public.recompute_employee_kpi(_employee_id, _effective_date);
  PERFORM public.recompute_payroll(_employee_id, _effective_date);
  RETURN v_id;
END;
$function$;

-- Update recompute_payroll to apply kpi_adjustment from promotion sessions
CREATE OR REPLACE FUNCTION public.recompute_payroll(_employee_id uuid, _period date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_period_start DATE := date_trunc('month', _period)::date;
  v_base BIGINT; v_org UUID; v_kpi NUMERIC; v_bonus_pct NUMERIC;
  v_kpi_bonus BIGINT; v_extra_bonus BIGINT; v_deduction BIGINT;
  v_overtime BIGINT := 0; v_total BIGINT; v_completed INT; v_run_id UUID;
  v_adjust NUMERIC := 0; v_effective_kpi NUMERIC;
BEGIN
  SELECT monthly_base_mmk, org_id INTO v_base, v_org FROM public.employees WHERE id = _employee_id;
  IF v_base IS NULL THEN RETURN; END IF;
  SELECT kpi INTO v_kpi FROM public.employee_kpis WHERE employee_id = _employee_id AND period_month = v_period_start;
  IF v_kpi IS NULL THEN v_kpi := 0; END IF;

  SELECT COALESCE(SUM(kpi_adjustment), 0) INTO v_adjust
    FROM public.employee_promotions
    WHERE employee_id = _employee_id AND period_month = v_period_start;

  v_effective_kpi := LEAST(100, GREATEST(0, v_kpi + v_adjust));

  v_bonus_pct := CASE
    WHEN v_effective_kpi >= 95 THEN 0.20
    WHEN v_effective_kpi >= 90 THEN 0.15
    WHEN v_effective_kpi >= 85 THEN 0.10
    WHEN v_effective_kpi >= 80 THEN 0.05
    ELSE 0 END;
  v_kpi_bonus := (v_base * v_bonus_pct)::bigint;
  SELECT COALESCE(SUM(amount_mmk),0) INTO v_extra_bonus FROM public.bonuses WHERE employee_id = _employee_id AND period_month = v_period_start;
  SELECT COALESCE(SUM(amount_mmk),0) INTO v_deduction FROM public.deductions WHERE employee_id = _employee_id AND period_month = v_period_start;
  SELECT COUNT(*) INTO v_completed FROM public.tasks
    WHERE assignee_employee_id = _employee_id AND status = 'done'
      AND completed_at >= v_period_start AND completed_at < (v_period_start + interval '1 month');
  v_total := v_base + v_kpi_bonus + v_extra_bonus + v_overtime - v_deduction;

  SELECT id INTO v_run_id FROM public.payroll_runs WHERE org_id = v_org AND period_month = v_period_start;
  IF v_run_id IS NULL THEN
    INSERT INTO public.payroll_runs(org_id, period_month) VALUES (v_org, v_period_start) RETURNING id INTO v_run_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.payroll_lines WHERE run_id = v_run_id AND employee_id = _employee_id) THEN
    UPDATE public.payroll_lines SET
      base_mmk = v_base, performance_bonus_mmk = v_kpi_bonus, bonus_mmk = v_extra_bonus,
      deduction_mmk = v_deduction, overtime_mmk = v_overtime, kpi_snapshot = v_effective_kpi,
      total_mmk = v_total, tasks_completed = v_completed
    WHERE run_id = v_run_id AND employee_id = _employee_id;
  ELSE
    INSERT INTO public.payroll_lines(run_id, employee_id, base_mmk, performance_bonus_mmk, bonus_mmk, deduction_mmk, overtime_mmk, kpi_snapshot, total_mmk, tasks_completed)
    VALUES (v_run_id, _employee_id, v_base, v_kpi_bonus, v_extra_bonus, v_deduction, v_overtime, v_effective_kpi, v_total, v_completed);
  END IF;

  UPDATE public.payroll_runs SET total_mmk = (SELECT COALESCE(SUM(total_mmk),0) FROM public.payroll_lines WHERE run_id = v_run_id) WHERE id = v_run_id;
END;
$function$;