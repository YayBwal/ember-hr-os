
DO $$
DECLARE
  v_uid uuid;
  v_org uuid;
  v_email text := 'testingadmin1@gmail.com';
  v_pass text := 'test123456';
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at ASC LIMIT 1;
  IF v_org IS NULL THEN
    INSERT INTO public.organizations(name) VALUES ('Mandai') RETURNING id INTO v_org;
  END IF;

  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = v_email;
  IF v_uid IS NULL THEN
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      v_email, crypt(v_pass, gen_salt('bf')),
      now(),
      jsonb_build_object('provider','email','providers', jsonb_build_array('email')),
      jsonb_build_object('full_name','Test Admin','join_org_id', v_org::text, 'role','admin'),
      now(), now(), '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_email), 'email', v_uid::text, now(), now(), now());
  ELSE
    UPDATE auth.users SET encrypted_password = crypt(v_pass, gen_salt('bf')), email_confirmed_at = COALESCE(email_confirmed_at, now()), updated_at = now() WHERE id = v_uid;
  END IF;

  INSERT INTO public.profiles(id, org_id, full_name) VALUES (v_uid, v_org, 'Test Admin')
    ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id, full_name = EXCLUDED.full_name;

  DELETE FROM public.user_roles WHERE user_id = v_uid AND role <> 'admin';
  INSERT INTO public.user_roles(user_id, role) VALUES (v_uid, 'admin') ON CONFLICT DO NOTHING;
END $$;
