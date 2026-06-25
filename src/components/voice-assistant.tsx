import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useRouter } from "@tanstack/react-router";
import { GeminiLiveSession, type LiveStatus, type LiveEvent } from "@/lib/gemini-live-client";

type Line = { id: string; who: "you" | "ai"; text: string; partial?: boolean };

export function VoiceAssistant() {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [muted, setMuted] = useState(false);
  const sessionRef = useRef<GeminiLiveSession | null>(null);
  const router = useRouter();

  const handleEvent = useCallback(
    (e: LiveEvent) => {
      if (e.type === "status") setStatus(e.status);
      else if (e.type === "user_text" || e.type === "ai_text") {
        const who: "you" | "ai" = e.type === "user_text" ? "you" : "ai";
        setLines((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.who === who && last.partial) {
            // Replace the streaming line in place.
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
    },
    [router],
  );

  const start = useCallback(async () => {
    setOpen(true);
    setLines([]);
    const s = new GeminiLiveSession();
    sessionRef.current = s;
    s.on(handleEvent);
    await s.start();
  }, [handleEvent]);

  const hangup = useCallback(async () => {
    const s = sessionRef.current;
    sessionRef.current = null;
    if (s) await s.stop();
    setOpen(false);
    setStatus("idle");
  }, []);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    sessionRef.current?.setMuted(next);
  }, [muted]);

  useEffect(() => {
    return () => {
      void sessionRef.current?.stop();
    };
  }, []);

  const statusLabel: Record<LiveStatus, string> = {
    idle: "Ready",
    connecting: "ချိတ်နေသည် · Connecting",
    listening: "နားထောင်နေသည် · Listening",
    thinking: "စဉ်းစားနေသည် · Thinking",
    speaking: "ပြောနေသည် · Speaking",
    error: "Error",
  };

  const isLive = open;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
      {isLive && (
        <div className="w-[320px] max-h-[360px] flex flex-col rounded-lg border border-border bg-card shadow-xl overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span
                  className={`absolute inline-flex h-full w-full rounded-full ${
                    status === "speaking"
                      ? "bg-primary animate-ping"
                      : status === "listening"
                        ? "bg-emerald-500 animate-ping"
                        : "bg-muted-foreground"
                  }`}
                />
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full ${
                    status === "speaking"
                      ? "bg-primary"
                      : status === "listening"
                        ? "bg-emerald-500"
                        : "bg-muted-foreground"
                  }`}
                />
              </span>
              <span className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
                {statusLabel[status]}
              </span>
              <span className="text-[10px] text-muted-foreground/70 ml-1">Live S2S</span>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={hangup} aria-label="Close">
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 text-sm">
            {lines.length === 0 && (
              <p className="text-xs text-muted-foreground">
                စကားပြောပါ — Speak (Burmese or English). Latency ~300ms.
              </p>
            )}
            {lines.map((l) => (
              <div key={l.id} className={l.who === "ai" ? "text-foreground" : "text-muted-foreground"}>
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] mr-1">
                  {l.who === "ai" ? "AI" : "YOU"}
                </span>
                {l.text}
              </div>
            ))}
            {status === "thinking" && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> ...
              </div>
            )}
          </div>
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
            <Button size="sm" variant="destructive" onClick={hangup} className="h-8 ml-auto">
              <Phone className="h-3.5 w-3.5 mr-1.5 rotate-[135deg]" /> End
            </Button>
          </div>
        </div>
      )}

      <Button
        onClick={isLive ? () => setOpen((o) => !o) : start}
        size="lg"
        className={`h-14 w-14 rounded-full shadow-xl bg-primary ${
          status === "speaking" || status === "listening" ? "ring-4 ring-primary/40 animate-pulse" : ""
        }`}
        title={isLive ? "Voice assistant active" : "Talk to Mandai AI (Live)"}
        aria-label="Voice assistant"
      >
        {status === "connecting" || status === "thinking" ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Mic className="h-5 w-5" />
        )}
      </Button>
    </div>
  );
}
