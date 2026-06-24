import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, AudioLines } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/delivery")({
  head: () => ({ meta: [{ title: "Delivery · Mandai" }] }),
  component: DeliveryPage,
});

type TaskStatus = "todo" | "in_progress" | "review" | "done";
type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignee_employee_id: string | null;
  effort_points: number;
  due_date: string | null;
};

const COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: "todo", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
];

function DeliveryPage() {
  const qc = useQueryClient();

  const { data: tasks } = useQuery({
    queryKey: ["tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, title, description, status, assignee_employee_id, effort_points, due_date")
        .order("position");
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });

  // realtime
  useEffect(() => {
    const channel = supabase
      .channel("tasks-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => {
        qc.invalidateQueries({ queryKey: ["tasks"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const move = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TaskStatus }) => {
      const patch: Partial<Task> & { completed_at?: string | null } = { status };
      (patch as any).completed_at = status === "done" ? new Date().toISOString() : null;
      const { error } = await supabase.from("tasks").update(patch).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const prev = qc.getQueryData<Task[]>(["tasks"]);
      qc.setQueryData<Task[]>(["tasks"], (t) => t?.map((x) => (x.id === id ? { ...x, status } : x)) ?? []);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["tasks"], ctx.prev);
      toast.error("Couldn't move task");
    },
    onSuccess: (_d, vars) => {
      if (vars.status === "done") {
        toast.success("Task done — payroll will recalculate");
        qc.invalidateQueries({ queryKey: ["kpis"] });
      }
    },
  });

  function onDrop(status: TaskStatus, ev: React.DragEvent) {
    ev.preventDefault();
    const id = ev.dataTransfer.getData("text/task-id");
    if (id) move.mutate({ id, status });
  }

  return (
    <AppShell>
      <div className="px-4 py-6 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-mono uppercase tracking-[0.2em] text-primary">Delivery</div>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Action board</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Drag to update. Completing a task triggers payroll recalculation.
            </p>
          </div>
          <AIIngestDialog />
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const colTasks = (tasks ?? []).filter((t) => t.status === col.id);
            return (
              <div
                key={col.id}
                className="rounded-xl border border-border bg-card p-3"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDrop(col.id, e)}
              >
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${col.id === "in_progress" ? "bg-primary" : "bg-muted-foreground/40"}`} />
                    <span className="text-xs font-medium uppercase tracking-wider">{col.label}</span>
                  </div>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">{colTasks.length}</span>
                </div>
                <div className="mt-3 space-y-2 min-h-[120px]">
                  {colTasks.map((t) => (
                    <TaskCard key={t.id} task={t} />
                  ))}
                  {colTasks.length === 0 && (
                    <div className="rounded-md border border-dashed border-border py-6 text-center text-[11px] text-muted-foreground">
                      Drop here
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

function TaskCard({ task }: { task: Task }) {
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/task-id", task.id)}
      className="cursor-grab rounded-md border border-border bg-background p-3 shadow-sm transition-shadow hover:border-primary/40 hover:shadow-md active:cursor-grabbing"
    >
      <div className="text-sm font-medium leading-snug">{task.title}</div>
      {task.description && (
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.description}</div>
      )}
      <div className="mt-3 flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        <span>{task.effort_points} pts</span>
        {task.due_date && <span>{task.due_date}</span>}
      </div>
    </div>
  );
}

function AIIngestDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [loading, setLoading] = useState(false);

  async function run() {
    if (!transcript.trim()) {
      toast.error("Paste a meeting transcript first");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-tasks", {
        body: { title: title || "Untitled meeting", transcript },
      });
      if (error) throw error;
      const count = (data as { created?: number })?.created ?? 0;
      toast.success(`AI created ${count} task${count === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["ai", "activity"] });
      setOpen(false);
      setTitle("");
      setTranscript("");
    } catch (e) {
      toast.error((e as Error).message || "AI extraction failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-1.5">
          <Sparkles className="h-3.5 w-3.5" /> Ingest meeting
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AudioLines className="h-4 w-4 text-primary" /> Ingest meeting → AI tasks
          </DialogTitle>
          <DialogDescription>
            Paste a meeting transcript. Mandai extracts action items and drops them into the board.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="m-title">Meeting title</Label>
            <Input
              id="m-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sept Ops sync"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-transcript">Transcript</Label>
            <Textarea
              id="m-transcript"
              rows={8}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Aung will finalize Q3 payroll by Friday. Hnin will source 5 senior engineer candidates next week. Kyaw to audit attendance anomalies and review with Phyo…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={run} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {loading ? "Extracting…" : "Extract tasks"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
