import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Dept = "HR" | "Operations" | "Finance" | "Admin" | "Engineering";

function periodMonth(d?: string) {
  const date = d ? new Date(d) : new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export const approveCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { candidateId: string; department: Dept; position: string; monthlyBase: number; teamId?: string | null }) => d)
  .handler(async ({ data, context }) => {
    const args: { _candidate_id: string; _department: Dept; _position: string; _monthly_base: number; _team_id?: string } = {
      _candidate_id: data.candidateId,
      _department: data.department,
      _position: data.position,
      _monthly_base: data.monthlyBase,
    };
    if (data.teamId) args._team_id = data.teamId;
    const { data: empId, error } = await context.supabase.rpc("approve_candidate", args);
    if (error) throw new Error(error.message);
    return { employeeId: empId as string };
  });

export const logAttendance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { employeeId: string; date: string; status: "present" | "late" | "absent" | "leave"; minutesLate?: number; note?: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("attendance")
      .upsert(
        {
          employee_id: data.employeeId,
          date: data.date,
          status: data.status,
          minutes_late: data.minutesLate ?? 0,
          note: data.note ?? null,
        },
        { onConflict: "employee_id,date" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setProductivityQuality = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { employeeId: string; periodMonth?: string; productivity: number; quality: number }) => d)
  .handler(async ({ data, context }) => {
    const period = periodMonth(data.periodMonth);
    // Ensure a row exists, then update productivity/quality (trigger fires payroll recompute).
    await context.supabase.rpc("recompute_employee_kpi", { _employee_id: data.employeeId, _period: period });
    const { error } = await context.supabase
      .from("employee_kpis")
      .update({ productivity: data.productivity, quality: data.quality })
      .eq("employee_id", data.employeeId)
      .eq("period_month", period);
    if (error) throw new Error(error.message);
    // recompute again to apply new prod/quality to kpi
    await context.supabase.rpc("recompute_employee_kpi", { _employee_id: data.employeeId, _period: period });
    return { ok: true };
  });

export const createTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string; department: Dept; teamLeadEmployeeId?: string | null }) => d)
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase.from("profiles").select("org_id").eq("id", context.userId).maybeSingle();
    if (!profile?.org_id) throw new Error("No org");
    const { data: row, error } = await context.supabase
      .from("teams")
      .insert({ org_id: profile.org_id, name: data.name, department: data.department, team_lead_employee_id: data.teamLeadEmployeeId ?? null })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const renameTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; name?: string; teamLeadEmployeeId?: string | null; department?: Dept }) => d)
  .handler(async ({ data, context }) => {
    const patch: { name?: string; department?: Dept; team_lead_employee_id?: string | null } = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.department !== undefined) patch.department = data.department;
    if (data.teamLeadEmployeeId !== undefined) patch.team_lead_employee_id = data.teamLeadEmployeeId;
    const { error } = await context.supabase.from("teams").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("teams").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const assignMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { teamId: string; employeeId: string; makePrimary?: boolean }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("team_members").insert({ team_id: data.teamId, employee_id: data.employeeId });
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    if (data.makePrimary !== false) {
      await context.supabase.from("employees").update({ team_id: data.teamId }).eq("id", data.employeeId);
    }
    return { ok: true };
  });

export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { teamId: string; employeeId: string }) => d)
  .handler(async ({ data, context }) => {
    await context.supabase.from("team_members").delete().eq("team_id", data.teamId).eq("employee_id", data.employeeId);
    await context.supabase.from("employees").update({ team_id: null }).eq("id", data.employeeId).eq("team_id", data.teamId);
    return { ok: true };
  });
