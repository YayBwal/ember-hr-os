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
  system_eligible: boolean;
  eligible_override: boolean | null;
  final_eligible: boolean;
  system_bonus_mmk: number;
  bonus_override_mmk: number | null;
  final_bonus_mmk: number;
  override_note: string | null;
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
    return (rows ?? []) as unknown as KpiRow[];
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

export const setKpiEligibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { employeeId: string; periodMonth: string; eligible: boolean | null }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("set_kpi_eligibility", {
      _employee_id: data.employeeId,
      _period_month: data.periodMonth,
      _eligible: data.eligible as boolean,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setKpiBonusOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { employeeId: string; periodMonth: string; amountMmk: number | null; note: string | null }) => {
    if (d.amountMmk !== null && (!Number.isFinite(d.amountMmk) || d.amountMmk < 0)) {
      throw new Error("Bonus amount must be >= 0");
    }
    if (d.note && d.note.length > 500) throw new Error("Note too long");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("set_kpi_bonus_override", {
      _employee_id: data.employeeId,
      _period_month: data.periodMonth,
      _amount_mmk: data.amountMmk as number,
      _note: data.note as string,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
