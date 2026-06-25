
-- 1. Dedupe payroll_runs per (org_id, period_month): keep canonical row, repoint lines, delete dups.
DO $$
DECLARE r RECORD; v_keep UUID;
BEGIN
  FOR r IN
    SELECT org_id, period_month FROM public.payroll_runs
    GROUP BY org_id, period_month HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO v_keep FROM public.payroll_runs
     WHERE org_id = r.org_id AND period_month = r.period_month
     ORDER BY last_recomputed_at DESC NULLS LAST, created_at DESC NULLS LAST, id ASC
     LIMIT 1;

    -- For lines in duplicate runs that collide with a line already on the keeper, drop the duplicate line.
    DELETE FROM public.payroll_lines pl
     USING public.payroll_runs pr
     WHERE pl.run_id = pr.id
       AND pr.org_id = r.org_id AND pr.period_month = r.period_month
       AND pr.id <> v_keep
       AND EXISTS (
         SELECT 1 FROM public.payroll_lines k
          WHERE k.run_id = v_keep AND k.employee_id = pl.employee_id
       );

    -- Repoint remaining duplicate lines onto the canonical run.
    UPDATE public.payroll_lines pl
       SET run_id = v_keep
      FROM public.payroll_runs pr
     WHERE pl.run_id = pr.id
       AND pr.org_id = r.org_id AND pr.period_month = r.period_month
       AND pr.id <> v_keep;

    -- Delete the now-orphan duplicate runs.
    DELETE FROM public.payroll_runs
     WHERE org_id = r.org_id AND period_month = r.period_month AND id <> v_keep;

    -- Refresh totals on the keeper.
    UPDATE public.payroll_runs
       SET total_mmk = COALESCE((SELECT SUM(total_mmk) FROM public.payroll_lines WHERE run_id = v_keep), 0)
     WHERE id = v_keep;
  END LOOP;
END $$;

-- 2. Enforce uniqueness so this can never happen again.
ALTER TABLE public.payroll_runs
  ADD CONSTRAINT payroll_runs_org_period_unique UNIQUE (org_id, period_month);

-- 3. Harden recompute_payroll to use ON CONFLICT instead of SELECT-then-INSERT.
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
  v_effective_kpi NUMERIC;
  v_emp_type TEXT; v_att NUMERIC; v_pres INT; v_late INT; v_logged INT;
  v_system_eligible BOOLEAN; v_eligible_ov BOOLEAN; v_bonus_ov BIGINT; v_final_eligible BOOLEAN;
  v_worked_hours NUMERIC; v_overtime_hours NUMERIC; v_hourly_rate NUMERIC;
BEGIN
  SELECT monthly_base_mmk, org_id, employment_type::text, attendance_pct
    INTO v_base, v_org, v_emp_type, v_att
    FROM public.employees WHERE id = _employee_id;
  IF v_base IS NULL THEN RETURN; END IF;

  SELECT kpi INTO v_kpi FROM public.employee_kpis
    WHERE employee_id = _employee_id AND period_month = v_period_start;
  IF v_kpi IS NULL THEN v_kpi := 0; END IF;
  v_effective_kpi := LEAST(100, GREATEST(0, v_kpi));

  SELECT COUNT(*) FILTER (WHERE status='present'),
         COUNT(*) FILTER (WHERE status='late'),
         COUNT(*)
    INTO v_pres, v_late, v_logged
    FROM public.attendance
    WHERE employee_id = _employee_id
      AND date BETWEEN v_period_start AND (v_period_start + interval '1 month - 1 day')::date;
  IF v_logged > 0 THEN v_att := ((v_pres + v_late*0.5)::numeric / v_logged) * 100; END IF;

  v_worked_hours := (COALESCE(v_pres,0) + COALESCE(v_late,0) * 0.5) * 8;
  v_overtime_hours := GREATEST(0, v_worked_hours - 176);
  IF v_overtime_hours > 0 AND v_base > 0 THEN
    v_hourly_rate := v_base::numeric / 176;
    v_overtime := ROUND(v_hourly_rate * v_overtime_hours * 1.5)::bigint;
  END IF;

  v_system_eligible := CASE
    WHEN v_emp_type = 'remote' THEN v_kpi >= 75 AND COALESCE(v_att,0) >= 90
    ELSE v_kpi >= 80 AND COALESCE(v_att,0) >= 85 END;
  SELECT eligible_override, bonus_override_mmk
    INTO v_eligible_ov, v_bonus_ov
    FROM public.kpi_overrides
    WHERE employee_id = _employee_id AND period_month = v_period_start;
  v_final_eligible := COALESCE(v_eligible_ov, v_system_eligible);

  v_bonus_pct := CASE
    WHEN v_effective_kpi >= 95 THEN 0.20 WHEN v_effective_kpi >= 90 THEN 0.15
    WHEN v_effective_kpi >= 85 THEN 0.10 WHEN v_effective_kpi >= 80 THEN 0.05 ELSE 0 END;
  IF NOT v_final_eligible THEN v_kpi_bonus := 0;
  ELSE v_kpi_bonus := COALESCE(v_bonus_ov, (v_base * v_bonus_pct)::bigint); END IF;

  SELECT COALESCE(SUM(amount_mmk),0) INTO v_extra_bonus FROM public.bonuses
    WHERE employee_id = _employee_id AND period_month = v_period_start;
  SELECT COALESCE(SUM(amount_mmk),0) INTO v_deduction FROM public.deductions
    WHERE employee_id = _employee_id AND period_month = v_period_start;
  SELECT COUNT(*) INTO v_completed FROM public.tasks
    WHERE assignee_employee_id = _employee_id AND status = 'done'
      AND completed_at >= v_period_start AND completed_at < (v_period_start + interval '1 month');
  v_total := v_base + v_kpi_bonus + v_extra_bonus + v_overtime - v_deduction;

  INSERT INTO public.payroll_runs(org_id, period_month, last_recomputed_at)
    VALUES (v_org, v_period_start, now())
    ON CONFLICT (org_id, period_month) DO UPDATE
      SET last_recomputed_at = EXCLUDED.last_recomputed_at
    RETURNING id INTO v_run_id;

  IF EXISTS (SELECT 1 FROM public.payroll_lines WHERE run_id = v_run_id AND employee_id = _employee_id) THEN
    UPDATE public.payroll_lines SET base_mmk = v_base, performance_bonus_mmk = v_kpi_bonus, bonus_mmk = v_extra_bonus,
      deduction_mmk = v_deduction, overtime_mmk = v_overtime, kpi_snapshot = v_effective_kpi,
      total_mmk = v_total, tasks_completed = v_completed
    WHERE run_id = v_run_id AND employee_id = _employee_id;
  ELSE
    INSERT INTO public.payroll_lines(run_id, employee_id, base_mmk, performance_bonus_mmk, bonus_mmk, deduction_mmk, overtime_mmk, kpi_snapshot, total_mmk, tasks_completed)
    VALUES (v_run_id, _employee_id, v_base, v_kpi_bonus, v_extra_bonus, v_deduction, v_overtime, v_effective_kpi, v_total, v_completed);
  END IF;

  UPDATE public.payroll_runs
     SET total_mmk = (SELECT COALESCE(SUM(total_mmk),0) FROM public.payroll_lines WHERE run_id = v_run_id),
         last_recomputed_at = now()
   WHERE id = v_run_id;
END; $function$;
