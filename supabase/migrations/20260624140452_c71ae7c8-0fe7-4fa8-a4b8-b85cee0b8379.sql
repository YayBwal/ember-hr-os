
-- Lock down SECURITY DEFINER functions: revoke public/anon/authenticated EXECUTE
-- on functions not intended to be called via the API. Keep RPC-callable and
-- RLS-referenced helpers executable.

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_task_recompute() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_attendance_recompute() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_bd_recompute() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_kpi_payroll() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_employee_kpi(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_payroll(uuid, date) FROM PUBLIC, anon, authenticated;

-- approve_candidate is an RPC intended for authenticated users; keep authenticated, revoke anon
REVOKE EXECUTE ON FUNCTION public.approve_candidate(uuid, department, text, bigint, uuid) FROM PUBLIC, anon;

-- has_role and current_org_id are used by RLS policies; signed-in users may call them
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_org_id() FROM PUBLIC, anon;
