# Phase 2 — Gemini Multimodal Live S2S Upgrade Plan

## ⚠️ မစတင်ခင် သိထားရမယ့် အရေးကြီး အချက် ၂ ခု

### 1. မြန်မာစကား ပြန်ပြောနိုင်မလား?

**တိုက်ရိုက်အဖြေ — အပြည့်အဝ မရပါ (ယခုလောလောဆယ်)**

- Gemini Live API ရဲ့ **native audio output** က language ~24 ခုပဲ တရားဝင် support လုပ်ပါတယ် — အဲ့ထဲမှာ **မြန်မာစကား မပါသေး**ပါ။ (en, ja, ko, hi, id, vi, th, zh စတာတွေ ပါတယ်)
- **Input (နားထောင်တာ)** ဘက်ကတော့ မြန်မာစကား **နားလည်နိုင်ပါတယ်** — Gemini က Burmese text/audio understanding ရှိပါတယ်။
- ဒါကြောင့် Multimodal Live ကို တိုက်ရိုက်သုံးရင် —
  - User က မြန်မာလို ပြောတာ → AI က နားလည်တယ် ✅
  - AI က ပြန်ပြောတဲ့ အသံကတော့ **အင်္ဂလိပ်/တရုတ်/ထိုင်း လေသံနဲ့ မြန်မာစာ ဖတ်တာ** ဖြစ်လာနိုင်တယ် (ဆိုးတယ်) ❌

**ဖြေရှင်းနည်း ၃ ခု (ရွေးခိုင်းပါမယ်):**


| Option                                                                       | Latency     | မြန်မာအသံ အရည်အသွေး          | Cost     |
| ---------------------------------------------------------------------------- | ----------- | ---------------------------- | -------- |
| **A. Pure S2S (Gemini Live native audio)**                                   | ~300ms      | ညံ့ (မြန်မာအသံ မရိုးသား)     | သက်သာ    |
| **B. Hybrid — Live API audio-in + text-out → Burmese TTS**                   | ~700ms–1.2s | သင့်တင့် (လက်ရှိထက် တိုးတက်) | အလယ်အလတ် |
| **C. လက်ရှိ cascade ထား၊ STT ကိုသာ Gemini audio understanding နဲ့ အစားထိုး** | ~2s         | လက်ရှိ TTS အတိုင်း           | သက်သာ    |


ကျွန်တော် အကြံပြုချင်တာက **Option B** — မြန်မာစကားအတွက် S2S ရဲ့ latency အကျိုးကျေးဇူး ၇၀% ရပြီး အသံအရည်အသွေး မပျက်ပါ။

### 2. Infrastructure ပြောင်းရမှု

လက်ရှိ voice ကို ကြည့်တော့ **LiveKit token endpoint ရှိပေမယ့် browser က LiveKit ကို သုံးမနေပါ** — `voice-assistant.tsx` က Web Speech API (browser STT) + `voiceChat` serverFn (Gemini text) + browser `speechSynthesis` (TTS) ပဲ ဖြစ်ပါတယ်။

Multimodal Live ကို LiveKit `MultimodalAgent` + `google.RealtimeModel` နဲ့ run ဖို့ဆိုရင် —

- **LiveKit Agent worker (Python သို့ Node)** ကို သီးခြား deploy လုပ်ရပါမယ်။
- TanStack Start က Cloudflare Worker ပေါ်မှာ run နေတာမို့ Agent worker ကို **Worker ထဲမှာ run လို့ မရပါ** (long-lived process လိုတယ်)။
- Fly.io / Render / Railway / Cloud Run ပေါ်မှာ container တစ်ခု သီးခြားလို ဖြစ်ပါမယ်။

အကယ်၍ extra service မထည့်ချင်ဘူးဆိုရင် — **WebSocket တိုက်ရိုက် Gemini Live API နဲ့ ချိတ်တဲ့ နည်း** လည်း ရှိပါတယ် (LiveKit လုံးဝ မလို၊ ဒါပေမဲ့ interruption handling/VAD ကိုယ်တိုင် ရေးရတယ်)။

---

## ထို့ကြောင့် ပြန်လည် မေးချင်ပါတယ်

ဆုံးဖြတ်ချက် ၂ ခု လိုပါတယ်:

**မေး ၁ — Voice output အရည်အသွေး vs latency:**

- **A.** Gemini Live native audio (~300ms၊ ဒါပေမဲ့ မြန်မာ accent ဆိုးနိုင်) (A သုံးမယ်)
- **B.** Hybrid: Live audio-in + Burmese TTS out (~700ms၊ မြန်မာ accent ကောင်း) ← **အကြံပြု**
- **C.** STT သာ upgrade၊ ကျန်တာ မပြောင်း

**မေး ၂ — Infrastructure:**

- **X.** LiveKit Agent worker အသစ် deploy (Fly.io/Render) — official, robust၊ ဒါပေမဲ့ service တစ်ခု ထပ်ထည့်ရ
- **Y.** Browser ကနေ Gemini Live WebSocket တိုက်ရိုက်ခေါ် (server က ephemeral token ထုတ်ပေး) — service အသစ် မလို၊ feature နည်း
- **Z.** TanStack server function ထဲက relay (Cloudflare Worker WebSocket) — middle ground

---

## အကြံပြုထားတဲ့ Plan (B + Y combo) 

ထောက်ခံချက် မရသေးခင် implementation မလုပ်ပါ။ Approve ပြီးမှ အောက်ပါအတိုင်း လုပ်ပါမယ်:

### Step 1 — Server: Ephemeral token endpoint

`src/routes/api/gemini-live-token.ts` — auth-checked, short-lived Gemini Live API access token ထုတ်ပေး (LOVABLE_API_KEY ကို browser ကို မပေါ်စေဖို့)

### Step 2 — Client: Live WebSocket session

`src/lib/gemini-live-client.ts` — browser ထဲမှာ

- `getUserMedia` → PCM 16kHz frames
- WebSocket → `wss://generativelanguage.googleapis.com/.../BidiGenerateContent`
- Audio-in streaming, **text-out** streaming (audio response မယူ)
- Tool/function calling ကို existing `ai-tools.ts` ထဲက dispatcher နဲ့ ချိတ်
- Interruption handling (server VAD signals)

### Step 3 — Burmese TTS layer

- AI response text ထွက်လာရင် **chunk-by-chunk** (sentence boundary) `speechSynthesis` ဒါမှမဟုတ် server-side `openai/gpt-4o-mini-tts` ကို stream
- မြန်မာစာ ပါတဲ့အခါ browser native Burmese voice ကို prefer (လက်ရှိ logic ပြန်သုံး)

### Step 4 — `voice-assistant.tsx` ပြန်ရေး

- Web Speech API code ဖျက်
- Mic button နှိပ်ရင် Gemini Live session ဖွင့်
- Status: `connecting → listening → thinking → speaking` (interrupt-able)
- Transcript panel က user/AI text ကို realtime ပြ

### Step 5 — Fallback

- Browser က WebSocket / Opus encoder မ support ရင် လက်ရှိ cascade pipeline ပြန် fallback

### Step 6 — Cleanup

- LiveKit token endpoint + `livekit-server-sdk` dependency ဖျက် (မသုံးတော့)

### Out of scope

- LiveKit Agent worker deployment (Option X ရွေးမှ)
- Native audio output (Option A ရွေးမှ)
- Multi-speaker / multi-room features

### Risks

- Cloudflare Worker က WebSocket relay လုပ်ဖို့ DurableObject သုံးရနိုင် — ဒါပေမဲ့ browser → Gemini direct ဖြစ်ရင် မလို
- Gemini Live API quota/rate limit — error handling လို
- Audio frame format mismatch (PCM 16-bit LE 16kHz) — encoding bug ဖြစ်တတ်တယ်

---

**ဘယ် option ရွေးမလဲ ပြောပေးပါ (မေး ၁ + မေး ၂)၊ ပြီးရင် ဒီ plan ကို နောက်ဆုံး update လုပ်ပြီး implement လုပ်ပါမယ်။ A+Y combo သုံးကြည့်မယ် အဆင်မပြေရင် A+X combo**