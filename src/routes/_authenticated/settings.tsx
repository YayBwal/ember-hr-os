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
import { createTeamLeader, listTeamLeaders, deleteTeamLeader, listEligibleEmployees } from "@/lib/admin-users.functions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

        <TeamLeaderAdmin />
      </div>
    </AppShell>
  );
}

function TeamLeaderAdmin() {
  const isAdmin = useHasRole("admin");
  const qc = useQueryClient();
  const listFn = useServerFn(listTeamLeaders);
  const createFn = useServerFn(createTeamLeader);
  const delFn = useServerFn(deleteTeamLeader);
  const eligibleFn = useServerFn(listEligibleEmployees);

  const { data: leaders } = useQuery({
    queryKey: ["admin", "team-leaders"],
    enabled: isAdmin,
    queryFn: () => listFn({ data: undefined as never }),
  });

  const { data: eligible } = useQuery({
    queryKey: ["admin", "eligible-employees"],
    enabled: isAdmin,
    queryFn: () => eligibleFn({ data: undefined as never }),
  });

  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");

  const selectedEmp = (eligible ?? []).find((e) => e.id === employeeId);

  const create = useMutation({
    mutationFn: () => createFn({ data: { employee_id: employeeId, password } }),
    onSuccess: () => {
      toast.success("Team Leader account created. Share the credentials privately.");
      setEmployeeId(""); setPassword(""); setOpen(false);
      qc.invalidateQueries({ queryKey: ["admin", "team-leaders"] });
      qc.invalidateQueries({ queryKey: ["admin", "eligible-employees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (user_id: string) => delFn({ data: { user_id } }),
    onSuccess: () => {
      toast.success("Team Leader removed");
      qc.invalidateQueries({ queryKey: ["admin", "team-leaders"] });
      qc.invalidateQueries({ queryKey: ["admin", "eligible-employees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) return null;

  const availableEmployees = (eligible ?? []).filter((e) => !e.taken);

  return (
    <div className="mt-8 max-w-3xl space-y-4 rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-amber-500" />
            <h2 className="font-display text-lg font-semibold tracking-tight">Team Leaders</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Only existing company employees can be promoted to Team Leader. Pick an employee, set a temporary password,
            and share the email and password privately (e.g. via your team chat).
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen((v) => !v)}>
          <UserPlus className="mr-1.5 h-4 w-4" /> {open ? "Cancel" : "New leader"}
        </Button>
      </div>

      {open && (
        <div className="grid gap-3 rounded-lg border border-dashed border-border p-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="tl-emp">Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger id="tl-emp">
                <SelectValue placeholder={availableEmployees.length ? "Select an employee…" : "No eligible employees"} />
              </SelectTrigger>
              <SelectContent>
                {availableEmployees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.full_name} — {e.email}
                    {e.position ? ` · ${e.position}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedEmp && (
              <div className="text-xs text-muted-foreground">
                {selectedEmp.department ?? "—"} · {selectedEmp.position ?? "—"}
              </div>
            )}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="tl-pass">Temporary password</Label>
            <Input id="tl-pass" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 8 characters" />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button
              onClick={() => create.mutate()}
              disabled={create.isPending || !employeeId || password.length < 8}
            >
              Create account
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {(leaders ?? []).length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No team leaders yet.
          </div>
        )}
        {(leaders ?? []).map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-amber-500/10 text-amber-600 text-xs">{initials(l.full_name ?? l.email ?? "?")}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{l.full_name ?? "Unnamed"}</div>
                <div className="truncate text-xs text-muted-foreground">{l.email ?? "—"}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">Team Leader</Badge>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => {
                  if (confirm(`Remove ${l.full_name ?? l.email}? This deletes their login.`)) remove.mutate(l.id);
                }}
                disabled={remove.isPending}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

