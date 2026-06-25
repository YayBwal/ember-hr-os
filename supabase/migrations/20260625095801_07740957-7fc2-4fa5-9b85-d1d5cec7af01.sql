
CREATE OR REPLACE FUNCTION public.appoint_team_leader(_team_id uuid, _employee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_email text; v_uid uuid; v_has_tl boolean;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT email INTO v_email FROM public.employees
    WHERE id = _employee_id AND org_id = public.current_org_id();
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Employee has no email on file — create a Team Leader account in Settings first';
  END IF;

  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower(v_email);
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No Team Leader account exists for % — create one in Settings → Team Leaders first', v_email;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'team_leader'
  ) INTO v_has_tl;
  IF NOT v_has_tl THEN
    RAISE EXCEPTION 'Account % is not a Team Leader — create one in Settings → Team Leaders first', v_email;
  END IF;

  UPDATE public.teams SET team_lead_employee_id = _employee_id
    WHERE id = _team_id AND org_id = public.current_org_id();
  INSERT INTO public.team_members(team_id, employee_id) VALUES (_team_id, _employee_id) ON CONFLICT DO NOTHING;
  UPDATE public.employees SET team_id = _team_id WHERE id = _employee_id;
END; $function$;
