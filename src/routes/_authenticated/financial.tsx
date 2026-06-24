import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { formatMMK, formatMMKCompact } from "@/lib/format";
import { Wallet, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/financial")({
  head: () => ({ meta: [{ title: "Financial · Mandai" }] }),
  component: FinancialPage,
});

type Employee = {
  id: string;
  full_name: string;
  department: string;
  position: string;
  monthly_base_mmk: number;
  performance_score: number;
};

type PayrollRun = { id: string; period_month: string; total_mmk: number; generated_at: string };
type PayrollLine = {
  id: string;
  employee_id: string;
  base_mmk: number;
  performance_bonus_mmk: number;
  total_mmk: number;
  tasks_completed: number;
};

function FinancialPage() {
  const qc = useQueryClient();

  const { data: employees } = useQuery({
    queryKey: ["employees", "for-payroll"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, full_name, department, position, monthly_base_mmk, performance_score");
      if (error) throw error;
      return (data ?? []) as Employee[];
    },
  });

  const { data: runs } = useQuery({
    queryKey: ["payroll", "runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_runs")
        .select("id, period_month, total_mmk, generated_at")
        .order("period_month", { ascending: false })
        .limit(6);
      if (error) throw error;
      return (data ?? []) as PayrollRun[];
    },
  });

  const latestRunId = runs?.[0]?.id;

  const { data: lines } = useQuery({
    queryKey: ["payroll", "lines", latestRunId],
    enabled: !!latestRunId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_lines")
        .select("id, employee_id, base_mmk, performance_bonus_mmk, total_mmk, tasks_completed")
        .eq("run_id", latestRunId!);
      if (error) throw error;
      return (data ?? []) as PayrollLine[];
    },
  });

  const linesByEmp = new Map((lines ?? []).map((l) => [l.employee_id, l]));

  const recalculate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("recalculate-payroll", { body: {} });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Payroll recalculated");
      qc.invalidateQueries({ queryKey: ["payroll"] });
      qc.invalidateQueries({ queryKey: ["kpis"] });
    },
    onError: (e: Error) => toast.error(e.message || "Recalculation failed"),
  });

  const projected = (employees ?? []).reduce((s, e) => {
    const bonus = Math.round(Number(e.monthly_base_mmk) * (Number(e.performance_score) / 100 - 0.8) * 0.5);
    return s + Number(e.monthly_base_mmk) + Math.max(0, bonus);
  }, 0);

  return (
    <AppShell>
      <div className="px-4 py-6 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-mono uppercase tracking-[0.2em] text-primary">Financial</div>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Payroll · MMK</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Monthly payroll tied to performance and completed delivery.
            </p>
          </div>
          <Button onClick={() => recalculate.mutate()} disabled={recalculate.isPending} className="gap-1.5">
            {recalculate.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Recalculate now
          </Button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Tile label="Latest run" value={runs?.[0] ? formatMMKCompact(runs[0].total_mmk) : "—"} accent />
          <Tile label="Projected (live)" value={formatMMKCompact(projected)} />
          <Tile label="Headcount" value={String(employees?.length ?? 0)} />
        </div>

        <div className="mt-8 overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Wallet className="h-4 w-4 text-primary" />
            <h2 className="font-display text-base font-semibold tracking-tight">Per-employee breakdown</h2>
            {runs?.[0] && (
              <span className="ml-auto text-xs text-muted-foreground">
                Period {runs[0].period_month}
              </span>
            )}
          </div>
          <div className="grid grid-cols-12 gap-2 border-b border-border bg-muted/30 px-4 py-2.5 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            <div className="col-span-4">Employee</div>
            <div className="col-span-2">Department</div>
            <div className="col-span-2 text-right">Base</div>
            <div className="col-span-2 text-right">Bonus</div>
            <div className="col-span-2 text-right">Total</div>
          </div>
          {(employees ?? []).map((e) => {
            const line = linesByEmp.get(e.id);
            const base = line?.base_mmk ?? Number(e.monthly_base_mmk);
            const bonus = line?.performance_bonus_mmk ?? Math.max(0, Math.round(Number(e.monthly_base_mmk) * (Number(e.performance_score) / 100 - 0.8) * 0.5));
            const total = line?.total_mmk ?? base + bonus;
            return (
              <div key={e.id} className="grid grid-cols-12 items-center gap-2 border-b border-border px-4 py-3 last:border-0">
                <div className="col-span-4">
                  <div className="font-medium">{e.full_name}</div>
                  <div className="text-xs text-muted-foreground">{e.position}</div>
                </div>
                <div className="col-span-2 text-xs">{e.department}</div>
                <div className="col-span-2 text-right font-mono text-sm">{formatMMK(base)}</div>
                <div className="col-span-2 text-right font-mono text-sm text-primary">
                  {bonus > 0 ? `+${formatMMK(bonus)}` : formatMMK(0)}
                </div>
                <div className="col-span-2 text-right font-mono text-sm font-semibold">{formatMMK(total)}</div>
              </div>
            );
          })}
          {(employees ?? []).length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">No employees to pay yet.</div>
          )}
        </div>

        {(runs ?? []).length > 0 && (
          <div className="mt-8">
            <h2 className="font-display text-base font-semibold tracking-tight">Recent runs</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(runs ?? []).map((r) => (
                <div key={r.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="text-xs text-muted-foreground">{r.period_month}</div>
                  <div className="mt-1 font-display text-xl font-semibold">{formatMMKCompact(r.total_mmk)}</div>
                  <div className="mt-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    Run · {new Date(r.generated_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
      <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-2xl font-semibold tracking-tight ${accent ? "text-primary" : ""}`}>
        {value}
      </div>
    </div>
  );
}
