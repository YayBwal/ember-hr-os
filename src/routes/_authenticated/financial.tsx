import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fragment, useEffect, useMemo, useState } from "react";
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
          </TabsList>
          <TabsContent value="payroll" className="mt-4"><PayrollTab /></TabsContent>
          <TabsContent value="promotions" className="mt-4"><PromotionsTab /></TabsContent>
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

  // Suggested promotions: KPI >= 90 + not promoted in 180 days
  const suggestions = useMemo(() => {
    const cutoff = Date.now() - 180 * 86400000;
    return (employees ?? []).filter((e) => {
      if ((e.performance_score ?? 0) < 90) return false;
      if (e.level === "lead") return false;
      const last = lastPromotionFor(e.id);
      // count "real" promotion (not the baseline hire row)
      const realLast = historyFor(e.id).find((p) => p.from_level !== null);
      const lastDate = realLast ? new Date(realLast.effective_date).getTime() : (e.join_date ? new Date(e.join_date).getTime() : 0);
      return lastDate < cutoff || !last;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, promotions]);

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

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium"><Sparkles className="h-4 w-4 text-primary" /> Suggested promotions</div>
          <p className="mt-1 text-xs text-muted-foreground">High KPI and overdue for a level bump.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.slice(0, 6).map((e) => (
              <button
                key={e.id}
                onClick={() => setPromoting(e)}
                className="rounded-full border border-border bg-card px-3 py-1 text-xs hover:bg-accent"
              >
                {e.full_name} · KPI {(e.performance_score ?? 0).toFixed(0)}
              </button>
            ))}
          </div>
        </div>
      )}

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
  const [kpiAdj, setKpiAdj] = useState(0);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (emp) {
      setLevel(nextLevel);
      setSalary(String(emp.monthly_base_mmk));
      setPosition(emp.position);
      setKpiAdj(0);
      setReason("");
    }
  }, [emp, nextLevel]);

  const mut = useMutation({
    mutationFn: async (vars: { employeeId: string; toLevel: EmployeeLevel; toPosition: string; toBaseMmk: number; note: string; kpiAdjustment: number }) =>
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
  const outOfBand = band && salaryNum > 0 && (salaryNum < band.min || salaryNum > band.max);
  const canSave = reason.trim().length > 0 && salaryNum > 0 && position.trim().length > 0 && !mut.isPending;

  const save = () => {
    if (!canSave) return;
    mut.mutate({
      employeeId: emp.id,
      toLevel: level,
      toPosition: position.trim(),
      toBaseMmk: salaryNum,
      note: reason.trim(),
      kpiAdjustment: kpiAdj,
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
                  onClick={() => setLevel(l)}
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
            <Input type="number" value={salary} onChange={(e) => setSalary(e.target.value)} />
            {band && (
              <div className={`mt-1 text-xs ${outOfBand ? "text-destructive" : "text-muted-foreground"}`}>
                Band: {formatMMKCompact(band.min)} – {formatMMKCompact(band.max)}{outOfBand && " · outside band"}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">KPI adjustment</Label>
              <Badge variant={kpiAdj === 0 ? "outline" : kpiAdj > 0 ? "default" : "destructive"}>
                {kpiAdj > 0 ? "+" : ""}{kpiAdj}
              </Badge>
            </div>
            <Slider
              className="mt-2"
              min={-50}
              max={50}
              step={1}
              value={[kpiAdj]}
              onValueChange={(v) => setKpiAdj(v[0] ?? 0)}
            />
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>−50</span><span>0</span><span>+50</span>
            </div>
          </div>

          <div>
            <Label className="text-xs">Reason <span className="text-destructive">*</span></Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Justification for this promotion / adjustment"
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
