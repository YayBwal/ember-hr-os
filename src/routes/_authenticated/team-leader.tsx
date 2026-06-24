import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Upload, Save, Crown, Plus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { initials } from "@/lib/format";
import { useHasRole } from "@/hooks/use-user-roles";
import { saveTeamReport, rateMember } from "@/lib/teams.functions";
import { createTask, updateTask } from "@/lib/delivery.functions";

export const Route = createFileRoute("/_authenticated/team-leader")({
  head: () => ({ meta: [{ title: "Team Leader Hub · Mandai" }] }),
  component: TeamLeaderPage,
});

function thisMonth() {
  const d = new Date();
  return {
    start: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10),
  };
}

function TeamLeaderPage() {
  const isTL = useHasRole("team_leader");
  const isAdmin = useHasRole("admin");
  const { data: meEmp } = useQuery({
    queryKey: ["me", "employee"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user?.email) return null;
      const { data } = await supabase.from("employees").select("id, full_name, email").eq("email", u.user.email).maybeSingle();
      return data;
    },
  });
  const { data: ledTeams } = useQuery({
    queryKey: ["my_led_teams", meEmp?.id],
    enabled: !!meEmp?.id,
    queryFn: async () => {
      const { data } = await supabase.from("teams").select("id, name, department").eq("team_lead_employee_id", meEmp!.id);
      return data ?? [];
    },
  });

  if (!isTL && !isAdmin) {
    return <AppShell><div className="p-8 text-sm text-muted-foreground">This page is only available to team leaders.</div></AppShell>;
  }

  return (
    <AppShell>
      <div className="px-4 py-6 md:px-8">
        <div className="text-xs font-mono uppercase tracking-[0.2em] text-primary">Team Leader Hub</div>
        <h1 className="mt-1 flex items-center gap-2 font-display text-3xl font-semibold tracking-tight"><Crown className="h-6 w-6 text-amber-500" /> My Teams</h1>
        <p className="mt-1 text-sm text-muted-foreground">File weekly/monthly reports and rate your members. Ratings feed each employee's KPI with bias-resistant weighting.</p>

        <div className="mt-6 space-y-6">
          {(ledTeams ?? []).map((t) => <TeamLeaderCard key={t.id} team={t} />)}
          {(ledTeams?.length ?? 0) === 0 && <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">You don't lead any teams yet. HR can appoint you in Operations.</div>}
        </div>
      </div>
    </AppShell>
  );
}

function TeamLeaderCard({ team }: { team: { id: string; name: string; department: string } }) {
  const qc = useQueryClient();
  const save = useServerFn(saveTeamReport);
  const rate = useServerFn(rateMember);
  const period = useMemo(() => thisMonth(), []);
  const [summary, setSummary] = useState("");
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: members } = useQuery({
    queryKey: ["team_roster", team.id],
    queryFn: async () => {
      const { data: tm } = await supabase.from("team_members").select("employee_id").eq("team_id", team.id);
      const ids = (tm ?? []).map((r) => r.employee_id);
      if (ids.length === 0) return [] as Array<{ id: string; full_name: string; position: string | null }>;
      const { data } = await supabase.from("employees").select("id, full_name, position").in("id", ids);
      return data ?? [];
    },
  });
  const { data: existing } = useQuery({
    queryKey: ["my_team_report", team.id, period.start],
    queryFn: async () => {
      const { data } = await supabase
        .from("team_reports")
        .select("id, summary, file_url, status")
        .eq("team_id", team.id)
        .eq("period_start", period.start)
        .maybeSingle();
      if (data) { setSummary(data.summary ?? ""); setFileUrl(data.file_url ?? null); }
      return data;
    },
  });
  const { data: ratings } = useQuery({
    queryKey: ["existing_ratings", existing?.id],
    enabled: !!existing?.id,
    queryFn: async () => {
      const { data } = await supabase.from("member_ratings").select("employee_id, productivity, quality, note").eq("report_id", existing!.id);
      return data ?? [];
    },
  });

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const path = `team_${team.id}/${period.start}-${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("team-reports").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = await supabase.storage.from("team-reports").createSignedUrl(path, 60 * 60 * 24 * 30);
      if (data?.signedUrl) setFileUrl(data.signedUrl);
      toast.success("File uploaded");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "upload failed";
      toast.error(msg);
    } finally { setUploading(false); }
  };

  const saveDraft = useMutation({
    mutationFn: () => save({ data: { id: existing?.id ?? null, teamId: team.id, periodStart: period.start, periodEnd: period.end, summary, fileUrl, submit: false } }),
    onSuccess: () => { toast.success("Draft saved"); qc.invalidateQueries({ queryKey: ["my_team_report", team.id, period.start] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const submitReport = useMutation({
    mutationFn: () => save({ data: { id: existing?.id ?? null, teamId: team.id, periodStart: period.start, periodEnd: period.end, summary, fileUrl, submit: true } }),
    onSuccess: () => { toast.success("Report submitted"); qc.invalidateQueries({ queryKey: ["my_team_report", team.id, period.start] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const locked = existing?.status === "submitted";

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-mono uppercase text-muted-foreground">{team.department}</div>
          <div className="font-display text-xl font-semibold">{team.name}</div>
          <div className="mt-1 text-xs text-muted-foreground">Period {period.start} → {period.end}</div>
        </div>
        <Badge variant={locked ? "default" : "outline"}>{existing?.status ?? "new"}</Badge>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <Label className="text-xs">Summary</Label>
          <Textarea rows={6} value={summary} onChange={(e) => setSummary(e.target.value)} disabled={locked} placeholder="Highlights, blockers, decisions…" />
          <div className="mt-2 flex items-center gap-2">
            <label className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded border border-border bg-background px-3 text-xs ${locked ? "pointer-events-none opacity-50" : "hover:bg-muted"}`}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload file
              <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
            {fileUrl && <a className="text-xs text-primary underline" href={fileUrl} target="_blank" rel="noreferrer">attached</a>}
          </div>
        </div>
        <div>
          <Label className="text-xs">Rate members</Label>
          <div className="mt-1 space-y-2">
            {(members ?? []).map((m) => {
              const r = (ratings ?? []).find((x) => x.employee_id === m.id);
              return <MemberRatingRow key={m.id} member={m} initial={r ?? null} locked={locked} reportId={existing?.id ?? null} onNeedSave={async () => {
                // ensure a draft exists first
                const res = await save({ data: { id: existing?.id ?? null, teamId: team.id, periodStart: period.start, periodEnd: period.end, summary, fileUrl, submit: false } });
                qc.invalidateQueries({ queryKey: ["my_team_report", team.id, period.start] });
                return res.id;
              }} onSubmitRating={async (id, productivity, quality, note) => {
                await rate({ data: { reportId: id, employeeId: m.id, productivity, quality, note } });
                qc.invalidateQueries({ queryKey: ["existing_ratings", id] });
              }} />;
            })}
            {(members?.length ?? 0) === 0 && <div className="text-xs text-muted-foreground">No team members.</div>}
          </div>
        </div>
      </div>

      {!locked && (
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => saveDraft.mutate()} disabled={saveDraft.isPending}><Save className="mr-1 h-4 w-4" /> Save draft</Button>
          <Button size="sm" onClick={() => submitReport.mutate()} disabled={submitReport.isPending}>{submitReport.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="mr-1 h-4 w-4" /> Submit</>}</Button>
        </div>
      )}
    </div>
  );
}

function MemberRatingRow({
  member, initial, locked, reportId, onNeedSave, onSubmitRating,
}: {
  member: { id: string; full_name: string; position: string | null };
  initial: { productivity: number; quality: number; note: string | null } | null;
  locked: boolean;
  reportId: string | null;
  onNeedSave: () => Promise<string>;
  onSubmitRating: (reportId: string, productivity: number, quality: number, note?: string) => Promise<void>;
}) {
  const [prod, setProd] = useState(initial?.productivity ?? 80);
  const [qual, setQual] = useState(initial?.quality ?? 80);
  const [note, setNote] = useState(initial?.note ?? "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const id = reportId ?? (await onNeedSave());
      await onSubmitRating(id, prod, qual, note || undefined);
      toast.success(`${member.full_name} rated`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "failed";
      toast.error(msg);
    } finally { setSaving(false); }
  };
  return (
    <div className="rounded border border-border bg-background p-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Avatar className="h-6 w-6"><AvatarFallback className="text-[10px]">{initials(member.full_name)}</AvatarFallback></Avatar><span className="text-sm">{member.full_name}</span></div>
        <span className="font-mono text-xs">P {prod} · Q {qual}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div><Label className="text-[10px]">Productivity</Label><Slider value={[prod]} onValueChange={(v) => setProd(v[0])} min={0} max={100} step={5} disabled={locked} /></div>
        <div><Label className="text-[10px]">Quality</Label><Slider value={[qual]} onValueChange={(v) => setQual(v[0])} min={0} max={100} step={5} disabled={locked} /></div>
      </div>
      <div className="mt-2 flex gap-2">
        <Input value={note} onChange={(e) => setNote(e.target.value)} disabled={locked} placeholder="Note" className="h-7 text-xs" />
        {!locked && <Button size="sm" variant="secondary" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}</Button>}
      </div>
    </div>
  );
}
