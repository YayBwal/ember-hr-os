
-- =========================================================
-- ENUMS
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'recruiter', 'hr', 'finance');
CREATE TYPE public.department AS ENUM ('HR', 'Operations', 'Finance', 'Admin', 'Engineering');
CREATE TYPE public.task_status AS ENUM ('todo', 'in_progress', 'review', 'done');
CREATE TYPE public.candidate_status AS ENUM ('new', 'screening', 'interview', 'offer', 'onboarded', 'rejected');
CREATE TYPE public.meeting_status AS ENUM ('uploaded', 'transcribing', 'extracting', 'ready', 'failed');

-- =========================================================
-- updated_at helper
-- =========================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- =========================================================
-- organizations
-- =========================================================
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_org_updated BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- profiles
-- =========================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_profiles_org ON public.profiles(org_id);
CREATE TRIGGER trg_profile_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- helper: current user's org
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.profiles WHERE id = auth.uid()
$$;

-- =========================================================
-- user_roles
-- =========================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- =========================================================
-- profiles policies
-- =========================================================
CREATE POLICY "profiles_select_same_org" ON public.profiles FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "orgs_select_member" ON public.organizations FOR SELECT TO authenticated
  USING (id = public.current_org_id());

-- user_roles policies
CREATE POLICY "roles_select_self" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "roles_admin_manage" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================
-- employees
-- =========================================================
CREATE TABLE public.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  department public.department NOT NULL,
  position TEXT NOT NULL,
  monthly_base_mmk BIGINT NOT NULL DEFAULT 0,
  performance_score NUMERIC(4,2) NOT NULL DEFAULT 80.0,
  attendance_pct NUMERIC(5,2) NOT NULL DEFAULT 95.0,
  workload INT NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_emp_org ON public.employees(org_id);
CREATE TRIGGER trg_emp_updated BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "emp_org_all" ON public.employees FOR ALL TO authenticated
  USING (org_id = public.current_org_id()) WITH CHECK (org_id = public.current_org_id());

-- =========================================================
-- candidates
-- =========================================================
CREATE TABLE public.candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  role_applied TEXT NOT NULL,
  status public.candidate_status NOT NULL DEFAULT 'new',
  ai_match_score NUMERIC(4,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidates TO authenticated;
GRANT ALL ON public.candidates TO service_role;
ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_cand_org ON public.candidates(org_id);
CREATE TRIGGER trg_cand_updated BEFORE UPDATE ON public.candidates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "cand_org_all" ON public.candidates FOR ALL TO authenticated
  USING (org_id = public.current_org_id()) WITH CHECK (org_id = public.current_org_id());

-- =========================================================
-- meetings
-- =========================================================
CREATE TABLE public.meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  audio_path TEXT,
  transcript TEXT,
  status public.meeting_status NOT NULL DEFAULT 'uploaded',
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meetings TO authenticated;
GRANT ALL ON public.meetings TO service_role;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_meet_org ON public.meetings(org_id);
CREATE TRIGGER trg_meet_updated BEFORE UPDATE ON public.meetings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "meet_org_all" ON public.meetings FOR ALL TO authenticated
  USING (org_id = public.current_org_id()) WITH CHECK (org_id = public.current_org_id());

-- =========================================================
-- tasks
-- =========================================================
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status public.task_status NOT NULL DEFAULT 'todo',
  assignee_employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  meeting_id UUID REFERENCES public.meetings(id) ON DELETE SET NULL,
  effort_points INT NOT NULL DEFAULT 3,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_task_org_status ON public.tasks(org_id, status);
CREATE TRIGGER trg_task_updated BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "task_org_all" ON public.tasks FOR ALL TO authenticated
  USING (org_id = public.current_org_id()) WITH CHECK (org_id = public.current_org_id());

-- =========================================================
-- payroll
-- =========================================================
CREATE TABLE public.payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  total_mmk BIGINT NOT NULL DEFAULT 0,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_runs TO authenticated;
GRANT ALL ON public.payroll_runs TO service_role;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_pr_org ON public.payroll_runs(org_id);
CREATE POLICY "pr_org_all" ON public.payroll_runs FOR ALL TO authenticated
  USING (org_id = public.current_org_id()) WITH CHECK (org_id = public.current_org_id());

CREATE TABLE public.payroll_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  base_mmk BIGINT NOT NULL DEFAULT 0,
  performance_bonus_mmk BIGINT NOT NULL DEFAULT 0,
  total_mmk BIGINT NOT NULL DEFAULT 0,
  tasks_completed INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_lines TO authenticated;
GRANT ALL ON public.payroll_lines TO service_role;
ALTER TABLE public.payroll_lines ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_pl_run ON public.payroll_lines(run_id);
CREATE POLICY "pl_org_all" ON public.payroll_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.payroll_runs r WHERE r.id = run_id AND r.org_id = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.payroll_runs r WHERE r.id = run_id AND r.org_id = public.current_org_id()));

-- =========================================================
-- signup trigger: create org + profile + default role
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id UUID;
  v_org_name TEXT;
  v_full_name TEXT;
  v_join_org UUID;
BEGIN
  v_org_name := COALESCE(NEW.raw_user_meta_data->>'org_name', 'My Organization');
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
  v_join_org := NULLIF(NEW.raw_user_meta_data->>'join_org_id', '')::UUID;

  IF v_join_org IS NOT NULL AND EXISTS (SELECT 1 FROM public.organizations WHERE id = v_join_org) THEN
    v_org_id := v_join_org;
  ELSE
    INSERT INTO public.organizations(name) VALUES (v_org_name) RETURNING id INTO v_org_id;
  END IF;

  INSERT INTO public.profiles(id, org_id, full_name) VALUES (NEW.id, v_org_id, v_full_name);
  INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- DEMO SEED — one shared "Mandai Demo" org so any new signup
-- that opts into demo data can join it. New signups by default
-- create a fresh empty org via handle_new_user.
-- We seed a "showcase" org with a marker id-friendly name.
-- =========================================================
DO $$
DECLARE
  v_org UUID;
  e1 UUID; e2 UUID; e3 UUID; e4 UUID; e5 UUID; e6 UUID; e7 UUID; e8 UUID; e9 UUID; e10 UUID;
BEGIN
  INSERT INTO public.organizations(name) VALUES ('Mandai Demo Co.') RETURNING id INTO v_org;

  INSERT INTO public.employees(org_id, full_name, email, department, position, monthly_base_mmk, performance_score, attendance_pct, workload) VALUES
    (v_org, 'Aung Min',       'aung@mandai.demo',   'HR',          'HR Lead',              2400000, 92.0, 98.0, 7) RETURNING id INTO e1;
  INSERT INTO public.employees(org_id, full_name, email, department, position, monthly_base_mmk, performance_score, attendance_pct, workload) VALUES
    (v_org, 'Hnin Wai',        'hnin@mandai.demo',   'HR',          'Recruiter',            1600000, 88.0, 96.0, 6) RETURNING id INTO e2;
  INSERT INTO public.employees(org_id, full_name, email, department, position, monthly_base_mmk, performance_score, attendance_pct, workload) VALUES
    (v_org, 'Kyaw Zin',        'kyaw@mandai.demo',   'Operations',  'Ops Manager',          2800000, 90.0, 97.0, 8) RETURNING id INTO e3;
  INSERT INTO public.employees(org_id, full_name, email, department, position, monthly_base_mmk, performance_score, attendance_pct, workload) VALUES
    (v_org, 'Su Mon',           'su@mandai.demo',     'Operations',  'Operations Analyst',   1800000, 85.0, 94.0, 7) RETURNING id INTO e4;
  INSERT INTO public.employees(org_id, full_name, email, department, position, monthly_base_mmk, performance_score, attendance_pct, workload) VALUES
    (v_org, 'Thiha Aung',       'thiha@mandai.demo',  'Engineering', 'Senior Engineer',      3200000, 94.0, 99.0, 9) RETURNING id INTO e5;
  INSERT INTO public.employees(org_id, full_name, email, department, position, monthly_base_mmk, performance_score, attendance_pct, workload) VALUES
    (v_org, 'May Thu',          'may@mandai.demo',    'Engineering', 'Engineer',             2400000, 87.0, 95.0, 7) RETURNING id INTO e6;
  INSERT INTO public.employees(org_id, full_name, email, department, position, monthly_base_mmk, performance_score, attendance_pct, workload) VALUES
    (v_org, 'Zarni Htet',       'zarni@mandai.demo',  'Finance',     'Finance Lead',         2600000, 91.0, 98.0, 6) RETURNING id INTO e7;
  INSERT INTO public.employees(org_id, full_name, email, department, position, monthly_base_mmk, performance_score, attendance_pct, workload) VALUES
    (v_org, 'Phyo Phyo',        'phyo@mandai.demo',   'Finance',     'Payroll Specialist',   1700000, 86.0, 93.0, 5) RETURNING id INTO e8;
  INSERT INTO public.employees(org_id, full_name, email, department, position, monthly_base_mmk, performance_score, attendance_pct, workload) VALUES
    (v_org, 'Nay Lin',          'nay@mandai.demo',    'Admin',       'Office Manager',       1500000, 84.0, 96.0, 5) RETURNING id INTO e9;
  INSERT INTO public.employees(org_id, full_name, email, department, position, monthly_base_mmk, performance_score, attendance_pct, workload) VALUES
    (v_org, 'Ei Ei',             'ei@mandai.demo',     'Admin',       'Admin Assistant',      1200000, 82.0, 97.0, 4) RETURNING id INTO e10;

  INSERT INTO public.candidates(org_id, full_name, email, role_applied, status, ai_match_score, notes) VALUES
    (v_org, 'Khin Maung', 'khin@apply.demo', 'Senior Engineer', 'interview', 88.0, 'Strong React/TS background'),
    (v_org, 'Tin Tin',     'tin@apply.demo',  'Recruiter',       'screening', 76.0, 'Past agency experience'),
    (v_org, 'Soe Naing',   'soe@apply.demo',  'Ops Analyst',     'new',        82.0, 'Industry transition'),
    (v_org, 'Aye Mya',     'aye@apply.demo',  'Engineer',        'offer',      91.0, 'Top of stack');

  INSERT INTO public.tasks(org_id, title, description, status, assignee_employee_id, effort_points, due_date) VALUES
    (v_org, 'Finalize Q3 payroll batch', 'Lock period and run final payroll for Q3', 'in_progress', e7, 5, current_date + 3),
    (v_org, 'Onboard new Operations hire', 'Set up tooling and intro meetings', 'todo', e3, 3, current_date + 7),
    (v_org, 'Audit attendance anomalies', 'Pull last 30d attendance dips and flag', 'review', e8, 3, current_date + 1),
    (v_org, 'Publish updated employee handbook', 'Edit + legal review + publish', 'done', e1, 5, current_date - 1),
    (v_org, 'Recruit Senior Engineer candidate pipeline', 'Source 10 candidates by Friday', 'todo', e2, 5, current_date + 5),
    (v_org, 'Set up performance review cycle', 'Configure cadence + criteria', 'in_progress', e1, 4, current_date + 10),
    (v_org, 'Quarterly ops dashboard refresh', 'Recharts review and ship', 'todo', e5, 3, current_date + 4),
    (v_org, 'Confirm bonus structure with Finance', 'Sync on Q3 performance bonuses', 'review', e7, 2, current_date + 2);
END $$;
