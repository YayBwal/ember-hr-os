import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Send, Loader2, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useRouter } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { copilotChat, type ToolTrace } from "@/lib/copilot.functions";
import type { AiAction } from "@/lib/ai-tools";

type Line = {
  id: string;
  who: "you" | "ai";
  text: string;
  tools?: ToolTrace[];
};

function fmtMMK(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n || 0));
}

function ToolCard({ trace }: { trace: ToolTrace }) {
  const r = trace.result as Record<string, unknown> | null;
  if (!r || r.ok === false) {
    return (
      <div className="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
        Tool {trace.name} failed: {String((r as { error?: string } | null)?.error ?? "unknown")}
      </div>
    );
  }

  const renderChart = trace.chart && trace.chart.data.length > 0 && (
    <div className="mt-2 h-40">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={trace.chart.data} margin={{ top: 4, right: 8, left: 0, bottom: 24 }}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10 }}
            angle={-30}
            textAnchor="end"
            interval={0}
            height={40}
          />
          <YAxis tick={{ fontSize: 10 }} width={48} />
          <Tooltip />
          <Bar dataKey="value" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );

  let table: React.ReactNode = null;
  if (trace.name === "payroll_summary" && Array.isArray(r.rows)) {
    const rows = r.rows as { name: string; base_mmk: number; performance_bonus_mmk: number; bonus_mmk: number; deduction_mmk: number; total_mmk: number; kpi: number }[];
    table = (
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left font-medium pr-2 pb-1">Name</th>
              <th className="text-right font-medium pr-2 pb-1">Base</th>
              <th className="text-right font-medium pr-2 pb-1">Bonus</th>
              <th className="text-right font-medium pr-2 pb-1">Deduct</th>
              <th className="text-right font-medium pb-1">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((row, i) => (
              <tr key={i} className="border-t border-border/40">
                <td className="py-1 pr-2 truncate max-w-[110px]">{row.name}</td>
                <td className="py-1 pr-2 text-right font-mono">{fmtMMK(row.base_mmk)}</td>
                <td className="py-1 pr-2 text-right font-mono">{fmtMMK(row.performance_bonus_mmk + row.bonus_mmk)}</td>
                <td className="py-1 pr-2 text-right font-mono">{fmtMMK(row.deduction_mmk)}</td>
                <td className="py-1 text-right font-mono font-semibold">{fmtMMK(row.total_mmk)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-1 text-[10px] text-muted-foreground">
          Total: <span className="font-mono">{fmtMMK(Number(r.total_mmk ?? 0))} MMK</span> · {String(r.employee_count ?? rows.length)} employees
        </div>
      </div>
    );
  } else if (trace.name === "kpi_ranking" && Array.isArray(r.rows)) {
    const rows = r.rows as { name: string; position: string | null; kpi: number; task_completion: number; attendance: number }[];
    table = (
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left font-medium pr-2 pb-1">#</th>
              <th className="text-left font-medium pr-2 pb-1">Name</th>
              <th className="text-right font-medium pr-2 pb-1">KPI</th>
              <th className="text-right font-medium pr-2 pb-1">Tasks</th>
              <th className="text-right font-medium pb-1">Attend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-border/40">
                <td className="py-1 pr-2 text-muted-foreground">{i + 1}</td>
                <td className="py-1 pr-2 truncate max-w-[120px]">{row.name}</td>
                <td className="py-1 pr-2 text-right font-mono font-semibold">{row.kpi}</td>
                <td className="py-1 pr-2 text-right font-mono">{row.task_completion}%</td>
                <td className="py-1 text-right font-mono">{row.attendance}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else if (trace.name === "bonus_totals") {
    table = (
      <div className="mt-2 text-xs">
        <div className="font-mono">{String(r.formatted ?? "")}</div>
      </div>
    );
  } else if (trace.name === "attendance_summary") {
    table = (
      <div className="mt-2 flex gap-3 text-[11px]">
        <span className="text-emerald-600">Present {String(r.present ?? 0)}</span>
        <span className="text-amber-600">Late {String(r.late ?? 0)}</span>
        <span className="text-destructive">Absent {String(r.absent ?? 0)}</span>
      </div>
    );
  } else if (trace.name === "team_overview" && Array.isArray(r.teams)) {
    const teams = r.teams as { name: string; department: string | null; members: number; avg_kpi: number }[];
    table = (
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left font-medium pr-2 pb-1">Team</th>
              <th className="text-right font-medium pr-2 pb-1">Members</th>
              <th className="text-right font-medium pb-1">Avg KPI</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t, i) => (
              <tr key={i} className="border-t border-border/40">
                <td className="py-1 pr-2">{t.name}</td>
                <td className="py-1 pr-2 text-right font-mono">{t.members}</td>
                <td className="py-1 text-right font-mono font-semibold">{t.avg_kpi}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else if (trace.name === "search_candidates" && Array.isArray(r.candidates)) {
    const list = r.candidates as { full_name: string; role_applied: string | null; status: string; ai_match_score: number }[];
    table = (
      <div className="mt-2 space-y-1 text-[11px]">
        {list.map((c, i) => (
          <div key={i} className="flex items-center justify-between">
            <span className="truncate">{c.full_name} · <span className="text-muted-foreground">{c.role_applied}</span></span>
            <span className="font-mono">{c.ai_match_score}%</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <details className="mt-2 rounded border border-border/60 bg-muted/30 p-2 text-xs">
      <summary className="cursor-pointer select-none text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        ⚙ {trace.name}
      </summary>
      {table}
      {renderChart}
    </details>
  );
}

export function AiCopilot() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chat = useServerFn(copilotChat);
  const router = useRouter();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const runActions = useCallback((actions: AiAction[] | undefined) => {
    if (!actions) return;
    for (const a of actions) {
      if (a.type === "navigate") {
        try {
          const [path, search] = a.to.split("?");
          const params: Record<string, string> = {};
          if (search) for (const [k, v] of new URLSearchParams(search)) params[k] = v;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          router.navigate({ to: path as any, search: params as any });
        } catch (e) {
          console.warn("navigate failed", e);
        }
      }
    }
  }, [router]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const userLine: Line = { id: crypto.randomUUID(), who: "you", text };
    setLines((p) => [...p, userLine]);
    historyRef.current.push({ role: "user", content: text });
    setBusy(true);
    try {
      const { reply, actions, tools } = await chat({ data: { messages: historyRef.current } });
      historyRef.current.push({ role: "assistant", content: reply });
      setLines((p) => [...p, { id: crypto.randomUUID(), who: "ai", text: reply, tools }]);
      runActions(actions as AiAction[] | undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI request failed";
      toast.error(msg);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [input, busy, chat, runActions]);

  return (
    <>
      <div className="fixed bottom-5 right-24 z-50">
        <Button
          onClick={() => setOpen((o) => !o)}
          size="lg"
          variant={open ? "default" : "outline"}
          className="h-14 w-14 rounded-full shadow-xl"
          title="Mandai Copilot (text)"
        >
          <MessageSquare className="h-5 w-5" />
        </Button>
      </div>

      {open && (
        <div className="fixed bottom-24 right-5 z-50 flex h-[min(640px,80vh)] w-[min(420px,calc(100vw-2.5rem))] flex-col rounded-lg border border-border bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
                Mandai Copilot
              </span>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen(false)}>
              <X className="h-3 w-3" />
            </Button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
            {lines.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Ask about KPI, payroll, bonuses, attendance, teams, or candidates.
                </p>
                <div className="flex flex-wrap gap-1">
                  {[
                    "Who has the lowest KPI this month?",
                    "How much did we pay in bonuses?",
                    "Show payroll summary",
                    "Attendance this month",
                  ].map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setInput(q)}
                      className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {lines.map((l) => (
              <div key={l.id} className={l.who === "you" ? "flex justify-end" : ""}>
                <div
                  className={
                    l.who === "you"
                      ? "max-w-[85%] rounded-2xl bg-primary px-3 py-1.5 text-primary-foreground text-xs"
                      : "max-w-full"
                  }
                >
                  {l.who === "you" ? (
                    <span className="whitespace-pre-wrap">{l.text}</span>
                  ) : (
                    <>
                      <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-[13px] [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_table]:text-xs">
                        <ReactMarkdown>{l.text}</ReactMarkdown>
                      </div>
                      {l.tools?.map((t, i) => (
                        <ToolCard key={i} trace={t} />
                      ))}
                    </>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
              </div>
            )}
          </div>

          <div className="border-t border-border p-2">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder="Ask anything…"
                className="flex-1 resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary max-h-32"
              />
              <Button onClick={() => void send()} disabled={busy || !input.trim()} size="icon" className="h-8 w-8">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
