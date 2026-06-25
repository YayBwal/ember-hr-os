import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Mic, MicOff, Send, Loader2, X, Sparkles, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useRouter } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { copilotChat, type ToolTrace } from "@/lib/copilot.functions";
import type { AiAction } from "@/lib/ai-tools";
import { GeminiLiveSession, type LiveStatus, type LiveEvent } from "@/lib/gemini-live-client";

/* ----------------------------- Tool result card ---------------------------- */

type ChatLine = { id: string; who: "you" | "ai"; text: string; tools?: ToolTrace[] };
type VoiceLine = { id: string; who: "you" | "ai"; text: string; partial?: boolean };

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
          <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} height={40} />
          <YAxis tick={{ fontSize: 10 }} width={48} />
          <Tooltip />
          <Bar dataKey="value" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
  let table: React.ReactNode = null;
  if (trace.name === "payroll_summary" && Array.isArray(r.rows)) {
    const rows = r.rows as { name: string; base_mmk: number; performance_bonus_mmk: number; bonus_mmk: number; deduction_mmk: number; total_mmk: number }[];
    table = (
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-muted-foreground"><tr>
            <th className="text-left font-medium pr-2 pb-1">Name</th>
            <th className="text-right font-medium pr-2 pb-1">Base</th>
            <th className="text-right font-medium pr-2 pb-1">Bonus</th>
            <th className="text-right font-medium pb-1">Total</th>
          </tr></thead>
          <tbody>
            {rows.slice(0, 12).map((row, i) => (
              <tr key={i} className="border-t border-border/40">
                <td className="py-1 pr-2 truncate max-w-[110px]">{row.name}</td>
                <td className="py-1 pr-2 text-right font-mono">{fmtMMK(row.base_mmk)}</td>
                <td className="py-1 pr-2 text-right font-mono">{fmtMMK(row.performance_bonus_mmk + row.bonus_mmk)}</td>
                <td className="py-1 text-right font-mono font-semibold">{fmtMMK(row.total_mmk)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-1 text-[10px] text-muted-foreground">
          Total: <span className="font-mono">{fmtMMK(Number(r.total_mmk ?? 0))} MMK</span>
        </div>
      </div>
    );
  } else if (trace.name === "kpi_ranking" && Array.isArray(r.rows)) {
    const rows = r.rows as { name: string; kpi: number; task_completion: number; attendance: number }[];
    table = (
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-muted-foreground"><tr>
            <th className="text-left font-medium pr-2 pb-1">#</th>
            <th className="text-left font-medium pr-2 pb-1">Name</th>
            <th className="text-right font-medium pr-2 pb-1">KPI</th>
            <th className="text-right font-medium pb-1">Attend</th>
          </tr></thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-border/40">
                <td className="py-1 pr-2 text-muted-foreground">{i + 1}</td>
                <td className="py-1 pr-2 truncate max-w-[120px]">{row.name}</td>
                <td className="py-1 pr-2 text-right font-mono font-semibold">{row.kpi}</td>
                <td className="py-1 text-right font-mono">{row.attendance}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else if (trace.name === "bonus_totals") {
    table = <div className="mt-2 text-xs font-mono">{String(r.formatted ?? "")}</div>;
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

/* --------------------------------- Main UI -------------------------------- */

type Mode = "chat" | "voice";

export function AssistantDock() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("chat");
  const router = useRouter();

  // -------- chat state --------
  const [chatLines, setChatLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chat = useServerFn(copilotChat);

  // -------- voice state --------
  const [voiceStatus, setVoiceStatus] = useState<LiveStatus>("idle");
  const [voiceLines, setVoiceLines] = useState<VoiceLine[]>([]);
  const [muted, setMuted] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const sessionRef = useRef<GeminiLiveSession | null>(null);
  const voiceScrollRef = useRef<HTMLDivElement | null>(null);

  /* auto-scroll */
  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatLines, busy]);
  useEffect(() => {
    if (voiceScrollRef.current) voiceScrollRef.current.scrollTop = voiceScrollRef.current.scrollHeight;
  }, [voiceLines]);
  useEffect(() => {
    if (open && mode === "chat") inputRef.current?.focus();
  }, [open, mode]);

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
    setChatLines((p) => [...p, { id: crypto.randomUUID(), who: "you", text }]);
    historyRef.current.push({ role: "user", content: text });
    setBusy(true);
    try {
      const { reply, actions, tools } = await chat({ data: { messages: historyRef.current } });
      historyRef.current.push({ role: "assistant", content: reply });
      setChatLines((p) => [...p, { id: crypto.randomUUID(), who: "ai", text: reply, tools }]);
      runActions(actions as AiAction[] | undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI request failed");
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [input, busy, chat, runActions]);

  /* voice handlers */
  const handleVoiceEvent = useCallback((e: LiveEvent) => {
    if (e.type === "status") setVoiceStatus(e.status);
    else if (e.type === "user_text" || e.type === "ai_text") {
      const who: "you" | "ai" = e.type === "user_text" ? "you" : "ai";
      setVoiceLines((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.who === who && last.partial) {
          const copy = prev.slice(0, -1);
          return [...copy, { ...last, text: e.text, partial: e.partial }];
        }
        return [...prev, { id: crypto.randomUUID(), who, text: e.text, partial: e.partial }];
      });
    } else if (e.type === "action") {
      if (e.action.type === "navigate") {
        try {
          const [path, search] = e.action.to.split("?");
          const params: Record<string, string> = {};
          if (search) for (const [k, v] of new URLSearchParams(search)) params[k] = v;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          router.navigate({ to: path as any, search: params as any });
        } catch (err) {
          console.warn("navigate failed", err);
        }
      }
    } else if (e.type === "error") {
      toast.error(e.message);
    }
  }, [router]);

  const startVoice = useCallback(async () => {
    setVoiceLines([]);
    setVoiceActive(true);
    const s = new GeminiLiveSession();
    sessionRef.current = s;
    s.on(handleVoiceEvent);
    await s.start();
  }, [handleVoiceEvent]);

  const stopVoice = useCallback(async () => {
    const s = sessionRef.current;
    sessionRef.current = null;
    if (s) await s.stop();
    setVoiceActive(false);
    setVoiceStatus("idle");
  }, []);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    sessionRef.current?.setMuted(next);
  }, [muted]);

  // when user switches modes, don't kill the voice session, it persists
  const switchMode = (m: Mode) => {
    setMode(m);
    if (m === "voice" && !voiceActive && voiceStatus === "idle") {
      void startVoice();
    }
  };

  useEffect(() => () => { void sessionRef.current?.stop(); }, []);

  const statusLabel: Record<LiveStatus, string> = {
    idle: "Ready",
    connecting: "ချိတ်နေသည် · Connecting",
    listening: "နားထောင်နေသည် · Listening",
    thinking: "စဉ်းစားနေသည် · Thinking",
    speaking: "ပြောနေသည် · Speaking",
    error: "Error",
  };

  return (
    <>
      {/* Single FAB */}
      <div className="fixed bottom-5 right-5 z-50">
        <Button
          onClick={() => setOpen((o) => !o)}
          size="lg"
          className={`h-14 w-14 rounded-full shadow-xl bg-primary ${
            voiceActive && (voiceStatus === "speaking" || voiceStatus === "listening")
              ? "ring-4 ring-primary/40 animate-pulse"
              : ""
          }`}
          aria-label="Mandai Assistant"
          title="Mandai Assistant"
        >
          {voiceActive ? <Mic className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        </Button>
      </div>

      {open && (
        <div className="fixed bottom-24 right-5 z-50 flex h-[min(640px,80vh)] w-[min(420px,calc(100vw-2.5rem))] flex-col rounded-lg border border-border bg-card shadow-2xl">
          {/* Header with tabs */}
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-1 rounded-md bg-muted/60 p-0.5">
              <button
                type="button"
                onClick={() => switchMode("chat")}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.14em] transition ${
                  mode === "chat" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <MessageSquare className="h-3 w-3" /> Chat
              </button>
              <button
                type="button"
                onClick={() => switchMode("voice")}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.14em] transition ${
                  mode === "voice" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Mic className="h-3 w-3" /> Voice
                {voiceActive && (
                  <span className={`ml-0.5 h-1.5 w-1.5 rounded-full ${
                    voiceStatus === "speaking" ? "bg-primary animate-pulse" :
                    voiceStatus === "listening" ? "bg-emerald-500 animate-pulse" :
                    voiceStatus === "error" ? "bg-destructive" : "bg-muted-foreground"
                  }`} />
                )}
              </button>
            </div>
            <div className="flex items-center gap-1">
              {mode === "voice" && voiceActive && (
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                  {statusLabel[voiceStatus]}
                </span>
              )}
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen(false)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* CHAT mode */}
          {mode === "chat" && (
            <>
              <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
                {chatLines.length === 0 && (
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
                {chatLines.map((l) => (
                  <div key={l.id} className={l.who === "you" ? "flex justify-end" : ""}>
                    <div className={l.who === "you"
                      ? "max-w-[85%] rounded-2xl bg-primary px-3 py-1.5 text-primary-foreground text-xs"
                      : "max-w-full"}>
                      {l.who === "you" ? (
                        <span className="whitespace-pre-wrap">{l.text}</span>
                      ) : (
                        <>
                          <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-[13px] [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_table]:text-xs">
                            <ReactMarkdown>{l.text}</ReactMarkdown>
                          </div>
                          {l.tools?.map((t, i) => <ToolCard key={i} trace={t} />)}
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
                  <Button
                    onClick={() => switchMode("voice")}
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    title="Switch to voice"
                  >
                    <Mic className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* VOICE mode */}
          {mode === "voice" && (
            <>
              <div ref={voiceScrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 text-sm">
                {!voiceActive && voiceStatus === "idle" && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                    <div className="rounded-full bg-primary/10 p-4">
                      <Mic className="h-6 w-6 text-primary" />
                    </div>
                    <p className="text-xs text-muted-foreground max-w-[240px]">
                      စကားပြောပါ — Speak (Burmese or English).<br />Latency ~300ms.
                    </p>
                    <Button size="sm" onClick={() => void startVoice()}>
                      <Mic className="h-3.5 w-3.5 mr-1.5" /> Start Voice
                    </Button>
                  </div>
                )}
                {voiceStatus === "error" && !voiceActive && (
                  <div className="rounded border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                    Voice connection failed. Try Chat mode, or retry voice.
                  </div>
                )}
                {voiceLines.map((l) => (
                  <div
                    key={l.id}
                    className={`${l.who === "ai" ? "text-foreground" : "text-muted-foreground"} ${l.partial ? "opacity-70 italic" : ""}`}
                  >
                    <span className={`text-[10px] font-mono uppercase tracking-[0.18em] mr-1 ${
                      l.who === "ai" ? "text-primary" : "text-emerald-600 dark:text-emerald-400"
                    }`}>
                      {l.who === "ai" ? "AI" : "YOU"}
                    </span>
                    {l.text}
                    {l.partial && <span className="ml-1 inline-block w-1 h-3 align-middle bg-current animate-pulse" />}
                  </div>
                ))}
                {voiceStatus === "thinking" && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> ...
                  </div>
                )}
              </div>
              {voiceActive && (
                <div className="flex items-center gap-2 border-t border-border px-3 py-2">
                  <Button
                    size="sm"
                    variant={muted ? "default" : "outline"}
                    onClick={toggleMute}
                    className="h-8"
                    aria-label={muted ? "Unmute" : "Mute"}
                  >
                    {muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    onClick={() => switchMode("chat")}
                    size="sm"
                    variant="outline"
                    className="h-8"
                    title="Switch to chat"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => void stopVoice()} className="h-8 ml-auto">
                    <Phone className="h-3.5 w-3.5 mr-1.5 rotate-[135deg]" /> End
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
