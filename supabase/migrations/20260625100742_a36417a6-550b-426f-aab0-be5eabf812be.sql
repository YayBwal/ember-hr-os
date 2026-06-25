CREATE OR REPLACE FUNCTION public.recompute_employee_kpi(_employee_id uuid, _period date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_period_start date := date_trunc('month', _period)::date;
  v_period_end   date := (date_trunc('month', _period) + interval '1 month - 1 day')::date;
  v_done int;
  v_total int;
  v_task_completion numeric := 0;
  v_present int; v_late int; v_logged int;
  v_attendance numeric := 100;
  v_tl_prod numeric; v_tl_qual numeric; v_tl_avg numeric;
  v_objective numeric;
  v_clamped numeric;
  v_kpi numeric;
BEGIN
  -- Count tasks: done tasks count toward completion; total includes all task statuses
  -- in the period (by due_date) OR completed in the period (by completed_at).
  SELECT
    COUNT(*) FILTER (WHERE status = 'done'),
    COUNT(*)
  INTO v_done, v_total
  FROM public.tasks
  WHERE assignee_employee_id = _employee_id
    AND (
      (due_date BETWEEN v_period_start AND v_period_end)
      OR (completed_at >= v_period_start AND completed_at < (v_period_start + interval '1 month'))
    );
  IF v_total > 0 THEN
    v_task_completion := (v_done::numeric / v_total) * 100;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE status='present'),
    COUNT(*) FILTER (WHERE status='late'),
    COUNT(*)
  INTO v_present, v_late, v_logged
  FROM public.attendance
  WHERE employee_id = _employee_id
    AND date BETWEEN v_period_start AND v_period_end;
  IF v_logged > 0 THEN
    v_attendance := ((v_present + (v_late * 0.5))::numeric / v_logged) * 100;
  END IF;

  SELECT mr.productivity, mr.quality
  INTO v_tl_prod, v_tl_qual
  FROM public.member_ratings mr
  JOIN public.team_reports tr ON tr.id = mr.report_id
  WHERE mr.employee_id = _employee_id
    AND tr.status = 'submitted'
    AND tr.period_start <= v_period_end
    AND tr.period_end   >= v_period_start
  ORDER BY tr.period_start DESC
  LIMIT 1;

  v_objective := (v_task_completion * 0.60) + (v_attendance * 0.40);

  IF v_tl_prod IS NOT NULL THEN
    v_tl_avg := (v_tl_prod + COALESCE(v_tl_qual, v_tl_prod)) / 2.0;
    v_clamped := LEAST(v_tl_avg, v_objective + 15);
    v_kpi := (v_objective * 0.75) + (v_clamped * 0.25);
  ELSE
    v_kpi := v_objective;
  END IF;
  v_kpi := LEAST(GREATEST(v_kpi, 0), 99.99);

  INSERT INTO public.employee_kpis(employee_id, period_month, task_completion, productivity, quality, attendance, kpi)
  VALUES (_employee_id, v_period_start, v_task_completion, 80, 80, v_attendance, v_kpi)
  ON CONFLICT (employee_id, period_month) DO UPDATE SET
    task_completion = EXCLUDED.task_completion,
    attendance      = EXCLUDED.attendance,
    kpi             = EXCLUDED.kpi,
    updated_at      = now();

  UPDATE public.employees
     SET performance_score = v_kpi,
         attendance_pct    = LEAST(v_attendance, 99.99)
   WHERE id = _employee_id;
END;
$function$;

-- Backfill existing KPI rows for the current month so the Operations tab updates immediately
DO $$
DECLARE r RECORD; v_period date := date_trunc('month', CURRENT_DATE)::date;
BEGIN
  FOR r IN SELECT DISTINCT assignee_employee_id AS eid FROM public.tasks WHERE assignee_employee_id IS NOT NULL LOOP
    PERFORM public.recompute_employee_kpi(r.eid, v_period);
  END LOOP;
END $$;