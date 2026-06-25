import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type CreateTLInput = { email: string; password: string; full_name: string };

export const createTeamLeader = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: CreateTLInput) => {
    if (!d?.email || !/^\S+@\S+\.\S+$/.test(d.email)) throw new Error("Valid email required");
    if (!d?.password || d.password.length < 8) throw new Error("Password must be at least 8 characters");
    if (!d?.full_name || !d.full_name.trim()) throw new Error("Full name required");
    return { email: d.email.trim().toLowerCase(), password: d.password, full_name: d.full_name.trim() };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden: admin only");

    const { data: me } = await supabase.from("profiles").select("org_id").eq("id", userId).maybeSingle();
    const orgId = me?.org_id;
    if (!orgId) throw new Error("Admin has no organization");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name, join_org_id: orgId },
    });
    if (cErr || !created.user) throw new Error(cErr?.message ?? "Failed to create user");
    const newId = created.user.id;

    // handle_new_user trigger inserts admin role + profile. Replace role with team_leader.
    await supabaseAdmin.from("user_roles").delete().eq("user_id", newId);
    const { error: rErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newId, role: "team_leader" });
    if (rErr) throw new Error(rErr.message);
    await supabaseAdmin.from("profiles").update({ org_id: orgId, full_name: data.full_name }).eq("id", newId);

    return { ok: true, user_id: newId, email: data.email };
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
    // Only allow deletion of team-leader-only accounts (not admins).
    const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", data.user_id);
    const roleList = (roles ?? []).map((r) => r.role);
    if (roleList.includes("admin")) throw new Error("Cannot remove an admin via this action");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
