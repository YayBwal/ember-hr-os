import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Loader2, Plus, Users, Trophy, UserPlus } from "lucide-react";
import { formatMMKCompact, initials } from "@/lib/format";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { createTeam, deleteTeam, logAttendance } from "@/lib/operations.functions";
import { TeamDetailSheet } from "@/components/team-detail-sheet";


export const Route = createFileRoute("/_authenticated/operations")({
  head: () => ({ meta: [{ title: "Operations · Mandai" }] }),
  component: OperationsPage,
});

type Dept = "HR" | "Operations" | "Finance" | "Admin" | "Engineering";
const DEPTS: Dept[] = ["HR", "Operations", "Finance", "Admin", "Engineering"];

type Employee = {
  id: string; full_name: string; email: string | null;
  department: Dept; position: string; monthly_base_mmk: number;
  performance_score: number; attendance_pct: number;
  team_id: string | null; join_date: string | null;
  phone: string | null; avatar_url: string | null; salary_grade: string | null;
  level: "junior" | "mid" | "senior" | "lead";
};
type Team = { id: string; name: string; department: Dept; team_lead_employee_id: string | null; org_id: string };
type Kpi = { employee_id: string; period_month: string; task_completion: number; attendance: number; kpi: number };

type SortKey = "kpi" | "attendance" | "completed";


function OperationsPage() {
  useRealtimeInvalidate(
    ["employees", "tasks", "attendance", "employee_kpis", "teams", "team_members"],
    ["employees", "teams", "team_members", "employee-kpis", "task_counts"],
  );

  return (
    <AppShell>
      <div className="px-4 py-6 md:px-8">
        <div className="text-xs font-mono uppercase tracking-[0.2em] text-primary">Operations</div>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Workforce</h1>
        <p className="mt-1 text-sm text-muted-foreground">Leaderboard, teams and meetings — live data.</p>

        <Tabs defaultValue="leaderboard" className="mt-6">
          <TabsList>
            <TabsTrigger value="leaderboard"><Trophy className="mr-2 h-4 w-4" />Leaderboard</TabsTrigger>
            <TabsTrigger value="teams"><Users className="mr-2 h-4 w-4" />Teams</TabsTrigger>
          </TabsList>
          <TabsContent value="leaderboard" className="mt-4"><Leaderboard /></TabsContent>
          <TabsContent value="teams" className="mt-4"><TeamsBoard /></TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function Leaderboard() {
  const [sortBy, setSortBy] = useState<SortKey>("kpi");
  const [selected, setSelected] = useState<string | null>(null);

  const { data: employees } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, full_name, email, department, position, monthly_base_mmk, performance_score, attendance_pct, team_id, join_date, phone, avatar_url, salary_grade, level");
      if (error) throw error;
      return (data ?? []) as Employee[];
    },
  });
  const { data: kpis } = useQuery({
    queryKey: ["employee-kpis"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employee_kpis").select("employee_id, period_month, kpi, attendance, task_completion");
      if (error) throw error;
      return (data ?? []) as Kpi[];
    },
  });
  const { data: taskCounts } = useQuery({
    queryKey: ["task_counts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tasks").select("assignee_employee_id,status");
      if (error) throw error;
      const map: Record<string, { completed: number; active: number }> = {};
      for (const t of data ?? []) {
        if (!t.assignee_employee_id) continue;
        const m = (map[t.assignee_employee_id] ??= { completed: 0, active: 0 });
        if (t.status === "done") m.completed++;
        else if (t.status !== "cancelled") m.active++;
      }
      return map;
    },
  });
  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data } = await supabase.from("teams").select("id,name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  // Pending peer reviews this month: distinct (team_id, reviewer) pairs missing.
  const period = new Date(); period.setUTCDate(1);
  const periodKey = period.toISOString().slice(0, 10);
  const { data: pendingReviews } = useQuery({
    queryKey: ["pending_peer_reviews", periodKey],
    queryFn: async () => {
      const [{ data: tm }, { data: pr }] = await Promise.all([
        supabase.from("team_members").select("team_id, employee_id"),
        supabase.from("peer_reviews").select("team_id, reviewer_employee_id").eq("period_month", periodKey),
      ]);
      const submitted = new Set((pr ?? []).map((r) => `${r.team_id}:${r.reviewer_employee_id}`));
      let pending = 0;
      for (const m of tm ?? []) if (!submitted.has(`${m.team_id}:${m.employee_id}`)) pending++;
      return pending;
    },
  });

  
  const latestKpi = (id: string) => kpis?.find((k) => k.employee_id === id && k.period_month.startsWith(periodKey.slice(0, 7)));

  const rows = useMemo(() => {
    const list = (employees ?? []).map((e) => {
      const k = latestKpi(e.id);
      const counts = taskCounts?.[e.id] ?? { completed: 0, active: 0 };
      return {
        emp: e,
        kpi: Number(k?.kpi ?? e.performance_score ?? 0),
        productivity: Number(k?.productivity ?? 80),
        attendance: Number(k?.attendance ?? e.attendance_pct ?? 0),
        completed: counts.completed,
        active: counts.active,
      };
    });
    const cmp: Record<SortKey, (a: typeof list[number], b: typeof list[number]) => number> = {
      kpi: (a, b) => b.kpi - a.kpi,
      productivity: (a, b) => b.productivity - a.productivity,
      attendance: (a, b) => b.attendance - a.attendance,
      completed: (a, b) => b.completed - a.completed,
    };
    list.sort(cmp[sortBy]);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, kpis, taskCounts, sortBy]);

  const teamName = (id: string | null) => teams?.find((t) => t.id === id)?.name ?? "—";

  return (
    <div>
      <div className="flex items-center gap-3">
        <Label className="text-xs">Sort by</Label>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="kpi">Highest KPI</SelectItem>
            <SelectItem value="productivity">Productivity</SelectItem>
            <SelectItem value="attendance">Attendance</SelectItem>
            <SelectItem value="completed">Completed Tasks</SelectItem>
          </SelectContent>
        </Select>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant={pendingReviews && pendingReviews > 0 ? "default" : "outline"} className="ml-auto gap-1 cursor-help">
                <ClipboardList className="h-3 w-3" />
                {pendingReviews ?? 0} pending review{(pendingReviews ?? 0) === 1 ? "" : "s"}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Team members who haven't submitted peer reviews this month.</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Rank</th>
              <th className="px-4 py-3 text-left">Employee</th>
              <th className="px-4 py-3 text-left">Dept</th>
              <th className="px-4 py-3 text-left">Team</th>
              <th className="px-4 py-3 text-right">KPI</th>
              <th className="px-4 py-3 text-right">Prod.</th>
              <th className="px-4 py-3 text-right">Att.</th>
              <th className="px-4 py-3 text-right">Done</th>
              <th className="px-4 py-3 text-right">Active</th>
              <th className="px-4 py-3 text-left">Grade</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.emp.id} className="cursor-pointer border-t border-border hover:bg-muted/40" onClick={() => setSelected(r.emp.id)}>
                <td className="px-4 py-3 font-mono text-muted-foreground">#{i + 1}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8"><AvatarFallback>{initials(r.emp.full_name)}</AvatarFallback></Avatar>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.emp.full_name}</span>
                        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{r.emp.level}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{r.emp.position}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">{r.emp.department}</td>
                <td className="px-4 py-3">{teamName(r.emp.team_id)}</td>
                <td className="px-4 py-3 text-right font-medium">{r.kpi.toFixed(1)}</td>
                <td className="px-4 py-3 text-right">{r.productivity.toFixed(0)}</td>
                <td className="px-4 py-3 text-right">{r.attendance.toFixed(0)}%</td>
                <td className="px-4 py-3 text-right">{r.completed}</td>
                <td className="px-4 py-3 text-right">{r.active}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{r.emp.salary_grade ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-muted-foreground">No employees yet. Approve a candidate in Pipeline.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <EmployeeProfileSheet employeeId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function EmployeeProfileSheet({ employeeId, onClose }: { employeeId: string | null; onClose: () => void }) {
  const open = !!employeeId;
  const qc = useQueryClient();
  const logAtt = useServerFn(logAttendance);
  const setPQ = useServerFn(setProductivityQuality);
  const [att, setAtt] = useState<{ date: string; status: "present" | "late" | "absent" | "leave"; minutes: number }>({
    date: new Date().toISOString().slice(0, 10), status: "present", minutes: 0,
  });
  const [prod, setProd] = useState(80);
  const [qual, setQual] = useState(80);

  const { data: emp } = useQuery({
    queryKey: ["employee", employeeId],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from("employees").select("*").eq("id", employeeId!).maybeSingle();
      return data as Employee | null;
    },
  });
  const { data: kpi } = useQuery({
    queryKey: ["employee_kpi_current", employeeId],
    enabled: open,
    queryFn: async () => {
      const period = new Date(); period.setUTCDate(1);
      const { data } = await supabase
        .from("employee_kpis")
        .select("*")
        .eq("employee_id", employeeId!)
        .gte("period_month", period.toISOString().slice(0, 10))
        .maybeSingle();
      return data as Kpi | null;
    },
  });
  const { data: tasks } = useQuery({
    queryKey: ["employee_tasks", employeeId],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase
        .from("tasks")
        .select("id,title,status,priority,due_date,progress")
        .eq("assignee_employee_id", employeeId!)
        .order("due_date", { ascending: true });
      return data ?? [];
    },
  });
  const { data: payroll } = useQuery({
    queryKey: ["employee_payroll", employeeId],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase
        .from("payroll_lines")
        .select("id,base_mmk,performance_bonus_mmk,bonus_mmk,deduction_mmk,total_mmk,kpi_snapshot,created_at")
        .eq("employee_id", employeeId!)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const submitAtt = useMutation({
    mutationFn: () => logAtt({ data: { employeeId: employeeId!, date: att.date, status: att.status, minutesLate: att.minutes } }),
    onSuccess: () => {
      toast.success("Attendance logged");
      qc.invalidateQueries({ queryKey: ["employee_kpi_current", employeeId] });
      qc.invalidateQueries({ queryKey: ["employee-kpis"] });
    },
  });
  const submitPQ = useMutation({
    mutationFn: () => setPQ({ data: { employeeId: employeeId!, productivity: prod, quality: qual } }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["employee_kpi_current", employeeId] }); qc.invalidateQueries({ queryKey: ["employee-kpis"] }); },
  });

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3">
            <Avatar><AvatarFallback>{initials(emp?.full_name ?? "?")}</AvatarFallback></Avatar>
            <div>
              <div className="font-display text-lg">{emp?.full_name}</div>
              <div className="text-xs text-muted-foreground">{emp?.position} · {emp?.department}</div>
            </div>
          </SheetTitle>
        </SheetHeader>
        {!emp ? null : (
          <Tabs defaultValue="profile" className="mt-4">
            <TabsList>
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="performance">Performance</TabsTrigger>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="financial">Financial</TabsTrigger>
            </TabsList>
            <TabsContent value="profile" className="space-y-2 text-sm">
              <Row label="Email" value={emp.email ?? "—"} />
              <Row label="Phone" value={emp.phone ?? "—"} />
              <Row label="Join date" value={emp.join_date ?? "—"} />
              <Row label="Salary base" value={formatMMKCompact(emp.monthly_base_mmk)} />
              <Row label="Salary grade" value={emp.salary_grade ?? "—"} />
            </TabsContent>
            <TabsContent value="performance" className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Metric label="KPI" value={(kpi?.kpi ?? 0).toFixed(1)} />
                <Metric label="Productivity" value={(kpi?.productivity ?? 80).toFixed(0)} />
                <Metric label="Attendance" value={`${(kpi?.attendance ?? 100).toFixed(0)}%`} />
                <Metric label="Task completion" value={`${(kpi?.task_completion ?? 0).toFixed(0)}%`} />
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs font-mono uppercase text-muted-foreground">Log attendance</div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
                  <Input type="date" value={att.date} onChange={(e) => setAtt({ ...att, date: e.target.value })} />
                  <Select value={att.status} onValueChange={(v) => setAtt({ ...att, status: v as typeof att.status })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="present">Present</SelectItem>
                      <SelectItem value="late">Late</SelectItem>
                      <SelectItem value="absent">Absent</SelectItem>
                      <SelectItem value="leave">Leave</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input type="number" placeholder="min late" value={att.minutes} onChange={(e) => setAtt({ ...att, minutes: Number(e.target.value) || 0 })} />
                  <Button onClick={() => submitAtt.mutate()} disabled={submitAtt.isPending}>
                    {submitAtt.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-1.5 text-xs font-mono uppercase text-muted-foreground">
                  <span>HR Override · Productivity &amp; Quality</span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild><Info className="h-3 w-3 cursor-help opacity-70" /></TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        HR-only manual adjustment that writes directly to the employee's monthly KPI and recomputes payroll. Use sparingly — Team Leader Ratings (in Team Leader Hub) are the primary performance signal.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">Writes directly to monthly KPI and triggers payroll recompute. Team Leader ratings live in Team Leader Hub.</div>
                <div className="mt-3 space-y-3">
                  <div>
                    <div className="flex justify-between text-xs"><span>Productivity</span><span className="font-mono">{prod}</span></div>
                    <Slider value={[prod]} onValueChange={(v) => setProd(v[0])} min={0} max={100} step={1} />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs"><span>Quality</span><span className="font-mono">{qual}</span></div>
                    <Slider value={[qual]} onValueChange={(v) => setQual(v[0])} min={0} max={100} step={1} />
                  </div>
                  <Button size="sm" onClick={() => submitPQ.mutate()} disabled={submitPQ.isPending}>
                    {submitPQ.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                  </Button>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="tasks" className="space-y-2">
              {(tasks ?? []).map((t) => (
                <div key={t.id} className="rounded border border-border p-2">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{t.title}</div>
                    <Badge variant="outline">{t.status}</Badge>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Due {t.due_date ?? "—"} · {t.priority}</span>
                    <span>{t.progress}%</span>
                  </div>
                  <Progress value={t.progress} className="mt-1 h-1" />
                </div>
              ))}
              {(tasks?.length ?? 0) === 0 && <div className="text-sm text-muted-foreground">No tasks assigned.</div>}
            </TabsContent>
            <TabsContent value="financial" className="space-y-2">
              {(payroll ?? []).map((p) => (
                <div key={p.id} className="rounded border border-border p-2 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-xs text-muted-foreground">{new Date(p.created_at).toISOString().slice(0, 10)}</div>
                    <div className="font-semibold">{formatMMKCompact(p.total_mmk)}</div>
                  </div>
                  <div className="mt-1 grid grid-cols-4 gap-2 text-xs text-muted-foreground">
                    <span>Base {formatMMKCompact(p.base_mmk)}</span>
                    <span>KPI +{formatMMKCompact(p.performance_bonus_mmk)}</span>
                    <span>Bonus +{formatMMKCompact(p.bonus_mmk)}</span>
                    <span>Ded -{formatMMKCompact(p.deduction_mmk)}</span>
                  </div>
                </div>
              ))}
              {(payroll?.length ?? 0) === 0 && <div className="text-sm text-muted-foreground">No payroll history.</div>}
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between border-b border-border py-2"><span className="text-muted-foreground">{label}</span><span>{value}</span></div>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs font-mono uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold">{value}</div>
    </div>
  );
}

function TeamsBoard() {
  const qc = useQueryClient();
  const create = useServerFn(createTeam);
  const del = useServerFn(deleteTeam);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ name: string; department: Dept }>({ name: "", department: "Engineering" });
  const [openTeam, setOpenTeam] = useState<Team | null>(null);

  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data } = await supabase.from("teams").select("*");
      return (data ?? []) as Team[];
    },
  });
  const { data: members } = useQuery({
    queryKey: ["team_members_all"],
    queryFn: async () => {
      const { data } = await supabase.from("team_members").select("team_id,employee_id");
      return data ?? [];
    },
  });
  const { data: employees } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data } = await supabase.from("employees").select("id,full_name,email,position,team_id,performance_score");
      return (data ?? []) as Array<{ id: string; full_name: string; email: string | null; position: string | null; team_id: string | null; performance_score: number | null }>;
    },
  });
  const { data: tasksByTeam } = useQuery({
    queryKey: ["tasks_by_team"],
    queryFn: async () => {
      const { data } = await supabase.from("tasks").select("team_id,status");
      const m: Record<string, { active: number; done: number }> = {};
      for (const t of data ?? []) {
        if (!t.team_id) continue;
        const r = (m[t.team_id] ??= { active: 0, done: 0 });
        if (t.status === "done") r.done++;
        else if (t.status !== "cancelled") r.active++;
      }
      return m;
    },
  });

  const submitCreate = useMutation({
    mutationFn: () => create({ data: form }),
    onSuccess: () => { toast.success("Team created"); setOpen(false); setForm({ name: "", department: "Engineering" }); qc.invalidateQueries({ queryKey: ["teams"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />New team</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create team</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div>
                <Label>Department</Label>
                <Select value={form.department} onValueChange={(v) => setForm({ ...form, department: v as Dept })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DEPTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => submitCreate.mutate()} disabled={!form.name || submitCreate.isPending}>
                {submitCreate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(teams ?? []).map((t) => {
          const teamMembers = (members ?? []).filter((m) => m.team_id === t.id);
          const memberIds = new Set(teamMembers.map((m) => m.employee_id));
          const memberEmps = (employees ?? []).filter((e) => memberIds.has(e.id));
          const stats = tasksByTeam?.[t.id] ?? { active: 0, done: 0 };
          const rate = stats.active + stats.done > 0 ? Math.round((stats.done / (stats.active + stats.done)) * 100) : 0;
          const lead = (employees ?? []).find((e) => e.id === t.team_lead_employee_id);
          const avgKpi = memberEmps.length > 0 ? Math.round(memberEmps.reduce((s, e) => s + (Number(e.performance_score) || 0), 0) / memberEmps.length) : 0;
          return (
            <div key={t.id} className="rounded-xl border border-border bg-card p-4 transition hover:border-primary/40">
              <button className="block w-full text-left" onClick={() => setOpenTeam(t)}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs font-mono uppercase text-muted-foreground">{t.department}</div>
                    <div className="font-display text-lg font-semibold">{t.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">TL: {lead?.full_name ?? "— unassigned —"}</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <Stat label="Members" value={memberEmps.length} />
                  <Stat label="Active" value={stats.active} />
                  <Stat label="Done" value={stats.done} />
                </div>
                <div className="mt-3">
                  <div className="flex justify-between text-xs"><span className="text-muted-foreground">Completion</span><span>{rate}%</span></div>
                  <Progress value={rate} className="mt-1 h-1.5" />
                </div>
                <div className="mt-2 flex justify-between text-xs"><span className="text-muted-foreground">Avg KPI</span><span className="font-mono">{avgKpi}</span></div>
              </button>
              <div className="mt-3 flex justify-end">
                <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete team "${t.name}"?`)) del({ data: { id: t.id } }).then(() => qc.invalidateQueries({ queryKey: ["teams"] })); }}>Delete</Button>
              </div>
            </div>
          );
        })}
        {(teams?.length ?? 0) === 0 && <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No teams yet.</div>}
      </div>

      <TeamDetailSheet team={openTeam} allEmployees={(employees ?? []) as never} onClose={() => setOpenTeam(null)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

