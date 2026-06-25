CREATE OR REPLACE FUNCTION public.compute_kpi_dashboard(_period_month date DEFAULT CURRENT_DATE)
 RETURNS TABLE(employee_id uuid, full_name text, department text, job_position text, level text, team_id uuid, employment_type text, base_salary_mmk bigint, task_completion_pct numeric, tasks_done integer, tasks_total integer, attendance_pct numeric, days_present integer, days_late integer, days_absent integer, working_hours numeric, kpi_score numeric, bonus_eligible boolean, bonus_amount_mmk bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
    WHERE tk.org_id = v_org
      AND tk.assignee_employee_id IS NOT NULL
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
    FROM public.employee_promotions ep
    WHERE ep.period_month = v_start
    GROUP BY ep.employee_id
  ),
  k AS (
    SELECT ek.employee_id AS eid, ek.kpi
    FROM public.employee_kpis ek
    WHERE ek.period_month = v_start
  )
  SELECT
    e.id,
    e.full_name,
    e.department::text,
    e.position::text,
    e.level::text,
    e.team_id,
    e.employment_type::text,
    e.monthly_base_mmk,
    CASE WHEN COALESCE(t.total_tasks,0) > 0
         THEN ROUND((t.done_tasks::numeric / t.total_tasks) * 100, 2)
         ELSE 0 END,
    COALESCE(t.done_tasks,0)::int,
    COALESCE(t.total_tasks,0)::int,
    CASE WHEN COALESCE(a.logged,0) > 0
         THEN ROUND(((a.pres + a.lat*0.5)::numeric / a.logged) * 100, 2)
         ELSE COALESCE(e.attendance_pct, 0) END,
    COALESCE(a.pres,0)::int,
    COALESCE(a.lat,0)::int,
    COALESCE(a.abs_d,0)::int,
    ROUND((COALESCE(a.pres,0) + COALESCE(a.lat,0)*0.5) * 8, 2),
    LEAST(99.99, GREATEST(0, COALESCE(k.kpi, e.performance_score, 0) + COALESCE(adj.adj,0))),
    CASE
      WHEN e.employment_type = 'remote' THEN
        COALESCE(k.kpi,0) >= 75
        AND (CASE WHEN COALESCE(a.logged,0) > 0 THEN ((a.pres + a.lat*0.5)::numeric / a.logged) * 100 ELSE COALESCE(e.attendance_pct,0) END) >= 90
      ELSE
        COALESCE(k.kpi,0) >= 80
        AND (CASE WHEN COALESCE(a.logged,0) > 0 THEN ((a.pres + a.lat*0.5)::numeric / a.logged) * 100 ELSE COALESCE(e.attendance_pct,0) END) >= 85
    END,
    (e.monthly_base_mmk *
      CASE
        WHEN LEAST(100, GREATEST(0, COALESCE(k.kpi,0) + COALESCE(adj.adj,0))) >= 95 THEN 0.20
        WHEN LEAST(100, GREATEST(0, COALESCE(k.kpi,0) + COALESCE(adj.adj,0))) >= 90 THEN 0.15
        WHEN LEAST(100, GREATEST(0, COALESCE(k.kpi,0) + COALESCE(adj.adj,0))) >= 85 THEN 0.10
        WHEN LEAST(100, GREATEST(0, COALESCE(k.kpi,0) + COALESCE(adj.adj,0))) >= 80 THEN 0.05
        ELSE 0
      END
    )::bigint
  FROM public.employees e
  LEFT JOIN t   ON t.eid = e.id
  LEFT JOIN a   ON a.eid = e.id
  LEFT JOIN adj ON adj.eid = e.id
  LEFT JOIN k   ON k.eid = e.id
  WHERE e.org_id = v_org
  ORDER BY e.full_name;
END;
$function$;