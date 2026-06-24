import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

// HMAC-protected tool dispatch endpoint for the LiveKit voice agent worker.
// The agent worker signs requests with AGENT_SERVICE_TOKEN. The request body
// includes the orgId from the LiveKit room metadata; we trust it because the
// HMAC proves the caller is the agent.

type ToolName =
  | "create_task"
  | "move_task"
  | "list_tasks"
  | "get_kpis"
  | "get_payroll_summary"
  | "recalc_payroll"
  | "list_employees";

interface ToolRequest {
  tool: ToolName;
  orgId: string;
  args: Record<string, unknown>;
}

function verify(signature: string | null, timestamp: string | null, body: string, secret: string) {
  if (!signature || !timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false; // 5 min window
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/agent/tools")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.AGENT_SERVICE_TOKEN;
        if (!secret) return Response.json({ error: "Not configured" }, { status: 500 });

        const body = await request.text();
        const sig = request.headers.get("x-agent-signature");
        const ts = request.headers.get("x-agent-timestamp");
        if (!verify(sig, ts, body, secret)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: ToolRequest;
        try {
          payload = JSON.parse(body);
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        if (!payload.tool || !payload.orgId) {
          return Response.json({ error: "Missing tool or orgId" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const orgId = payload.orgId;
        const args = (payload.args ?? {}) as Record<string, any>;

        try {
          switch (payload.tool) {
            case "create_task": {
              const { title, description, assignee_employee_id, effort_points, due_date, status } = args;
              if (!title) return Response.json({ error: "title required" }, { status: 400 });
              const { data, error } = await supabaseAdmin
                .from("tasks")
                .insert({
                  org_id: orgId,
                  title: String(title),
                  description: description ? String(description) : null,
                  assignee_employee_id: assignee_employee_id ?? null,
                  effort_points: typeof effort_points === "number" ? effort_points : 3,
                  due_date: due_date ?? null,
                  status: status ?? "todo",
                })
                .select("id, title, status, effort_points")
                .single();
              if (error) throw error;
              return Response.json({ ok: true, task: data });
            }
            case "move_task": {
              const { task_id, status } = args;
              if (!task_id || !status) return Response.json({ error: "task_id + status required" }, { status: 400 });
              const update: Record<string, unknown> = { status };
              if (status === "done") update.completed_at = new Date().toISOString();
              const { data, error } = await supabaseAdmin
                .from("tasks")
                .update(update)
                .eq("id", task_id)
                .eq("org_id", orgId)
                .select("id, title, status")
                .single();
              if (error) throw error;
              return Response.json({ ok: true, task: data });
            }
            case "list_tasks": {
              const { status, limit } = args;
              let q = supabaseAdmin
                .from("tasks")
                .select("id, title, status, effort_points, assignee_employee_id, due_date")
                .eq("org_id", orgId)
                .order("created_at", { ascending: false })
                .limit(Math.min(Number(limit) || 20, 50));
              if (status) q = q.eq("status", status);
              const { data, error } = await q;
              if (error) throw error;
              return Response.json({ ok: true, tasks: data });
            }
            case "list_employees": {
              const { data, error } = await supabaseAdmin
                .from("employees")
                .select("id, full_name, role, department")
                .eq("org_id", orgId)
                .limit(50);
              if (error) throw error;
              return Response.json({ ok: true, employees: data });
            }
            case "get_kpis": {
              const [emp, tasks, candidates] = await Promise.all([
                supabaseAdmin.from("employees").select("id", { count: "exact", head: true }).eq("org_id", orgId),
                supabaseAdmin.from("tasks").select("status", { count: "exact" }).eq("org_id", orgId),
                supabaseAdmin.from("candidates").select("id", { count: "exact", head: true }).eq("org_id", orgId),
              ]);
              const tasksByStatus = (tasks.data ?? []).reduce<Record<string, number>>((acc, t: any) => {
                acc[t.status] = (acc[t.status] ?? 0) + 1;
                return acc;
              }, {});
              return Response.json({
                ok: true,
                kpis: {
                  employees: emp.count ?? 0,
                  candidates: candidates.count ?? 0,
                  tasks_total: tasks.count ?? 0,
                  tasks_by_status: tasksByStatus,
                },
              });
            }
            case "get_payroll_summary": {
              const { data: runs } = await supabaseAdmin
                .from("payroll_runs")
                .select("id, period_label, total_mmk, status, created_at")
                .eq("org_id", orgId)
                .order("created_at", { ascending: false })
                .limit(3);
              return Response.json({ ok: true, recent_runs: runs ?? [] });
            }
            case "recalc_payroll": {
              const { data, error } = await supabaseAdmin.functions.invoke("recalculate-payroll", {
                body: { org_id: orgId },
              });
              if (error) throw error;
              return Response.json({ ok: true, result: data });
            }
            default:
              return Response.json({ error: "Unknown tool" }, { status: 400 });
          }
        } catch (e: any) {
          console.error("agent tool error", payload.tool, e);
          return Response.json({ error: e?.message ?? "Tool failed" }, { status: 500 });
        }
      },
    },
  },
});
