
-- 1. Update trigger to respect explicit role in metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id UUID;
  v_org_name TEXT;
  v_full_name TEXT;
  v_join_org UUID;
  v_role TEXT;
BEGIN
  v_org_name := COALESCE(NEW.raw_user_meta_data->>'org_name', 'My Organization');
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
  v_join_org := NULLIF(NEW.raw_user_meta_data->>'join_org_id', '')::UUID;
  v_role := COALESCE(NULLIF(NEW.raw_user_meta_data->>'role', ''), 'admin');

  IF v_join_org IS NOT NULL AND EXISTS (SELECT 1 FROM public.organizations WHERE id = v_join_org) THEN
    v_org_id := v_join_org;
  ELSE
    INSERT INTO public.organizations(name) VALUES (v_org_name) RETURNING id INTO v_org_id;
  END IF;

  INSERT INTO public.profiles(id, org_id, full_name) VALUES (NEW.id, v_org_id, v_full_name);
  INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, v_role::public.app_role) ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $function$;

-- 2. Clean up users who have both team_leader and admin: keep team_leader only
DELETE FROM public.user_roles ur
WHERE ur.role = 'admin'
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur2
    WHERE ur2.user_id = ur.user_id AND ur2.role = 'team_leader'
  );
