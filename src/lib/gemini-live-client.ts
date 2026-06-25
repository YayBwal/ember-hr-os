// Browser client for Gemini Multimodal Live (audio-in → audio-out S2S).
// Captures mic at 16 kHz PCM16, streams over the /api/gemini-live WS proxy,
// receives 24 kHz PCM16 audio chunks, and plays them via WebAudio scheduling.
//
// Tool calls coming from the model are routed back to the server via
// dispatchAiTool and answered with toolResponse messages.

import { supabase } from "@/integrations/supabase/client";
import { ALL_TOOLS } from "@/lib/ai-tools";
import { dispatchAiTool } from "@/lib/dispatch-tool.functions";

const MODEL = "models/gemini-2.0-flash-live-001";

const SYSTEM_INSTRUCTION = `You are Mandai — a friendly, professional HR/operations voice assistant in an admin app.
LANGUAGE: Match the user's language. If they speak Burmese, reply in Burmese; English, reply in English. Mixed, keep the mix.
STYLE: Keep replies SHORT (1–2 sentences) — they are spoken aloud. No markdown, no lists, no long numbers; round MMK values.
TOOLS: kpi_ranking, bonus_totals, payroll_summary, attendance_summary, team_overview, search_candidates, navigate.
Call a tool whenever the user asks about KPIs, payroll, bonuses, attendance, teams, or specific employees, or wants to open a page. After a tool returns, summarize ONE key number in one short sentence.`;

export type LiveStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

export type LiveEvent =
  | { type: "status"; status: LiveStatus }
  | { type: "user_text"; text: string; partial: boolean }
  | { type: "ai_text"; text: string; partial: boolean }
  | { type: "action"; action: { type: "navigate"; to: string } }
  | { type: "error"; message: string };

// Gemini-Live tool spec uses functionDeclarations (not the OpenAI {type:"function"} wrapper).
const LIVE_TOOLS = [
  {
    functionDeclarations: ALL_TOOLS.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    })),
  },
];

function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// AudioWorklet processor: downsample mic input to mono 16-bit PCM @ 16 kHz
// and post 50 ms chunks back to the main thread as ArrayBuffers.
const WORKLET_SRC = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
    this._sampleCount = 0;
    this._targetSamples = Math.floor(sampleRate * 0.05); // 50 ms
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    this._buf.push(new Float32Array(ch));
    this._sampleCount += ch.length;
    if (this._sampleCount >= this._targetSamples) {
      const merged = new Float32Array(this._sampleCount);
      let off = 0;
      for (const part of this._buf) { merged.set(part, off); off += part.length; }
      this._buf = []; this._sampleCount = 0;
      // Downsample from sampleRate -> 16000 (linear) then convert to PCM16.
      const ratio = sampleRate / 16000;
      const outLen = Math.floor(merged.length / ratio);
      const out = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const s = merged[Math.floor(i * ratio)] ?? 0;
        const v = Math.max(-1, Math.min(1, s));
        out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      this.port.postMessage(out.buffer, [out.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
`;

export class GeminiLiveSession {
  private ws: WebSocket | null = null;
  private audioCtxIn: AudioContext | null = null;
  private audioCtxOut: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private playHead = 0;
  private muted = false;
  private closed = false;
  private listeners = new Set<(e: LiveEvent) => void>();
  private currentAiText = "";
  private currentUserText = "";

  on(cb: (e: LiveEvent) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit(e: LiveEvent) {
    for (const l of this.listeners) l(e);
  }
  private setStatus(s: LiveStatus) {
    this.emit({ type: "status", status: s });
  }

  setMuted(m: boolean) {
    this.muted = m;
  }

  async start(): Promise<void> {
    this.setStatus("connecting");

    // Auth token for the WS proxy.
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      this.emit({ type: "error", message: "Not signed in" });
      this.setStatus("error");
      return;
    }

    // Probe proxy config first so we can surface a clear reason if mis-wired.
    try {
      const probe = await fetch("/api/gemini-live", { method: "GET" });
      if (probe.ok) {
        const j = (await probe.json()) as {
          ok: boolean;
          hasGeminiKey: boolean;
          hasSupabaseEnv: boolean;
          hasWebSocketPair: boolean;
        };
        if (!j.ok) {
          const missing: string[] = [];
          if (!j.hasGeminiKey) missing.push("GEMINI_API_KEY");
          if (!j.hasSupabaseEnv) missing.push("SUPABASE env");
          if (!j.hasWebSocketPair) missing.push("WebSocket runtime");
          this.emit({
            type: "error",
            message: `Voice not available: missing ${missing.join(", ")}. Try Chat mode instead.`,
          });
          this.setStatus("error");
          return;
        }
      }
    } catch {
      /* probe is best-effort; continue to WS attempt */
    }

    // Mic permission first.
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch {
      this.emit({ type: "error", message: "Microphone permission denied" });
      this.setStatus("error");
      return;
    }

    // Set up output AudioContext at 24 kHz (Gemini Live output rate).
    this.audioCtxOut = new AudioContext({ sampleRate: 24000 });
    this.playHead = this.audioCtxOut.currentTime;

    // Set up input AudioContext + worklet.
    this.audioCtxIn = new AudioContext();
    const blob = new Blob([WORKLET_SRC], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      await this.audioCtxIn.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    this.sourceNode = this.audioCtxIn.createMediaStreamSource(this.micStream);
    this.workletNode = new AudioWorkletNode(this.audioCtxIn, "pcm-capture");
    this.workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (this.muted || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const bytes = new Uint8Array(e.data);
      const data = b64encode(bytes);
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data }],
          },
        }),
      );
    };
    this.sourceNode.connect(this.workletNode);
    // Do not connect worklet to destination (don't echo mic to speakers).

    // Open WS proxy.
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${location.host}/api/gemini-live?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      // Send setup.
      ws.send(
        JSON.stringify({
          setup: {
            model: MODEL,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
              },
            },
            systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
            tools: LIVE_TOOLS,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        }),
      );
      this.setStatus("listening");
    };

    ws.onmessage = async (e) => {
      let msg: Record<string, unknown>;
      if (typeof e.data === "string") {
        try { msg = JSON.parse(e.data); } catch { return; }
      } else if (e.data instanceof Blob) {
        try { msg = JSON.parse(await e.data.text()); } catch { return; }
      } else {
        return;
      }
      void this.handleServerMessage(msg);
    };

    ws.onerror = () => {
      this.emit({ type: "error", message: "Connection error" });
      this.setStatus("error");
    };
    ws.onclose = () => {
      if (!this.closed) this.setStatus("idle");
    };
  }

  private async handleServerMessage(msg: Record<string, unknown>) {
    // serverContent: audio chunks + text + turn complete
    const sc = msg.serverContent as Record<string, unknown> | undefined;
    if (sc) {
      if (sc.interrupted) {
        // Stop currently scheduled audio by resetting the play head.
        if (this.audioCtxOut) this.playHead = this.audioCtxOut.currentTime;
      }
      const modelTurn = sc.modelTurn as { parts?: Array<Record<string, unknown>> } | undefined;
      if (modelTurn?.parts) {
        for (const part of modelTurn.parts) {
          const inline = part.inlineData as { mimeType?: string; data?: string } | undefined;
          if (inline?.data && inline.mimeType?.startsWith("audio/")) {
            this.setStatus("speaking");
            this.playPcm(b64decode(inline.data));
          }
          if (typeof part.text === "string" && part.text) {
            this.currentAiText += part.text;
            this.emit({ type: "ai_text", text: this.currentAiText, partial: true });
          }
        }
      }
      // Input transcription stream (user's spoken words).
      const inputTx = sc.inputTranscription as { text?: string } | undefined;
      if (inputTx?.text) {
        this.currentUserText += inputTx.text;
        this.emit({ type: "user_text", text: this.currentUserText, partial: true });
      }
      // Output transcription stream (what the model is saying aloud).
      const outputTx = sc.outputTranscription as { text?: string } | undefined;
      if (outputTx?.text) {
        this.currentAiText += outputTx.text;
        this.emit({ type: "ai_text", text: this.currentAiText, partial: true });
      }
      if (sc.turnComplete) {
        if (this.currentUserText.trim()) {
          this.emit({ type: "user_text", text: this.currentUserText.trim(), partial: false });
          this.currentUserText = "";
        }
        if (this.currentAiText.trim()) {
          this.emit({ type: "ai_text", text: this.currentAiText.trim(), partial: false });
          this.currentAiText = "";
        }
        this.setStatus("listening");
      }
    }

    // toolCall -> dispatch -> send toolResponse
    const tc = msg.toolCall as { functionCalls?: Array<{ id?: string; name: string; args?: Record<string, unknown> }> } | undefined;
    if (tc?.functionCalls?.length) {
      this.setStatus("thinking");
      const functionResponses: Array<{ id?: string; name: string; response: { output: unknown } }> = [];
      for (const call of tc.functionCalls) {
        try {
          if (call.name === "navigate") {
            const route = (call.args?.route as string) ?? "/";
            this.emit({ type: "action", action: { type: "navigate", to: route } });
            functionResponses.push({ id: call.id, name: call.name, response: { output: { ok: true } } });
            continue;
          }
          const out = await dispatchAiTool({ data: { name: call.name, args: call.args ?? {} } });
          const parsed = JSON.parse(out.json) as { result: unknown; action?: { type: "navigate"; to: string } };
          if (parsed.action?.type === "navigate") this.emit({ type: "action", action: parsed.action });
          functionResponses.push({ id: call.id, name: call.name, response: { output: parsed.result } });
        } catch (err) {
          functionResponses.push({
            id: call.id,
            name: call.name,
            response: { output: { ok: false, error: (err as Error).message } },
          });
        }
      }
      this.ws?.send(JSON.stringify({ toolResponse: { functionResponses } }));
    }
  }

  private playPcm(pcm16: Uint8Array) {
    const ctx = this.audioCtxOut;
    if (!ctx) return;
    // pcm16 is 16-bit LE mono @ 24kHz.
    const samples = pcm16.length / 2;
    const buf = ctx.createBuffer(1, samples, 24000);
    const channel = buf.getChannelData(0);
    const view = new DataView(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
    for (let i = 0; i < samples; i++) {
      channel[i] = view.getInt16(i * 2, true) / 0x8000;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, this.playHead);
    src.start(startAt);
    this.playHead = startAt + buf.duration;
  }

  async stop() {
    this.closed = true;
    try { this.ws?.close(); } catch { /* noop */ }
    try { this.workletNode?.disconnect(); } catch { /* noop */ }
    try { this.sourceNode?.disconnect(); } catch { /* noop */ }
    try { this.micStream?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    try { await this.audioCtxIn?.close(); } catch { /* noop */ }
    try { await this.audioCtxOut?.close(); } catch { /* noop */ }
    this.ws = null;
    this.workletNode = null;
    this.sourceNode = null;
    this.micStream = null;
    this.audioCtxIn = null;
    this.audioCtxOut = null;
    this.setStatus("idle");
  }
}
