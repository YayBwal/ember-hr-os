// Shared AI tool catalog + dispatcher used by both the voice assistant and
// the text Copilot. Pure helper module (no `process.env` at module scope) —
// safe to import from server-function files reachable by client bundles.

export type AiAction = { type: "navigate"; to: string };

export type ChartSpec = {
  type: "bar" | "line";
  title?: string;
  data: { label: string; value: number }[];
};

export type ToolResult = {
  result: unknown;
  action?: AiAction;
  chart?: ChartSpec;
};

export const ALL_TOOLS = [
  {
    type: "function",
    function: {
      name: "navigate",
      description: "Navigate the app to a route. Use when the user wants to open/go to a page.",
      parameters: {
        type: "object",
        properties: {
          route: {
            type: "string",
            enum: ["/pipeline", "/operations", "/team-leader", "/financial", "/settings"],
          },
        },
        required: ["route"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_candidates",
      description:
        "Search the recruitment candidates table by full or partial name. Use when the user asks to find / look up / show a specific candidate.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Candidate name fragment." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "kpi_ranking",
      description:
        "Get a ranked list of employees by KPI for a month. Use for 'who has the lowest/highest KPI', 'top performers', etc.",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["lowest", "highest"] },
          limit: { type: "number", description: "1-20, default 5" },
          period: { type: "string", description: "YYYY-MM. Default = current month." },
        },
        required: ["direction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bonus_totals",
      description:
        "Total bonuses (performance + extra) paid in a month. Use for 'how much did we pay in bonuses'.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", description: "YYYY-MM. Default = current month." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "payroll_summary",
      description:
        "Monthly payroll breakdown per employee. Returns base, performance bonus, extra bonus, deductions, total, and KPI snapshot. Use for any payroll/salary question.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", description: "YYYY-MM. Default = current month." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "attendance_summary",
      description:
        "Attendance counts (present/late/absent) for the org in a month. Use for attendance questions.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", description: "YYYY-MM. Default = current month." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "team_overview",
      description: "List teams in the org with member counts and average KPI.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

function monthStart(period?: string): string {
  const d = period ? new Date(`${period}-01`) : new Date();
  if (Number.isNaN(d.getTime())) {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10);
  }
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function fmtMMK(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n || 0));
}

type SupabaseLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  supabase: SupabaseLike,
): Promise<ToolResult> {
  switch (name) {
    case "navigate": {
      const route = String(args.route ?? "");
      if (!route) return { result: { ok: false, error: "missing route" } };
      return {
        result: { ok: true, navigated_to: route },
        action: { type: "navigate", to: route },
      };
    }

    case "search_candidates": {
      const q = String(args.query ?? "").trim();
      if (!q) return { result: { ok: false, error: "empty query" } };
      const { data: rows, error } = await supabase
        .from("candidates")
        .select("id,full_name,email,role_applied,status,ai_match_score")
        .ilike("full_name", `%${q}%`)
        .limit(10);
      if (error) return { result: { ok: false, error: error.message } };
      return {
        result: { ok: true, count: (rows ?? []).length, candidates: rows ?? [] },
        action: { type: "navigate", to: `/pipeline?q=${encodeURIComponent(q)}` },
      };
    }

    case "kpi_ranking": {
      const dir = args.direction === "highest" ? "highest" : "lowest";
      const limit = Math.max(1, Math.min(20, Number(args.limit ?? 5)));
      const period = monthStart(args.period as string | undefined);
      const { data: rows, error } = await supabase
        .from("employee_kpis")
        .select("kpi, task_completion, attendance, employee_id, employees(full_name, position, department)")
        .eq("period_month", period)
        .order("kpi", { ascending: dir === "lowest" })
        .limit(limit);
      if (error) return { result: { ok: false, error: error.message } };
      type KpiRow = { name: string; position: string | null; department: string | null; kpi: number; task_completion: number; attendance: number };
      const list: KpiRow[] = (rows ?? []).map((r: Record<string, unknown>) => {
        const emp = r.employees as { full_name?: string; position?: string; department?: string } | null;
        return {
          name: emp?.full_name ?? "—",
          position: emp?.position ?? null,
          department: emp?.department ?? null,
          kpi: Math.round(Number(r.kpi ?? 0)),
          task_completion: Math.round(Number(r.task_completion ?? 0)),
          attendance: Math.round(Number(r.attendance ?? 0)),
        };
      });
      const chart: ChartSpec = {
        type: "bar",
        title: `${dir === "lowest" ? "Lowest" : "Highest"} KPI · ${period.slice(0, 7)}`,
        data: list.map((r: KpiRow) => ({ label: r.name, value: r.kpi })),
      };
      return { result: { ok: true, period, direction: dir, rows: list }, chart };
    }

    case "bonus_totals": {
      const period = monthStart(args.period as string | undefined);
      const { data: lines, error } = await supabase
        .from("payroll_lines")
        .select("performance_bonus_mmk, bonus_mmk, payroll_runs!inner(period_month)")
        .eq("payroll_runs.period_month", period);
      if (error) return { result: { ok: false, error: error.message } };
      let perf = 0;
      let extra = 0;
      for (const l of lines ?? []) {
        perf += Number((l as Record<string, unknown>).performance_bonus_mmk ?? 0);
        extra += Number((l as Record<string, unknown>).bonus_mmk ?? 0);
      }
      return {
        result: {
          ok: true,
          period,
          performance_bonus_mmk: perf,
          extra_bonus_mmk: extra,
          total_bonus_mmk: perf + extra,
          formatted: `${fmtMMK(perf + extra)} MMK total (${fmtMMK(perf)} performance + ${fmtMMK(extra)} extra)`,
        },
      };
    }

    case "payroll_summary": {
      const period = monthStart(args.period as string | undefined);
      const { data: run, error: runErr } = await supabase
        .from("payroll_runs")
        .select("id, total_mmk, period_month")
        .eq("period_month", period)
        .maybeSingle();
      if (runErr) return { result: { ok: false, error: runErr.message } };
      if (!run) return { result: { ok: true, period, total_mmk: 0, rows: [] } };
      const { data: lines, error } = await supabase
        .from("payroll_lines")
        .select(
          "base_mmk, performance_bonus_mmk, bonus_mmk, deduction_mmk, total_mmk, kpi_snapshot, tasks_completed, employees(full_name, position)",
        )
        .eq("run_id", (run as { id: string }).id)
        .order("total_mmk", { ascending: false })
        .limit(50);
      if (error) return { result: { ok: false, error: error.message } };
      type PayRow = { name: string; position: string | null; base_mmk: number; performance_bonus_mmk: number; bonus_mmk: number; deduction_mmk: number; total_mmk: number; kpi: number; tasks_completed: number };
      const rows: PayRow[] = (lines ?? []).map((l: Record<string, unknown>) => {
        const emp = l.employees as { full_name?: string; position?: string } | null;
        return {
          name: emp?.full_name ?? "—",
          position: emp?.position ?? null,
          base_mmk: Number(l.base_mmk ?? 0),
          performance_bonus_mmk: Number(l.performance_bonus_mmk ?? 0),
          bonus_mmk: Number(l.bonus_mmk ?? 0),
          deduction_mmk: Number(l.deduction_mmk ?? 0),
          total_mmk: Number(l.total_mmk ?? 0),
          kpi: Math.round(Number(l.kpi_snapshot ?? 0)),
          tasks_completed: Number(l.tasks_completed ?? 0),
        };
      });
      const chart: ChartSpec = {
        type: "bar",
        title: `Payroll · ${period.slice(0, 7)}`,
        data: rows.slice(0, 10).map((r: PayRow) => ({ label: r.name, value: r.total_mmk })),
      };
      return {
        result: {
          ok: true,
          period,
          total_mmk: Number((run as { total_mmk: number }).total_mmk ?? 0),
          employee_count: rows.length,
          rows,
        },
        chart,
      };
    }

    case "attendance_summary": {
      const period = monthStart(args.period as string | undefined);
      const next = new Date(period);
      next.setMonth(next.getMonth() + 1);
      const end = next.toISOString().slice(0, 10);
      const { data: rows, error } = await supabase
        .from("attendance")
        .select("status")
        .gte("date", period)
        .lt("date", end);
      if (error) return { result: { ok: false, error: error.message } };
      let present = 0;
      let late = 0;
      let absent = 0;
      for (const r of rows ?? []) {
        const s = (r as { status?: string }).status;
        if (s === "present") present++;
        else if (s === "late") late++;
        else if (s === "absent") absent++;
      }
      const total = present + late + absent;
      const chart: ChartSpec = {
        type: "bar",
        title: `Attendance · ${period.slice(0, 7)}`,
        data: [
          { label: "Present", value: present },
          { label: "Late", value: late },
          { label: "Absent", value: absent },
        ],
      };
      return {
        result: { ok: true, period, present, late, absent, total },
        chart,
      };
    }

    case "team_overview": {
      const { data: teams, error } = await supabase
        .from("teams")
        .select("id, name, department");
      if (error) return { result: { ok: false, error: error.message } };
      const result: { name: string; department: string | null; members: number; avg_kpi: number }[] = [];
      for (const t of teams ?? []) {
        const tid = (t as { id: string }).id;
        const { data: emps } = await supabase
          .from("employees")
          .select("id, performance_score")
          .eq("team_id", tid);
        const list = (emps ?? []) as { performance_score?: number }[];
        const avg =
          list.length === 0
            ? 0
            : Math.round(list.reduce((s, e) => s + Number(e.performance_score ?? 0), 0) / list.length);
        result.push({
          name: (t as { name: string }).name,
          department: (t as { department: string | null }).department,
          members: list.length,
          avg_kpi: avg,
        });
      }
      const chart: ChartSpec = {
        type: "bar",
        title: "Avg KPI by team",
        data: result.map((r) => ({ label: r.name, value: r.avg_kpi })),
      };
      return { result: { ok: true, teams: result }, chart };
    }

    default:
      return { result: { ok: false, error: `unknown tool ${name}` } };
  }
}
