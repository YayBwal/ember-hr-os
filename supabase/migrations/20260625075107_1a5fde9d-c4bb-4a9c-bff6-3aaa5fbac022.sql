
DROP FUNCTION IF EXISTS public.compute_kpi_dashboard(date);

CREATE TABLE public.kpi_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  eligible_override boolean,
  bonus_override_mmk bigint,
  note text,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, period_month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kpi_overrides TO authenticated;
GRANT ALL ON public.kpi_overrides TO service_role;
ALTER TABLE public.kpi_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kpi_overrides org read" ON public.kpi_overrides FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.org_id = public.current_org_id()));
CREATE POLICY "kpi_overrides admin write" ON public.kpi_overrides FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER kpi_overrides_updated_at BEFORE UPDATE ON public.kpi_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.kpi_override_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  period_month date NOT NULL,
  field text NOT NULL,
  old_value text,
  new_value text,
  note text,
  changed_by uuid REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.kpi_override_audit TO authenticated;
GRANT ALL ON public.kpi_override_audit TO service_role;
ALTER TABLE public.kpi_override_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kpi_audit admin read" ON public.kpi_override_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "kpi_audit admin insert" ON public.kpi_override_audit FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.set_kpi_eligibility(_employee_id uuid, _period_month date, _eligible boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old boolean; v_period date := date_trunc('month', _period_month)::date;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = _employee_id AND org_id = public.current_org_id()) THEN
    RAISE EXCEPTION 'employee not found';
  END IF;
  SELECT eligible_override INTO v_old FROM public.kpi_overrides WHERE employee_id = _employee_id AND period_month = v_period;
  INSERT INTO public.kpi_overrides(employee_id, period_month, eligible_override, updated_by)
    VALUES (_employee_id, v_period, _eligible, auth.uid())
    ON CONFLICT (employee_id, period_month) DO UPDATE
      SET eligible_override = EXCLUDED.eligible_override, updated_by = auth.uid();
  INSERT INTO public.kpi_override_audit(employee_id, period_month, field, old_value, new_value, changed_by)
    VALUES (_employee_id, v_period, 'eligible_override', COALESCE(v_old::text,'(null)'), COALESCE(_eligible::text,'(null)'), auth.uid());
  PERFORM public.recompute_payroll(_employee_id, v_period);
END; $$;

CREATE OR REPLACE FUNCTION public.set_kpi_bonus_override(_employee_id uuid, _period_month date, _amount_mmk bigint, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old bigint; v_period date := date_trunc('month', _period_month)::date;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _amount_mmk IS NOT NULL AND _amount_mmk < 0 THEN RAISE EXCEPTION 'amount must be >= 0'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = _employee_id AND org_id = public.current_org_id()) THEN
    RAISE EXCEPTION 'employee not found';
  END IF;
  SELECT bonus_override_mmk INTO v_old FROM public.kpi_overrides WHERE employee_id = _employee_id AND period_month = v_period;
  INSERT INTO public.kpi_overrides(employee_id, period_month, bonus_override_mmk, note, updated_by)
    VALUES (_employee_id, v_period, _amount_mmk, _note, auth.uid())
    ON CONFLICT (employee_id, period_month) DO UPDATE
      SET bonus_override_mmk = EXCLUDED.bonus_override_mmk, note = EXCLUDED.note, updated_by = auth.uid();
  INSERT INTO public.kpi_override_audit(employee_id, period_month, field, old_value, new_value, note, changed_by)
    VALUES (_employee_id, v_period, 'bonus_override_mmk', COALESCE(v_old::text,'(null)'), COALESCE(_amount_mmk::text,'(null)'), _note, auth.uid());
  PERFORM public.recompute_payroll(_employee_id, v_period);
END; $$;

CREATE OR REPLACE FUNCTION public.compute_kpi_dashboard(_period_month date DEFAULT CURRENT_DATE)
 RETURNS TABLE(employee_id uuid, full_name text, department text, job_position text, level text, team_id uuid, employment_type text, base_salary_mmk bigint, task_completion_pct numeric, tasks_done integer, tasks_total integer, attendance_pct numeric, days_present integer, days_late integer, days_absent integer, working_hours numeric, kpi_score numeric, system_eligible boolean, eligible_override boolean, final_eligible boolean, system_bonus_mmk bigint, bonus_override_mmk bigint, final_bonus_mmk bigint, override_note text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
      LEAST(100, GREATEST(0, b.kpi_raw + b.adjv)) AS kpi_for_tier
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
        ELSE 0 END)::bigint AS sys_bonus
    FROM calc c
  )
  SELECT
    c.eid, c.full_name, c.dept, c.pos, c.lvl, c.team_id, c.etype, c.base_mmk,
    c.tcp, c.done_tasks, c.total_tasks, c.att, c.pres, c.lat, c.abs_d,
    ROUND((c.pres + c.lat*0.5)*8, 2),
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
END; $$;

CREATE OR REPLACE FUNCTION public.recompute_payroll(_employee_id uuid, _period date)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period_start DATE := date_trunc('month', _period)::date;
  v_base BIGINT; v_org UUID; v_kpi NUMERIC; v_bonus_pct NUMERIC;
  v_kpi_bonus BIGINT; v_extra_bonus BIGINT; v_deduction BIGINT;
  v_overtime BIGINT := 0; v_total BIGINT; v_completed INT; v_run_id UUID;
  v_adjust NUMERIC := 0; v_effective_kpi NUMERIC;
  v_emp_type TEXT; v_att NUMERIC; v_pres INT; v_late INT; v_logged INT;
  v_system_eligible BOOLEAN; v_eligible_ov BOOLEAN; v_bonus_ov BIGINT; v_final_eligible BOOLEAN;
BEGIN
  SELECT monthly_base_mmk, org_id, employment_type::text, attendance_pct INTO v_base, v_org, v_emp_type, v_att FROM public.employees WHERE id = _employee_id;
  IF v_base IS NULL THEN RETURN; END IF;
  SELECT kpi INTO v_kpi FROM public.employee_kpis WHERE employee_id = _employee_id AND period_month = v_period_start;
  IF v_kpi IS NULL THEN v_kpi := 0; END IF;
  SELECT COALESCE(SUM(kpi_adjustment), 0) INTO v_adjust FROM public.employee_promotions WHERE employee_id = _employee_id AND period_month = v_period_start;
  v_effective_kpi := LEAST(100, GREATEST(0, v_kpi + v_adjust));

  SELECT COUNT(*) FILTER (WHERE status='present'), COUNT(*) FILTER (WHERE status='late'), COUNT(*)
    INTO v_pres, v_late, v_logged
  FROM public.attendance WHERE employee_id = _employee_id AND date BETWEEN v_period_start AND (v_period_start + interval '1 month - 1 day')::date;
  IF v_logged > 0 THEN v_att := ((v_pres + v_late*0.5)::numeric / v_logged) * 100; END IF;

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
END; $$;
