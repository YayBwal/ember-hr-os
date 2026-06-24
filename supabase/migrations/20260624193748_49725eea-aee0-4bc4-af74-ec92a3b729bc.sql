
CREATE POLICY "team-reports tl upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'team-reports' AND public.has_role(auth.uid(),'team_leader'));
CREATE POLICY "team-reports tl update" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'team-reports' AND (public.has_role(auth.uid(),'team_leader') OR public.has_role(auth.uid(),'admin')));
CREATE POLICY "team-reports read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'team-reports');
CREATE POLICY "team-reports admin delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'team-reports' AND public.has_role(auth.uid(),'admin'));
