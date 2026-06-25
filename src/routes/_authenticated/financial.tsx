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
import { toast } from "sonner";
import { Loader2, Plus, Minus, RefreshCw, TrendingUp, History, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
            <TabsTrigger value="promotions">Promotions &amp; Demotions</TabsTrigger>
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
  const [periodInput, setPeriodInput] = useState<string>(() => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const period = `${periodInput}-01`;
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
      const { data } = await supabase.from("payroll_runs").select("id,period_month,total_mmk,last_recomputed_at").eq("period_month", period).order("last_recomputed_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
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
  const { data: overrides } = useQuery({
    queryKey: ["kpi_overrides", period],
    queryFn: async () => {
      const { data } = await supabase.from("kpi_overrides").select("employee_id,bonus_override_mmk,note").eq("period_month", period);
      return (data ?? []) as Array<{ employee_id: string; bonus_override_mmk: number | null; note: string | null }>;
    },
  });
  const overrideFor = (id: string) => overrides?.find((o) => o.employee_id === id);
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

  const lastRecomputed = run?.last_recomputed_at ? new Date(run.last_recomputed_at as string) : null;

  return (
    <TooltipProvider delayDuration={150}>
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Period</Label>
            <Input type="month" value={periodInput} onChange={(e) => setPeriodInput(e.target.value)} className="h-9 w-[160px]" />
            {lastRecomputed && (
              <Badge variant="outline" className="text-[10px] font-normal">
                Last recomputed: {lastRecomputed.toLocaleString()}
              </Badge>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Total <span className="font-medium text-foreground">{formatMMKCompact(run?.total_mmk ?? 0)}</span>.
            Payroll is finalized only when you click <span className="font-medium text-foreground">Recompute</span>. Live KPI and attendance changes flow into KPI Calculation immediately.
          </p>
        </div>
        <Button onClick={() => runMut.mutate()} disabled={runMut.isPending}>
          {runMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Recompute payroll
        </Button>
      </div>

      {!run && (
        <div className="mt-4 rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          Payroll has not been computed for this period. Click <span className="font-medium text-foreground">Recompute Payroll</span> to generate results.
        </div>
      )}

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
              const ov = overrideFor(e.id);
              const isOverride = ov?.bonus_override_mmk != null;
              const tier = bonusTier(Number(l?.kpi_snapshot ?? 0));
              const bonusTip = isOverride
                ? `Manually adjusted by HR${ov?.note ? ` · ${ov.note}` : ""}`
                : `Auto-generated from KPI tier (${tier})`;
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
                    <Badge variant="outline">{(l?.kpi_snapshot ?? 0).toFixed(1)} · {tier}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-1 cursor-help">
                          +{formatMMKCompact(l?.performance_bonus_mmk ?? 0)}
                          <Info className="h-3 w-3 opacity-60" />
                          {isOverride && <Badge variant="secondary" className="ml-1 text-[9px]">manual</Badge>}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{bonusTip}</TooltipContent>
                    </Tooltip>
                  </td>
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
    </TooltipProvider>
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

  // Tracking stats
  const stats = useMemo(() => {
    const now = new Date();
    const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const dir = (p: Promotion) => {
      if (!p.from_level) return 0;
      return LEVELS.indexOf(p.to_level) - LEVELS.indexOf(p.from_level);
    };
    const inQuarter = (promotions ?? []).filter((p) => new Date(p.effective_date) >= qStart);
    const inMonth = (promotions ?? []).filter((p) => new Date(p.effective_date) >= mStart);
    const promotionsQ = inQuarter.filter((p) => dir(p) > 0).length;
    const demotionsQ = inQuarter.filter((p) => dir(p) < 0).length;
    let netDelta = 0, uplift = 0, savings = 0;
    for (const p of inMonth) {
      const d = p.to_base_mmk - (p.from_base_mmk ?? 0);
      netDelta += d;
      if (d > 0) uplift += d;
      else if (d < 0) savings += -d;
    }
    return { promotionsQ, demotionsQ, netDelta, uplift, savings };
  }, [promotions]);


  return (
    <div>
      {/* Promotion / Demotion tracking */}
      <div>
        <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Promotion / Demotion tracking</div>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Promotions this quarter</div>
            <div className="mt-1 flex items-center gap-2 text-2xl font-semibold"><TrendingUp className="h-5 w-5 text-primary" />{stats.promotionsQ}</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Demotions this quarter</div>
            <div className="mt-1 flex items-center gap-2 text-2xl font-semibold"><Minus className="h-5 w-5 text-muted-foreground" />{stats.demotionsQ}</div>
          </div>
        </div>
      </div>

      {/* Financial impact tracking */}
      <div className="mt-5">
        <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Financial impact tracking</div>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Net salary delta (this month)</div>
            <div className="mt-1 text-2xl font-semibold">{formatMMKCompact(stats.netDelta)}</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Promotion uplift (this month)</div>
            <div className="mt-1 text-2xl font-semibold text-primary">{formatMMKCompact(stats.uplift)}</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Demotion savings (this month)</div>
            <div className="mt-1 text-2xl font-semibold">{formatMMKCompact(stats.savings)}</div>
          </div>
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
                      <Button size="sm" onClick={() => setPromoting(e)}>
                        <RefreshCw className="mr-1 h-3 w-3" /> Adjust Level
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
                            {historyFor(e.id).map((p) => {
                              const diff = p.from_level ? LEVELS.indexOf(p.to_level) - LEVELS.indexOf(p.from_level) : 0;
                              const kind = diff > 0 ? "Promotion" : diff < 0 ? "Demotion" : "Lateral";
                              return (
                              <li key={p.id} className="flex flex-wrap items-center gap-2">
                                <span className="text-muted-foreground">{new Date(p.effective_date).toLocaleDateString()}</span>
                                <Badge variant={diff < 0 ? "outline" : "secondary"} className="text-[10px]">{kind}</Badge>
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
                              );
                            })}
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
  const currentLevel: EmployeeLevel = useMemo(() => {
    if (!emp) return "junior";
    return (emp.level === "mid" ? "junior" : emp.level) as EmployeeLevel;
  }, [emp]);

  const nextLevel: EmployeeLevel = useMemo(() => {
    const idx = LEVELS.indexOf(currentLevel);
    return LEVELS[Math.min(Math.max(idx, 0) + 1, LEVELS.length - 1)];
  }, [currentLevel]);

  const [level, setLevel] = useState<EmployeeLevel>(nextLevel);
  const [salary, setSalary] = useState("");
  const [position, setPosition] = useState("");
  const [reason, setReason] = useState("");
  const manuallyEdited = useRef(false);

  const direction = LEVELS.indexOf(level) - LEVELS.indexOf(currentLevel);
  const isPromotion = direction > 0;
  const isDemotion = direction < 0;

  const autoSalaryFor = (lvl: EmployeeLevel): number | null => {
    if (!emp) return null;
    const b = bands?.[lvl];
    const dir = LEVELS.indexOf(lvl) - LEVELS.indexOf(currentLevel);
    if (dir > 0) return b?.min && b.min > 0 ? b.min : null;
    if (dir < 0) return b?.max && b.max > 0 ? b.max : null;
    return emp.monthly_base_mmk;
  };

  useEffect(() => {
    if (emp) {
      setLevel(nextLevel);
      setPosition(emp.position);
      setReason("");
      manuallyEdited.current = false;
      const auto = autoSalaryFor(nextLevel);
      setSalary(String(auto && auto > 0 ? auto : emp.monthly_base_mmk));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emp, nextLevel, bands]);

  // Auto-fill salary when level changes (unless user manually edited)
  useEffect(() => {
    if (!emp || manuallyEdited.current) return;
    const auto = autoSalaryFor(level);
    if (auto && auto > 0) setSalary(String(auto));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    onSuccess: () => {
      toast.success(isDemotion ? "Demotion saved" : "Promotion saved");
      onClose();
    },
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
  const positiveSalary = salaryNum > 0;
  const belowMin = !!band && positiveSalary && salaryNum < band.min;
  const aboveMax = !!band && positiveSalary && salaryNum > band.max;

  let salaryError: string | null = null;
  if (!positiveSalary) salaryError = "Salary required";
  else if (band) {
    if (isPromotion && belowMin) salaryError = `Promotion salary must be ≥ ${LEVEL_LABEL[level]} minimum (${formatMMKCompact(band.min)})`;
    else if (isPromotion && aboveMax) salaryError = `Above ${LEVEL_LABEL[level]} maximum (${formatMMKCompact(band.max)})`;
    else if (isDemotion && aboveMax) salaryError = `Demotion salary must be ≤ ${LEVEL_LABEL[level]} maximum (${formatMMKCompact(band.max)})`;
    else if (isDemotion && belowMin) salaryError = `Below ${LEVEL_LABEL[level]} minimum (${formatMMKCompact(band.min)})`;
  }

  const sameLevel = direction === 0;
  const canSave =
    !sameLevel &&
    reason.trim().length > 0 &&
    position.trim().length > 0 &&
    !salaryError &&
    !mut.isPending;

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
          <DialogTitle className="flex items-center gap-2">
            Adjust Level — {emp.full_name}
            {isPromotion && <Badge className="bg-primary/15 text-primary hover:bg-primary/15">Promotion</Badge>}
            {isDemotion && <Badge variant="outline">Demotion</Badge>}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Current <Badge variant="secondary" className="mx-1">{LEVEL_LABEL[emp.level]}</Badge> · {emp.position} · <span className="font-medium text-foreground">{formatMMK(emp.monthly_base_mmk)}</span>
          </div>

          <div>
            <Label className="text-xs">Target Level</Label>
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
            {sameLevel && (
              <div className="mt-1 text-xs text-muted-foreground">Pick a different level to record a promotion or demotion.</div>
            )}
          </div>

          <div>
            <Label className="text-xs">Target Position <span className="text-destructive">*</span></Label>
            <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="e.g. Senior Engineer" />
          </div>

          <div>
            <Label className="text-xs">Target Salary (MMK) <span className="text-destructive">*</span></Label>
            <Input
              type="number"
              value={salary}
              onChange={(e) => { manuallyEdited.current = true; setSalary(e.target.value); }}
            />
            {salaryError ? (
              <div className="mt-1 text-xs text-destructive">{salaryError}</div>
            ) : band ? (
              <div className="mt-1 text-xs text-muted-foreground">
                Band: {formatMMKCompact(band.min)} – {formatMMKCompact(band.max)}
              </div>
            ) : (
              <div className="mt-1 text-xs text-muted-foreground">No salary band configured for {LEVEL_LABEL[level]}.</div>
            )}
          </div>

          <div>
            <Label className="text-xs">Reason / Justification <span className="text-destructive">*</span></Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder={isDemotion ? "Justification for this demotion" : "Justification for this promotion"}
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
        <Label className="text-xs flex items-center gap-1.5">
          Period
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live · Operations sync
          </span>
        </Label>
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
                  <th className="px-4 py-3 text-right">OT hrs</th>
                  <th className="px-4 py-3 text-right">KPI</th>
                  <th className="px-4 py-3 text-center">Eligible</th>
                  <th className="px-4 py-3 text-right">Bonus</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </td></tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-muted-foreground">No employees match the filters.</td></tr>
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
                        <td className="px-4 py-3 text-right">{Number(r.overtime_hours ?? 0) > 0 ? <span className="text-amber-600 font-medium">{Number(r.overtime_hours).toFixed(0)}h</span> : <span className="text-muted-foreground">—</span>}</td>
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
                          <td colSpan={10} className="px-4 py-3 text-xs text-muted-foreground">
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
