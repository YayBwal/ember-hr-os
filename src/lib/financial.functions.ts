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

export type EmployeeLevel = "trainee" | "junior" | "mid" | "senior" | "lead";

export const promoteEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    employeeId: string;
    toLevel: EmployeeLevel;
    toPosition: string;
    toBaseMmk: number;
    effectiveDate?: string;
    note: string;
  }) => {
    if (!d.note || d.note.trim().length === 0) throw new Error("Reason is required");
    return { ...d, note: d.note.trim() };
  })
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("promote_employee", {
      _employee_id: data.employeeId,
      _to_level: data.toLevel,
      _to_position: data.toPosition,
      _to_base_mmk: data.toBaseMmk,
      _effective_date: data.effectiveDate ?? new Date().toISOString().slice(0, 10),
      _note: data.note,
    } as never);
    if (error) throw new Error(error.message);
    return { id };
  });
