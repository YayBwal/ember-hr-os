import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Plus, Users as UsersIcon } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

type Org = { id: string; name: string; created_at: string; member_count: number };
type UserRow = { id: string; full_name: string | null; org_id: string | null; org_name: string | null; email: string | null };

export const Route = createFileRoute("/_authenticated/organization")({
  head: () => ({ meta: [{ title: "Organizations · Admin" }] }),
  component: OrganizationPage,
});

function OrganizationPage() {
  const qc = useQueryClient();
  const [newOrgName, setNewOrgName] = useState("");

  const me = useQuery({
    queryKey: ["me", "profile"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, org_id")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const orgs = useQuery({
    queryKey: ["admin", "organizations"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_organizations");
      if (error) throw error;
      return (data ?? []) as Org[];
    },
  });

  const users = useQuery({
    queryKey: ["admin", "all_users"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_all_users");
      if (error) throw error;
      return (data ?? []) as UserRow[];
    },
  });

  const switchOrg = useMutation({
    mutationFn: async (orgId: string) => {
      const { error } = await supabase.rpc("switch_my_org", { _org_id: orgId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Switched organization");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createOrg = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.rpc("create_and_switch_org", { _name: name });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Organization created — you're now in it");
      setNewOrgName("");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reassign = useMutation({
    mutationFn: async ({ userId, orgId }: { userId: string; orgId: string }) => {
      const { error } = await supabase.rpc("admin_set_user_org", {
        _user_id: userId,
        _org_id: orgId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("User reassigned");
      qc.invalidateQueries({ queryKey: ["admin", "all_users"] });
      qc.invalidateQueries({ queryKey: ["admin", "organizations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const myOrgSettings = useQuery({
    queryKey: ["my-org-settings", me.data?.org_id],
    enabled: !!me.data?.org_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("organizations")
        .select("default_trainee_salary_mmk")
        .eq("id", me.data!.org_id!)
        .maybeSingle();
      return data;
    },
  });
  const [traineeSalary, setTraineeSalary] = useState<string>("");
  const currentDefault = myOrgSettings.data?.default_trainee_salary_mmk;
  const setDefaultTrainee = useMutation({
    mutationFn: async (amount: number) => {
      const { error } = await supabase.rpc("set_org_default_trainee_salary", { _amount: amount });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Default trainee salary updated");
      qc.invalidateQueries({ queryKey: ["my-org-settings"] });
      qc.invalidateQueries({ queryKey: ["org-defaults"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const orgOptions = useMemo(() => orgs.data ?? [], [orgs.data]);
  const isAdminError = (orgs.error as Error | undefined)?.message?.toLowerCase().includes("forbidden");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 p-6">
      <header>
        <div className="text-xs font-mono uppercase tracking-widest text-primary">Admin</div>
        <h1 className="mt-1 text-3xl font-semibold">Organizations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Switch your active organization, create a new one, or reassign other users.
        </p>
      </header>

      {isAdminError ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            You need the admin role to manage organizations.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* My org switcher + create */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4" /> My organization
              </CardTitle>
              <CardDescription>Pick an existing organization or create a new one. Your pipeline and operations data will follow.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select
                  value={me.data?.org_id ?? undefined}
                  onValueChange={(v) => switchOrg.mutate(v)}
                  disabled={switchOrg.isPending || !orgs.data}
                >
                  <SelectTrigger className="sm:w-80">
                    <SelectValue placeholder="Select organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {orgOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name} <span className="text-muted-foreground">· {o.member_count} member{o.member_count === 1 ? "" : "s"}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">
                  Currently signed into: {orgOptions.find((o) => o.id === me.data?.org_id)?.name ?? "—"}
                </span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  placeholder="New organization name"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  className="sm:max-w-sm"
                />
                <Button
                  onClick={() => createOrg.mutate(newOrgName.trim())}
                  disabled={!newOrgName.trim() || createOrg.isPending}
                >
                  <Plus className="h-4 w-4" /> Create & switch
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Trainee salary default */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trainee defaults</CardTitle>
              <CardDescription>Default monthly salary (MMK) used when moving candidates into the Trainee stage. Override per person in Pipeline.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  type="number"
                  placeholder={currentDefault ? String(currentDefault) : "500000"}
                  value={traineeSalary}
                  onChange={(e) => setTraineeSalary(e.target.value)}
                  className="sm:max-w-xs"
                />
                <Button
                  onClick={() => setDefaultTrainee.mutate(Number(traineeSalary))}
                  disabled={!traineeSalary || setDefaultTrainee.isPending}
                >
                  Save default
                </Button>
                <span className="text-xs text-muted-foreground">
                  Current: {currentDefault ? `${currentDefault.toLocaleString()} MMK` : "—"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* All orgs */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">All organizations</CardTitle>
              <CardDescription>{orgs.data?.length ?? 0} total</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Name</th>
                      <th className="px-3 py-2 text-left font-medium">Members</th>
                      <th className="px-3 py-2 text-left font-medium">Created</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {(orgs.data ?? []).map((o) => (
                      <tr key={o.id} className="border-t">
                        <td className="px-3 py-2 font-medium">
                          {o.name}
                          {o.id === me.data?.org_id && (
                            <Badge variant="secondary" className="ml-2 gap-1">
                              <Check className="h-3 w-3" /> active
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{o.member_count}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {new Date(o.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {o.id !== me.data?.org_id && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => switchOrg.mutate(o.id)}
                              disabled={switchOrg.isPending}
                            >
                              Switch to
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* User reassignment */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UsersIcon className="h-4 w-4" /> Users
              </CardTitle>
              <CardDescription>Move any user to a different organization.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">User</th>
                      <th className="px-3 py-2 text-left font-medium">Email</th>
                      <th className="px-3 py-2 text-left font-medium">Organization</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(users.data ?? []).map((u) => (
                      <tr key={u.id} className="border-t">
                        <td className="px-3 py-2 font-medium">{u.full_name ?? "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{u.email ?? "—"}</td>
                        <td className="px-3 py-2">
                          <Select
                            value={u.org_id ?? undefined}
                            onValueChange={(v) => reassign.mutate({ userId: u.id, orgId: v })}
                            disabled={reassign.isPending}
                          >
                            <SelectTrigger className="w-72">
                              <SelectValue placeholder="Assign to org" />
                            </SelectTrigger>
                            <SelectContent>
                              {orgOptions.map((o) => (
                                <SelectItem key={o.id} value={o.id}>
                                  {o.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
