import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { initials } from "@/lib/format";
import { toast } from "sonner";
import { useHasRole } from "@/hooks/use-user-roles";
import { createTeamLeader, listTeamLeaders, deleteTeamLeader } from "@/lib/admin-users.functions";
import { Crown, Trash2, UserPlus } from "lucide-react";


export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings · Mandai" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const { data: profile } = useQuery({
    queryKey: ["me", "profile"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, org_id")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [name, setName] = useState("");
  useEffect(() => {
    setName(profile?.full_name ?? "");
  }, [profile?.full_name]);

  const save = useMutation({
    mutationFn: async () => {
      if (!profile?.id) throw new Error("Not signed in");
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: name.trim() })
        .eq("id", profile.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profile updated");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell>
      <div className="px-4 py-6 md:px-8">
        <div className="text-xs font-mono uppercase tracking-[0.2em] text-primary">Settings</div>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Profile</h1>

        <div className="mt-6 max-w-xl space-y-6 rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14">
              <AvatarFallback className="bg-primary/10 text-primary">{initials(name || "?")}</AvatarFallback>
            </Avatar>
            <div className="text-sm text-muted-foreground">Display avatar derived from your name.</div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </div>

          <div className="flex justify-end">
            <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
              Save changes
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
