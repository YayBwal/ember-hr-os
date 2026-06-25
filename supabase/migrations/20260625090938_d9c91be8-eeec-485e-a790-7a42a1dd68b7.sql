-- 1. Update recompute_payroll to compute overtime from worked hours
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
  SELECT monthly_base_mmk, org_id, employment_type::text, attendance_pct INTO v_base, v_org, v_emp_type, v_att FROM public.employees WHERE id = _employee_id;
  IF v_base IS NULL THEN RETURN; END IF;
  SELECT kpi INTO v_kpi FROM public.employee_kpis WHERE employee_id = _employee_id AND period_month = v_period_start;
  IF v_kpi IS NULL THEN v_kpi := 0; END IF;
  v_effective_kpi := LEAST(100, GREATEST(0, v_kpi));

  SELECT COUNT(*) FILTER (WHERE status='present'), COUNT(*) FILTER (WHERE status='late'), COUNT(*)
    INTO v_pres, v_late, v_logged
  FROM public.attendance WHERE employee_id = _employee_id AND date BETWEEN v_period_start AND (v_period_start + interval '1 month - 1 day')::date;
  IF v_logged > 0 THEN v_att := ((v_pres + v_late*0.5)::numeric / v_logged) * 100; END IF;

  -- Overtime: hours worked beyond 176/mo baseline, at 1.5x hourly rate
  v_worked_hours := (COALESCE(v_pres,0) + COALESCE(v_late,0) * 0.5) * 8;
  v_overtime_hours := GREATEST(0, v_worked_hours - 176);
  IF v_overtime_hours > 0 AND v_base > 0 THEN
    v_hourly_rate := v_base::numeric / 176;
    v_overtime := ROUND(v_hourly_rate * v_overtime_hours * 1.5)::bigint;
  END IF;

  v_system_eligible := CASE
    WHEN v_emp_type = 'remote' THEN v_kpi >= 75 AND COALESCE(v_att,0) >= 90
    ELSE v_kpi >= 80 AND COALESCE(v_att,0) >= 85 END;
  SELECT eligible_override, bonus_override_mmk INTO v_eligible_ov, v_bonus_ov FROM public.kpi_overrides WHERE employee_id = _employee_id AND period_month = v_period_start;
  v_final_eligible := COALESCE(v_eligible_ov, v_system_eligible);

  v_bonus_pct := CASE
    WHEN v_effective_kpi >= 95 THEN 0.20 WHEN v_effective_kpi >= 90 THEN 0.15
    WHEN v_effective_kpi >= 85 THEN 0.10 WHEN v_effective_kpi >= 80 THEN 0.05 ELSE 0 END;
  IF NOT v_final_eligible THEN v_kpi_bonus := 0;
  ELSE v_kpi_bonus := COALESCE(v_bonus_ov, (v_base * v_bonus_pct)::bigint); END IF;

  SELECT COALESCE(SUM(amount_mmk),0) INTO v_extra_bonus FROM public.bonuses WHERE employee_id = _employee_id AND period_month = v_period_start;
  SELECT COALESCE(SUM(amount_mmk),0) INTO v_deduction FROM public.deductions WHERE employee_id = _employee_id AND period_month = v_period_start;
  SELECT COUNT(*) INTO v_completed FROM public.tasks WHERE assignee_employee_id = _employee_id AND status = 'done' AND completed_at >= v_period_start AND completed_at < (v_period_start + interval '1 month');
  v_total := v_base + v_kpi_bonus + v_extra_bonus + v_overtime - v_deduction;

  SELECT id INTO v_run_id FROM public.payroll_runs WHERE org_id = v_org AND period_month = v_period_start;
  IF v_run_id IS NULL THEN INSERT INTO public.payroll_runs(org_id, period_month) VALUES (v_org, v_period_start) RETURNING id INTO v_run_id; END IF;

  IF EXISTS (SELECT 1 FROM public.payroll_lines WHERE run_id = v_run_id AND employee_id = _employee_id) THEN
    UPDATE public.payroll_lines SET base_mmk = v_base, performance_bonus_mmk = v_kpi_bonus, bonus_mmk = v_extra_bonus,
      deduction_mmk = v_deduction, overtime_mmk = v_overtime, kpi_snapshot = v_effective_kpi,
      total_mmk = v_total, tasks_completed = v_completed
    WHERE run_id = v_run_id AND employee_id = _employee_id;
  ELSE
    INSERT INTO public.payroll_lines(run_id, employee_id, base_mmk, performance_bonus_mmk, bonus_mmk, deduction_mmk, overtime_mmk, kpi_snapshot, total_mmk, tasks_completed)
    VALUES (v_run_id, _employee_id, v_base, v_kpi_bonus, v_extra_bonus, v_deduction, v_overtime, v_effective_kpi, v_total, v_completed);
  END IF;
  UPDATE public.payroll_runs SET total_mmk = (SELECT COALESCE(SUM(total_mmk),0) FROM public.payroll_lines WHERE run_id = v_run_id) WHERE id = v_run_id;
END; $function$;

-- 2. Remove auto recompute_payroll calls from triggers (keep KPI recompute live)
CREATE OR REPLACE FUNCTION public.trg_bd_recompute()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_emp UUID; v_period DATE;
BEGIN
  v_emp := COALESCE(NEW.employee_id, OLD.employee_id);
  v_period := COALESCE(NEW.period_month, OLD.period_month);
  IF v_emp IS NOT NULL THEN PERFORM public.recompute_employee_kpi(v_emp, v_period); END IF;
  RETURN COALESCE(NEW, OLD);
END; $function$;

CREATE OR REPLACE FUNCTION public.trg_kpi_payroll()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- KPI changes flow to Operations live; payroll lines update only on manual Recompute
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.trg_task_recompute()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_period DATE := CURRENT_DATE;
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.assignee_employee_id IS NOT NULL THEN
    PERFORM public.recompute_employee_kpi(NEW.assignee_employee_id, v_period);
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.assignee_employee_id IS NOT NULL AND OLD.assignee_employee_id IS DISTINCT FROM NEW.assignee_employee_id THEN
    PERFORM public.recompute_employee_kpi(OLD.assignee_employee_id, v_period);
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $function$;

CREATE OR REPLACE FUNCTION public.trg_attendance_recompute()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_emp UUID; v_period DATE; v_old_id UUID;
BEGIN
  v_emp := COALESCE(NEW.employee_id, OLD.employee_id);
  v_period := COALESCE(NEW.date, OLD.date);
  v_old_id := CASE WHEN TG_OP <> 'INSERT' THEN OLD.id ELSE NULL END;
  IF v_old_id IS NOT NULL THEN
    DELETE FROM public.deductions WHERE reason = 'attendance:' || v_old_id::text;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF NEW.status = 'absent' THEN
      INSERT INTO public.deductions(employee_id, period_month, amount_mmk, reason, source)
      SELECT NEW.employee_id, date_trunc('month', NEW.date)::date, (monthly_base_mmk / 22), 'attendance:' || NEW.id::text, 'absent'
      FROM public.employees WHERE id = NEW.employee_id;
    ELSIF NEW.status = 'late' AND NEW.minutes_late > 0 THEN
      INSERT INTO public.deductions(employee_id, period_month, amount_mmk, reason, source)
      SELECT NEW.employee_id, date_trunc('month', NEW.date)::date, LEAST((monthly_base_mmk / 22 / 8 / 60) * NEW.minutes_late, monthly_base_mmk / 22), 'attendance:' || NEW.id::text, 'late'
      FROM public.employees WHERE id = NEW.employee_id;
    END IF;
  END IF;
  PERFORM public.recompute_employee_kpi(v_emp, v_period);
  RETURN COALESCE(NEW, OLD);
END; $function$;

CREATE OR REPLACE FUNCTION public.trg_rating_recompute()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_period date;
BEGIN
  SELECT period_start INTO v_period FROM public.team_reports WHERE id = COALESCE(NEW.report_id, OLD.report_id);
  PERFORM public.recompute_employee_kpi(COALESCE(NEW.employee_id, OLD.employee_id), v_period);
  RETURN COALESCE(NEW, OLD);
END; $function$;

-- 3. Add overtime_hours to compute_kpi_dashboard
DROP FUNCTION IF EXISTS public.compute_kpi_dashboard(date);
CREATE OR REPLACE FUNCTION public.compute_kpi_dashboard(_period_month date DEFAULT CURRENT_DATE)
 RETURNS TABLE(employee_id uuid, full_name text, department text, job_position text, level text, team_id uuid, employment_type text, base_salary_mmk bigint, task_completion_pct numeric, tasks_done integer, tasks_total integer, attendance_pct numeric, days_present integer, days_late integer, days_absent integer, working_hours numeric, overtime_hours numeric, kpi_score numeric, system_eligible boolean, eligible_override boolean, final_eligible boolean, system_bonus_mmk bigint, bonus_override_mmk bigint, final_bonus_mmk bigint, override_note text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := public.current_org_id();
  v_start date := date_trunc('month', _period_month)::date;
  v_end date := (date_trunc('month', _period_month) + interval '1 month - 1 day')::date;
BEGIN
  RETURN QUERY
  WITH t AS (
    SELECT tk.assignee_employee_id AS eid,
           COUNT(*) FILTER (WHERE tk.status IN ('todo','in_progress','done')) AS total_tasks,
           COUNT(*) FILTER (WHERE tk.status='done') AS done_tasks
    FROM public.tasks tk
    WHERE tk.org_id = v_org AND tk.assignee_employee_id IS NOT NULL
      AND (tk.due_date BETWEEN v_start AND v_end
           OR (tk.completed_at >= v_start AND tk.completed_at < v_start + interval '1 month'))
    GROUP BY tk.assignee_employee_id
  ),
  a AS (
    SELECT att.employee_id AS eid,
           COUNT(*) FILTER (WHERE att.status='present') AS pres,
           COUNT(*) FILTER (WHERE att.status='late') AS lat,
           COUNT(*) FILTER (WHERE att.status='absent') AS abs_d,
           COUNT(*) AS logged
    FROM public.attendance att
    WHERE att.date BETWEEN v_start AND v_end
    GROUP BY att.employee_id
  ),
  adj AS (
    SELECT ep.employee_id AS eid, COALESCE(SUM(ep.kpi_adjustment),0) AS adj
    FROM public.employee_promotions ep WHERE ep.period_month = v_start GROUP BY ep.employee_id
  ),
  k AS (SELECT ek.employee_id AS eid, ek.kpi FROM public.employee_kpis ek WHERE ek.period_month = v_start),
  ov AS (SELECT o.employee_id AS eid, o.eligible_override, o.bonus_override_mmk, o.note FROM public.kpi_overrides o WHERE o.period_month = v_start),
  base AS (
    SELECT
      e.id AS eid, e.full_name, e.department::text AS dept, e.position::text AS pos, e.level::text AS lvl, e.team_id,
      e.employment_type::text AS etype, e.monthly_base_mmk AS base_mmk, e.attendance_pct AS emp_att, e.performance_score AS emp_perf,
      COALESCE(t.total_tasks,0)::int AS total_tasks, COALESCE(t.done_tasks,0)::int AS done_tasks,
      COALESCE(a.pres,0)::int AS pres, COALESCE(a.lat,0)::int AS lat, COALESCE(a.abs_d,0)::int AS abs_d, COALESCE(a.logged,0)::int AS logged,
      COALESCE(k.kpi, 0)::numeric AS kpi_raw, COALESCE(adj.adj,0)::numeric AS adjv,
      ov.eligible_override AS eligov, ov.bonus_override_mmk AS bonusov, ov.note AS notev
    FROM public.employees e
    LEFT JOIN t ON t.eid=e.id LEFT JOIN a ON a.eid=e.id LEFT JOIN adj ON adj.eid=e.id LEFT JOIN k ON k.eid=e.id LEFT JOIN ov ON ov.eid=e.id
    WHERE e.org_id = v_org
  ),
  calc AS (
    SELECT b.*,
      CASE WHEN b.total_tasks>0 THEN ROUND((b.done_tasks::numeric/b.total_tasks)*100,2) ELSE 0 END AS tcp,
      CASE WHEN b.logged>0 THEN ROUND(((b.pres + b.lat*0.5)::numeric/b.logged)*100,2) ELSE COALESCE(b.emp_att,0) END AS att,
      LEAST(99.99, GREATEST(0, b.kpi_raw + b.adjv)) AS kpi_final,
      LEAST(100, GREATEST(0, b.kpi_raw + b.adjv)) AS kpi_for_tier,
      ROUND((b.pres + b.lat*0.5)*8, 2) AS wh
    FROM base b
  ),
  calc2 AS (
    SELECT c.*,
      (CASE WHEN c.etype='remote' THEN c.kpi_raw >= 75 AND c.att >= 90 ELSE c.kpi_raw >= 80 AND c.att >= 85 END) AS sys_elig,
      (c.base_mmk * CASE
        WHEN c.kpi_for_tier >= 95 THEN 0.20
        WHEN c.kpi_for_tier >= 90 THEN 0.15
        WHEN c.kpi_for_tier >= 85 THEN 0.10
        WHEN c.kpi_for_tier >= 80 THEN 0.05
        ELSE 0 END)::bigint AS sys_bonus,
      GREATEST(0, c.wh - 176) AS ot_hrs
    FROM calc c
  )
  SELECT
    c.eid, c.full_name, c.dept, c.pos, c.lvl, c.team_id, c.etype, c.base_mmk,
    c.tcp, c.done_tasks, c.total_tasks, c.att, c.pres, c.lat, c.abs_d,
    c.wh, c.ot_hrs,
    c.kpi_final,
    c.sys_elig,
    c.eligov,
    COALESCE(c.eligov, c.sys_elig) AS final_eligible,
    c.sys_bonus,
    c.bonusov,
    CASE WHEN NOT COALESCE(c.eligov, c.sys_elig) THEN 0::bigint ELSE COALESCE(c.bonusov, c.sys_bonus) END AS final_bonus,
    c.notev
  FROM calc2 c
  ORDER BY c.full_name;
END; $function$;