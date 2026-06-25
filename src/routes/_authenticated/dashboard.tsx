import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { formatMMKCompact } from "@/lib/format";
import { Users, ListTodo, Wallet, Gauge, CalendarCheck2, ArrowUpRight, Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Overview · Mandai" }] }),
  component: DashboardPage,
});

type Kpis = {
  employees: number;
  open_tasks: number;
  payroll_mmk: number;
  avg_performance: number;
  attendance_pct: number;
};

function DashboardPage() {
  const { data: kpis, isLoading } = useQuery({
    queryKey: ["dashboard-kpis"],
    queryFn: async (): Promise<Kpis> => {
      const [emp, tasks, payroll] = await Promise.all([
        supabase.from("employees").select("id, monthly_base_mmk, performance_score, attendance_pct"),
        supabase.from("tasks").select("id, status"),
        supabase.from("payroll_runs").select("total_mmk, period_month").order("period_month", { ascending: false }).limit(1),
      ]);
      const employees = emp.data ?? [];
      const allTasks = tasks.data ?? [];
      const totalBase = employees.reduce((s, e) => s + Number(e.monthly_base_mmk ?? 0), 0);
      const avgPerf =
        employees.length > 0
          ? employees.reduce((s, e) => s + Number(e.performance_score ?? 0), 0) / employees.length
          : 0;
      const avgAtt =
        employees.length > 0
          ? employees.reduce((s, e) => s + Number(e.attendance_pct ?? 0), 0) / employees.length
          : 0;
      const lastPayroll = payroll.data?.[0]?.total_mmk ? Number(payroll.data[0].total_mmk) : totalBase;
      return {
        employees: employees.length,
        open_tasks: allTasks.filter((t) => t.status !== "done").length,
        payroll_mmk: lastPayroll,
        avg_performance: Math.round(avgPerf * 10) / 10,
        attendance_pct: Math.round(avgAtt * 10) / 10,
      };
    },
  });

  const { data: recent } = useQuery({
    queryKey: ["recent-tasks"],
    queryFn: async () => {
      const { data } = await supabase
        .from("tasks")
        .select("id, title, status, updated_at")
        .order("updated_at", { ascending: false })
        .limit(6);
      return data ?? [];
    },
  });

  return (
    <AppShell>
      <div className="px-4 py-6 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-mono uppercase tracking-[0.2em] text-primary">Overview</div>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Operating snapshot</h1>
          </div>
          <Link
            to="/operations"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Sparkles className="h-3.5 w-3.5" /> Open Operations
          </Link>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi icon={Users} label="Employees" value={isLoading ? "—" : String(kpis?.employees ?? 0)} />
          <Kpi icon={ListTodo} label="Open tasks" value={isLoading ? "—" : String(kpis?.open_tasks ?? 0)} live />
          <Kpi
            icon={Wallet}
            label="Payroll · last run"
            value={isLoading ? "—" : formatMMKCompact(kpis?.payroll_mmk ?? 0)}
            accent
          />
          <Kpi icon={Gauge} label="Avg performance" value={isLoading ? "—" : `${kpis?.avg_performance ?? 0}`} />
          <Kpi icon={CalendarCheck2} label="Attendance" value={isLoading ? "—" : `${kpis?.attendance_pct ?? 0}%`} />
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">Modules</h2>
                <p className="text-sm text-muted-foreground">Jump into the four pillars of your workspace.</p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                { to: "/pipeline", label: "Pipeline", blurb: "AI-scored candidates → onboarding" },
                { to: "/operations", label: "Operations", blurb: "Teams, tasks, reports & KPIs" },
                { to: "/team-leader", label: "Team Leader", blurb: "File reports & rate members" },
                { to: "/financial", label: "Financial", blurb: "MMK payroll, tied to performance" },
              ].map((m) => (
                <Link
                  key={m.to}
                  to={m.to}
                  className="group flex items-center justify-between rounded-lg border border-border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
                >
                  <div>
                    <div className="font-medium">{m.label}</div>
                    <div className="text-xs text-muted-foreground">{m.blurb}</div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                </Link>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-display text-lg font-semibold tracking-tight">Recent activity</h2>
            <ul className="mt-3 divide-y divide-border">
              {(recent ?? []).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                  <span className="truncate">{t.title}</span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono uppercase ${
                      t.status === "done"
                        ? "bg-success/15 text-success"
                        : t.status === "in_progress"
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {String(t.status).replace("_", " ")}
                  </span>
                </li>
              ))}
              {(!recent || recent.length === 0) && (
                <li className="py-6 text-center text-xs text-muted-foreground">No activity yet.</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  live,
  accent,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  live?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${accent ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}
    >
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Icon className="h-3 w-3" /> {label}
        </span>
        {live && (
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
        )}
      </div>
      <div className={`mt-2 font-display text-2xl font-semibold tracking-tight ${accent ? "text-primary" : ""}`}>
        {value}
      </div>
    </div>
  );
}
