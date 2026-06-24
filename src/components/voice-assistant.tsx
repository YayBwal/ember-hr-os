import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { voiceChat } from "@/lib/voice.functions";

type Action =
  | { type: "navigate"; to: string }
  | { type: "highlight_candidates"; ids: string[] };

type Status = "idle" | "listening" | "thinking" | "speaking" | "error";
type Line = { id: string; who: "you" | "ai"; text: string };

// Web Speech API types (minimal)
type SR = any;

declare global {
  interface Window {
    SpeechRecognition?: SR;
    webkitSpeechRecognition?: SR;
  }
}

export function VoiceAssistant() {
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [muted, setMuted] = useState(false);
  const recRef = useRef<any>(null);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const shouldListenRef = useRef(false);
  const chat = useServerFn(voiceChat);
  const router = useRouter();
  const qc = useQueryClient();
  const [sttLang, setSttLang] = useState<"my-MM" | "en-US">("my-MM");

  const supported =
    typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition) &&
    "speechSynthesis" in window;

  const speak = useCallback((text: string) => {
    return new Promise<void>((resolve) => {
      if (!("speechSynthesis" in window)) return resolve();
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      // Detect Burmese characters (U+1000–U+109F) to pick TTS voice/lang.
      const hasBurmese = /[\u1000-\u109F]/.test(text);
      u.lang = hasBurmese ? "my-MM" : "en-US";
      u.rate = 1;
      u.pitch = 1;
      const voices = window.speechSynthesis.getVoices();
      const match = voices.find((v) =>
        hasBurmese ? v.lang?.toLowerCase().startsWith("my") : v.lang?.toLowerCase().startsWith("en"),
      );
      if (match) u.voice = match;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }, []);

  const runActions = useCallback(
    (actions: Action[] | undefined) => {
      if (!actions) return;
      for (const a of actions) {
        if (a.type === "navigate") {
          try {
            const [path, search] = a.to.split("?");
            const params: Record<string, string> = {};
            if (search) {
              for (const [k, v] of new URLSearchParams(search)) params[k] = v;
            }
            router.navigate({ to: path as any, search: params as any });
          } catch (e) {
            console.warn("navigate failed", e);
          }
        } else if (a.type === "highlight_candidates") {
          qc.invalidateQueries({ queryKey: ["candidates"] });
        }
      }
    },
    [router, qc],
  );

  const startListening = useCallback(() => {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;
    try {
      const rec = new Ctor();
      rec.lang = "my-MM";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.continuous = false;
      rec.onstart = () => setStatus("listening");
      rec.onerror = (e: any) => {
        if (e.error === "not-allowed") {
          toast.error("မိုက်ခွင့်ပြုပါ — Microphone permission denied");
          shouldListenRef.current = false;
          setStatus("error");
          setTimeout(() => setStatus("idle"), 1500);
        } else if (e.error === "no-speech") {
          // try again silently
          if (shouldListenRef.current) setTimeout(() => startListening(), 200);
        } else {
          console.warn("speech error", e.error);
        }
      };
      rec.onresult = async (event: any) => {
        const text = event.results[0]?.[0]?.transcript?.trim();
        if (!text) {
          if (shouldListenRef.current) setTimeout(() => startListening(), 200);
          return;
        }
        const id = crypto.randomUUID();
        setLines((p) => [...p, { id, who: "you", text }]);
        historyRef.current.push({ role: "user", content: text });
        setStatus("thinking");
        try {
          const { reply } = await chat({ data: { messages: historyRef.current } });
          historyRef.current.push({ role: "assistant", content: reply });
          setLines((p) => [...p, { id: crypto.randomUUID(), who: "ai", text: reply }]);
          setStatus("speaking");
          await speak(reply);
        } catch (err: any) {
          toast.error(err?.message ?? "AI ဖြေဆိုရာတွင် ပြဿနာရှိနေသည်");
        } finally {
          if (shouldListenRef.current) {
            setTimeout(() => startListening(), 150);
          } else {
            setStatus("idle");
          }
        }
      };
      rec.onend = () => {
        // handled in onresult / onerror
      };
      recRef.current = rec;
      rec.start();
    } catch (e) {
      console.error(e);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 1500);
    }
  }, [chat, speak]);

  const start = useCallback(async () => {
    if (!supported) {
      toast.error("ဤbrowserတွင် voice မဖော်ပြနိုင်ပါ — Use Chrome/Edge");
      return;
    }
    try {
      // Prime mic permission
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      toast.error("မိုက်ခွင့်ပြုပါ");
      return;
    }
    // Warm up voices
    window.speechSynthesis.getVoices();
    setOpen(true);
    setLines([]);
    historyRef.current = [];
    shouldListenRef.current = true;
    startListening();
  }, [supported, startListening]);

  const hangup = useCallback(() => {
    shouldListenRef.current = false;
    try { recRef.current?.stop(); } catch {}
    try { window.speechSynthesis.cancel(); } catch {}
    setStatus("idle");
    setOpen(false);
  }, []);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    if (next) {
      shouldListenRef.current = false;
      try { recRef.current?.stop(); } catch {}
      setStatus("idle");
    } else {
      shouldListenRef.current = true;
      startListening();
    }
  }, [muted, startListening]);

  useEffect(() => () => { hangup(); }, [hangup]);

  const isLive = open;
  const statusLabel = {
    idle: "Ready",
    listening: "နားထောင်နေသည် · Listening",
    thinking: "စဉ်းစားနေသည် · Thinking",
    speaking: "ပြောနေသည် · Speaking",
    error: "Error",
  }[status];

  return (
    <>
      <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
        {isLive && (
          <div className="w-[320px] max-h-[360px] flex flex-col rounded-lg border border-border bg-card shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className={`absolute inline-flex h-full w-full rounded-full ${status === "speaking" ? "bg-primary animate-ping" : status === "listening" ? "bg-emerald-500 animate-ping" : "bg-muted-foreground"}`} />
                  <span className={`relative inline-flex h-2 w-2 rounded-full ${status === "speaking" ? "bg-primary" : status === "listening" ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                </span>
                <span className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
                  {statusLabel}
                </span>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={hangup}>
                <X className="h-3 w-3" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2 text-sm">
              {lines.length === 0 && (
                <p className="text-xs text-muted-foreground">မြန်မာစကားပြောပါ — Speak in Burmese.</p>
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
              <Button size="sm" variant={muted ? "default" : "outline"} onClick={toggleMute} className="h-8">
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
          className={`h-14 w-14 rounded-full shadow-xl bg-primary ${status === "speaking" || status === "listening" ? "ring-4 ring-primary/40 animate-pulse" : ""}`}
          title={isLive ? "Voice assistant active" : "Talk to Mandai AI (Burmese)"}
        >
          {status === "thinking" ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Mic className="h-5 w-5" />
          )}
        </Button>
      </div>
    </>
  );
}
