import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const appointTeamLeader = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { teamId: string; employeeId: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("appoint_team_leader", {
      _team_id: data.teamId,
      _employee_id: data.employeeId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeTeamLeader = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { teamId: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("remove_team_leader", { _team_id: data.teamId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addTeamMemberFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { teamId: string; employeeId: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("add_team_member", {
      _team_id: data.teamId,
      _employee_id: data.employeeId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeTeamMemberFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { teamId: string; employeeId: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("remove_team_member", {
      _team_id: data.teamId,
      _employee_id: data.employeeId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveTeamReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id?: string | null;
      teamId: string;
      periodStart: string;
      periodEnd: string;
      summary?: string;
      fileUrl?: string | null;
      submit?: boolean;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("org_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile?.org_id) throw new Error("No org");
    const payload = {
      org_id: profile.org_id,
      team_id: data.teamId,
      period_start: data.periodStart,
      period_end: data.periodEnd,
      summary: data.summary ?? null,
      file_url: data.fileUrl ?? null,
      status: data.submit ? "submitted" : "draft",
      submitted_by: context.userId,
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("team_reports")
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from("team_reports")
      .upsert(payload, { onConflict: "team_id,period_start" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const rateMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { reportId: string; employeeId: string; rating: number; note?: string }) => d,
  )
  .handler(async ({ data, context }) => {
    // Single TL rating; stored into both productivity & quality columns for back-compat
    // (recompute_employee_kpi averages them, so the average equals the single rating).
    const { error } = await context.supabase
      .from("member_ratings")
      .upsert(
        {
          report_id: data.reportId,
          employee_id: data.employeeId,
          productivity: data.rating,
          quality: data.rating,
          note: data.note ?? null,
        },
        { onConflict: "report_id,employee_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

