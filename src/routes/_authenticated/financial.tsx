import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fragment, useMemo, useState } from "react";
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

const LEVELS: EmployeeLevel[] = ["junior", "mid", "senior", "lead"];
const LEVEL_LABEL: Record<EmployeeLevel, string> = { junior: "Junior", mid: "Mid", senior: "Senior", lead: "Lead" };

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
      const { data } = await supabase.from("payroll_lines").select("*").eq("run_id", run!.id);
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
                  <td className="px-4 py-3 text-right text-destructive">-{formatMMKCompact(l?.deduction_mmk ?? 0)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatMMK(l?.total_mmk ?? e.monthly_base_mmk)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "bonus", emp: e })}><Plus className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "deduction", emp: e })}><Minus className="h-3 w-3" /></Button>
                  </td>
                </tr>
              );
            })}
            {(employees?.length ?? 0) === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">No employees.</td></tr>}
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
                <>
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
                </>
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
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["employees_fin"] });
          qc.invalidateQueries({ queryKey: ["promotions"] });
          qc.invalidateQueries({ queryKey: ["payroll_lines"] });
        }}
        promote={promoteFn}
      />
    </div>
  );
}

/* ---------------- Promote dialog ---------------- */
function PromoteDialog({
  emp, bands, onClose, onSaved, promote,
}: {
  emp: Emp | null;
  bands: Record<EmployeeLevel, { min: number; max: number }> | null;
  onClose: () => void;
  onSaved: () => void;
  promote: ReturnType<typeof useServerFn<typeof promoteEmployee>>;
}) {
  const nextLevel: EmployeeLevel = useMemo(() => {
    if (!emp) return "mid";
    const idx = LEVELS.indexOf(emp.level);
    return LEVELS[Math.min(idx + 1, LEVELS.length - 1)];
  }, [emp]);

  const [level, setLevel] = useState<EmployeeLevel>(nextLevel);
  const [position, setPosition] = useState("");
  const [salary, setSalary] = useState("");
  const [effective, setEffective] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // reset when emp changes
  useMemo(() => {
    if (emp) {
      setLevel(nextLevel);
      setPosition(emp.position);
      const band = bands?.[nextLevel];
      setSalary(String(band?.min ?? emp.monthly_base_mmk));
      setNote("");
    }
  }, [emp, nextLevel, bands]);

  if (!emp) return null;
  const band = bands?.[level];
  const salaryNum = Number(salary);
  const outOfBand = band && salaryNum > 0 && (salaryNum < band.min || salaryNum > band.max);

  const save = async () => {
    if (!position.trim()) { toast.error("Position required"); return; }
    if (!salaryNum || salaryNum <= 0) { toast.error("Salary required"); return; }
    setSaving(true);
    try {
      await promote({ data: {
        employeeId: emp.id, toLevel: level, toPosition: position.trim(),
        toBaseMmk: salaryNum, effectiveDate: effective, note: note || undefined,
      }});
      toast.success(`${emp.full_name} promoted to ${LEVEL_LABEL[level]}`);
      onSaved(); onClose();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={!!emp} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promote {emp.full_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Currently <Badge variant="secondary">{LEVEL_LABEL[emp.level]}</Badge> · {emp.position} · {formatMMK(emp.monthly_base_mmk)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>New level</Label>
              <Select value={level} onValueChange={(v) => {
                const lv = v as EmployeeLevel;
                setLevel(lv);
                const b = bands?.[lv]; if (b) setSalary(String(b.min));
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEVELS.map((l) => <SelectItem key={l} value={l}>{LEVEL_LABEL[l]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Effective date</Label>
              <Input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>New position</Label>
            <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="e.g. Senior Engineer" />
          </div>
          <div>
            <Label>New monthly salary (MMK)</Label>
            <Input type="number" value={salary} onChange={(e) => setSalary(e.target.value)} />
            {band && (
              <div className={`mt-1 text-xs ${outOfBand ? "text-destructive" : "text-muted-foreground"}`}>
                Band for {LEVEL_LABEL[level]}: {formatMMKCompact(band.min)} – {formatMMKCompact(band.max)}
                {outOfBand && " · outside band"}
              </div>
            )}
          </div>
          <div>
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save promotion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
