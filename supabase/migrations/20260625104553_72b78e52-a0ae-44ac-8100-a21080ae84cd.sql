
-- 1) Candidate CVs: only admins from the same org as the candidate
DROP POLICY IF EXISTS hr_read_candidate_cvs ON storage.objects;
CREATE POLICY hr_read_candidate_cvs ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'candidate-cvs'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.candidates c
      WHERE c.cv_storage_path = storage.objects.name
        AND c.org_id = public.current_org_id()
    )
  );

-- 2) user_roles: scope admin management to same org via profiles
DROP POLICY IF EXISTS roles_admin_manage ON public.user_roles;
CREATE POLICY roles_admin_manage ON public.user_roles
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = user_roles.user_id
        AND p.org_id = public.current_org_id()
    )
    AND user_id <> auth.uid()  -- prevent self privilege escalation
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = user_roles.user_id
        AND p.org_id = public.current_org_id()
    )
    AND user_id <> auth.uid()
  );

-- 3) team_reports: mirror full USING in WITH CHECK
DROP POLICY IF EXISTS "report admin write" ON public.team_reports;
CREATE POLICY "report admin write" ON public.team_reports
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role(auth.uid(),'admin'::public.app_role))
  WITH CHECK (org_id = public.current_org_id() AND public.has_role(auth.uid(),'admin'::public.app_role));

-- 4) telegram_sessions: explicit deny-all (service role still bypasses RLS)
REVOKE ALL ON public.telegram_sessions FROM anon, authenticated;
CREATE POLICY telegram_sessions_no_api_access ON public.telegram_sessions
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- 5) SECURITY DEFINER hardening
-- Revoke from PUBLIC and anon across all public SECURITY DEFINER functions
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', r.proname, r.args);
  END LOOP;
END$$;

-- Trigger-only / internal functions: also revoke from authenticated
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.candidates_delete_on_reject() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_attendance_recompute() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_bd_recompute() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_kpi_payroll() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_rating_recompute() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_task_recompute() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

-- Ensure RLS helpers remain callable by authenticated (used in policies)
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;
