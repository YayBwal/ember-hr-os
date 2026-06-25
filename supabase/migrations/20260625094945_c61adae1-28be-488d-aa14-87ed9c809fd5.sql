CREATE OR REPLACE FUNCTION public.recompute_payroll(_employee_id uuid, _period date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_period_start DATE := date_trunc('month', _period)::date;
  v_period_end   DATE := (date_trunc('month', _period) + interval '1 month - 1 day')::date;
  v_base BIGINT; v_org UUID;
  v_emp_type TEXT;
  v_kpi_raw NUMERIC := 0;
  v_kpi_adj NUMERIC := 0;
  v_effective_kpi NUMERIC := 0;
  v_bonus_pct NUMERIC := 0;
  v_kpi_bonus BIGINT := 0;
  v_extra_bonus BIGINT := 0;
  v_deduction BIGINT := 0;
  v_overtime BIGINT := 0;
  v_total BIGINT := 0;
  v_completed INT := 0;
  v_run_id UUID;
  v_present INT := 0; v_late INT := 0; v_absent INT := 0; v_logged INT := 0;
  v_att NUMERIC := 0;
  v_system_eligible BOOLEAN;
  v_eligible_ov BOOLEAN;
  v_bonus_ov BIGINT;
  v_final_eligible BOOLEAN;
  v_worked_hours NUMERIC := 0;
  v_overtime_hours NUMERIC := 0;
  v_hourly_rate NUMERIC := 0;
BEGIN
  SELECT monthly_base_mmk, org_id, employment_type::text
    INTO v_base, v_org, v_emp_type
    FROM public.employees WHERE id = _employee_id;
  IF v_base IS NULL THEN RETURN; END IF;
  v_base := COALESCE(v_base, 0);

  -- Raw KPI from monthly snapshot
  SELECT COALESCE(kpi, 0) INTO v_kpi_raw FROM public.employee_kpis
    WHERE employee_id = _employee_id AND period_month = v_period_start;
  v_kpi_raw := COALESCE(v_kpi_raw, 0);

  -- Sum any monthly KPI adjustments from promotions
  SELECT COALESCE(SUM(kpi_adjustment), 0) INTO v_kpi_adj
    FROM public.employee_promotions
    WHERE employee_id = _employee_id AND period_month = v_period_start;
  v_kpi_adj := COALESCE(v_kpi_adj, 0);

  v_effective_kpi := LEAST(100, GREATEST(0, v_kpi_raw + v_kpi_adj));

  -- Attendance with explicit defaults
  SELECT
    COALESCE(COUNT(*) FILTER (WHERE status='present'), 0),
    COALESCE(COUNT(*) FILTER (WHERE status='late'), 0),
    COALESCE(COUNT(*) FILTER (WHERE status='absent'), 0),
    COALESCE(COUNT(*), 0)
  INTO v_present, v_late, v_absent, v_logged
  FROM public.attendance
  WHERE employee_id = _employee_id
    AND date BETWEEN v_period_start AND v_period_end;

  v_present := COALESCE(v_present, 0);
  v_late := COALESCE(v_late, 0);
  v_logged := COALESCE(v_logged, 0);

  IF v_logged > 0 THEN
    v_att := ((v_present + v_late * 0.5)::numeric / v_logged) * 100;
  ELSE
    SELECT COALESCE(attendance_pct, 0) INTO v_att FROM public.employees WHERE id = _employee_id;
    v_att := COALESCE(v_att, 0);
  END IF;

  -- Overtime (explicit per requirement)
  v_worked_hours := (v_present + v_late * 0.5) * 8;
  v_overtime_hours := GREATEST(0, v_worked_hours - 176);
  IF v_overtime_hours > 0 AND v_base > 0 THEN
    v_hourly_rate := v_base::numeric / 176;
    v_overtime := ROUND(v_hourly_rate * v_overtime_hours * 1.5)::bigint;
  ELSE
    v_overtime := 0;
  END IF;

  -- Eligibility (matches KPI dashboard rules; uses effective KPI)
  v_system_eligible := CASE
    WHEN v_emp_type = 'remote' THEN v_effective_kpi >= 75 AND v_att >= 90
    ELSE v_effective_kpi >= 80 AND v_att >= 85
  END;

  SELECT eligible_override, bonus_override_mmk
    INTO v_eligible_ov, v_bonus_ov
    FROM public.kpi_overrides
    WHERE employee_id = _employee_id AND period_month = v_period_start;
  v_final_eligible := COALESCE(v_eligible_ov, v_system_eligible);

  -- Tier mapping on effective KPI
  v_bonus_pct := CASE
    WHEN v_effective_kpi >= 95 THEN 0.20
    WHEN v_effective_kpi >= 90 THEN 0.15
    WHEN v_effective_kpi >= 85 THEN 0.10
    WHEN v_effective_kpi >= 80 THEN 0.05
    ELSE 0
  END;

  IF v_bonus_ov IS NOT NULL THEN
    -- manual override always wins, but only when eligible
    v_kpi_bonus := CASE WHEN v_final_eligible THEN v_bonus_ov ELSE 0 END;
  ELSIF v_final_eligible THEN
    v_kpi_bonus := ROUND(v_base::numeric * v_bonus_pct)::bigint;
  ELSE
    v_kpi_bonus := 0;
  END IF;

  SELECT COALESCE(SUM(amount_mmk),0) INTO v_extra_bonus FROM public.bonuses
    WHERE employee_id = _employee_id AND period_month = v_period_start;
  SELECT COALESCE(SUM(amount_mmk),0) INTO v_deduction FROM public.deductions
    WHERE employee_id = _employee_id AND period_month = v_period_start;
  SELECT COALESCE(COUNT(*), 0) INTO v_completed FROM public.tasks
    WHERE assignee_employee_id = _employee_id AND status = 'done'
      AND completed_at >= v_period_start AND completed_at < (v_period_start + interval '1 month');

  v_total := v_base + v_kpi_bonus + v_extra_bonus + v_overtime - v_deduction;

  INSERT INTO public.payroll_runs(org_id, period_month, last_recomputed_at)
    VALUES (v_org, v_period_start, now())
    ON CONFLICT (org_id, period_month) DO UPDATE
      SET last_recomputed_at = EXCLUDED.last_recomputed_at
    RETURNING id INTO v_run_id;

  IF EXISTS (SELECT 1 FROM public.payroll_lines WHERE run_id = v_run_id AND employee_id = _employee_id) THEN
    UPDATE public.payroll_lines SET
      base_mmk = v_base,
      performance_bonus_mmk = v_kpi_bonus,
      bonus_mmk = v_extra_bonus,
      deduction_mmk = v_deduction,
      overtime_mmk = v_overtime,
      kpi_snapshot = v_effective_kpi,
      total_mmk = v_total,
      tasks_completed = v_completed
    WHERE run_id = v_run_id AND employee_id = _employee_id;
  ELSE
    INSERT INTO public.payroll_lines(
      run_id, employee_id, base_mmk, performance_bonus_mmk, bonus_mmk,
      deduction_mmk, overtime_mmk, kpi_snapshot, total_mmk, tasks_completed
    ) VALUES (
      v_run_id, _employee_id, v_base, v_kpi_bonus, v_extra_bonus,
      v_deduction, v_overtime, v_effective_kpi, v_total, v_completed
    );
  END IF;

  UPDATE public.payroll_runs
     SET total_mmk = (SELECT COALESCE(SUM(total_mmk),0) FROM public.payroll_lines WHERE run_id = v_run_id),
         last_recomputed_at = now()
   WHERE id = v_run_id;
END;
$function$;