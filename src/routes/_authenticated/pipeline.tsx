import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Plus, Upload, FileText, Sparkles, X, ArrowRight, Trash2, Brain, GitCompare, PauseCircle, Undo2 } from "lucide-react";
import { parseCv, scoreManual, analyzeCandidate, compareCandidates, type DeepAnalysis, type ComparisonResult } from "@/lib/pipeline.functions";
import { approveCandidate } from "@/lib/operations.functions";

export const Route = createFileRoute("/_authenticated/pipeline")({
  head: () => ({ meta: [{ title: "Pipeline · Mandai" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    q: typeof s.q === "string" ? s.q : undefined,
    stage: typeof s.stage === "string" ? (s.stage as Stage) : undefined,
  }),
  component: PipelinePage,
});

const STAGES = ["screening", "interview", "hold", "trainee", "hired"] as const;
type Stage = (typeof STAGES)[number] | "rejected";

const STAGE_LABELS: Record<Stage, string> = {
  screening: "Screening",
  interview: "Interview",
  hold: "On Hold",
  trainee: "Trainee",
  hired: "Hired",
  rejected: "Rejected",
};

const ROLE_PRESETS = [
  "Software Engineer",
  "Senior Engineer",
  "Product Manager",
  "Designer",
  "Operations Analyst",
  "Finance Analyst",
  "HR Specialist",
  "Customer Success",
];

type Candidate = {
  id: string;
  full_name: string;
  email: string | null;
  role_applied: string;
  status: Stage;
  ai_match_score: number;
  notes: string | null;
  skills: string[] | null;
  next_action: string | null;
  trainee_salary_mmk: number | null;
  hold_reason: string | null;
  held_at: string | null;
};

const PAGE_SIZE = 25;

function PipelinePage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [approving, setApproving] = useState<Candidate | null>(null);
  const [holding, setHolding] = useState<Candidate[] | null>(null);
  const [analyzeId, setAnalyzeId] = useState<Candidate | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const { q, stage: stageParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [searchInput, setSearchInput] = useState(q ?? "");
  const [minScore, setMinScore] = useState(0);
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);

  const activeStage: Stage = (stageParam as Stage) ?? "screening";

  useEffect(() => {
    const channel = supabase
      .channel("candidates-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "candidates" },
        () => qc.invalidateQueries({ queryKey: ["candidates"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const { data: candidates, isLoading } = useQuery({
    queryKey: ["candidates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates")
        .select("id, full_name, email, role_applied, status, ai_match_score, notes, skills, next_action, trainee_salary_mmk, hold_reason, held_at")
        .order("ai_match_score", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Candidate[];
    },
  });

  const { data: orgDefaults } = useQuery({
    queryKey: ["org-defaults"],
    queryFn: async () => {
      const orgId = (await supabase.rpc("current_org_id")).data as string | null;
      if (!orgId) return { default_trainee_salary_mmk: 500000 };
      const { data } = await supabase.from("organizations").select("default_trainee_salary_mmk").eq("id", orgId).maybeSingle();
      return { default_trainee_salary_mmk: Number(data?.default_trainee_salary_mmk ?? 500000) };
    },
  });
  const defaultTraineeSalary = orgDefaults?.default_trainee_salary_mmk ?? 500000;

  const all = candidates ?? [];

  const counts = useMemo(() => {
    const c: Record<Stage, number> = { screening: 0, interview: 0, hold: 0, trainee: 0, hired: 0, rejected: 0 };
    for (const x of all) c[x.status] = (c[x.status] ?? 0) + 1;
    return c;
  }, [all]);

  const roles = useMemo(() => Array.from(new Set(all.map((c) => c.role_applied))).sort(), [all]);

  const filtered = useMemo(() => {
    const needle = (q ?? "").trim().toLowerCase();
    return all
      .filter((c) => c.status === activeStage)
      .filter((c) => c.ai_match_score >= minScore)
      .filter((c) => (roleFilter === "all" ? true : c.role_applied === roleFilter))
      .filter((c) => {
        if (!needle) return true;
        return (
          c.full_name?.toLowerCase().includes(needle) ||
          c.email?.toLowerCase().includes(needle) ||
          c.skills?.some((s) => s.toLowerCase().includes(needle))
        );
      });
  }, [all, activeStage, minScore, roleFilter, q]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); setSelected(new Set()); }, [activeStage, q, minScore, roleFilter]);

  const update = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: Stage }) => {
      const { error } = await supabase.from("candidates").update({ status }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success(
        vars.status === "rejected"
          ? `Rejected & removed ${vars.ids.length}`
          : `Moved ${vars.ids.length} → ${STAGE_LABELS[vars.status]}`,
      );
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["candidates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function advanceOne(c: Candidate) {
    if (c.status === "screening") update.mutate({ ids: [c.id], status: "interview" });
    else if (c.status === "interview" || c.status === "trainee") setApproving(c);
  }
  function moveToTrainee(ids: string[]) {
    update.mutate({ ids, status: "trainee" });
  }

  function reject(ids: string[]) {
    if (!confirm(`Permanently delete ${ids.length} candidate${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    update.mutate({ ids, status: "rejected" });
  }

  const holdMut = useMutation({
    mutationFn: async ({ ids, reason }: { ids: string[]; reason: string }) => {
      const { error } = await supabase
        .from("candidates")
        .update({ status: "hold", hold_reason: reason, held_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success(`Placed ${vars.ids.length} on hold`);
      setSelected(new Set());
      setHolding(null);
      qc.invalidateQueries({ queryKey: ["candidates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recallMut = useMutation({
    mutationFn: async ({ ids, to }: { ids: string[]; to: Stage }) => {
      const { error } = await supabase
        .from("candidates")
        .update({ status: to, hold_reason: null, held_at: null })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success(`Recalled ${vars.ids.length} → ${STAGE_LABELS[vars.to]}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["candidates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function setStage(s: Stage) {
    navigate({ search: (prev: any) => ({ ...prev, stage: s }), replace: true });
  }

  const allSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));

  return (
    <AppShell>
      <div className="px-4 py-6 md:px-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-mono uppercase tracking-[0.2em] text-primary">Pipeline</div>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Candidates</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Screening → Interview → Hired. Built for high-volume days.
            </p>
          </div>
          <Button onClick={() => setOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Add candidates
          </Button>
        </div>

        {/* Stage tabs with counts */}
        <div className="mt-6 flex flex-wrap gap-1 border-b border-border">
          {STAGES.map((s) => {
            const active = activeStage === s;
            return (
              <button
                key={s}
                onClick={() => setStage(s)}
                className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {STAGE_LABELS[s]}
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono">
                  {counts[s]}
                </span>
                {active && (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />
                )}
              </button>
            );
          })}
        </div>

        {/* Filter bar */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Input
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              navigate({ search: (prev: any) => ({ ...prev, q: e.target.value || undefined }), replace: true });
            }}
            placeholder="Search name, email, or skill…"
            className="max-w-xs"
          />
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="All roles" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {roles.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
            <span className="text-xs text-muted-foreground">Min match</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="w-24"
            />
            <span className="w-8 text-right font-mono text-xs">{minScore}</span>
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            {filtered.length} of {counts[activeStage]} in {STAGE_LABELS[activeStage]}
          </div>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-2">
            <div className="text-sm">
              <span className="font-medium">{selected.size}</span> selected
            </div>
            <div className="flex gap-2">
              {activeStage === "screening" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => update.mutate({ ids: Array.from(selected), status: "interview" })}
                  className="gap-1.5"
                >
                  <ArrowRight className="h-3.5 w-3.5" /> Move to Interview
                </Button>
              )}
              {activeStage === "interview" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => moveToTrainee(Array.from(selected))}
                  className="gap-1.5"
                >
                  <ArrowRight className="h-3.5 w-3.5" /> Move to Trainee
                </Button>
              )}
              {selected.size >= 2 && selected.size <= 4 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCompareOpen(true)}
                  className="gap-1.5"
                >
                  <GitCompare className="h-3.5 w-3.5" /> Compare ({selected.size})
                </Button>
              )}
              {(activeStage === "interview" || activeStage === "trainee" || activeStage === "screening") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const list = (candidates ?? []).filter((c) => selected.has(c.id));
                    if (list.length) setHolding(list);
                  }}
                  className="gap-1.5"
                >
                  <PauseCircle className="h-3.5 w-3.5" /> Place on hold
                </Button>
              )}
              {activeStage === "hold" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => recallMut.mutate({ ids: Array.from(selected), to: "interview" })}
                  className="gap-1.5"
                >
                  <Undo2 className="h-3.5 w-3.5" /> Recall → Interview
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => reject(Array.from(selected))}
                className="gap-1.5 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" /> Reject & delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
          <div className="grid grid-cols-12 gap-2 border-b border-border bg-muted/40 px-4 py-2.5 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            <div className="col-span-1 flex items-center">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) pageRows.forEach((r) => next.add(r.id));
                  else pageRows.forEach((r) => next.delete(r.id));
                  setSelected(next);
                }}
              />
            </div>
            <div className="col-span-3">Candidate</div>
            <div className="col-span-2">Role</div>
            <div className="col-span-2">AI match</div>
            <div className="col-span-2">Next step</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : pageRows.length === 0 ? (
            all.length === 0 ? (
              <EmptyState onAdd={() => setOpen(true)} />
            ) : (
              <div className="p-12 text-center text-sm text-muted-foreground">
                Nothing in {STAGE_LABELS[activeStage]} matching these filters.
              </div>
            )
          ) : (
            pageRows.map((c) => (
              <div key={c.id} className="grid grid-cols-12 items-center gap-2 border-b border-border px-4 py-3 last:border-0 hover:bg-muted/20">
                <div className="col-span-1">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(c.id);
                      else next.delete(c.id);
                      setSelected(next);
                    }}
                  />
                </div>
                <div className="col-span-3 min-w-0">
                  <div className="font-medium truncate">{c.full_name}</div>
                  <div className="text-xs text-muted-foreground truncate">{c.email ?? "—"}</div>
                  {c.skills && c.skills.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.skills.slice(0, 3).map((s) => (
                        <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                          {s}
                        </span>
                      ))}
                      {c.skills.length > 3 && (
                        <span className="text-[10px] font-mono text-muted-foreground">+{c.skills.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="col-span-2 text-sm truncate">{c.role_applied}</div>
                <div className="col-span-2">
                  <MatchBar score={Number(c.ai_match_score)} />
                </div>
                <div className="col-span-2 text-xs text-muted-foreground truncate" title={c.status === "hold" ? (c.hold_reason ?? "") : (c.next_action ?? "")}>
                  {c.status === "hold" ? (
                    <span>
                      <span className="text-amber-600">⏸ {c.hold_reason ?? "On hold"}</span>
                      {c.held_at && <span className="ml-1 text-[10px]">· {daysAgo(c.held_at)}d</span>}
                    </span>
                  ) : (c.next_action ?? "—")}
                </div>
                <div className="col-span-2 flex items-center justify-end gap-1">
                  <button
                    onClick={() => setAnalyzeId(c)}
                    className="rounded-md border border-border bg-background p-1.5 text-muted-foreground hover:border-primary/40 hover:text-primary"
                    title="AI deep analysis"
                  >
                    <Brain className="h-3 w-3" />
                  </button>
                  {c.status === "screening" && (
                    <button
                      onClick={() => advanceOne(c)}
                      className="rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium hover:border-primary/40 hover:text-primary"
                    >
                      → Interview
                    </button>
                  )}
                  {c.status === "interview" && (
                    <>
                      <button
                        onClick={() => moveToTrainee([c.id])}
                        className="rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium hover:border-primary/40 hover:text-primary"
                      >
                        → Trainee
                      </button>
                      <button
                        onClick={() => setApproving(c)}
                        className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/20"
                      >
                        Hire
                      </button>
                    </>
                  )}
                  {c.status === "trainee" && (
                    <button
                      onClick={() => setApproving(c)}
                      className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/20"
                    >
                      Promote → Hired
                    </button>
                  )}
                  {c.status === "hold" && (
                    <button
                      onClick={() => recallMut.mutate({ ids: [c.id], to: "interview" })}
                      className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/20"
                      title="Recall this candidate back to Interview"
                    >
                      ↺ Recall
                    </button>
                  )}
                  {(c.status === "screening" || c.status === "interview" || c.status === "trainee") && (
                    <button
                      onClick={() => setHolding([c])}
                      className="rounded-md border border-border bg-background p-1.5 text-muted-foreground hover:border-amber-500/40 hover:text-amber-600"
                      title="Place on hold (talent pool)"
                    >
                      <PauseCircle className="h-3 w-3" />
                    </button>
                  )}
                  {c.status !== "hired" && (
                    <button
                      onClick={() => reject([c.id])}
                      className="rounded-md border border-border bg-background p-1.5 text-muted-foreground hover:border-destructive/40 hover:text-destructive"
                      title="Reject & delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
          {pageCount > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 text-xs text-muted-foreground">
              <div>Page {page + 1} of {pageCount}</div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
                <Button size="sm" variant="outline" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <AddCandidateDialog open={open} onOpenChange={setOpen} />
      <ApproveDialog candidate={approving} defaultBase={approving?.trainee_salary_mmk ?? defaultTraineeSalary} onClose={() => setApproving(null)} />
      <AnalyzeDialog candidate={analyzeId} onClose={() => setAnalyzeId(null)} />
      <CompareDialog
        open={compareOpen}
        ids={Array.from(selected)}
        candidates={all}
        onClose={() => setCompareOpen(false)}
      />
    </AppShell>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16">
      <div className="rounded-full bg-primary/10 p-3">
        <Sparkles className="h-5 w-5 text-primary" />
      </div>
      <div className="text-center">
        <div className="text-sm font-medium">No candidates yet</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Drop CVs or add manually. AI scores and suggests the next step instantly.
        </p>
      </div>
      <Button onClick={onAdd} size="sm" className="gap-2 mt-1">
        <Plus className="h-3.5 w-3.5" />
        Add candidates
      </Button>
    </div>
  );
}

async function getOrgId(): Promise<string> {
  const { data, error } = await supabase.rpc("current_org_id");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No organisation found for your account");
  return data as string;
}

function AddCandidateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const parseCvFn = useServerFn(parseCv);
  const scoreManualFn = useServerFn(scoreManual);

  const [tab, setTab] = useState<"upload" | "manual">("upload");
  const [role, setRole] = useState(ROLE_PRESETS[0]);
  const [customRole, setCustomRole] = useState("");
  const finalRole = role === "__custom__" ? customRole.trim() : role;

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [skillsText, setSkillsText] = useState("");
  const [notes, setNotes] = useState("");

  function reset() {
    setFullName(""); setEmail(""); setSkillsText(""); setNotes("");
    setCustomRole(""); setRole(ROLE_PRESETS[0]);
    setBusy(false); setDragOver(false); setProgress(null);
  }

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!finalRole) { toast.error("Pick a role first"); return; }
      const arr = Array.from(files).filter((f) =>
        ["application/pdf", "text/plain"].includes(f.type),
      );
      if (arr.length === 0) { toast.error("Drop a PDF or TXT file (convert DOCX to PDF first)"); return; }

      setBusy(true);
      setProgress({ done: 0, total: arr.length });
      let okCount = 0;
      try {
        const orgId = await getOrgId();
        for (const f of arr) {
          if (f.size > 8 * 1024 * 1024) {
            toast.error(`${f.name} is over 8MB — skipping`);
            setProgress((p) => p && { ...p, done: p.done + 1 });
            continue;
          }
          const fileBase64 = await fileToBase64(f);
          try {
            const parsed = await parseCvFn({
              data: { fileBase64, mime: f.type, filename: f.name, role: finalRole },
            });
            const { error } = await supabase.from("candidates").insert({
              org_id: orgId,
              full_name: parsed.full_name,
              email: parsed.email,
              role_applied: finalRole,
              status: "screening",
              ai_match_score: parsed.ai_match_score,
              skills: parsed.skills,
              next_action: parsed.next_action,
              notes: parsed.summary || null,
            });
            if (error) throw error;
            okCount += 1;
            toast.success(`${parsed.full_name} · ${parsed.ai_match_score}% match`);
          } catch (e: any) {
            toast.error(`${f.name}: ${e?.message ?? "parse failed"}`);
          }
          setProgress((p) => p && { ...p, done: p.done + 1 });
        }
        if (okCount > 0) {
          qc.invalidateQueries({ queryKey: ["candidates"] });
          onOpenChange(false);
          reset();
        }
      } catch (e: any) {
        toast.error(e?.message ?? "Failed");
      } finally {
        setBusy(false);
      }
    },
    [finalRole, parseCvFn, qc, onOpenChange],
  );

  async function submitManual() {
    if (!fullName.trim()) return toast.error("Name required");
    if (!finalRole) return toast.error("Role required");
    setBusy(true);
    try {
      const orgId = await getOrgId();
      const skills = skillsText.split(",").map((s) => s.trim()).filter(Boolean);
      let ai_match_score = 50;
      let next_action = "Schedule initial screening";
      try {
        const scored = await scoreManualFn({
          data: { full_name: fullName, email: email || null, skills, role: finalRole, notes },
        });
        ai_match_score = scored.ai_match_score;
        next_action = scored.next_action;
      } catch (e: any) {
        toast.warning(`AI scoring failed (${e?.message ?? "error"}) — saving with defaults`);
      }
      const { error } = await supabase.from("candidates").insert({
        org_id: orgId,
        full_name: fullName.trim(),
        email: email.trim() || null,
        role_applied: finalRole,
        status: "screening",
        ai_match_score,
        skills,
        next_action,
        notes: notes || null,
      });
      if (error) throw error;
      toast.success(`${fullName} added · ${ai_match_score}% match`);
      qc.invalidateQueries({ queryKey: ["candidates"] });
      onOpenChange(false);
      reset();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Add candidates</DialogTitle>
          <DialogDescription>
            Drop one or many CVs for batch AI extraction, or enter details manually.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">Role (applied to all)</Label>
          <div className="flex gap-2">
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLE_PRESETS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                <SelectItem value="__custom__">Custom…</SelectItem>
              </SelectContent>
            </Select>
            {role === "__custom__" && (
              <Input placeholder="Role title" value={customRole} onChange={(e) => setCustomRole(e.target.value)} className="flex-1" />
            )}
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="mt-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload" className="gap-2"><Upload className="h-3.5 w-3.5" /> Upload CVs</TabsTrigger>
            <TabsTrigger value="manual" className="gap-2"><FileText className="h-3.5 w-3.5" /> Manual</TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="mt-4">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
              }}
              onClick={() => !busy && fileRef.current?.click()}
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors ${
                dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30"
              } ${busy ? "pointer-events-none opacity-60" : ""}`}
            >
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,.txt,application/pdf,text/plain"
                className="hidden"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
              {busy ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <div className="text-sm font-medium">
                    {progress ? `Processing ${progress.done} of ${progress.total}…` : "AI is reading the CV…"}
                  </div>
                  <div className="text-xs text-muted-foreground">Extracting details, scoring match, suggesting next step.</div>
                </>
              ) : (
                <>
                  <div className="rounded-full bg-primary/10 p-3">
                    <Upload className="h-5 w-5 text-primary" />
                  </div>
                  <div className="text-sm font-medium">Drop CVs here or click to browse</div>
                  <div className="text-xs text-muted-foreground">PDF or TXT · up to 8MB each · batch upload</div>
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="manual" className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="fn" className="text-xs">Full name</Label>
                <Input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="em" className="text-xs">Email</Label>
                <Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sk" className="text-xs">Skills (comma-separated)</Label>
              <Input id="sk" value={skillsText} onChange={(e) => setSkillsText(e.target.value)} placeholder="React, TypeScript, Postgres" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nt" className="text-xs">Notes</Label>
              <Textarea id="nt" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything HR should remember…" />
            </div>
          </TabsContent>
        </Tabs>

        {tab === "manual" && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button onClick={submitManual} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Add & score
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const res = String(reader.result ?? "");
      const idx = res.indexOf(",");
      resolve(idx >= 0 ? res.slice(idx + 1) : res);
    };
    reader.readAsDataURL(file);
  });
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

function ApproveDialog({ candidate, defaultBase, onClose }: { candidate: Candidate | null; defaultBase?: number; onClose: () => void }) {
  const qc = useQueryClient();
  const approve = useServerFn(approveCandidate);
  const [department, setDepartment] = useState<"HR" | "Operations" | "Finance" | "Admin" | "Engineering">("Engineering");
  const [position, setPosition] = useState("");
  const [base, setBase] = useState<string>("1500000");
  useEffect(() => {
    if (candidate) setBase(String(defaultBase ?? candidate.trainee_salary_mmk ?? 1500000));
  }, [candidate, defaultBase]);

  const submit = useMutation({
    mutationFn: () =>
      approve({
        data: {
          candidateId: candidate!.id,
          department,
          position: position || candidate!.role_applied,
          monthlyBase: Number(base) || 0,
        },
      }),
    onSuccess: () => {
      toast.success("Hired — employee created");
      qc.invalidateQueries({ queryKey: ["candidates"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!candidate} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hire {candidate?.full_name}</DialogTitle>
          <DialogDescription>Creates an employee record and onboards them.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Department</Label>
            <Select value={department} onValueChange={(v) => setDepartment(v as typeof department)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["HR", "Operations", "Finance", "Admin", "Engineering"] as const).map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Position</Label>
            <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder={candidate?.role_applied} />
          </div>
          <div>
            <Label>Monthly base (MMK)</Label>
            <Input type="number" value={base} onChange={(e) => setBase(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm hire"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AnalyzeDialog({ candidate, onClose }: { candidate: Candidate | null; onClose: () => void }) {
  const analyze = useServerFn(analyzeCandidate);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<DeepAnalysis | null>(null);

  useEffect(() => {
    if (!candidate) { setData(null); return; }
    setBusy(true);
    setData(null);
    analyze({ data: { candidate_id: candidate.id } })
      .then((r) => setData(r))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Analysis failed"))
      .finally(() => setBusy(false));
  }, [candidate, analyze]);

  return (
    <Dialog open={!!candidate} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" /> AI deep analysis
          </DialogTitle>
          <DialogDescription>
            {candidate?.full_name} · {candidate?.role_applied} · {candidate?.ai_match_score}% match
          </DialogDescription>
        </DialogHeader>
        {busy && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Analyzing…
          </div>
        )}
        {data && (
          <div className="space-y-4 text-sm">
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">Role fit</div>
              <p>{data.role_fit_reasoning}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-mono uppercase tracking-wider text-emerald-600 mb-1">Strengths</div>
                <ul className="space-y-1 text-xs list-disc pl-4">
                  {data.strengths.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
              <div>
                <div className="text-xs font-mono uppercase tracking-wider text-amber-600 mb-1">Gaps</div>
                <ul className="space-y-1 text-xs list-disc pl-4">
                  {data.gaps.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            </div>
            {data.red_flags.length > 0 && (
              <div>
                <div className="text-xs font-mono uppercase tracking-wider text-destructive mb-1">Red flags</div>
                <ul className="space-y-1 text-xs list-disc pl-4">
                  {data.red_flags.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">Interview questions</div>
              <ol className="space-y-1 text-xs list-decimal pl-4">
                {data.interview_questions.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </div>
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
              <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Recommended</div>
              <div className="font-medium text-primary">{data.recommended_decision}</div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompareDialog({
  open,
  ids,
  candidates,
  onClose,
}: {
  open: boolean;
  ids: string[];
  candidates: Candidate[];
  onClose: () => void;
}) {
  const compare = useServerFn(compareCandidates);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<ComparisonResult | null>(null);

  useEffect(() => {
    if (!open || ids.length < 2) { setData(null); return; }
    setBusy(true);
    setData(null);
    compare({ data: { ids } })
      .then((r) => setData(r))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Compare failed"))
      .finally(() => setBusy(false));
  }, [open, ids, compare]);

  const picked = candidates.filter((c) => ids.includes(c.id));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-primary" /> Candidate comparison
          </DialogTitle>
          <DialogDescription>
            Comparing {picked.length} candidates for {picked[0]?.role_applied}
          </DialogDescription>
        </DialogHeader>
        {busy && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Comparing…
          </div>
        )}
        {data && (
          <div className="space-y-4">
            <p className="text-sm">{data.summary}</p>
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${data.rows.length}, minmax(0, 1fr))` }}>
              {data.rows.map((row, i) => {
                const isWinner = row.full_name === data.winner;
                return (
                  <div
                    key={i}
                    className={`rounded-lg border p-3 ${isWinner ? "border-primary bg-primary/5" : "border-border"}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="font-medium text-sm truncate">{row.full_name}</div>
                      {isWinner && <span className="text-[10px] font-mono uppercase text-primary">Top pick</span>}
                    </div>
                    <div className="space-y-2">
                      <div>
                        <div className="text-[10px] font-mono uppercase text-emerald-600 mb-1">Strengths</div>
                        <ul className="text-xs space-y-0.5 list-disc pl-3">
                          {row.strengths.map((s, j) => <li key={j}>{s}</li>)}
                        </ul>
                      </div>
                      <div>
                        <div className="text-[10px] font-mono uppercase text-amber-600 mb-1">Gaps</div>
                        <ul className="text-xs space-y-0.5 list-disc pl-3">
                          {row.gaps.map((s, j) => <li key={j}>{s}</li>)}
                        </ul>
                      </div>
                      <div className="pt-1 border-t border-border/40 text-xs text-muted-foreground">{row.verdict}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
