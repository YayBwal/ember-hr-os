import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Status = "todo" | "in_progress" | "review" | "done" | "blocked" | "cancelled";
type Priority = "low" | "medium" | "high" | "urgent";

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      title: string;
      description?: string;
      assigneeEmployeeId?: string | null;
      teamId?: string | null;
      priority?: Priority;
      dueDate?: string | null;
      effortPoints?: number;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase.from("profiles").select("org_id").eq("id", context.userId).maybeSingle();
    if (!profile?.org_id) throw new Error("No org");
    const { data: row, error } = await context.supabase
      .from("tasks")
      .insert({
        org_id: profile.org_id,
        title: data.title,
        description: data.description ?? null,
        assignee_employee_id: data.assigneeEmployeeId ?? null,
        team_id: data.teamId ?? null,
        priority: data.priority ?? "medium",
        due_date: data.dueDate ?? null,
        effort_points: data.effortPoints ?? 3,
        status: "todo",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id: string;
      status?: Status;
      priority?: Priority;
      progress?: number;
      assigneeEmployeeId?: string | null;
      dueDate?: string | null;
      title?: string;
      description?: string | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.status !== undefined) {
      patch.status = data.status;
      patch.completed_at = data.status === "done" ? new Date().toISOString() : null;
      if (data.status === "done") patch.progress = 100;
    }
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.progress !== undefined) patch.progress = data.progress;
    if (data.assigneeEmployeeId !== undefined) patch.assignee_employee_id = data.assigneeEmployeeId;
    if (data.dueDate !== undefined) patch.due_date = data.dueDate;
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    const { error } = await context.supabase.from("tasks").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string; body: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("task_comments")
      .insert({ task_id: data.taskId, author_user_id: context.userId, body: data.body });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
