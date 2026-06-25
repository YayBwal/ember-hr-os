import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Send, Trash2, MessageSquare, Users, BarChart3, AlertTriangle, Pencil } from "lucide-react";
import {
  listFeedbackEmployees,
  upsertEmployeeDirectory,
  listSurveys,
  createSurvey,
  setSurveyStatus,
  deleteSurvey,
  broadcastSurveyToTelegram,
  listResponses,
  listIncidentReports,
  updateIncidentStatus,
} from "@/lib/feedback.functions";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

export const Route = createFileRoute("/_authenticated/feedbacks")({
  component: FeedbacksPage,
});

const DEPARTMENTS = ["engineering", "design", "operations", "sales", "marketing", "finance", "hr", "other"];

function FeedbacksPage() {
  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <MessageSquare className="h-6 w-6" /> Feedbacks
          </h1>
          <p className="text-sm text-muted-foreground">
            Anonymous employee feedback & incident reports via Telegram Bot.
          </p>
        </div>
        <Tabs defaultValue="directory">
          <TabsList>
            <TabsTrigger value="directory"><Users className="h-4 w-4 mr-1" /> Employee Directory</TabsTrigger>
            <TabsTrigger value="surveys"><MessageSquare className="h-4 w-4 mr-1" /> Survey Creator</TabsTrigger>
            <TabsTrigger value="analytics"><BarChart3 className="h-4 w-4 mr-1" /> Analytics</TabsTrigger>
            <TabsTrigger value="reports"><AlertTriangle className="h-4 w-4 mr-1" /> Incident Reports</TabsTrigger>
          </TabsList>
          <TabsContent value="directory"><DirectoryTab /></TabsContent>
          <TabsContent value="surveys"><SurveysTab /></TabsContent>
          <TabsContent value="analytics"><AnalyticsTab /></TabsContent>
          <TabsContent value="reports"><ReportsTab /></TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

// ===================== Directory =====================
function DirectoryTab() {
  const listFn = useServerFn(listFeedbackEmployees);
  const upsertFn = useServerFn(upsertEmployeeDirectory);
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["feedback-employees"], queryFn: () => listFn() });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ full_name: "", department: "engineering", employee_code: "", phone_number: "", position: "Staff" });

  const save = useMutation({
    mutationFn: (payload: any) => upsertFn({ data: payload }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["feedback-employees"] });
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  function openNew() {
    setEditing(null);
    setForm({ full_name: "", department: "engineering", employee_code: "", phone_number: "", position: "Staff" });
    setOpen(true);
  }
  function openEdit(emp: any) {
    setEditing(emp);
    setForm({
      full_name: emp.full_name ?? "",
      department: emp.department ?? "engineering",
      employee_code: emp.employee_code ?? "",
      phone_number: emp.phone_number ?? "",
      position: emp.position ?? "Staff",
    });
    setOpen(true);
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">{data.length} employees</div>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Add Employee</Button>
      </div>
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-2">Employee ID</th>
              <th className="p-2">Name</th>
              <th className="p-2">Department</th>
              <th className="p-2">Position</th>
              <th className="p-2">Phone</th>
              <th className="p-2">Telegram</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {data.map((e: any) => (
              <tr key={e.id} className="border-t">
                <td className="p-2 font-mono text-xs">{e.employee_code ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="p-2">{e.full_name}</td>
                <td className="p-2 capitalize">{e.department}</td>
                <td className="p-2">{e.position}</td>
                <td className="p-2">{e.phone_number ?? "—"}</td>
                <td className="p-2">
                  {e.telegram_chat_id ? <Badge variant="secondary">Linked</Badge> : <Badge variant="outline">Not linked</Badge>}
                </td>
                <td className="p-2 text-right">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(e)}><Pencil className="h-3 w-3" /></Button>
                </td>
              </tr>
            ))}
            {data.length === 0 && <tr><td className="p-4 text-center text-muted-foreground" colSpan={7}>No employees yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Employee" : "Add Employee"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Employee ID</Label>
              <Input value={form.employee_code} onChange={(e) => setForm({ ...form, employee_code: e.target.value })} placeholder="EMP-001" />
            </div>
            <div>
              <Label>Full Name</Label>
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Department</Label>
                <Select value={form.department} onValueChange={(v) => setForm({ ...form, department: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Position</Label>
                <Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Phone Number</Label>
              <Input value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} placeholder="+95..." />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => save.mutate({ id: editing?.id, ...form })} disabled={!form.full_name || !form.employee_code || save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===================== Surveys =====================
function SurveysTab() {
  const listFn = useServerFn(listSurveys);
  const createFn = useServerFn(createSurvey);
  const statusFn = useServerFn(setSurveyStatus);
  const delFn = useServerFn(deleteSurvey);
  const sendFn = useServerFn(broadcastSurveyToTelegram);
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["surveys"], queryFn: () => listFn() });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [questions, setQuestions] = useState<{ question_text: string; question_type: "rating" | "text" | "multiple_choice" }[]>([
    { question_text: "How satisfied are you overall?", question_type: "rating" },
  ]);

  const create = useMutation({
    mutationFn: () => createFn({ data: { title, description, questions } }),
    onSuccess: () => {
      toast.success("Survey created");
      qc.invalidateQueries({ queryKey: ["surveys"] });
      setOpen(false);
      setTitle(""); setDescription(""); setQuestions([{ question_text: "", question_type: "rating" }]);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const send = useMutation({
    mutationFn: (id: string) => sendFn({ data: { surveyId: id } }),
    onSuccess: (r: any) => {
      toast.success(`Sent to ${r.sent}/${r.total} employees`);
      qc.invalidateQueries({ queryKey: ["surveys"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: (p: { id: string; status: any }) => statusFn({ data: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["surveys"] }),
  });

  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["surveys"] }); },
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">{data.length} surveys</div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> New Survey</Button></DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create Survey</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              <div className="space-y-2">
                <Label>Questions</Label>
                {questions.map((q, i) => (
                  <div key={i} className="flex gap-2 items-start border rounded p-2">
                    <div className="flex-1 space-y-2">
                      <Input
                        placeholder={`Question ${i + 1}`}
                        value={q.question_text}
                        onChange={(e) => {
                          const next = [...questions]; next[i] = { ...q, question_text: e.target.value }; setQuestions(next);
                        }}
                      />
                      <Select
                        value={q.question_type}
                        onValueChange={(v: any) => {
                          const next = [...questions]; next[i] = { ...q, question_type: v }; setQuestions(next);
                        }}
                      >
                        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="rating">Rating (1-5)</SelectItem>
                          <SelectItem value="text">Text Feedback</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setQuestions(questions.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setQuestions([...questions, { question_text: "", question_type: "rating" }])}>
                  <Plus className="h-4 w-4 mr-1" /> Add Question
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => create.mutate()}
                disabled={!title || questions.some((q) => !q.question_text) || create.isPending}
              >
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="grid gap-3">
        {data.map((s: any) => (
          <div key={s.id} className="border rounded-lg p-3 flex justify-between gap-3 items-start">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <div className="font-medium">{s.title}</div>
                <Badge variant={s.status === "active" ? "default" : s.status === "completed" ? "secondary" : "outline"}>{s.status}</Badge>
              </div>
              {s.description && <div className="text-sm text-muted-foreground">{s.description}</div>}
              <div className="text-xs text-muted-foreground mt-1">{s.survey_questions?.length ?? 0} questions</div>
            </div>
            <div className="flex gap-2">
              <Select value={s.status} onValueChange={(v: any) => setStatus.mutate({ id: s.id, status: v })}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => send.mutate(s.id)} disabled={send.isPending}>
                <Send className="h-4 w-4 mr-1" /> Send to Telegram
              </Button>
              <Button size="sm" variant="ghost" onClick={() => del.mutate(s.id)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
        ))}
        {data.length === 0 && <div className="text-sm text-muted-foreground text-center py-8">No surveys yet.</div>}
      </div>
    </div>
  );
}

// ===================== Analytics =====================
function AnalyticsTab() {
  const listSurveysFn = useServerFn(listSurveys);
  const respFn = useServerFn(listResponses);
  const { data: surveys = [] } = useQuery({ queryKey: ["surveys"], queryFn: () => listSurveysFn() });
  const [surveyId, setSurveyId] = useState<string>("");
  const { data: responses = [] } = useQuery({
    queryKey: ["responses", surveyId],
    queryFn: () => respFn({ data: { surveyId: surveyId || undefined } }),
  });

  const ratings = responses.filter((r: any) => r.rating_value != null);
  const avg = ratings.length ? ratings.reduce((a: number, r: any) => a + r.rating_value, 0) / ratings.length : 0;
  const satisfactionPct = ratings.length ? Math.round((avg / 5) * 100) : 0;

  const byDept = useMemo(() => {
    const map: Record<string, { total: number; sum: number }> = {};
    for (const r of ratings) {
      const d = r.department ?? "unknown";
      map[d] ??= { total: 0, sum: 0 };
      map[d].total += 1;
      map[d].sum += r.rating_value;
    }
    return Object.entries(map).map(([dept, v]) => ({ dept, avg: +(v.sum / v.total).toFixed(2), count: v.total }));
  }, [ratings]);

  const distribution = useMemo(() => {
    const m: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of ratings) m[r.rating_value] = (m[r.rating_value] ?? 0) + 1;
    return [1, 2, 3, 4, 5].map((n) => ({ rating: `${n}★`, count: m[n] }));
  }, [ratings]);

  const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6"];

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <div>
          <Label>Survey</Label>
          <Select value={surveyId || "all"} onValueChange={(v) => setSurveyId(v === "all" ? "" : v)}>
            <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Surveys</SelectItem>
              {surveys.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        <StatCard label="Satisfaction" value={`${satisfactionPct}%`} sub={`avg ${avg.toFixed(2)}/5`} />
        <StatCard label="Total Responses" value={responses.length} />
        <StatCard label="Rating Responses" value={ratings.length} />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-2">Rating Distribution</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={distribution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="rating" /><YAxis allowDecimals={false} />
              <RTooltip />
              <Bar dataKey="count">{distribution.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-2">Avg by Department</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byDept}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="dept" /><YAxis domain={[0, 5]} />
              <RTooltip />
              <Bar dataKey="avg" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="border rounded-lg p-4 md:col-span-2">
          <h3 className="text-sm font-medium mb-2">Response Share by Department</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={byDept} dataKey="count" nameKey="dept" outerRadius={90} label>
                {byDept.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Legend /><RTooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="border rounded-lg p-4">
        <h3 className="text-sm font-medium mb-2">Recent Text Comments</h3>
        <div className="space-y-2">
          {responses.filter((r: any) => r.text_comment).slice(0, 20).map((r: any) => (
            <div key={r.id} className="text-sm border-l-2 border-primary pl-3">
              <div className="text-muted-foreground text-xs">{r.department ?? "unknown"} · {new Date(r.submitted_at).toLocaleString()}</div>
              <div>{r.text_comment}</div>
            </div>
          ))}
          {responses.filter((r: any) => r.text_comment).length === 0 && (
            <div className="text-sm text-muted-foreground">No text comments yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="border rounded-lg p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ===================== Incident Reports =====================
function ReportsTab() {
  const listFn = useServerFn(listIncidentReports);
  const updFn = useServerFn(updateIncidentStatus);
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["incidents"], queryFn: () => listFn() });
  const upd = useMutation({
    mutationFn: (p: { id: string; status: any }) => updFn({ data: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["incidents"] }),
  });
  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">{data.length} reports · submitted anonymously via Telegram</div>
      <div className="grid gap-3">
        {data.map((r: any) => (
          <div key={r.id} className="border rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="destructive">{r.category ?? "Report"}</Badge>
              <Badge variant="outline">From: {r.reporter_department ?? "—"}</Badge>
              {r.subject_name && <Badge variant="secondary">Re: {r.subject_name}</Badge>}
              <span className="text-xs text-muted-foreground ml-auto">{new Date(r.created_at).toLocaleString()}</span>
            </div>
            <div className="text-sm whitespace-pre-wrap">{r.description}</div>
            <div className="flex gap-2">
              <Select value={r.status} onValueChange={(v: any) => upd.mutate({ id: r.id, status: v })}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="reviewing">Reviewing</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="dismissed">Dismissed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
        {data.length === 0 && <div className="text-sm text-muted-foreground text-center py-8">No incident reports.</div>}
      </div>
    </div>
  );
}
