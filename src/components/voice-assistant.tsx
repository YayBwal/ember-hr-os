import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant } from "livekit-client";
import { KrispNoiseFilter, isKrispNoiseFilterSupported } from "@livekit/krisp-noise-filter";
import { Mic, MicOff, Phone, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

type Status = "idle" | "connecting" | "live" | "error";

interface TranscriptLine {
  id: string;
  who: "you" | "agent";
  text: string;
  final: boolean;
}

export function VoiceAssistant() {
  const [status, setStatus] = useState<Status>("idle");
  const [muted, setMuted] = useState(false);
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => () => { roomRef.current?.disconnect(); }, []);

  async function connect() {
    if (status === "connecting" || status === "live") return;
    setStatus("connecting");
    setLines([]);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Not signed in");

      const res = await fetch("/api/livekit-token", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Token error ${res.status}`);
      const { token: lkToken, url } = (await res.json()) as { token: string; url: string };

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio && audioElRef.current) {
          track.attach(audioElRef.current);
          if (participant.identity.startsWith("agent")) setAgentSpeaking(true);
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach());
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        setAgentSpeaking(speakers.some((s) => s.identity.startsWith("agent")));
      });
      room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
        const who: "you" | "agent" = participant?.identity.startsWith("agent") ? "agent" : "you";
        setLines((prev) => {
          const next = [...prev];
          for (const seg of segments) {
            const idx = next.findIndex((l) => l.id === seg.id);
            if (idx >= 0) next[idx] = { ...next[idx], text: seg.text, final: seg.final };
            else next.push({ id: seg.id, who, text: seg.text, final: seg.final });
          }
          return next.slice(-40);
        });
      });
      room.on(RoomEvent.DataReceived, (payload) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload)) as
            | { type: "navigate"; to: string }
            | { type: "tool_result"; tool: string; ok: boolean; summary?: string }
            | { type: "invalidate"; keys: string[][] };
          if (msg.type === "navigate") navigate({ to: msg.to as any });
          else if (msg.type === "tool_result") {
            toast.success(`${msg.tool}: ${msg.summary ?? (msg.ok ? "ok" : "failed")}`);
            qc.invalidateQueries();
          } else if (msg.type === "invalidate") {
            msg.keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
          }
        } catch {}
      });
      room.on(RoomEvent.Disconnected, () => {
        setStatus("idle");
        setAgentSpeaking(false);
      });

      await room.connect(url, lkToken);
      await room.localParticipant.setMicrophoneEnabled(true);

      // Apply Krisp noise filter on the published mic track
      if (isKrispNoiseFilterSupported()) {
        const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        const micTrack = micPub?.track;
        if (micTrack && "setProcessor" in micTrack) {
          try {
            await (micTrack as any).setProcessor(KrispNoiseFilter());
          } catch (e) {
            console.warn("Krisp filter failed", e);
          }
        }
      }

      setStatus("live");
      setOpen(true);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Voice connect failed");
      setStatus("error");
      roomRef.current?.disconnect();
      setTimeout(() => setStatus("idle"), 1500);
    }
  }

  async function hangup() {
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setStatus("idle");
    setOpen(false);
    setAgentSpeaking(false);
  }

  async function toggleMute() {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }

  const isLive = status === "live";

  return (
    <>
      <audio ref={audioElRef} autoPlay playsInline />
      <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
        {open && isLive && (
          <div className="w-[320px] max-h-[360px] flex flex-col rounded-lg border border-border bg-card shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className={`absolute inline-flex h-full w-full rounded-full ${agentSpeaking ? "bg-primary animate-ping" : "bg-emerald-500"}`} />
                  <span className={`relative inline-flex h-2 w-2 rounded-full ${agentSpeaking ? "bg-primary" : "bg-emerald-500"}`} />
                </span>
                <span className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
                  {agentSpeaking ? "Agent speaking" : "Listening · မြန်မာ"}
                </span>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen(false)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2 text-sm">
              {lines.length === 0 && (
                <p className="text-xs text-muted-foreground">မိုက်ကိုနှိပ်၍ မြန်မာစကားပြောပါ — Tap mic and speak in Burmese.</p>
              )}
              {lines.map((l) => (
                <div key={l.id} className={l.who === "agent" ? "text-foreground" : "text-muted-foreground"}>
                  <span className="text-[10px] font-mono uppercase tracking-[0.18em] mr-1">{l.who === "agent" ? "AI" : "YOU"}</span>
                  {l.text}
                </div>
              ))}
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
          onClick={isLive ? () => setOpen((o) => !o) : connect}
          disabled={status === "connecting"}
          size="lg"
          className={`h-14 w-14 rounded-full shadow-xl ${isLive ? "bg-primary" : "bg-primary"} ${agentSpeaking ? "ring-4 ring-primary/40 animate-pulse" : ""}`}
          title={isLive ? "Voice assistant active" : "Talk to Mandai AI (Burmese)"}
        >
          {status === "connecting" ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : isLive ? (
            <Mic className="h-5 w-5" />
          ) : (
            <Mic className="h-5 w-5" />
          )}
        </Button>
      </div>
    </>
  );
}
