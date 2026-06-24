import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Plus, MoreHorizontal } from "lucide-react";
import { initials } from "@/lib/format";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { createTask, updateTask } from "@/lib/delivery.functions";

export const Route = createFileRoute("/_authenticated/delivery")({
  head: () => ({ meta: [{ title: "Delivery · Mandai" }] }),
  component: DeliveryPage,
});

type Status = "todo" | "in_progress" | "review" | "done" | "blocked" | "cancelled";
type Priority = "low" | "medium" | "high" | "urgent";
type Task = {
  id: string; title: string; description: string | null;
  status: Status; priority: Priority; progress: number;
  assignee_employee_id: string | null; due_date: string | null; effort_points: number;
};
const COLUMNS: { id: Status; label: string }[] = [
  { id: "todo", label: "Pending" },
  { id: "in_progress", label: "In Progress" },
  { id: "review", label: "Review" },
  { id: "done", label: "Completed" },
];
const PRIO_COLOR: Record<Priority, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-primary/15 text-primary",
  high: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  urgent: "bg-destructive/15 text-destructive",
};

function DeliveryPage() {
  useRealtimeInvalidate(["tasks", "employees", "task_comments"], ["tasks", "employees_min", "task_comments"]);
  const qc = useQueryClient();
  const create = useServerFn(createTask);
  const update = useServerFn(updateTask);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [form, setForm] = useState<{ title: string; description: string; assignee_employee_id: string; priority: Priority; due_date: string }>({
    title: "", description: "", assignee_employee_id: "", priority: "medium", due_date: "",
  });

  const { data: tasks } = useQuery({
    queryKey: ["tasks"],
    queryFn: async () => {
      const { data } = await supabase.from("tasks").select("id,title,description,status,priority,progress,assignee_employee_id,due_date,effort_points").order("created_at", { ascending: false });
      return (data ?? []) as Task[];
    },
  });
  const { data: employees } = useQuery({
    queryKey: ["employees_min"],
    queryFn: async () => {
      const { data } = await supabase.from("employees").select("id,full_name");
      return (data ?? []) as { id: string; full_name: string }[];
    },
  });
  const empName = (id: string | null) => employees?.find((e) => e.id === id)?.full_name ?? "Unassigned";

  const submitCreate = useMutation({
    mutationFn: () => create({
      data: {
        title: form.title,
        description: form.description || undefined,
        assigneeEmployeeId: form.assignee_employee_id || null,
        priority: form.priority,
        dueDate: form.due_date || null,
      },
    }),
    onSuccess: () => {
      toast.success("Task created");
      setOpen(false);
      setForm({ title: "", description: "", assignee_employee_id: "", priority: "medium", due_date: "" });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const moveTask = (id: string, status: Status) =>
    update({ data: { id, status } }).then(() => qc.invalidateQueries({ queryKey: ["tasks"] }));

  return (
    <AppShell>
      <div className="px-4 py-6 md:px-8">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-mono uppercase tracking-[0.2em] text-primary">Delivery</div>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Tasks</h1>
            <p className="mt-1 text-sm text-muted-foreground">Drag-free kanban. Status changes recompute KPI and payroll live.</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />New task</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create task</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
                <div><Label>Description</Label><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Assignee</Label>
                    <Select value={form.assignee_employee_id} onValueChange={(v) => setForm({ ...form, assignee_employee_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>{(employees ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Priority</Label>
                    <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v as Priority })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{(["low", "medium", "high", "urgent"] as Priority[]).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2"><Label>Due date</Label><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => submitCreate.mutate()} disabled={!form.title || submitCreate.isPending}>
                  {submitCreate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const items = (tasks ?? []).filter((t) => t.status === col.id);
            return (
              <div key={col.id} className="rounded-xl border border-border bg-card p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="font-display text-sm font-semibold">{col.label}</div>
                  <Badge variant="outline">{items.length}</Badge>
                </div>
                <div className="space-y-2">
                  {items.map((t) => (
                    <div key={t.id} className="cursor-pointer rounded-lg border border-border bg-background p-3 hover:border-primary/40" onClick={() => setEditing(t)}>
                      <div className="flex items-start justify-between">
                        <div className="font-medium text-sm">{t.title}</div>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${PRIO_COLOR[t.priority]}`}>{t.priority}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Avatar className="h-5 w-5"><AvatarFallback className="text-[10px]">{initials(empName(t.assignee_employee_id))}</AvatarFallback></Avatar>
                          <span>{t.due_date ?? "—"}</span>
                        </div>
                        <span>{t.progress}%</span>
                      </div>
                      <Progress value={t.progress} className="mt-1 h-1" />
                    </div>
                  ))}
                  {items.length === 0 && <div className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">Empty</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.title}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">{editing.description || "No description"}</p>
              <div>
                <Label>Status</Label>
                <Select value={editing.status} onValueChange={(v) => moveTask(editing.id, v as Status).then(() => setEditing(null))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["todo", "in_progress", "review", "done", "blocked", "cancelled"] as Status[]).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Progress · {editing.progress}%</Label>
                <input
                  type="range" min={0} max={100} value={editing.progress}
                  onChange={(e) => setEditing({ ...editing, progress: Number(e.target.value) })}
                  onMouseUp={() => update({ data: { id: editing.id, progress: editing.progress } }).then(() => qc.invalidateQueries({ queryKey: ["tasks"] }))}
                  className="w-full"
                />
              </div>
              <TaskComments taskId={editing.id} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function TaskComments({ taskId }: { taskId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const { data: comments } = useQuery({
    queryKey: ["task_comments", taskId],
    queryFn: async () => {
      const { data } = await supabase.from("task_comments").select("id,body,created_at,author_user_id").eq("task_id", taskId).order("created_at");
      return data ?? [];
    },
  });
  const submit = async () => {
    if (!body.trim()) return;
    const { error } = await supabase.from("task_comments").insert({ task_id: taskId, body });
    if (error) { toast.error(error.message); return; }
    setBody("");
    qc.invalidateQueries({ queryKey: ["task_comments", taskId] });
  };
  return (
    <div>
      <Label className="text-xs">Comments</Label>
      <div className="mt-1 space-y-1">
        {(comments ?? []).map((c) => (
          <div key={c.id} className="rounded border border-border p-2 text-xs">
            <div className="text-[10px] text-muted-foreground">{new Date(c.created_at).toLocaleString()}</div>
            <div>{c.body}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add comment…" />
        <Button size="sm" onClick={submit}><MoreHorizontal className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
