import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function periodMonth(d?: string) {
  const date = d ? new Date(d) : new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export const addBonus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { employeeId: string; amountMmk: number; reason?: string; periodMonth?: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("bonuses").insert({
      employee_id: data.employeeId,
      amount_mmk: data.amountMmk,
      reason: data.reason ?? null,
      period_month: periodMonth(data.periodMonth),
      source: "manual",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addDeduction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { employeeId: string; amountMmk: number; reason?: string; periodMonth?: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("deductions").insert({
      employee_id: data.employeeId,
      amount_mmk: data.amountMmk,
      reason: data.reason ?? null,
      period_month: periodMonth(data.periodMonth),
      source: "manual",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runPayroll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { periodMonth?: string }) => d)
  .handler(async ({ data, context }) => {
    const period = periodMonth(data.periodMonth);
    const { data: emps, error } = await context.supabase.from("employees").select("id");
    if (error) throw new Error(error.message);
    for (const e of emps ?? []) {
      await context.supabase.rpc("recompute_employee_kpi", { _employee_id: e.id, _period: period });
      await context.supabase.rpc("recompute_payroll", { _employee_id: e.id, _period: period });
    }
    return { ok: true, count: emps?.length ?? 0 };
  });
