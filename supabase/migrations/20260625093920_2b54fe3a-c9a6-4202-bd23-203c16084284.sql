-- Assign roles by email lookup
DO $$
DECLARE
  v_kset uuid;
  v_light uuid;
BEGIN
  SELECT id INTO v_kset FROM auth.users WHERE lower(email) = 'kset@gmail.com' LIMIT 1;
  SELECT id INTO v_light FROM auth.users WHERE lower(email) = 'lightempireog@gmail.com' LIMIT 1;

  IF v_kset IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = v_kset;
    INSERT INTO public.user_roles (user_id, role) VALUES (v_kset, 'team_leader')
      ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  IF v_light IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = v_light AND role <> 'admin';
    INSERT INTO public.user_roles (user_id, role) VALUES (v_light, 'admin')
      ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
END $$;