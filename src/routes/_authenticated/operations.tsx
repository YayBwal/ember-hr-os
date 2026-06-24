import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatMMKCompact, initials } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/operations")({
  head: () => ({ meta: [{ title: "Operations · Mandai" }] }),
  component: OperationsPage,
});

type Employee = {
  id: string;
  full_name: string;
  email: string | null;
  department: string;
  position: string;
  monthly_base_mmk: number;
  performance_score: number;
  attendance_pct: number;
  workload: number;
};

function OperationsPage() {
  const { data: employees, isLoading } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, full_name, email, department, position, monthly_base_mmk, performance_score, attendance_pct, workload")
        .order("department");
      if (error) throw error;
      return (data ?? []) as Employee[];
    },
  });

  const byDept = (employees ?? []).reduce<Record<string, Employee[]>>((acc, e) => {
    (acc[e.department] ??= []).push(e);
    return acc;
  }, {});

  return (
    <AppShell>
      <div className="px-4 py-6 md:px-8">
        <div className="text-xs font-mono uppercase tracking-[0.2em] text-primary">Operations</div>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Workforce</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Departments, workload, performance and attendance at a glance.
        </p>

        {isLoading ? (
          <div className="mt-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (employees ?? []).length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No employees yet in this organization.
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            {Object.entries(byDept).map(([dept, list]) => (
              <section key={dept}>
                <div className="flex items-baseline justify-between">
                  <h2 className="font-display text-lg font-semibold tracking-tight">{dept}</h2>
                  <span className="text-xs text-muted-foreground">
                    {list.length} member{list.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((e) => (
                    <EmployeeCard key={e.id} e={e} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function EmployeeCard({ e }: { e: Employee }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <Avatar className="h-10 w-10">
          <AvatarFallback className="bg-primary/10 text-primary text-xs">{initials(e.full_name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate font-medium">{e.full_name}</div>
          <div className="truncate text-xs text-muted-foreground">{e.position}</div>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
        <Metric label="Perf" value={`${Number(e.performance_score).toFixed(1)}`} />
        <Metric label="Attend" value={`${Number(e.attendance_pct).toFixed(0)}%`} />
        <Metric label="Load" value={`${e.workload}/10`} />
      </dl>
      <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs">
        <span className="text-muted-foreground">Base · monthly</span>
        <span className="font-mono">{formatMMKCompact(e.monthly_base_mmk)}</span>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-2">
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-display text-sm font-semibold">{value}</div>
    </div>
  );
}
