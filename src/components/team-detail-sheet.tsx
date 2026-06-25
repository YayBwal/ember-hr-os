import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Loader2, Plus, UserMinus, UserPlus2, Crown, CheckCircle2, MessageSquare } from "lucide-react";
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
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
        {team && (
          <div className="flex h-full flex-col">
            <SheetHeader className="sticky top-0 z-10 border-b border-border bg-background/95 px-5 py-4 backdrop-blur">
              <SheetTitle className="flex items-center gap-2">
                <span className="font-display text-lg">{team.name}</span>
                <Badge variant="outline" className="text-xs">{team.department}</Badge>
              </SheetTitle>
              <p className="text-xs text-muted-foreground">Live team session · scroll for full workflow</p>
            </SheetHeader>

            <div className="flex-1 space-y-6 px-5 py-5">
              {isAdmin && <RenameTeamRow team={team} />}
              <Section title="Team Leader" icon={<Crown className="h-3.5 w-3.5 text-amber-500" />}>
                <LeaderRow team={team} allEmployees={allEmployees} isAdmin={isAdmin} />
              </Section>
              <Section title="Members" icon={<UserPlus2 className="h-3.5 w-3.5" />}>
                <MembersList team={team} allEmployees={allEmployees} isAdmin={isAdmin} />
              </Section>
              <Section title="Tasks" icon={<Plus className="h-3.5 w-3.5" />}>
                <TasksList team={team} allEmployees={allEmployees} readOnly={isAdmin} />
              </Section>
              <Section title="Review & Feedback" icon={<MessageSquare className="h-3.5 w-3.5" />}>
                <ReviewFeedback team={team} allEmployees={allEmployees} readOnly={isAdmin} />
              </Section>
              <Section title="Reports" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
                <ReportsList team={team} allEmployees={allEmployees} />
              </Section>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </section>
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
    <div className="flex items-end gap-2">
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

function LeaderRow({ team, allEmployees, isAdmin }: { team: Team; allEmployees: Emp[]; isAdmin: boolean }) {
  const qc = useQueryClient();
  const appoint = useServerFn(appointTeamLeader);
  const unappoint = useServerFn(removeTeamLeader);
  const listTL = useServerFn(listTeamLeaders);
  const lead = allEmployees.find((e) => e.id === team.team_lead_employee_id);

  const { data: tlAccounts } = useQuery({
    queryKey: ["tl_accounts"],
    enabled: isAdmin,
    queryFn: () => listTL(),
  });
  const tlEmailSet = new Set(
    (tlAccounts ?? [])
      .map((u) => (u.email ?? "").toLowerCase().trim())
      .filter((s) => s.length > 0),
  );
  // Only employees that already have a Team Leader login account are eligible.
  const eligibleLeaders = allEmployees.filter(
    (e) => e.email && tlEmailSet.has(e.email.toLowerCase().trim()),
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["teams"] });
    qc.invalidateQueries({ queryKey: ["employees"] });
  };
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      {lead ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Avatar className="h-7 w-7"><AvatarFallback className="text-xs">{initials(lead.full_name)}</AvatarFallback></Avatar>
            <div className="text-sm">
              <div className="font-medium">{lead.full_name}</div>
              <div className="text-xs text-muted-foreground">{lead.position}</div>
            </div>
          </div>
          {isAdmin && <Button size="sm" variant="ghost" onClick={() => unappoint({ data: { teamId: team.id } }).then(() => { toast.success("Removed"); invalidate(); })}>Remove</Button>}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">No leader assigned.</div>
      )}
      {isAdmin && (
        <div className="mt-2 space-y-1">
          <Select onValueChange={(v) => appoint({ data: { teamId: team.id, employeeId: v } }).then(() => { toast.success("Appointed"); invalidate(); }).catch((e: Error) => toast.error(e.message))}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={lead ? "Reassign team leader…" : "Appoint team leader…"} /></SelectTrigger>
            <SelectContent>
              {eligibleLeaders.length === 0 ? (
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                  No Team Leader accounts yet. Create one in Settings → Team Leaders.
                </div>
              ) : (
                eligibleLeaders.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)
              )}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">Only employees with a Team Leader login account are listed.</p>
        </div>
      )}
    </div>
  );
}

function MembersList({ team, allEmployees, isAdmin }: { team: Team; allEmployees: Emp[]; isAdmin: boolean }) {
  const qc = useQueryClient();
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
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["team_members", team.id] });
    qc.invalidateQueries({ queryKey: ["teams"] });
    qc.invalidateQueries({ queryKey: ["employees"] });
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{memberEmps.length} member{memberEmps.length === 1 ? "" : "s"}</div>
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
  );
}

function TasksList({ team, allEmployees, readOnly = false }: { team: Team; allEmployees: Emp[]; readOnly?: boolean }) {
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

  // Hide "done" tasks here — they appear in Review & Feedback section
  const activeTasks = (tasks ?? []).filter((t) => t.status !== "done");

  return (
    <div className="space-y-3">
      {readOnly ? (
        <div className="rounded border border-dashed border-border bg-muted/30 p-2 text-[11px] text-muted-foreground">
          Read-only · Team Leader assigns tasks. HR audits the workload here.
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <div className="flex-1"><Label className="text-xs">New task</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" /></div>
          <Select value={assignee} onValueChange={setAssignee}>
            <SelectTrigger className="w-40 text-xs"><SelectValue placeholder="Assignee" /></SelectTrigger>
            <SelectContent>{teamMembers.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" onClick={() => add.mutate()} disabled={!title || add.isPending}>{add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}</Button>
        </div>
      )}
      <div className="space-y-1.5">
        {activeTasks.map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded border border-border bg-card p-2 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium">{t.title}</div>
              <div className="text-[10px] text-muted-foreground">{empName(t.assignee_employee_id)} · {t.due_date ?? "—"}</div>
            </div>
            {readOnly ? (
              <Badge variant="outline" className="text-[10px]">{t.status}</Badge>
            ) : (
              <Select value={t.status as string} onValueChange={(v) => update({ data: { id: t.id, status: v as never } }).then(() => qc.invalidateQueries({ queryKey: ["team_tasks", team.id] }))}>
                <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{["todo", "in_progress", "review", "done", "blocked", "cancelled"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
        ))}
        {activeTasks.length === 0 && <div className="rounded border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No active tasks.</div>}
      </div>
    </div>
  );
}

function ReviewFeedback({ team, allEmployees, readOnly = false }: { team: Team; allEmployees: Emp[]; readOnly?: boolean }) {
  const qc = useQueryClient();
  const saveReport = useServerFn(saveTeamReport);
  const rate = useServerFn(rateMember);
  const { start, end } = useMemo(() => thisMonth(), []);

  const { data: tasks } = useQuery({
    queryKey: ["team_tasks", team.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("tasks")
        .select("id,title,status,assignee_employee_id,due_date,updated_at")
        .eq("team_id", team.id)
        .order("updated_at", { ascending: false });
      return data ?? [];
    },
  });

  // Ensure a current-period report exists; capture its id for rateMember.
  const { data: reportId } = useQuery({
    queryKey: ["team_report_current", team.id, start],
    queryFn: async () => {
      const { data } = await supabase
        .from("team_reports")
        .select("id")
        .eq("team_id", team.id)
        .eq("period_start", start)
        .maybeSingle();
      return (data?.id as string | undefined) ?? null;
    },
  });

  const ensureReport = async () => {
    if (reportId) return reportId;
    const r = await saveReport({ data: { teamId: team.id, periodStart: start, periodEnd: end, summary: "Auto-created from review" } });
    qc.invalidateQueries({ queryKey: ["team_report_current", team.id, start] });
    return r.id;
  };

  const completed = (tasks ?? []).filter((t) => t.status === "done");

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">Completed tasks land here. {readOnly ? "HR review (read-only)." : "Leave feedback and submit a rating in one step."}</div>
      {completed.length === 0 && <div className="rounded border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No completed tasks yet this cycle.</div>}
      {completed.map((t) => {
        const emp = allEmployees.find((e) => e.id === t.assignee_employee_id);
        return (
          <CompletedTaskCard
            key={t.id}
            task={t}
            empName={emp?.full_name ?? "Unassigned"}
            empId={t.assignee_employee_id}
            readOnly={readOnly}
            ensureReport={ensureReport}
            submit={async (employeeId, rating, note) => {
              const rid = await ensureReport();
              await rate({ data: { reportId: rid, employeeId, rating, note } });
              toast.success("Feedback saved");
              qc.invalidateQueries({ queryKey: ["member_ratings", team.id] });
              qc.invalidateQueries({ queryKey: ["employee-kpis"] });
            }}
          />
        );
      })}
    </div>
  );
}

function CompletedTaskCard({
  task, empName, empId, readOnly, submit,
}: {
  task: { id: string; title: string; due_date: string | null; assignee_employee_id: string | null };
  empName: string;
  empId: string | null;
  readOnly: boolean;
  ensureReport: () => Promise<string>;
  submit: (employeeId: string, rating: number, note: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(70);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{task.title}</div>
          <div className="text-[10px] text-muted-foreground">{empName} · due {task.due_date ?? "—"}</div>
        </div>
        <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">done</Badge>
      </div>
      {!readOnly && empId && (
        <>
          <Button size="sm" variant="ghost" className="mt-2 h-7 px-2 text-xs" onClick={() => setOpen((s) => !s)}>
            {open ? "Hide feedback" : "Review & rate"}
          </Button>
          {open && (
            <div className="mt-2 space-y-2 rounded-md border border-border/60 bg-muted/30 p-2">
              <div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Performance rating</span>
                  <span className="font-mono">{rating}</span>
                </div>
                <Slider value={[rating]} min={0} max={100} step={1} onValueChange={(v) => setRating(v[0])} className="mt-1" />
              </div>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Coaching note (visible to admin)" className="min-h-[60px] text-xs" />
              <div className="flex justify-end">
                <Button size="sm" disabled={saving} onClick={async () => {
                  setSaving(true);
                  try { await submit(empId, rating, note); setOpen(false); }
                  catch (e) { toast.error((e as Error).message); }
                  finally { setSaving(false); }
                }}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Submit feedback"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ReportsList({ team, allEmployees }: { team: Team; allEmployees: Emp[] }) {
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
    <div className="space-y-2">
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
                  const rating = Math.round(((rt.productivity ?? 0) + (rt.quality ?? 0)) / 2);
                  return (
                    <div key={rt.employee_id} className="flex items-center justify-between rounded border border-border/60 px-2 py-1 text-xs">
                      <span>{emp?.full_name ?? "?"}</span>
                      <span className="font-mono">rating {rating}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {(reports?.length ?? 0) === 0 && <div className="rounded border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No reports yet.</div>}
    </div>
  );
}
