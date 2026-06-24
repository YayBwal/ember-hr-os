
REVOKE EXECUTE ON FUNCTION public.recompute_employee_kpi(UUID, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_payroll(UUID, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_task_recompute() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_attendance_recompute() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_bd_recompute() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_kpi_payroll() FROM PUBLIC;
