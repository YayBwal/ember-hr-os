
-- Extend employees with Telegram + employee code
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS employee_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS phone_number text,
  ADD COLUMN IF NOT EXISTS telegram_chat_id bigint;

-- Surveys
CREATE TABLE IF NOT EXISTS public.surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','completed')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.surveys TO authenticated;
GRANT ALL ON public.surveys TO service_role;
ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "surveys org access" ON public.surveys FOR ALL TO authenticated
  USING (org_id = public.current_org_id()) WITH CHECK (org_id = public.current_org_id());
CREATE TRIGGER surveys_updated BEFORE UPDATE ON public.surveys FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Survey questions
CREATE TABLE IF NOT EXISTS public.survey_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  question_type text NOT NULL CHECK (question_type IN ('rating','multiple_choice','text')),
  options jsonb,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.survey_questions TO authenticated;
GRANT ALL ON public.survey_questions TO service_role;
ALTER TABLE public.survey_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sq via survey" ON public.survey_questions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.surveys s WHERE s.id = survey_id AND s.org_id = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.surveys s WHERE s.id = survey_id AND s.org_id = public.current_org_id()));

-- Anonymous responses
CREATE TABLE IF NOT EXISTS public.feedback_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.survey_questions(id) ON DELETE CASCADE,
  department text,
  rating_value int,
  text_comment text,
  submitted_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback_responses TO authenticated;
GRANT ALL ON public.feedback_responses TO service_role;
ALTER TABLE public.feedback_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fr via survey" ON public.feedback_responses FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.surveys s WHERE s.id = survey_id AND s.org_id = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.surveys s WHERE s.id = survey_id AND s.org_id = public.current_org_id()));
CREATE INDEX IF NOT EXISTS idx_fr_survey ON public.feedback_responses(survey_id);
CREATE INDEX IF NOT EXISTS idx_fr_dept ON public.feedback_responses(department);

-- Anonymous bullying / incident reports from Telegram
CREATE TABLE IF NOT EXISTS public.employee_incident_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reporter_department text,
  subject_employee_code text,
  subject_name text,
  category text,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewing','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_incident_reports TO authenticated;
GRANT ALL ON public.employee_incident_reports TO service_role;
ALTER TABLE public.employee_incident_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "incidents org access" ON public.employee_incident_reports FOR ALL TO authenticated
  USING (org_id = public.current_org_id()) WITH CHECK (org_id = public.current_org_id());
CREATE TRIGGER incidents_updated BEFORE UPDATE ON public.employee_incident_reports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Telegram session state (for multi-step bot conversations)
CREATE TABLE IF NOT EXISTS public.telegram_sessions (
  chat_id bigint PRIMARY KEY,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.telegram_sessions TO service_role;
ALTER TABLE public.telegram_sessions ENABLE ROW LEVEL SECURITY;
-- service role only; no policy for authenticated
