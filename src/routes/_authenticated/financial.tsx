import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { Loader2, Plus, Minus, RefreshCw, TrendingUp, Sparkles, History } from "lucide-react";
import { formatMMK, formatMMKCompact } from "@/lib/format";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { addBonus, addDeduction, runPayroll, promoteEmployee, type EmployeeLevel } from "@/lib/financial.functions";
import { getKpiDashboard, setEmploymentType, setKpiEligibility, setKpiBonusOverride, type KpiRow } from "@/lib/kpi.functions";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/financial")({
  head: () => ({ meta: [{ title: "Financial · Mandai" }] }),
  component: FinancialPage,
});

type Line = {
  id: string; employee_id: string; base_mmk: number; performance_bonus_mmk: number;
  bonus_mmk: number; deduction_mmk: number; overtime_mmk: number; total_mmk: number;
  kpi_snapshot: number; tasks_completed: number;
};
type Emp = {
  id: string; full_name: string; department: string; position: string;
  monthly_base_mmk: number; level: EmployeeLevel; join_date: string | null;
  performance_score: number | null;
};
type Promotion = {
  id: string; employee_id: string;
  from_level: EmployeeLevel | null; to_level: EmployeeLevel;
  from_base_mmk: number | null; to_base_mmk: number;
  from_position: string | null; to_position: string;
  effective_date: string; note: string | null; created_at: string;
};
type Org = {
  id: string;
  salary_bands: Record<EmployeeLevel, { min: number; max: number }> | null;
};

const LEVELS: EmployeeLevel[] = ["trainee", "junior", "senior", "lead"];
const LEVEL_LABEL: Record<EmployeeLevel, string> = { trainee: "Trainee", junior: "Junior", mid: "Junior", senior: "Senior", lead: "Lead" };

function bonusTier(kpi: number): string {
  if (kpi >= 95) return "20%"; if (kpi >= 90) return "15%"; if (kpi >= 85) return "10%"; if (kpi >= 80) return "5%"; return "0%";
}

function FinancialPage() {
  useRealtimeInvalidate(
    ["payroll_lines", "payroll_runs", "bonuses", "deductions", "employees", "employee_kpis", "employee_promotions"],
    ["payroll_lines", "payroll_runs", "employees_fin", "promotions", "org_bands"],
  );

  return (
    <AppShell>
      <div className="px-4 py-6 md:px-8">
        <div>
          <div className="text-xs font-mono uppercase tracking-[0.2em] text-primary">Financial</div>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Compensation</h1>
          <p className="mt-1 text-sm text-muted-foreground">Run payroll, promote employees, and track salary history.</p>
        </div>

        <Tabs defaultValue="payroll" className="mt-6">
          <TabsList>
            <TabsTrigger value="payroll">Payroll</TabsTrigger>
            <TabsTrigger value="promotions">Promotions</TabsTrigger>
            <TabsTrigger value="kpi">KPI Calculation</TabsTrigger>
          </TabsList>
          <TabsContent value="payroll" className="mt-4"><PayrollTab /></TabsContent>
          <TabsContent value="promotions" className="mt-4"><PromotionsTab /></TabsContent>
          <TabsContent value="kpi" className="mt-4"><KpiTab /></TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

/* ---------------- Payroll tab ---------------- */
function PayrollTab() {
  const qc = useQueryClient();
  const runFn = useServerFn(runPayroll);
  const bonusFn = useServerFn(addBonus);
  const dedFn = useServerFn(addDeduction);
  const [period] = useState<string>(() => {
    const d = new Date(); d.setUTCDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [dialog, setDialog] = useState<{ kind: "bonus" | "deduction"; emp: Emp } | null>(null);
  const [amount, setAmount] = useState<string>("");
  const [reason, setReason] = useState<string>("");

  const { data: employees } = useQuery({
    queryKey: ["employees_fin"],
    queryFn: async () => {
      const { data } = await supabase.from("employees")
        .select("id,full_name,department,position,monthly_base_mmk,level,join_date,performance_score");
      return (data ?? []) as Emp[];
    },
  });
  const { data: run } = useQuery({
    queryKey: ["payroll_runs", period],
    queryFn: async () => {
      const { data } = await supabase.from("payroll_runs").select("id,period_month,total_mmk").eq("period_month", period).maybeSingle();
      return data;
    },
  });
  const { data: lines } = useQuery({
    queryKey: ["payroll_lines", period, run?.id],
    enabled: !!run?.id,
    queryFn: async () => {
      const { data } = await supabase.from("payroll_lines").select("id, employee_id, base_mmk, performance_bonus_mmk, bonus_mmk, deduction_mmk, overtime_mmk, total_mmk, kpi_snapshot, tasks_completed").eq("run_id", run!.id);
      return (data ?? []) as Line[];
    },
  });
  const lineFor = (id: string) => lines?.find((l) => l.employee_id === id);

  const runMut = useMutation({
    mutationFn: () => runFn({ data: { periodMonth: period } }),
    onSuccess: () => { toast.success("Payroll recomputed"); qc.invalidateQueries({ queryKey: ["payroll_runs", period] }); qc.invalidateQueries({ queryKey: ["payroll_lines"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const submitDialog = async () => {
    if (!dialog) return;
    const n = Number(amount);
    if (!n || n <= 0) { toast.error("Enter an amount"); return; }
    try {
      if (dialog.kind === "bonus") await bonusFn({ data: { employeeId: dialog.emp.id, amountMmk: n, reason, periodMonth: period } });
      else await dedFn({ data: { employeeId: dialog.emp.id, amountMmk: n, reason, periodMonth: period } });
      toast.success(`${dialog.kind} added`);
      setDialog(null); setAmount(""); setReason("");
      qc.invalidateQueries({ queryKey: ["payroll_lines"] });
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div>
      <div className="flex items-start justify-between">
        <p className="text-sm text-muted-foreground">Period {period.slice(0, 7)}. Total <span className="font-medium text-foreground">{formatMMKCompact(run?.total_mmk ?? 0)}</span>.</p>
        <Button onClick={() => runMut.mutate()} disabled={runMut.isPending}>
          {runMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Recompute payroll
        </Button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Employee</th>
              <th className="px-4 py-3 text-right">Base</th>
              <th className="px-4 py-3 text-right">KPI</th>
              <th className="px-4 py-3 text-right">KPI Bonus</th>
              <th className="px-4 py-3 text-right">Extra Bonus</th>
              <th className="px-4 py-3 text-right">Overtime</th>
              <th className="px-4 py-3 text-right">Deductions</th>
              <th className="px-4 py-3 text-right">Final</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(employees ?? []).map((e) => {
              const l = lineFor(e.id);
              return (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{e.full_name}</span>
                      <Badge variant="secondary" className="text-[10px]">{LEVEL_LABEL[e.level]}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{e.position} · {e.department}</div>
                  </td>
                  <td className="px-4 py-3 text-right">{formatMMKCompact(l?.base_mmk ?? e.monthly_base_mmk)}</td>
                  <td className="px-4 py-3 text-right">
                    <Badge variant="outline">{(l?.kpi_snapshot ?? 0).toFixed(1)} · {bonusTier(Number(l?.kpi_snapshot ?? 0))}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400">+{formatMMKCompact(l?.performance_bonus_mmk ?? 0)}</td>
                  <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400">+{formatMMKCompact(l?.bonus_mmk ?? 0)}</td>
                  <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400">+{formatMMKCompact(l?.overtime_mmk ?? 0)}</td>
                  <td className="px-4 py-3 text-right text-destructive">-{formatMMKCompact(l?.deduction_mmk ?? 0)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatMMK(l?.total_mmk ?? e.monthly_base_mmk)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "bonus", emp: e })}><Plus className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "deduction", emp: e })}><Minus className="h-3 w-3" /></Button>
                  </td>
                </tr>
              );
            })}
            {(employees?.length ?? 0) === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">No employees.</td></tr>}
          </tbody>
        </table>
      </div>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dialog?.kind === "bonus" ? "Add bonus" : "Add deduction"} · {dialog?.emp.full_name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Amount (MMK)</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div><Label>Reason</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          </div>
          <DialogFooter><Button onClick={submitDialog}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------- Promotions tab ---------------- */
function PromotionsTab() {
  const qc = useQueryClient();
  const promoteFn = useServerFn(promoteEmployee);
  const [promoting, setPromoting] = useState<Emp | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: employees } = useQuery({
    queryKey: ["employees_fin"],
    queryFn: async () => {
      const { data } = await supabase.from("employees")
        .select("id,full_name,department,position,monthly_base_mmk,level,join_date,performance_score");
      return (data ?? []) as Emp[];
    },
  });

  const { data: promotions } = useQuery({
    queryKey: ["promotions"],
    queryFn: async () => {
      const { data } = await supabase.from("employee_promotions")
        .select("*").order("effective_date", { ascending: false });
      return (data ?? []) as Promotion[];
    },
  });

  const { data: org } = useQuery({
    queryKey: ["org_bands"],
    queryFn: async () => {
      const { data } = await supabase.from("organizations").select("id,salary_bands").maybeSingle();
      return data as Org | null;
    },
  });

  const lastPromotionFor = (empId: string) => promotions?.find((p) => p.employee_id === empId);
  const historyFor = (empId: string) => (promotions ?? []).filter((p) => p.employee_id === empId);

  // KPI strip
  const stats = useMemo(() => {
    const now = new Date();
    const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const realPromos = (promotions ?? []).filter((p) => p.from_level !== null);
    const promotedThisQuarter = realPromos.filter((p) => new Date(p.effective_date) >= qStart).length;
    const deltaThisMonth = realPromos
      .filter((p) => new Date(p.effective_date) >= mStart)
      .reduce((s, p) => s + (p.to_base_mmk - (p.from_base_mmk ?? 0)), 0);
    const tenures = (employees ?? [])
      .filter((e) => e.join_date)
      .map((e) => (Date.now() - new Date(e.join_date!).getTime()) / 86400000);
    const avgTenure = tenures.length ? Math.round(tenures.reduce((a, b) => a + b, 0) / tenures.length) : 0;
    return { promotedThisQuarter, deltaThisMonth, avgTenure };
  }, [promotions, employees]);


  return (
    <div>
      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Promoted this quarter</div>
          <div className="mt-1 flex items-center gap-2 text-2xl font-semibold"><TrendingUp className="h-5 w-5 text-primary" />{stats.promotedThisQuarter}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Salary delta (this month)</div>
          <div className="mt-1 text-2xl font-semibold">{formatMMKCompact(stats.deltaThisMonth)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Avg tenure</div>
          <div className="mt-1 text-2xl font-semibold">{stats.avgTenure} days</div>
        </div>
      </div>


      {/* Employees table */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Employee</th>
              <th className="px-4 py-3 text-left">Level</th>
              <th className="px-4 py-3 text-right">Salary</th>
              <th className="px-4 py-3 text-left">Last change</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(employees ?? []).map((e) => {
              const last = lastPromotionFor(e.id);
              const open = expanded === e.id;
              return (
                <Fragment key={e.id}>
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="font-medium">{e.full_name}</div>
                      <div className="text-xs text-muted-foreground">{e.position} · {e.department}</div>
                    </td>
                    <td className="px-4 py-3"><Badge variant="secondary">{LEVEL_LABEL[e.level]}</Badge></td>
                    <td className="px-4 py-3 text-right font-medium">{formatMMK(e.monthly_base_mmk)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {last ? new Date(last.effective_date).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setExpanded(open ? null : e.id)}>
                        <History className="mr-1 h-3 w-3" /> History
                      </Button>
                      <Button size="sm" onClick={() => setPromoting(e)} disabled={e.level === "lead"}>
                        <TrendingUp className="mr-1 h-3 w-3" /> Promote
                      </Button>
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-t border-border bg-muted/20">
                      <td colSpan={5} className="px-4 py-3">
                        {historyFor(e.id).length === 0 ? (
                          <div className="text-xs text-muted-foreground">No history.</div>
                        ) : (
                          <ul className="space-y-1 text-xs">
                            {historyFor(e.id).map((p) => (
                              <li key={p.id} className="flex flex-wrap items-center gap-2">
                                <span className="text-muted-foreground">{new Date(p.effective_date).toLocaleDateString()}</span>
                                <Badge variant="outline" className="text-[10px]">
                                  {p.from_level ? `${LEVEL_LABEL[p.from_level]} → ` : ""}{LEVEL_LABEL[p.to_level]}
                                </Badge>
                                <span>{p.from_position ? `${p.from_position} → ` : ""}{p.to_position}</span>
                                <span className="text-muted-foreground">
                                  {p.from_base_mmk != null ? `${formatMMKCompact(p.from_base_mmk)} → ` : ""}
                                  <span className="font-medium text-foreground">{formatMMKCompact(p.to_base_mmk)}</span>
                                </span>
                                {p.note && <span className="text-muted-foreground italic">· {p.note}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {(employees?.length ?? 0) === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">No employees.</td></tr>}
          </tbody>
        </table>
      </div>

      <PromoteDialog
        emp={promoting}
        bands={org?.salary_bands ?? null}
        onClose={() => setPromoting(null)}
        qc={qc}
        promote={promoteFn}
      />
    </div>
  );
}

/* ---------------- Promote dialog ---------------- */

function PromoteDialog({
  emp, bands, onClose, qc, promote,
}: {
  emp: Emp | null;
  bands: Record<EmployeeLevel, { min: number; max: number }> | null;
  onClose: () => void;
  qc: QueryClient;
  promote: ReturnType<typeof useServerFn<typeof promoteEmployee>>;
}) {
  const nextLevel: EmployeeLevel = useMemo(() => {
    if (!emp) return "junior";
    const current = emp.level === "mid" ? "junior" : emp.level;
    const idx = LEVELS.indexOf(current as EmployeeLevel);
    return LEVELS[Math.min(Math.max(idx, 0) + 1, LEVELS.length - 1)];
  }, [emp]);

  const [level, setLevel] = useState<EmployeeLevel>(nextLevel);
  const [salary, setSalary] = useState("");
  const [position, setPosition] = useState("");
  const [reason, setReason] = useState("");
  const manuallyEdited = useRef(false);

  useEffect(() => {
    if (emp) {
      setLevel(nextLevel);
      setPosition(emp.position);
      setReason("");
      manuallyEdited.current = false;
      const bandMin = bands?.[nextLevel]?.min;
      setSalary(String(bandMin && bandMin > 0 ? bandMin : emp.monthly_base_mmk));
    }
  }, [emp, nextLevel, bands]);

  // Auto-fill salary when level changes (unless user manually edited)
  useEffect(() => {
    if (!emp || manuallyEdited.current) return;
    const bandMin = bands?.[level]?.min;
    if (bandMin && bandMin > 0) setSalary(String(bandMin));
  }, [level, bands, emp]);

  const mut = useMutation({
    mutationFn: async (vars: { employeeId: string; toLevel: EmployeeLevel; toPosition: string; toBaseMmk: number; note: string }) =>
      promote({ data: vars }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["employees_fin"] });
      const prevEmps = qc.getQueryData<Emp[]>(["employees_fin"]);
      qc.setQueryData<Emp[]>(["employees_fin"], (old) =>
        (old ?? []).map((e) => e.id === vars.employeeId ? { ...e, level: vars.toLevel, monthly_base_mmk: vars.toBaseMmk } : e),
      );
      return { prevEmps };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prevEmps) qc.setQueryData(["employees_fin"], ctx.prevEmps);
      toast.error(e.message);
    },
    onSuccess: () => { toast.success("Promotion saved"); onClose(); },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["employees_fin"] });
      qc.invalidateQueries({ queryKey: ["promotions"] });
      qc.invalidateQueries({ queryKey: ["payroll_lines"] });
      qc.invalidateQueries({ queryKey: ["payroll_runs"] });
    },
  });

  if (!emp) return null;
  const band = bands?.[level];
  const salaryNum = Number(salary);
  const belowMin = !!band && salaryNum > 0 && salaryNum < band.min;
  const aboveMax = !!band && salaryNum > band.max;
  const canSave = reason.trim().length > 0 && salaryNum > 0 && position.trim().length > 0 && !belowMin && !mut.isPending;

  const save = () => {
    if (!canSave) return;
    mut.mutate({
      employeeId: emp.id,
      toLevel: level,
      toPosition: position.trim(),
      toBaseMmk: salaryNum,
      note: reason.trim(),
    });
  };

  return (
    <Dialog open={!!emp} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Promote {emp.full_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Current <Badge variant="secondary" className="mx-1">{LEVEL_LABEL[emp.level]}</Badge> · {emp.position} · <span className="font-medium text-foreground">{formatMMK(emp.monthly_base_mmk)}</span>
          </div>

          <div>
            <Label className="text-xs">Level</Label>
            <div className="mt-1 grid grid-cols-4 gap-1 rounded-md border border-border bg-muted/30 p-1">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => { manuallyEdited.current = false; setLevel(l); }}
                  className={`rounded px-2 py-1.5 text-xs font-medium transition ${level === l ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {LEVEL_LABEL[l]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs">Position <span className="text-destructive">*</span></Label>
            <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="e.g. Senior Engineer" />
          </div>

          <div>
            <Label className="text-xs">Salary (MMK)</Label>
            <Input
              type="number"
              value={salary}
              onChange={(e) => { manuallyEdited.current = true; setSalary(e.target.value); }}
            />
            {band && (
              <div className={`mt-1 text-xs ${belowMin ? "text-destructive" : "text-muted-foreground"}`}>
                {belowMin
                  ? `Below ${LEVEL_LABEL[level]} minimum (${formatMMKCompact(band.min)})`
                  : <>Band: {formatMMKCompact(band.min)} – {formatMMKCompact(band.max)}{aboveMax && " · above max"}</>}
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs">Reason <span className="text-destructive">*</span></Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Justification for this promotion"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!canSave}>
            {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- KPI Calculation tab ---------------- */
function KpiTab() {
  const qc = useQueryClient();
  const fetchKpi = useServerFn(getKpiDashboard);
  const setType = useServerFn(setEmploymentType);

  const [period, setPeriod] = useState<string>(() => {
    const d = new Date(); d.setUTCDate(1);
    return d.toISOString().slice(0, 7); // YYYY-MM
  });
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState<string>("all");
  const [type, setTypeFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const periodMonth = `${period}-01`;

  const { data: rows, isLoading } = useQuery({
    queryKey: ["kpi_dashboard", periodMonth],
    queryFn: () => fetchKpi({ data: { periodMonth } }),
    staleTime: 60_000,
  });

  const typeMut = useMutation({
    mutationFn: (v: { employeeId: string; type: "remote" | "on_site" }) => setType({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["kpi_dashboard", periodMonth] });
      const prev = qc.getQueryData<KpiRow[]>(["kpi_dashboard", periodMonth]);
      qc.setQueryData<KpiRow[]>(["kpi_dashboard", periodMonth], (old) =>
        (old ?? []).map((r) => r.employee_id === v.employeeId ? { ...r, employment_type: v.type } : r),
      );
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["kpi_dashboard", periodMonth], ctx.prev);
      toast.error(e.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kpi_dashboard", periodMonth] }),
  });

  const departments = useMemo(() => {
    const s = new Set<string>();
    (rows ?? []).forEach((r) => r.department && s.add(r.department));
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (dept !== "all" && r.department !== dept) return false;
      if (type !== "all" && r.employment_type !== type) return false;
      if (q && !r.full_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, dept, type]);

  const summary = useMemo(() => {
    const list = filtered;
    if (!list.length) return { avgKpi: 0, eligible: 0, avgAtt: 0, totalBonus: 0 };
    const avgKpi = list.reduce((a, r) => a + Number(r.kpi_score), 0) / list.length;
    const avgAtt = list.reduce((a, r) => a + Number(r.attendance_pct), 0) / list.length;
    const eligible = list.filter((r) => r.final_eligible).length;
    const totalBonus = list.reduce((a, r) => a + Number(r.final_bonus_mmk), 0);
    return { avgKpi, eligible, avgAtt, totalBonus };
  }, [filtered]);

  const filters = (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label className="text-xs">Period</Label>
        <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="h-9 w-[160px]" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Department</Label>
        <Select value={dept} onValueChange={setDept}>
          <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Employment type</Label>
        <Select value={type} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="on_site">On-Site</SelectItem>
            <SelectItem value="remote">Remote</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1 flex-1 min-w-[200px]">
        <Label className="text-xs">Search</Label>
        <Input placeholder="Employee name" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9" />
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {filters}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Avg KPI" value={summary.avgKpi.toFixed(1)} suffix="%" />
        <KpiCard label="Bonus Eligible" value={`${summary.eligible}`} suffix={` / ${filtered.length}`} />
        <KpiCard label="Avg Attendance" value={summary.avgAtt.toFixed(1)} suffix="%" />
        <KpiCard label="Final Bonus Total" value={formatMMKCompact(summary.totalBonus)} />
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="eligible">Eligible</TabsTrigger>
          <TabsTrigger value="bonus">Bonus</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Employee</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-right">Base</th>
                  <th className="px-4 py-3 text-right">Tasks</th>
                  <th className="px-4 py-3 text-right">Attendance</th>
                  <th className="px-4 py-3 text-right">Hours</th>
                  <th className="px-4 py-3 text-right">KPI</th>
                  <th className="px-4 py-3 text-center">Eligible</th>
                  <th className="px-4 py-3 text-right">Bonus</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </td></tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground">No employees match the filters.</td></tr>
                )}
                {filtered.map((r) => {
                  const isOpen = expanded === r.employee_id;
                  return (
                    <Fragment key={r.employee_id}>
                      <tr className="cursor-pointer border-t border-border hover:bg-muted/30" onClick={() => setExpanded(isOpen ? null : r.employee_id)}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{r.full_name}</div>
                          <div className="text-xs text-muted-foreground">{r.job_position} · {r.department}</div>
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <Select
                            value={r.employment_type}
                            onValueChange={(v) => typeMut.mutate({ employeeId: r.employee_id, type: v as "remote" | "on_site" })}
                          >
                            <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="on_site">On-Site</SelectItem>
                              <SelectItem value="remote">Remote</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-4 py-3 text-right">{formatMMKCompact(r.base_salary_mmk)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-medium">{Number(r.task_completion_pct).toFixed(0)}%</span>
                          <div className="text-[10px] text-muted-foreground">{r.tasks_done}/{r.tasks_total}</div>
                        </td>
                        <td className="px-4 py-3 text-right">{Number(r.attendance_pct).toFixed(0)}%</td>
                        <td className="px-4 py-3 text-right">{Number(r.working_hours).toFixed(0)}h</td>
                        <td className="px-4 py-3 text-right font-medium">{Number(r.kpi_score).toFixed(1)}</td>
                        <td className="px-4 py-3 text-center">
                          {r.final_eligible
                            ? <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15">Yes</Badge>
                            : <Badge variant="secondary" className="text-[10px]">No</Badge>}
                        </td>
                        <td className="px-4 py-3 text-right text-emerald-600">
                          {r.final_bonus_mmk > 0 ? `+${formatMMKCompact(r.final_bonus_mmk)}` : "—"}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-t border-border bg-muted/20">
                          <td colSpan={9} className="px-4 py-3 text-xs text-muted-foreground">
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                              <div><span className="text-foreground font-medium">{r.days_present}</span> days present</div>
                              <div><span className="text-foreground font-medium">{r.days_late}</span> days late</div>
                              <div><span className="text-foreground font-medium">{r.days_absent}</span> days absent</div>
                              <div><span className="text-foreground font-medium">{r.tasks_done}/{r.tasks_total}</span> tasks completed</div>
                              <div>Level: <span className="text-foreground font-medium">{LEVEL_LABEL[r.level as EmployeeLevel] ?? r.level}</span></div>
                              <div>Bonus tier: <span className="text-foreground font-medium">{bonusTier(Number(r.kpi_score))}</span></div>
                              <div>Final bonus: <span className="text-foreground font-medium">{formatMMK(r.final_bonus_mmk)}</span></div>
                              <div>Base salary: <span className="text-foreground font-medium">{formatMMK(r.base_salary_mmk)}</span></div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Eligibility: On-Site requires KPI ≥ 80 and Attendance ≥ 85%. Remote requires KPI ≥ 75 and Attendance ≥ 90%. Admin overrides take precedence over system rules.
          </p>
        </TabsContent>

        <TabsContent value="eligible" className="mt-4">
          <EligibleSubTab rows={filtered} periodMonth={periodMonth} isLoading={isLoading} />
        </TabsContent>

        <TabsContent value="bonus" className="mt-4">
          <BonusSubTab rows={filtered} periodMonth={periodMonth} isLoading={isLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- Eligible sub-tab ---------------- */
function EligibleSubTab({ rows, periodMonth, isLoading }: { rows: KpiRow[]; periodMonth: string; isLoading: boolean }) {
  const qc = useQueryClient();
  const setElig = useServerFn(setKpiEligibility);
  const mut = useMutation({
    mutationFn: (v: { employeeId: string; eligible: boolean | null }) =>
      setElig({ data: { employeeId: v.employeeId, periodMonth, eligible: v.eligible } }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["kpi_dashboard", periodMonth] });
      const prev = qc.getQueryData<KpiRow[]>(["kpi_dashboard", periodMonth]);
      qc.setQueryData<KpiRow[]>(["kpi_dashboard", periodMonth], (old) =>
        (old ?? []).map((r) => r.employee_id === v.employeeId
          ? { ...r, eligible_override: v.eligible, final_eligible: v.eligible ?? r.system_eligible }
          : r),
      );
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["kpi_dashboard", periodMonth], ctx.prev);
      toast.error(e.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi_dashboard", periodMonth] });
      qc.invalidateQueries({ queryKey: ["payroll_lines"] });
      toast.success("Eligibility updated");
    },
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left">Employee</th>
            <th className="px-4 py-3 text-right">KPI</th>
            <th className="px-4 py-3 text-right">Attendance</th>
            <th className="px-4 py-3 text-center">System</th>
            <th className="px-4 py-3 text-center">Eligible (Admin)</th>
            <th className="px-4 py-3 text-right">Reset</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && <tr><td colSpan={6} className="px-4 py-8 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>}
          {!isLoading && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No employees.</td></tr>}
          {rows.map((r) => (
            <tr key={r.employee_id} className="border-t border-border hover:bg-muted/30">
              <td className="px-4 py-3">
                <div className="font-medium">{r.full_name}</div>
                <div className="text-xs text-muted-foreground">{r.job_position} · {r.department}</div>
              </td>
              <td className="px-4 py-3 text-right">{Number(r.kpi_score).toFixed(1)}</td>
              <td className="px-4 py-3 text-right">{Number(r.attendance_pct).toFixed(0)}%</td>
              <td className="px-4 py-3 text-center">
                {r.system_eligible
                  ? <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">Yes</Badge>
                  : <Badge variant="outline" className="text-muted-foreground">No</Badge>}
              </td>
              <td className="px-4 py-3 text-center">
                <div className="flex items-center justify-center gap-2">
                  <Switch
                    checked={r.final_eligible}
                    onCheckedChange={(v) => mut.mutate({ employeeId: r.employee_id, eligible: v })}
                    disabled={mut.isPending}
                  />
                  <span className="text-xs">
                    {r.final_eligible ? "Yes" : "No"}
                    {r.eligible_override !== null && <span className="ml-1 text-amber-600">(override)</span>}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 text-right">
                {r.eligible_override !== null && (
                  <Button size="sm" variant="ghost"
                    onClick={() => mut.mutate({ employeeId: r.employee_id, eligible: null })}
                    disabled={mut.isPending}>
                    Reset
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Bonus sub-tab ---------------- */
function BonusSubTab({ rows, periodMonth, isLoading }: { rows: KpiRow[]; periodMonth: string; isLoading: boolean }) {
  const qc = useQueryClient();
  const setBonus = useServerFn(setKpiBonusOverride);
  const [dlg, setDlg] = useState<{ row: KpiRow } | null>(null);
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");

  function openDialog(r: KpiRow) {
    setDlg({ row: r });
    setAmount(String(r.bonus_override_mmk ?? r.system_bonus_mmk ?? 0));
    setNote(r.override_note ?? "");
  }

  const mut = useMutation({
    mutationFn: (v: { employeeId: string; amountMmk: number | null; note: string | null }) =>
      setBonus({ data: { employeeId: v.employeeId, periodMonth, amountMmk: v.amountMmk, note: v.note } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi_dashboard", periodMonth] });
      qc.invalidateQueries({ queryKey: ["payroll_lines"] });
      toast.success("Bonus updated");
      setDlg(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function save() {
    if (!dlg) return;
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) { toast.error("Enter a valid amount"); return; }
    if (!note.trim()) { toast.error("Reason note is required"); return; }
    mut.mutate({ employeeId: dlg.row.employee_id, amountMmk: Math.round(n), note: note.trim() });
  }

  function reset(r: KpiRow) {
    mut.mutate({ employeeId: r.employee_id, amountMmk: null, note: null });
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Employee</th>
              <th className="px-4 py-3 text-center">Eligible</th>
              <th className="px-4 py-3 text-right">Recommended</th>
              <th className="px-4 py-3 text-right">Final</th>
              <th className="px-4 py-3 text-left">Note</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="px-4 py-8 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>}
            {!isLoading && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No employees.</td></tr>}
            {rows.map((r) => {
              const overridden = r.bonus_override_mmk !== null;
              return (
                <tr key={r.employee_id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.full_name}</div>
                    <div className="text-xs text-muted-foreground">{r.job_position} · {r.department}</div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.final_eligible
                      ? <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15">Yes</Badge>
                      : <Badge variant="secondary">No</Badge>}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{formatMMKCompact(r.system_bonus_mmk)}</td>
                  <td className="px-4 py-3 text-right font-medium text-emerald-600">
                    {formatMMKCompact(r.final_bonus_mmk)}
                    {overridden && <span className="ml-1 text-[10px] text-amber-600">(override)</span>}
                  </td>
                  <td className="px-4 py-3 max-w-[240px] truncate text-xs text-muted-foreground" title={r.override_note ?? ""}>
                    {r.override_note ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" disabled={!r.final_eligible || mut.isPending} onClick={() => openDialog(r)}>
                        {overridden ? "Edit" : "Override"}
                      </Button>
                      {overridden && (
                        <Button size="sm" variant="ghost" onClick={() => reset(r)} disabled={mut.isPending}>Reset</Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Override bonus · {dlg?.row.full_name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg bg-muted/40 p-3 text-xs">
              <div>System recommended: <span className="font-medium text-foreground">{formatMMK(dlg?.row.system_bonus_mmk ?? 0)}</span></div>
              <div>KPI: <span className="font-medium text-foreground">{Number(dlg?.row.kpi_score ?? 0).toFixed(1)}</span> · Tier: <span className="font-medium text-foreground">{bonusTier(Number(dlg?.row.kpi_score ?? 0))}</span></div>
            </div>
            <div>
              <Label className="text-xs">Final bonus (MMK)</Label>
              <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Reason (required)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Outstanding client deal closed this month" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDlg(null)}>Cancel</Button>
            <Button onClick={save} disabled={mut.isPending || !note.trim()}>
              {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}


function KpiCard({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold tracking-tight">
        {value}<span className="text-base font-normal text-muted-foreground">{suffix ?? ""}</span>
      </div>
    </div>
  );
}
