import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type CreateTLInput = { employee_id: string; password: string };

export const listEligibleEmployees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: emps } = await supabaseAdmin
      .from("employees")
      .select("id, full_name, email, position, department")
      .not("email", "is", null)
      .order("full_name");
    const list = (emps ?? []).filter((e) => !!e.email);
    if (list.length === 0) return [] as Array<{ id: string; full_name: string; email: string; position: string | null; department: string | null; taken: boolean }>;
    // Mark employees whose email already has any auth account
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const emailSet = new Set(users.users.map((u) => (u.email ?? "").toLowerCase()));
    return list.map((e) => ({
      id: e.id,
      full_name: e.full_name,
      email: e.email as string,
      position: e.position ?? null,
      department: e.department ?? null,
      taken: emailSet.has((e.email as string).toLowerCase()),
    }));
  });

export const createTeamLeader = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: CreateTLInput) => {
    if (!d?.employee_id) throw new Error("Select an employee");
    if (!d?.password || d.password.length < 8) throw new Error("Password must be at least 8 characters");
    return { employee_id: d.employee_id, password: d.password };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden: admin only");

    const { data: me } = await supabase.from("profiles").select("org_id").eq("id", userId).maybeSingle();
    const orgId = me?.org_id;
    if (!orgId) throw new Error("Admin has no organization");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: emp } = await supabaseAdmin
      .from("employees")
      .select("id, full_name, email, org_id")
      .eq("id", data.employee_id)
      .maybeSingle();
    if (!emp) throw new Error("Employee not found");
    if (!emp.email) throw new Error("Employee has no email on file");
    if (emp.org_id !== orgId) throw new Error("Employee is in a different organization");

    const email = (emp.email as string).trim().toLowerCase();
    const full_name = emp.full_name as string;

    // Block if any auth user already exists for this email
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const existing = users.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (existing) throw new Error("An account already exists for this employee");

    const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name, join_org_id: orgId, role: "team_leader" },
    });
    if (cErr || !created.user) throw new Error(cErr?.message ?? "Failed to create user");
    const newId = created.user.id;

    // Belt-and-suspenders: strip any non-team_leader role, ensure team_leader exists.
    await supabaseAdmin.from("user_roles").delete().eq("user_id", newId).neq("role", "team_leader");
    const { error: rErr } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: newId, role: "team_leader" }, { onConflict: "user_id,role" });
    if (rErr) throw new Error(rErr.message);
    await supabaseAdmin.from("profiles").update({ org_id: orgId, full_name }).eq("id", newId);

    return { ok: true, user_id: newId, email };
  });

export const listTeamLeaders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "team_leader");
    const ids = (roles ?? []).map((r) => r.user_id);
    if (ids.length === 0) return [] as Array<{ id: string; email: string | null; full_name: string | null }>;
    const { data: profiles } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", ids);
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const emailMap = new Map(users.users.map((u) => [u.id, u.email ?? null]));
    return (profiles ?? []).map((p) => ({
      id: p.id,
      full_name: p.full_name,
      email: emailMap.get(p.id) ?? null,
    }));
  });

export const deleteTeamLeader = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string }) => {
    if (!d?.user_id) throw new Error("user_id required");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    if (data.user_id === userId) throw new Error("Cannot delete yourself");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", data.user_id);
    const roleList = (roles ?? []).map((r) => r.role);
    if (roleList.includes("admin")) throw new Error("Cannot remove an admin via this action");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
