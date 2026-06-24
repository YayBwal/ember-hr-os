
-- team_reports
CREATE TABLE public.team_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  summary text,
  file_url text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  submitted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, period_start)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_reports TO authenticated;
GRANT ALL ON public.team_reports TO service_role;
ALTER TABLE public.team_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "report org read" ON public.team_reports FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY "report admin write" ON public.team_reports FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (org_id = public.current_org_id());
CREATE POLICY "report tl write" ON public.team_reports FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role(auth.uid(),'team_leader'))
  WITH CHECK (org_id = public.current_org_id() AND public.has_role(auth.uid(),'team_leader'));
CREATE TRIGGER trg_team_reports_updated BEFORE UPDATE ON public.team_reports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- member_ratings
CREATE TABLE public.member_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.team_reports(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  productivity int NOT NULL CHECK (productivity BETWEEN 0 AND 100),
  quality int NOT NULL CHECK (quality BETWEEN 0 AND 100),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, employee_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_ratings TO authenticated;
GRANT ALL ON public.member_ratings TO service_role;
ALTER TABLE public.member_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rating org read" ON public.member_ratings FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.team_reports r WHERE r.id = report_id AND r.org_id = public.current_org_id())
);
CREATE POLICY "rating write" ON public.member_ratings FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.team_reports r WHERE r.id = report_id AND r.org_id = public.current_org_id()
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'team_leader')))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.team_reports r WHERE r.id = report_id AND r.org_id = public.current_org_id()
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'team_leader')))
);
CREATE TRIGGER trg_member_ratings_updated BEFORE UPDATE ON public.member_ratings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- peer_reviews
CREATE TABLE public.peer_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  reviewer_employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  reviewee_employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  score int NOT NULL CHECK (score BETWEEN 0 AND 100),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_month, reviewer_employee_id, reviewee_employee_id),
  CHECK (reviewer_employee_id <> reviewee_employee_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.peer_reviews TO authenticated;
GRANT ALL ON public.peer_reviews TO service_role;
ALTER TABLE public.peer_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "peer own read" ON public.peer_reviews FOR SELECT TO authenticated USING (
  org_id = public.current_org_id() AND (
    public.has_role(auth.uid(),'admin')
    OR reviewer_employee_id IN (SELECT id FROM public.employees WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
  )
);
CREATE POLICY "peer own insert" ON public.peer_reviews FOR INSERT TO authenticated WITH CHECK (
  org_id = public.current_org_id()
  AND reviewer_employee_id IN (SELECT id FROM public.employees WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
);
CREATE POLICY "peer own update" ON public.peer_reviews FOR UPDATE TO authenticated USING (
  reviewer_employee_id IN (SELECT id FROM public.employees WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid()))
);

-- Aggregate function (hides reviewer identity)
CREATE OR REPLACE FUNCTION public.get_peer_avg(_employee_id uuid, _period date)
RETURNS TABLE(avg_score numeric, review_count int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(AVG(score),0)::numeric, COUNT(*)::int
  FROM public.peer_reviews
  WHERE reviewee_employee_id = _employee_id
    AND period_month = date_trunc('month', _period)::date;
$$;

-- Admin RPCs
CREATE OR REPLACE FUNCTION public.appoint_team_leader(_team_id uuid, _employee_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email text; v_uid uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.teams SET team_lead_employee_id = _employee_id WHERE id = _team_id AND org_id = public.current_org_id();
  INSERT INTO public.team_members(team_id, employee_id) VALUES (_team_id, _employee_id) ON CONFLICT DO NOTHING;
  UPDATE public.employees SET team_id = _team_id WHERE id = _employee_id;
  SELECT email INTO v_email FROM public.employees WHERE id = _employee_id;
  IF v_email IS NOT NULL THEN
    SELECT id INTO v_uid FROM auth.users WHERE email = v_email;
    IF v_uid IS NOT NULL THEN
      INSERT INTO public.user_roles(user_id, role) VALUES (v_uid, 'team_leader') ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.remove_team_leader(_team_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid; v_email text; v_uid uuid; v_other int;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT team_lead_employee_id INTO v_emp FROM public.teams WHERE id = _team_id AND org_id = public.current_org_id();
  UPDATE public.teams SET team_lead_employee_id = NULL WHERE id = _team_id;
  IF v_emp IS NULL THEN RETURN; END IF;
  SELECT email INTO v_email FROM public.employees WHERE id = v_emp;
  IF v_email IS NULL THEN RETURN; END IF;
  SELECT id INTO v_uid FROM auth.users WHERE email = v_email;
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO v_other FROM public.teams WHERE team_lead_employee_id = v_emp;
  IF v_other = 0 THEN
    DELETE FROM public.user_roles WHERE user_id = v_uid AND role = 'team_leader';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.add_team_member(_team_id uuid, _employee_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.team_members(team_id, employee_id) VALUES (_team_id, _employee_id) ON CONFLICT DO NOTHING;
  UPDATE public.employees SET team_id = _team_id WHERE id = _employee_id;
END; $$;

CREATE OR REPLACE FUNCTION public.remove_team_member(_team_id uuid, _employee_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.team_members WHERE team_id = _team_id AND employee_id = _employee_id;
  UPDATE public.employees SET team_id = NULL WHERE id = _employee_id AND team_id = _team_id;
END; $$;

-- KPI formula
CREATE OR REPLACE FUNCTION public.recompute_employee_kpi(_employee_id uuid, _period date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period_start date := date_trunc('month', _period)::date;
  v_period_end date := (date_trunc('month', _period) + interval '1 month - 1 day')::date;
  v_done int; v_total int; v_task_completion numeric := 0;
  v_present int; v_late int; v_logged int; v_attendance numeric := 100;
  v_productivity numeric; v_quality numeric;
  v_tl_prod numeric; v_tl_qual numeric;
  v_peer_avg numeric := 0; v_peer_count int := 0;
  v_objective numeric; v_kpi numeric;
  v_tl_avg numeric; v_obj_avg numeric; v_clamped numeric;
BEGIN
  SELECT COUNT(*) FILTER (WHERE status = 'done'), COUNT(*) INTO v_done, v_total
  FROM public.tasks
  WHERE assignee_employee_id = _employee_id AND due_date BETWEEN v_period_start AND v_period_end;
  IF v_total > 0 THEN v_task_completion := (v_done::numeric / v_total) * 100; END IF;

  SELECT COUNT(*) FILTER (WHERE status='present'), COUNT(*) FILTER (WHERE status='late'), COUNT(*)
  INTO v_present, v_late, v_logged
  FROM public.attendance
  WHERE employee_id = _employee_id AND date BETWEEN v_period_start AND v_period_end;
  IF v_logged > 0 THEN v_attendance := ((v_present + (v_late * 0.5))::numeric / v_logged) * 100; END IF;

  SELECT productivity, quality INTO v_productivity, v_quality
  FROM public.employee_kpis WHERE employee_id = _employee_id AND period_month = v_period_start;
  v_productivity := COALESCE(v_productivity, 80);
  v_quality := COALESCE(v_quality, 80);

  SELECT mr.productivity, mr.quality INTO v_tl_prod, v_tl_qual
  FROM public.member_ratings mr
  JOIN public.team_reports tr ON tr.id = mr.report_id
  WHERE mr.employee_id = _employee_id
    AND tr.status = 'submitted'
    AND tr.period_start <= v_period_end AND tr.period_end >= v_period_start
  ORDER BY tr.period_start DESC LIMIT 1;

  SELECT avg_score, review_count INTO v_peer_avg, v_peer_count
  FROM public.get_peer_avg(_employee_id, v_period_start);

  v_objective := (v_task_completion * 0.35) + (v_attendance * 0.20) + (v_productivity * 0.10) + (v_quality * 0.10);

  IF v_tl_prod IS NOT NULL THEN
    v_tl_avg := (v_tl_prod + v_tl_qual) / 2;
    v_obj_avg := (v_task_completion + v_attendance + v_productivity + v_quality) / 4;
    v_clamped := LEAST(v_tl_avg, v_obj_avg + 15);
    IF v_peer_count >= 2 THEN
      v_kpi := v_objective + (v_clamped * 0.25) + (v_peer_avg * 0.10);
    ELSE
      v_kpi := (v_objective / 0.75) * 0.90 + (v_clamped * 0.10);
    END IF;
  ELSE
    v_kpi := v_objective / 0.75;
  END IF;
  v_kpi := LEAST(GREATEST(v_kpi, 0), 100);

  INSERT INTO public.employee_kpis(employee_id, period_month, task_completion, productivity, quality, attendance, kpi)
  VALUES (_employee_id, v_period_start, v_task_completion, v_productivity, v_quality, v_attendance, v_kpi)
  ON CONFLICT (employee_id, period_month) DO UPDATE SET
    task_completion = EXCLUDED.task_completion,
    attendance = EXCLUDED.attendance,
    kpi = EXCLUDED.kpi,
    updated_at = now();

  UPDATE public.employees SET performance_score = v_kpi, attendance_pct = v_attendance WHERE id = _employee_id;
END; $$;

-- Triggers
CREATE OR REPLACE FUNCTION public.trg_rating_recompute()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_period date;
BEGIN
  SELECT period_start INTO v_period FROM public.team_reports WHERE id = COALESCE(NEW.report_id, OLD.report_id);
  PERFORM public.recompute_employee_kpi(COALESCE(NEW.employee_id, OLD.employee_id), v_period);
  PERFORM public.recompute_payroll(COALESCE(NEW.employee_id, OLD.employee_id), v_period);
  RETURN COALESCE(NEW, OLD);
END; $$;
CREATE TRIGGER trg_member_ratings_recompute
AFTER INSERT OR UPDATE OR DELETE ON public.member_ratings
FOR EACH ROW EXECUTE FUNCTION public.trg_rating_recompute();

CREATE OR REPLACE FUNCTION public.trg_peer_recompute()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.recompute_employee_kpi(COALESCE(NEW.reviewee_employee_id, OLD.reviewee_employee_id), COALESCE(NEW.period_month, OLD.period_month));
  PERFORM public.recompute_payroll(COALESCE(NEW.reviewee_employee_id, OLD.reviewee_employee_id), COALESCE(NEW.period_month, OLD.period_month));
  RETURN COALESCE(NEW, OLD);
END; $$;
CREATE TRIGGER trg_peer_reviews_recompute
AFTER INSERT OR UPDATE OR DELETE ON public.peer_reviews
FOR EACH ROW EXECUTE FUNCTION public.trg_peer_recompute();
