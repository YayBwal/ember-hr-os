import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Loader2, Plus, Trash2, Upload, ShieldCheck, UserMinus, UserPlus2, Crown } from "lucide-react";
import { toast } from "sonner";
import { initials } from "@/lib/format";
import { useHasRole } from "@/hooks/use-user-roles";
import {
  appointTeamLeader,
  removeTeamLeader,
  addTeamMemberFn,
  removeTeamMemberFn,
  saveTeamReport,
  rateMember,
  submitPeerReview,
} from "@/lib/teams.functions";
import { renameTeam } from "@/lib/operations.functions";
import { createTask, updateTask } from "@/lib/delivery.functions";

type Team = { id: string; name: string; department: string; team_lead_employee_id: string | null; org_id: string };
type Emp = { id: string; full_name: string; email: string | null; position: string | null; team_id: string | null; performance_score: number | null };

function thisMonth() {
  const d = new Date();
  return {
    start: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10),
  };
}

export function TeamDetailSheet({ team, allEmployees, onClose }: { team: Team | null; allEmployees: Emp[]; onClose: () => void }) {
  const open = !!team;
  const isAdmin = useHasRole("admin");

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        {team && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className="font-display text-lg">{team.name}</span>
                <Badge variant="outline" className="text-xs">{team.department}</Badge>
              </SheetTitle>
            </SheetHeader>
            {isAdmin && <RenameTeamRow team={team} />}
            <Tabs defaultValue="members" className="mt-4">
              <TabsList>
                <TabsTrigger value="members">Members</TabsTrigger>
                <TabsTrigger value="tasks">Tasks</TabsTrigger>
                <TabsTrigger value="reports">Reports</TabsTrigger>
                <TabsTrigger value="peer">Peer Reviews</TabsTrigger>
              </TabsList>
              <TabsContent value="members" className="mt-3"><MembersTab team={team} allEmployees={allEmployees} isAdmin={isAdmin} /></TabsContent>
              <TabsContent value="tasks" className="mt-3"><TeamTasksTab team={team} allEmployees={allEmployees} readOnly={isAdmin} /></TabsContent>
              <TabsContent value="reports" className="mt-3"><ReportsTab team={team} allEmployees={allEmployees} isAdmin={isAdmin} /></TabsContent>
              <TabsContent value="peer" className="mt-3"><PeerReviewTab team={team} allEmployees={allEmployees} isAdmin={isAdmin} /></TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function RenameTeamRow({ team }: { team: Team }) {
  const qc = useQueryClient();
  const rename = useServerFn(renameTeam);
  const [name, setName] = useState(team.name);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim() || name.trim() === team.name) return;
    setSaving(true);
    try {
      await rename({ data: { id: team.id, name: name.trim() } });
      toast.success("Team renamed");
      qc.invalidateQueries({ queryKey: ["teams"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="mt-3 flex items-end gap-2">
      <div className="flex-1">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Rename team</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" />
      </div>
      <Button size="sm" variant="outline" onClick={save} disabled={saving || !name.trim() || name.trim() === team.name}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
      </Button>
    </div>
  );
}

function MembersTab({ team, allEmployees, isAdmin }: { team: Team; allEmployees: Emp[]; isAdmin: boolean }) {
  const qc = useQueryClient();
  const appoint = useServerFn(appointTeamLeader);
  const unappoint = useServerFn(removeTeamLeader);
  const addMem = useServerFn(addTeamMemberFn);
  const removeMem = useServerFn(removeTeamMemberFn);
  const { data: members } = useQuery({
    queryKey: ["team_members", team.id],
    queryFn: async () => {
      const { data } = await supabase.from("team_members").select("employee_id").eq("team_id", team.id);
      return (data ?? []).map((r) => r.employee_id as string);
    },
  });
  const memberIds = new Set(members ?? []);
  const memberEmps = allEmployees.filter((e) => memberIds.has(e.id));
  const available = allEmployees.filter((e) => !memberIds.has(e.id));
  const lead = allEmployees.find((e) => e.id === team.team_lead_employee_id);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["team_members", team.id] });
    qc.invalidateQueries({ queryKey: ["teams"] });
    qc.invalidateQueries({ queryKey: ["employees"] });
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-amber-500" />
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Team Leader</span>
          </div>
          {isAdmin && lead && (
            <Button size="sm" variant="ghost" onClick={() => unappoint({ data: { teamId: team.id } }).then(() => { toast.success("Removed"); invalidate(); })}>Remove</Button>
          )}
        </div>
        {lead ? (
          <div className="mt-2 flex items-center gap-2">
            <Avatar className="h-7 w-7"><AvatarFallback className="text-xs">{initials(lead.full_name)}</AvatarFallback></Avatar>
            <div className="text-sm">
              <div className="font-medium">{lead.full_name}</div>
              <div className="text-xs text-muted-foreground">{lead.position}</div>
            </div>
          </div>
        ) : (
          <div className="mt-2 text-xs text-muted-foreground">No leader assigned.</div>
        )}
        {isAdmin && (
          <div className="mt-2">
            <Select onValueChange={(v) => appoint({ data: { teamId: team.id, employeeId: v } }).then(() => { toast.success("Appointed"); invalidate(); }).catch((e: Error) => toast.error(e.message))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={lead ? "Reassign team leader…" : "Appoint team leader…"} /></SelectTrigger>
              <SelectContent>
                {allEmployees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Members · {memberEmps.length}</div>
          {!isAdmin && <span className="text-[10px] text-muted-foreground">HR manages roster</span>}
        </div>
        <div className="mt-2 space-y-1">
          {memberEmps.map((e) => (
            <div key={e.id} className="flex items-center justify-between rounded border border-border px-2 py-1 text-sm">
              <div className="flex items-center gap-2">
                <Avatar className="h-6 w-6"><AvatarFallback className="text-[10px]">{initials(e.full_name)}</AvatarFallback></Avatar>
                <div>
                  <div className="font-medium">{e.full_name}</div>
                  <div className="text-[10px] text-muted-foreground">{e.position}</div>
                </div>
              </div>
              {isAdmin && (
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeMem({ data: { teamId: team.id, employeeId: e.id } }).then(() => { toast.success("Removed"); invalidate(); })}>
                  <UserMinus className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
          {memberEmps.length === 0 && <div className="text-xs text-muted-foreground">No members yet.</div>}
        </div>
        {isAdmin && available.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <UserPlus2 className="h-4 w-4 text-muted-foreground" />
            <Select onValueChange={(v) => addMem({ data: { teamId: team.id, employeeId: v } }).then(() => { toast.success("Added"); invalidate(); }).catch((e: Error) => toast.error(e.message))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Add member…" /></SelectTrigger>
              <SelectContent>
                {available.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}

function TeamTasksTab({ team, allEmployees, readOnly = false }: { team: Team; allEmployees: Emp[]; readOnly?: boolean }) {
  const qc = useQueryClient();
  const create = useServerFn(createTask);
  const update = useServerFn(updateTask);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState<string>("");
  const { data: tasks } = useQuery({
    queryKey: ["team_tasks", team.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("tasks")
        .select("id,title,status,priority,progress,assignee_employee_id,due_date")
        .eq("team_id", team.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });
  const { data: members } = useQuery({
    queryKey: ["team_members", team.id],
    queryFn: async () => {
      const { data } = await supabase.from("team_members").select("employee_id").eq("team_id", team.id);
      return (data ?? []).map((r) => r.employee_id as string);
    },
  });
  const memSet = new Set(members ?? []);
  const teamMembers = allEmployees.filter((e) => memSet.has(e.id));
  const empName = (id: string | null) => allEmployees.find((e) => e.id === id)?.full_name ?? "Unassigned";

  const add = useMutation({
    mutationFn: () => create({ data: { title, teamId: team.id, assigneeEmployeeId: assignee || null, priority: "medium" } }),
    onSuccess: () => { toast.success("Task created"); setTitle(""); setAssignee(""); qc.invalidateQueries({ queryKey: ["team_tasks", team.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  // HR/Admin: read-only view of assignments + per-member counts for KPI auditing
  if (readOnly) {
    const counts = teamMembers.map((m) => {
      const all = (tasks ?? []).filter((t) => t.assignee_employee_id === m.id);
      const done = all.filter((t) => t.status === "done").length;
      return { id: m.id, name: m.full_name, total: all.length, done };
    });
    const unassigned = (tasks ?? []).filter((t) => !t.assignee_employee_id).length;
    return (
      <div className="space-y-3">
        <div className="rounded border border-dashed border-border bg-muted/30 p-2 text-[11px] text-muted-foreground">
          Read-only · Team Leader assigns tasks. HR views assignments to audit KPI.
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Workload per member</div>
          <div className="mt-2 space-y-1">
            {counts.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded border border-border px-2 py-1 text-xs">
                <span>{c.name}</span>
                <span className="font-mono text-muted-foreground">{c.done}/{c.total} done</span>
              </div>
            ))}
            {counts.length === 0 && <div className="text-xs text-muted-foreground">No members.</div>}
            {unassigned > 0 && <div className="text-[11px] text-amber-600">{unassigned} unassigned task(s)</div>}
          </div>
        </div>
        <div className="space-y-1.5">
          {(tasks ?? []).map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded border border-border bg-card p-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{t.title}</div>
                <div className="text-[10px] text-muted-foreground">{empName(t.assignee_employee_id)} · {t.due_date ?? "—"}</div>
              </div>
              <Badge variant="outline" className="text-[10px]">{t.status}</Badge>
            </div>
          ))}
          {(tasks?.length ?? 0) === 0 && <div className="rounded border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No tasks for this team.</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1"><Label className="text-xs">New task</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" /></div>
        <Select value={assignee} onValueChange={setAssignee}>
          <SelectTrigger className="w-40 text-xs"><SelectValue placeholder="Assignee" /></SelectTrigger>
          <SelectContent>{teamMembers.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" onClick={() => add.mutate()} disabled={!title || add.isPending}>{add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}</Button>
      </div>
      <div className="space-y-1.5">
        {(tasks ?? []).map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded border border-border bg-card p-2 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium">{t.title}</div>
              <div className="text-[10px] text-muted-foreground">{empName(t.assignee_employee_id)} · {t.due_date ?? "—"}</div>
            </div>
            <Select value={t.status as string} onValueChange={(v) => update({ data: { id: t.id, status: v as never } }).then(() => qc.invalidateQueries({ queryKey: ["team_tasks", team.id] }))}>
              <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{["todo", "in_progress", "review", "done", "blocked", "cancelled"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ))}
        {(tasks?.length ?? 0) === 0 && <div className="rounded border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No tasks for this team.</div>}
      </div>
    </div>
  );
}

function ReportsTab({ team, allEmployees, isAdmin }: { team: Team; allEmployees: Emp[]; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data: reports } = useQuery({
    queryKey: ["team_reports", team.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("team_reports")
        .select("id, period_start, period_end, summary, file_url, status, created_at")
        .eq("team_id", team.id)
        .order("period_start", { ascending: false });
      return data ?? [];
    },
  });
  const { data: ratings } = useQuery({
    queryKey: ["member_ratings", team.id],
    queryFn: async () => {
      const ids = (reports ?? []).map((r) => r.id);
      if (ids.length === 0) return [] as { report_id: string; employee_id: string; productivity: number; quality: number; note: string | null }[];
      const { data } = await supabase.from("member_ratings").select("report_id, employee_id, productivity, quality, note").in("report_id", ids);
      return data ?? [];
    },
    enabled: (reports?.length ?? 0) > 0,
  });

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">{isAdmin ? "All submitted reports for this team. Admins can review ratings; TL files reports from the Team Leader Hub." : "Team report history."}</div>
      {(reports ?? []).map((r) => {
        const rs = (ratings ?? []).filter((x) => x.report_id === r.id);
        return (
          <div key={r.id} className="rounded border border-border bg-card p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">{r.period_start} → {r.period_end}</div>
                <div className="text-[10px] text-muted-foreground">Saved {new Date(r.created_at).toLocaleDateString()}</div>
              </div>
              <Badge variant={r.status === "submitted" ? "default" : "outline"}>{r.status}</Badge>
            </div>
            {r.summary && <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">{r.summary}</p>}
            {r.file_url && <a href={r.file_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-primary underline">attached file</a>}
            {rs.length > 0 && (
              <div className="mt-2 space-y-1">
                {rs.map((rt) => {
                  const emp = allEmployees.find((e) => e.id === rt.employee_id);
                  return (
                    <div key={rt.employee_id} className="flex items-center justify-between rounded border border-border/60 px-2 py-1 text-xs">
                      <span>{emp?.full_name ?? "?"}</span>
                      <span className="font-mono">prod {rt.productivity} · qual {rt.quality}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {(reports?.length ?? 0) === 0 && <div className="rounded border border-dashed border-border p-6 text-center text-xs text-muted-foreground">No reports yet.</div>}
    </div>
  );
}

function PeerReviewTab({ team, allEmployees, isAdmin }: { team: Team; allEmployees: Emp[]; isAdmin: boolean }) {
  const qc = useQueryClient();
  const submit = useServerFn(submitPeerReview);
  const period = thisMonth().start;

  const { data: meEmp } = useQuery({
    queryKey: ["me", "employee"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user?.email) return null;
      const { data } = await supabase.from("employees").select("id, full_name").eq("email", u.user.email).maybeSingle();
      return data;
    },
  });
  const { data: members } = useQuery({
    queryKey: ["team_members", team.id],
    queryFn: async () => {
      const { data } = await supabase.from("team_members").select("employee_id").eq("team_id", team.id);
      return (data ?? []).map((r) => r.employee_id as string);
    },
  });
  const memberIds = new Set(members ?? []);
  const teammates = allEmployees.filter((e) => memberIds.has(e.id) && e.id !== meEmp?.id);

  const { data: myReviews } = useQuery({
    queryKey: ["peer_reviews_mine", team.id, period],
    enabled: !!meEmp?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("peer_reviews")
        .select("reviewee_employee_id, score")
        .eq("team_id", team.id)
        .eq("period_month", period)
        .eq("reviewer_employee_id", meEmp!.id);
      return data ?? [];
    },
  });
  const scoreOf = (id: string) => myReviews?.find((r) => r.reviewee_employee_id === id)?.score ?? null;

  const isTeamMember = !!meEmp && memberIds.has(meEmp.id);

  return (
    <div className="space-y-4">
      {isTeamMember && (
        <div>
          <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Rate teammates · {period.slice(0, 7)}</div>
          <div className="mt-2 space-y-2">
            {teammates.map((t) => <PeerRow key={t.id} teammate={t} current={scoreOf(t.id)} onSave={(score, note) => submit({ data: { teamId: team.id, revieweeEmployeeId: t.id, periodMonth: period, score, note } }).then(() => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["peer_reviews_mine", team.id, period] }); }).catch((e: Error) => toast.error(e.message))} />)}
            {teammates.length === 0 && <div className="text-xs text-muted-foreground">No teammates to rate.</div>}
          </div>
        </div>
      )}
      {isAdmin && <PeerAggregates team={team} allEmployees={allEmployees} memberIds={[...memberIds]} period={period} />}
      {!isAdmin && !isTeamMember && <div className="rounded border border-dashed border-border p-6 text-center text-xs text-muted-foreground">You're not a member of this team.</div>}
    </div>
  );
}

function PeerRow({ teammate, current, onSave }: { teammate: Emp; current: number | null; onSave: (score: number, note?: string) => void }) {
  const [score, setScore] = useState(current ?? 80);
  const [note, setNote] = useState("");
  return (
    <div className="rounded border border-border bg-card p-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Avatar className="h-6 w-6"><AvatarFallback className="text-[10px]">{initials(teammate.full_name)}</AvatarFallback></Avatar><span className="text-sm">{teammate.full_name}</span></div>
        <span className="font-mono text-xs">{score}</span>
      </div>
      <Slider value={[score]} onValueChange={(v) => setScore(v[0])} min={0} max={100} step={5} className="mt-2" />
      <div className="mt-2 flex gap-2">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note (anonymous)" className="h-7 text-xs" />
        <Button size="sm" variant="secondary" onClick={() => onSave(score, note || undefined)}>{current === null ? "Submit" : "Update"}</Button>
      </div>
    </div>
  );
}

function PeerAggregates({ team, allEmployees, memberIds, period }: { team: Team; allEmployees: Emp[]; memberIds: string[]; period: string }) {
  const { data: aggs } = useQuery({
    queryKey: ["peer_aggs", team.id, period],
    queryFn: async () => {
      const out: Record<string, { avg: number; count: number }> = {};
      await Promise.all(memberIds.map(async (id) => {
        const { data } = await supabase.rpc("get_peer_avg", { _employee_id: id, _period: period });
        const row = (data ?? [])[0] as { avg_score: number; review_count: number } | undefined;
        out[id] = { avg: Number(row?.avg_score ?? 0), count: row?.review_count ?? 0 };
      }));
      return out;
    },
  });
  return (
    <div>
      <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Peer review aggregates (admin)</div>
      <div className="mt-2 space-y-1">
        {memberIds.map((id) => {
          const emp = allEmployees.find((e) => e.id === id);
          const a = aggs?.[id];
          return (
            <div key={id} className="flex items-center justify-between rounded border border-border px-2 py-1 text-xs">
              <span>{emp?.full_name ?? id}</span>
              <span className="font-mono">{a ? `${a.avg.toFixed(1)} (${a.count} reviews)` : "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
