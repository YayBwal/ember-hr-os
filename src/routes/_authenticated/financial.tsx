import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Wallet, Plus, Minus, RefreshCw } from "lucide-react";
import { formatMMK, formatMMKCompact } from "@/lib/format";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { addBonus, addDeduction, runPayroll } from "@/lib/financial.functions";

export const Route = createFileRoute("/_authenticated/financial")({
  head: () => ({ meta: [{ title: "Financial · Mandai" }] }),
  component: FinancialPage,
});

type Line = {
  id: string; employee_id: string; base_mmk: number; performance_bonus_mmk: number;
  bonus_mmk: number; deduction_mmk: number; overtime_mmk: number; total_mmk: number;
  kpi_snapshot: number; tasks_completed: number;
};
type Emp = { id: string; full_name: string; department: string; position: string; monthly_base_mmk: number };

function bonusTier(kpi: number): string {
  if (kpi >= 95) return "20%"; if (kpi >= 90) return "15%"; if (kpi >= 85) return "10%"; if (kpi >= 80) return "5%"; return "0%";
}

function FinancialPage() {
  useRealtimeInvalidate(
    ["payroll_lines", "payroll_runs", "bonuses", "deductions", "employees", "employee_kpis"],
    ["payroll_lines", "payroll_runs", "employees_fin"],
  );
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
      const { data } = await supabase.from("employees").select("id,full_name,department,position,monthly_base_mmk");
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
    <AppShell>
      <div className="px-4 py-6 md:px-8">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-mono uppercase tracking-[0.2em] text-primary">Financial</div>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Payroll</h1>
            <p className="mt-1 text-sm text-muted-foreground">Period {period.slice(0, 7)}. Total <span className="font-medium text-foreground">{formatMMKCompact(run?.total_mmk ?? 0)}</span>.</p>
          </div>
          <Button onClick={() => runMut.mutate()} disabled={runMut.isPending}>
            {runMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Recompute payroll
          </Button>
        </div>

        <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-card">
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
                      <div className="font-medium">{e.full_name}</div>
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
    </AppShell>
  );
}
