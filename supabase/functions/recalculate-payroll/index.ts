import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader)
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: profile } = await supabase.from("profiles").select("org_id").maybeSingle();
    if (!profile?.org_id)
      return new Response(JSON.stringify({ error: "No org" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const { data: employees, error: empErr } = await supabase
      .from("employees")
      .select("id, monthly_base_mmk, performance_score")
      .eq("org_id", profile.org_id);
    if (empErr) throw empErr;

    const periodMonth = new Date();
    periodMonth.setDate(1);
    const periodIso = periodMonth.toISOString().slice(0, 10);
    const periodStart = new Date(periodMonth);
    const periodEnd = new Date(periodMonth.getFullYear(), periodMonth.getMonth() + 1, 1);

    // tasks completed this period per assignee
    const { data: doneTasks } = await supabase
      .from("tasks")
      .select("id, assignee_employee_id, effort_points, completed_at, status")
      .eq("org_id", profile.org_id)
      .eq("status", "done")
      .gte("completed_at", periodStart.toISOString())
      .lt("completed_at", periodEnd.toISOString());

    const doneByEmp = new Map<string, { count: number; points: number }>();
    for (const t of doneTasks ?? []) {
      if (!t.assignee_employee_id) continue;
      const cur = doneByEmp.get(t.assignee_employee_id) ?? { count: 0, points: 0 };
      cur.count += 1;
      cur.points += Number(t.effort_points ?? 0);
      doneByEmp.set(t.assignee_employee_id, cur);
    }

    let totalMmk = 0;
    const lines = (employees ?? []).map((e) => {
      const base = Number(e.monthly_base_mmk);
      const perf = Number(e.performance_score);
      const stats = doneByEmp.get(e.id) ?? { count: 0, points: 0 };
      // bonus formula: perf above 80 contributes, plus task points
      const perfBonus = Math.max(0, Math.round(base * (perf / 100 - 0.8) * 0.5));
      const deliveryBonus = stats.points * 15000;
      const bonus = perfBonus + deliveryBonus;
      const total = base + bonus;
      totalMmk += total;
      return {
        employee_id: e.id,
        base_mmk: base,
        performance_bonus_mmk: bonus,
        total_mmk: total,
        tasks_completed: stats.count,
      };
    });

    // upsert run for this period
    const { data: existing } = await supabase
      .from("payroll_runs")
      .select("id")
      .eq("org_id", profile.org_id)
      .eq("period_month", periodIso)
      .maybeSingle();

    let runId: string;
    if (existing) {
      runId = existing.id;
      await supabase
        .from("payroll_runs")
        .update({ total_mmk: totalMmk, generated_at: new Date().toISOString() })
        .eq("id", runId);
      await supabase.from("payroll_lines").delete().eq("run_id", runId);
    } else {
      const { data: created, error: rErr } = await supabase
        .from("payroll_runs")
        .insert({ org_id: profile.org_id, period_month: periodIso, total_mmk: totalMmk })
        .select("id")
        .single();
      if (rErr) throw rErr;
      runId = created.id;
    }

    if (lines.length > 0) {
      const { error: lErr } = await supabase
        .from("payroll_lines")
        .insert(lines.map((l) => ({ ...l, run_id: runId })));
      if (lErr) throw lErr;
    }

    return new Response(JSON.stringify({ ok: true, run_id: runId, total_mmk: totalMmk, lines: lines.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
