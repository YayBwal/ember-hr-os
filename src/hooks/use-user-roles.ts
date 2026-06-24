import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "recruiter" | "hr" | "finance" | "team_leader";

export function useUserRoles() {
  return useQuery({
    queryKey: ["me", "roles"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [] as AppRole[];
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
      return (data ?? []).map((r) => r.role as AppRole);
    },
  });
}

export function useHasRole(role: AppRole) {
  const { data } = useUserRoles();
  return (data ?? []).includes(role);
}
