
-- Function: list every organization (admin only)
CREATE OR REPLACE FUNCTION public.admin_list_organizations()
RETURNS TABLE(id uuid, name text, created_at timestamptz, member_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT o.id, o.name, o.created_at,
      (SELECT COUNT(*) FROM public.profiles p WHERE p.org_id = o.id) AS member_count
    FROM public.organizations o
    ORDER BY o.created_at ASC;
END;
$$;

-- Function: list every user across all orgs (admin only)
CREATE OR REPLACE FUNCTION public.admin_list_all_users()
RETURNS TABLE(id uuid, full_name text, org_id uuid, org_name text, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT p.id, p.full_name, p.org_id, o.name AS org_name, u.email::text
    FROM public.profiles p
    LEFT JOIN public.organizations o ON o.id = p.org_id
    LEFT JOIN auth.users u ON u.id = p.id
    ORDER BY o.name NULLS LAST, p.full_name NULLS LAST;
END;
$$;

-- Function: switch the calling user's own organization
CREATE OR REPLACE FUNCTION public.switch_my_org(_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org_id) THEN
    RAISE EXCEPTION 'organization not found';
  END IF;
  UPDATE public.profiles SET org_id = _org_id WHERE id = auth.uid();
END;
$$;

-- Function: create a new organization and switch into it
CREATE OR REPLACE FUNCTION public.create_and_switch_org(_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_org_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _name IS NULL OR length(trim(_name)) = 0 THEN
    RAISE EXCEPTION 'name required';
  END IF;
  INSERT INTO public.organizations(name) VALUES (trim(_name)) RETURNING id INTO v_org_id;
  UPDATE public.profiles SET org_id = v_org_id WHERE id = auth.uid();
  RETURN v_org_id;
END;
$$;

-- Function: admin reassigns any user to an organization
CREATE OR REPLACE FUNCTION public.admin_set_user_org(_user_id uuid, _org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org_id) THEN
    RAISE EXCEPTION 'organization not found';
  END IF;
  UPDATE public.profiles SET org_id = _org_id WHERE id = _user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_organizations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_all_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.switch_my_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_and_switch_org(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_org(uuid, uuid) TO authenticated;
