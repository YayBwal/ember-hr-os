import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type KpiRow = {
  employee_id: string;
  full_name: string;
  department: string;
  job_position: string;
  level: string;
  team_id: string | null;
  employment_type: "remote" | "on_site";
  base_salary_mmk: number;
  task_completion_pct: number;
  tasks_done: number;
  tasks_total: number;
  attendance_pct: number;
  days_present: number;
  days_late: number;
  days_absent: number;
  working_hours: number;
  kpi_score: number;
  bonus_eligible: boolean;
  bonus_amount_mmk: number;
};

function monthStart(d?: string) {
  const date = d ? new Date(d) : new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

export const getKpiDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { periodMonth?: string }) => d ?? {})
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("compute_kpi_dashboard", {
      _period_month: monthStart(data.periodMonth),
    });
    if (error) throw new Error(error.message);
    return (rows ?? []) as KpiRow[];
  });

export const setEmploymentType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { employeeId: string; type: "remote" | "on_site" }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("employees")
      .update({ employment_type: data.type })
      .eq("id", data.employeeId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
