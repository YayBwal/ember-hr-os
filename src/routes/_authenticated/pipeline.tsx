import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useRef, useState } from "react";
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
import { Loader2, Plus, Upload, FileText, Sparkles, UserCheck } from "lucide-react";
import { parseCv, scoreManual } from "@/lib/pipeline.functions";
import { approveCandidate } from "@/lib/operations.functions";

export const Route = createFileRoute("/_authenticated/pipeline")({
  head: () => ({ meta: [{ title: "Pipeline · Mandai" }] }),
  validateSearch: (s: Record<string, unknown>) => ({ q: typeof s.q === "string" ? s.q : undefined }),
  component: PipelinePage,
});

const STAGES = ["new", "screening", "interview", "offer", "onboarded", "rejected"] as const;
type Stage = (typeof STAGES)[number];

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
};

function PipelinePage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [approving, setApproving] = useState<Candidate | null>(null);
  const { q } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [searchInput, setSearchInput] = useState(q ?? "");

  const { data: candidates, isLoading } = useQuery({
    queryKey: ["candidates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates")
        .select("id, full_name, email, role_applied, status, ai_match_score, notes, skills, next_action")
        .order("ai_match_score", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Candidate[];
    },
  });

  const filtered = (() => {
    const needle = (q ?? "").trim().toLowerCase();
    if (!needle) return candidates ?? [];
    return (candidates ?? []).filter((c) => c.full_name?.toLowerCase().includes(needle));
  })();

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
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-mono uppercase tracking-[0.2em] text-primary">Pipeline</div>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Candidates</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              AI-scored applicants, staged from sourcing to onboarding.
            </p>
          </div>
          <Button onClick={() => setOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Add candidate
          </Button>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Input
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              navigate({ search: { q: e.target.value || undefined } as any, replace: true });
            }}
            placeholder="Search candidates by name…"
            className="max-w-sm"
          />
          {q && (
            <div className="text-xs text-muted-foreground">
              Filtered by <span className="font-mono">{q}</span> · {filtered.length} result{filtered.length === 1 ? "" : "s"}
            </div>
          )}
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
          <div className="grid grid-cols-12 gap-2 border-b border-border bg-muted/40 px-4 py-2.5 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            <div className="col-span-3">Candidate</div>
            <div className="col-span-2">Role</div>
            <div className="col-span-2">AI match</div>
            <div className="col-span-1">Stage</div>
            <div className="col-span-3">Next</div>
            <div className="col-span-1 text-right">Advance</div>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            (candidates ?? []).length === 0 ? (
              <EmptyState onAdd={() => setOpen(true)} />
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">No matches for "{q}".</div>
            )
          ) : (
            filtered.map((c) => (
              <div key={c.id} className="grid grid-cols-12 items-center gap-2 border-b border-border px-4 py-3 last:border-0">
                <div className="col-span-3 min-w-0">
                  <div className="font-medium truncate">{c.full_name}</div>
                  <div className="text-xs text-muted-foreground truncate">{c.email ?? "—"}</div>
                  {c.skills && c.skills.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.skills.slice(0, 4).map((s) => (
                        <span
                          key={s}
                          className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
                        >
                          {s}
                        </span>
                      ))}
                      {c.skills.length > 4 && (
                        <span className="text-[10px] font-mono text-muted-foreground">
                          +{c.skills.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="col-span-2 text-sm truncate">{c.role_applied}</div>
                <div className="col-span-2">
                  <MatchBar score={Number(c.ai_match_score)} />
                </div>
                <div className="col-span-1">
                  <StageBadge status={c.status} />
                </div>
                <div className="col-span-3 text-xs text-muted-foreground truncate" title={c.next_action ?? ""}>
                  {c.next_action ?? "—"}
                </div>
                <div className="col-span-1 flex items-center justify-end gap-1">
                  {c.status !== "onboarded" && (
                    <button
                      onClick={() => setApproving(c)}
                      title="Approve & create employee"
                      className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                    >
                      <UserCheck className="h-3 w-3" />
                    </button>
                  )}
                  {nextStage(c.status) && (
                    <button
                      onClick={() => advance.mutate({ id: c.id, status: nextStage(c.status)! })}
                      className="rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium hover:border-primary/40 hover:text-primary"
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

      <AddCandidateDialog open={open} onOpenChange={setOpen} />
      <ApproveDialog candidate={approving} onClose={() => setApproving(null)} />
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
          Drop a CV or add one manually. AI will score and suggest the next step instantly.
        </p>
      </div>
      <Button onClick={onAdd} size="sm" className="gap-2 mt-1">
        <Plus className="h-3.5 w-3.5" />
        Add candidate
      </Button>
    </div>
  );
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
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Manual form fields
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [skillsText, setSkillsText] = useState("");
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState<Stage>("new");

  function reset() {
    setFullName("");
    setEmail("");
    setSkillsText("");
    setNotes("");
    setStage("new");
    setCustomRole("");
    setRole(ROLE_PRESETS[0]);
    setBusy(false);
    setDragOver(false);
  }

  async function getOrgId(): Promise<string> {
    const { data, error } = await supabase.from("profiles").select("org_id").maybeSingle();
    if (error || !data?.org_id) throw new Error("No organisation found");
    return data.org_id;
  }

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!finalRole) {
        toast.error("Pick a role first");
        return;
      }
      const arr = Array.from(files).filter((f) =>
        ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword", "text/plain"].includes(f.type),
      );
      if (arr.length === 0) {
        toast.error("Drop a PDF, DOCX, or TXT file");
        return;
      }
      setBusy(true);
      let okCount = 0;
      try {
        const orgId = await getOrgId();
        for (const f of arr) {
          if (f.size > 8 * 1024 * 1024) {
            toast.error(`${f.name} is over 8MB — skipping`);
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
              status: "new",
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
      const skills = skillsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      let ai_match_score = 50;
      let next_action = "Schedule initial screening";
      try {
        const scored = await scoreManualFn({
          data: {
            full_name: fullName,
            email: email || null,
            skills,
            role: finalRole,
            notes,
          },
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
        status: stage,
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
          <DialogTitle>Add candidate</DialogTitle>
          <DialogDescription>
            Drop a CV for instant AI extraction, or enter details manually. All processing is server-side.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">Role</Label>
          <div className="flex gap-2">
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_PRESETS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
                <SelectItem value="__custom__">Custom…</SelectItem>
              </SelectContent>
            </Select>
            {role === "__custom__" && (
              <Input
                placeholder="Role title"
                value={customRole}
                onChange={(e) => setCustomRole(e.target.value)}
                className="flex-1"
              />
            )}
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="mt-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload" className="gap-2">
              <Upload className="h-3.5 w-3.5" /> Upload CV
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-2">
              <FileText className="h-3.5 w-3.5" /> Manual entry
            </TabsTrigger>
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
                accept=".pdf,.docx,.doc,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain"
                className="hidden"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
              {busy ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <div className="text-sm font-medium">AI is reading the CV…</div>
                  <div className="text-xs text-muted-foreground">Extracting details, scoring match, suggesting next step.</div>
                </>
              ) : (
                <>
                  <div className="rounded-full bg-primary/10 p-3">
                    <Upload className="h-5 w-5 text-primary" />
                  </div>
                  <div className="text-sm font-medium">Drop CVs here or click to browse</div>
                  <div className="text-xs text-muted-foreground">PDF, DOCX, or TXT · up to 8MB · bulk upload supported</div>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Stage</Label>
                <Select value={stage} onValueChange={(v) => setStage(v as Stage)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                AI will score on save
              </div>
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
