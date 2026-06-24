import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pipeline")({
  head: () => ({ meta: [{ title: "Pipeline · Mandai" }] }),
  component: PipelinePage,
});

const STAGES = ["new", "screening", "interview", "offer", "onboarded", "rejected"] as const;
type Stage = (typeof STAGES)[number];

type Candidate = {
  id: string;
  full_name: string;
  email: string | null;
  role_applied: string;
  status: Stage;
  ai_match_score: number;
  notes: string | null;
};

function PipelinePage() {
  const qc = useQueryClient();
  const { data: candidates, isLoading } = useQuery({
    queryKey: ["candidates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates")
        .select("id, full_name, email, role_applied, status, ai_match_score, notes")
        .order("ai_match_score", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Candidate[];
    },
  });

  const advance = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Stage }) => {
      const { error } = await supabase.from("candidates").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Candidate updated");
      qc.invalidateQueries({ queryKey: ["candidates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell>
      <div className="px-4 py-6 md:px-8">
        <div className="text-xs font-mono uppercase tracking-[0.2em] text-primary">Pipeline</div>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Candidates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          AI-scored applicants, staged from sourcing to onboarding.
        </p>

        <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
          <div className="grid grid-cols-12 gap-2 border-b border-border bg-muted/40 px-4 py-2.5 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            <div className="col-span-3">Candidate</div>
            <div className="col-span-3">Role</div>
            <div className="col-span-2">AI match</div>
            <div className="col-span-2">Stage</div>
            <div className="col-span-2 text-right">Next</div>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (candidates ?? []).length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No candidates yet. Sign up with a fresh org to start sourcing.
            </div>
          ) : (
            (candidates ?? []).map((c) => (
              <div key={c.id} className="grid grid-cols-12 items-center gap-2 border-b border-border px-4 py-3 last:border-0">
                <div className="col-span-3">
                  <div className="font-medium">{c.full_name}</div>
                  <div className="text-xs text-muted-foreground">{c.email}</div>
                </div>
                <div className="col-span-3 text-sm">{c.role_applied}</div>
                <div className="col-span-2">
                  <MatchBar score={Number(c.ai_match_score)} />
                </div>
                <div className="col-span-2">
                  <StageBadge status={c.status} />
                </div>
                <div className="col-span-2 text-right">
                  {nextStage(c.status) && (
                    <button
                      onClick={() => advance.mutate({ id: c.id, status: nextStage(c.status)! })}
                      className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:border-primary/40 hover:text-primary"
                    >
                      → {nextStage(c.status)}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}

function nextStage(s: Stage): Stage | null {
  const order: Stage[] = ["new", "screening", "interview", "offer", "onboarded"];
  const idx = order.indexOf(s);
  if (idx === -1 || idx >= order.length - 1) return null;
  return order[idx + 1];
}

function StageBadge({ status }: { status: Stage }) {
  const tone =
    status === "onboarded"
      ? "bg-success/15 text-success"
      : status === "offer"
        ? "bg-primary/10 text-primary"
        : status === "rejected"
          ? "bg-muted text-muted-foreground"
          : "bg-accent/40 text-accent-foreground";
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${tone}`}>
      {status}
    </span>
  );
}

function MatchBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs">{pct.toFixed(0)}</span>
    </div>
  );
}
