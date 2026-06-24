
CREATE TYPE public.task_priority AS ENUM ('low','medium','high','urgent');
CREATE TYPE public.attendance_status AS ENUM ('present','late','absent','leave');

ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'blocked';
ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'cancelled';

CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  department public.department NOT NULL,
  team_lead_employee_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT ALL ON public.teams TO service_role;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_teams_org ON public.teams(org_id);
CREATE TRIGGER trg_teams_updated BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "teams_org_all" ON public.teams FOR ALL TO authenticated
  USING (org_id = public.current_org_id()) WITH CHECK (org_id = public.current_org_id());

ALTER TABLE public.employees
  ADD COLUMN team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN join_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN phone TEXT,
  ADD COLUMN avatar_url TEXT,
  ADD COLUMN salary_grade TEXT,
  ADD COLUMN candidate_id UUID REFERENCES public.candidates(id) ON DELETE SET NULL;
CREATE INDEX idx_emp_team ON public.employees(team_id);

ALTER TABLE public.teams
  ADD CONSTRAINT teams_lead_fk FOREIGN KEY (team_lead_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;

CREATE TABLE public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(team_id, employee_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members TO authenticated;
GRANT ALL ON public.team_members TO service_role;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_tm_team ON public.team_members(team_id);
CREATE INDEX idx_tm_emp ON public.team_members(employee_id);
CREATE POLICY "tm_org_all" ON public.team_members FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND t.org_id = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND t.org_id = public.current_org_id()));

CREATE TABLE public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  status public.attendance_status NOT NULL,
  minutes_late INT NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id, date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance TO authenticated;
GRANT ALL ON public.attendance TO service_role;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_att_emp_date ON public.attendance(employee_id, date);
CREATE POLICY "att_org_all" ON public.attendance FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.org_id = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.org_id = public.current_org_id()));

CREATE TABLE public.employee_kpis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  task_completion NUMERIC(5,2) NOT NULL DEFAULT 0,
  productivity NUMERIC(5,2) NOT NULL DEFAULT 80,
  quality NUMERIC(5,2) NOT NULL DEFAULT 80,
  attendance NUMERIC(5,2) NOT NULL DEFAULT 100,
  kpi NUMERIC(5,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id, period_month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_kpis TO authenticated;
GRANT ALL ON public.employee_kpis TO service_role;
ALTER TABLE public.employee_kpis ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ek_emp_period ON public.employee_kpis(employee_id, period_month);
CREATE TRIGGER trg_ek_updated BEFORE UPDATE ON public.employee_kpis FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "ek_org_all" ON public.employee_kpis FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.org_id = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.org_id = public.current_org_id()));

CREATE TABLE public.bonuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  amount_mmk BIGINT NOT NULL DEFAULT 0,
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bonuses TO authenticated;
GRANT ALL ON public.bonuses TO service_role;
ALTER TABLE public.bonuses ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_bon_emp_period ON public.bonuses(employee_id, period_month);
CREATE POLICY "bon_org_all" ON public.bonuses FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.org_id = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.org_id = public.current_org_id()));

CREATE TABLE public.deductions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  amount_mmk BIGINT NOT NULL DEFAULT 0,
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deductions TO authenticated;
GRANT ALL ON public.deductions TO service_role;
ALTER TABLE public.deductions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ded_emp_period ON public.deductions(employee_id, period_month);
CREATE POLICY "ded_org_all" ON public.deductions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.org_id = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.employees e WHERE e.id = employee_id AND e.org_id = public.current_org_id()));

CREATE TABLE public.task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_comments TO authenticated;
GRANT ALL ON public.task_comments TO service_role;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_tc_task ON public.task_comments(task_id);
CREATE POLICY "tc_org_all" ON public.task_comments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND t.org_id = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND t.org_id = public.current_org_id()));

CREATE TABLE public.meeting_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL UNIQUE REFERENCES public.meetings(id) ON DELETE CASCADE,
  summary TEXT,
  key_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  participants JSONB NOT NULL DEFAULT '[]'::jsonb,
  deadlines JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_summaries TO authenticated;
GRANT ALL ON public.meeting_summaries TO service_role;
ALTER TABLE public.meeting_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ms_org_all" ON public.meeting_summaries FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND m.org_id = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_id AND m.org_id = public.current_org_id()));

ALTER TABLE public.tasks
  ADD COLUMN priority public.task_priority NOT NULL DEFAULT 'medium',
  ADD COLUMN team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN progress INT NOT NULL DEFAULT 0;

ALTER TABLE public.payroll_lines
  ADD COLUMN bonus_mmk BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN deduction_mmk BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN overtime_mmk BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN kpi_snapshot NUMERIC(5,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.recompute_employee_kpi(_employee_id UUID, _period DATE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period_start DATE := date_trunc('month', _period)::date;
  v_period_end DATE := (date_trunc('month', _period) + interval '1 month - 1 day')::date;
  v_done INT; v_total INT; v_task_completion NUMERIC := 0;
  v_present INT; v_late INT; v_logged INT; v_attendance NUMERIC := 100;
  v_productivity NUMERIC; v_quality NUMERIC; v_kpi NUMERIC;
BEGIN
  SELECT COUNT(*) FILTER (WHERE status = 'done'), COUNT(*) INTO v_done, v_total
  FROM public.tasks
  WHERE assignee_employee_id = _employee_id AND due_date BETWEEN v_period_start AND v_period_end;
  IF v_total > 0 THEN v_task_completion := (v_done::numeric / v_total) * 100; END IF;

  SELECT COUNT(*) FILTER (WHERE status = 'present'), COUNT(*) FILTER (WHERE status = 'late'), COUNT(*)
  INTO v_present, v_late, v_logged
  FROM public.attendance
  WHERE employee_id = _employee_id AND date BETWEEN v_period_start AND v_period_end;
  IF v_logged > 0 THEN v_attendance := ((v_present + (v_late * 0.5))::numeric / v_logged) * 100; END IF;

  SELECT productivity, quality INTO v_productivity, v_quality FROM public.employee_kpis
  WHERE employee_id = _employee_id AND period_month = v_period_start;
  IF v_productivity IS NULL THEN v_productivity := 80; END IF;
  IF v_quality IS NULL THEN v_quality := 80; END IF;

  v_kpi := (v_task_completion * 0.40) + (v_productivity * 0.25) + (v_attendance * 0.20) + (v_quality * 0.15);

  INSERT INTO public.employee_kpis(employee_id, period_month, task_completion, productivity, quality, attendance, kpi)
  VALUES (_employee_id, v_period_start, v_task_completion, v_productivity, v_quality, v_attendance, v_kpi)
  ON CONFLICT (employee_id, period_month) DO UPDATE SET
    task_completion = EXCLUDED.task_completion, attendance = EXCLUDED.attendance, kpi = EXCLUDED.kpi, updated_at = now();

  UPDATE public.employees SET performance_score = v_kpi, attendance_pct = v_attendance WHERE id = _employee_id;
END; $$;

CREATE OR REPLACE FUNCTION public.recompute_payroll(_employee_id UUID, _period DATE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period_start DATE := date_trunc('month', _period)::date;
  v_base BIGINT; v_org UUID; v_kpi NUMERIC; v_bonus_pct NUMERIC;
  v_kpi_bonus BIGINT; v_extra_bonus BIGINT; v_deduction BIGINT;
  v_overtime BIGINT := 0; v_total BIGINT; v_completed INT; v_run_id UUID;
BEGIN
  SELECT monthly_base_mmk, org_id INTO v_base, v_org FROM public.employees WHERE id = _employee_id;
  IF v_base IS NULL THEN RETURN; END IF;
  SELECT kpi INTO v_kpi FROM public.employee_kpis WHERE employee_id = _employee_id AND period_month = v_period_start;
  IF v_kpi IS NULL THEN v_kpi := 0; END IF;
  v_bonus_pct := CASE WHEN v_kpi >= 95 THEN 0.20 WHEN v_kpi >= 90 THEN 0.15 WHEN v_kpi >= 85 THEN 0.10 WHEN v_kpi >= 80 THEN 0.05 ELSE 0 END;
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
      deduction_mmk = v_deduction, overtime_mmk = v_overtime, kpi_snapshot = v_kpi,
      total_mmk = v_total, tasks_completed = v_completed
    WHERE run_id = v_run_id AND employee_id = _employee_id;
  ELSE
    INSERT INTO public.payroll_lines(run_id, employee_id, base_mmk, performance_bonus_mmk, bonus_mmk, deduction_mmk, overtime_mmk, kpi_snapshot, total_mmk, tasks_completed)
    VALUES (v_run_id, _employee_id, v_base, v_kpi_bonus, v_extra_bonus, v_deduction, v_overtime, v_kpi, v_total, v_completed);
  END IF;

  UPDATE public.payroll_runs SET total_mmk = (SELECT COALESCE(SUM(total_mmk),0) FROM public.payroll_lines WHERE run_id = v_run_id) WHERE id = v_run_id;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_task_recompute()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_period DATE := CURRENT_DATE;
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.assignee_employee_id IS NOT NULL THEN
    PERFORM public.recompute_employee_kpi(NEW.assignee_employee_id, v_period);
    PERFORM public.recompute_payroll(NEW.assignee_employee_id, v_period);
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.assignee_employee_id IS NOT NULL AND OLD.assignee_employee_id IS DISTINCT FROM NEW.assignee_employee_id THEN
    PERFORM public.recompute_employee_kpi(OLD.assignee_employee_id, v_period);
    PERFORM public.recompute_payroll(OLD.assignee_employee_id, v_period);
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;
CREATE TRIGGER trg_tasks_kpi AFTER INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.trg_task_recompute();

CREATE OR REPLACE FUNCTION public.trg_attendance_recompute()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  PERFORM public.recompute_payroll(v_emp, v_period);
  RETURN COALESCE(NEW, OLD);
END; $$;
CREATE TRIGGER trg_attendance_kpi AFTER INSERT OR UPDATE OR DELETE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.trg_attendance_recompute();

CREATE OR REPLACE FUNCTION public.trg_bd_recompute()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp UUID; v_period DATE;
BEGIN
  v_emp := COALESCE(NEW.employee_id, OLD.employee_id);
  v_period := COALESCE(NEW.period_month, OLD.period_month);
  IF v_emp IS NOT NULL THEN PERFORM public.recompute_payroll(v_emp, v_period); END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;
CREATE TRIGGER trg_bonuses_payroll AFTER INSERT OR UPDATE OR DELETE ON public.bonuses
  FOR EACH ROW EXECUTE FUNCTION public.trg_bd_recompute();
CREATE TRIGGER trg_deductions_payroll AFTER INSERT OR UPDATE OR DELETE ON public.deductions
  FOR EACH ROW EXECUTE FUNCTION public.trg_bd_recompute();

CREATE OR REPLACE FUNCTION public.trg_kpi_payroll()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.recompute_payroll(NEW.employee_id, NEW.period_month);
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_ek_payroll AFTER INSERT OR UPDATE OF productivity, quality ON public.employee_kpis
  FOR EACH ROW EXECUTE FUNCTION public.trg_kpi_payroll();

CREATE OR REPLACE FUNCTION public.approve_candidate(
  _candidate_id UUID, _department public.department, _position TEXT, _monthly_base BIGINT, _team_id UUID DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cand RECORD; v_emp_id UUID;
BEGIN
  SELECT * INTO v_cand FROM public.candidates WHERE id = _candidate_id AND org_id = public.current_org_id();
  IF v_cand IS NULL THEN RAISE EXCEPTION 'candidate not found'; END IF;
  INSERT INTO public.employees(org_id, full_name, email, department, position, monthly_base_mmk, team_id, candidate_id, join_date)
  VALUES (v_cand.org_id, v_cand.full_name, v_cand.email, _department, _position, _monthly_base, _team_id, _candidate_id, CURRENT_DATE)
  RETURNING id INTO v_emp_id;
  IF _team_id IS NOT NULL THEN
    INSERT INTO public.team_members(team_id, employee_id) VALUES (_team_id, v_emp_id) ON CONFLICT DO NOTHING;
  END IF;
  UPDATE public.candidates SET status = 'onboarded' WHERE id = _candidate_id;
  RETURN v_emp_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.approve_candidate(UUID, public.department, TEXT, BIGINT, UUID) TO authenticated;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'employees','tasks','attendance','employee_kpis','payroll_lines','payroll_runs',
    'bonuses','deductions','task_comments','meetings','meeting_summaries','teams','team_members','candidates'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.employees REPLICA IDENTITY FULL;
ALTER TABLE public.tasks REPLICA IDENTITY FULL;
ALTER TABLE public.attendance REPLICA IDENTITY FULL;
ALTER TABLE public.employee_kpis REPLICA IDENTITY FULL;
ALTER TABLE public.payroll_lines REPLICA IDENTITY FULL;
ALTER TABLE public.bonuses REPLICA IDENTITY FULL;
ALTER TABLE public.deductions REPLICA IDENTITY FULL;
ALTER TABLE public.meeting_summaries REPLICA IDENTITY FULL;
