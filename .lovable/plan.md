
# Voice AI "Connecting…" Stuck Issue — Final Fix Plan

## ပြဿနာရဲ့ အမြစ်

Network probe က ဒီ response ပြန်လာတယ်:
```json
{"ok":true,"hasGeminiKey":true,"hasSupabaseEnv":true,"hasWebSocketPair":false}
```

`hasWebSocketPair:false` ဆိုတာ — **Lovable Cloud ရဲ့ TanStack Start server runtime က WebSocket server-side proxy ကို မထောက်ပံ့ဘူး**။ ဒါက ကျွန်တော်တို့ရဲ့ ယခုလက်ရှိ approach (browser → `/api/gemini-live` proxy → Gemini) ဟာ ဘယ်လိုပဲပြင်ပြင် အလုပ်လုပ်မှာမဟုတ်ဘူး။ Probe က ဒီ runtime မှာ WS infrastructure မရှိဘူးလို့ ဘောက်ပေးနေတယ်။

ပြီးခဲ့တဲ့ turn မှာ probe check ကိုပဲ ပိတ်ထားလိုက်တဲ့အတွက် — UI က "Voice not available" မပြတော့ဘဲ၊ ဒါပေမယ့် WebSocket connection ကိုယ်တိုင်က server မှာ fail ဖြစ်နေတဲ့အတွက် browser က "connecting" မှာ ထိုင်နေတာ။

## Solution: Browser-Direct + Ephemeral Token

**Proxy ဖျက်ပြီး၊ browser က Gemini ကို တိုက်ရိုက်ချိတ်တယ်။** Server က ephemeral token (1 မိနစ်တိုသော) ပဲ ထုတ်ပေးတယ်။ ဒါက Google ကိုယ်တိုင်က Live API client app တွေအတွက် ရည်ရွယ်ထားတဲ့ official pattern ပါ။

```text
လက်ရှိ (broken):
  Browser ─[WS]→ /api/gemini-live (Lovable Cloud) ─[WS]→ Gemini Live
                  ↑ WebSocketPair မထောက်ပံ့ → fail

အသစ် (works):
  Browser ─[HTTPS]→ /api/gemini-token (mint ephemeral) ─→ ✓
  Browser ─[WSS]→ Gemini Live (ephemeral token နဲ့) ─→ ✓
```

**ဘာကြောင့်အလုပ်လုပ်လဲ:**
- TanStack server route က ephemeral token mint တာက ရိုးရိုး HTTPS POST တစ်ခုပဲ — WebSocketPair မလို
- Browser က Gemini ကို တိုက်ရိုက် WSS ချိတ်တာက browser native WebSocket — Lovable runtime ကို လုံးဝ မဖြတ်တော့ဘူး
- API key က server မှာ ဆက်လုံခြုံတယ် (token ပဲ browser ကို ပေးတယ်)

## ပြောင်းရမယ့်အရာများ

### 1. Server: Token mint endpoint အသစ်
**File:** `src/routes/api/gemini-token.ts` (`gemini-live.ts` ကို အစားထိုး)

- Supabase user verify လုပ်
- Google REST API `POST https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=<GEMINI_API_KEY>` ခေါ်
- Body မှာ session config (model, voice, tools, system instruction) ထည့်
- Ephemeral `name` (token string) ပြန်ပေး — expire = 60 seconds, session lock = 10 minutes
- `gemini-live.ts` ဖျက်

### 2. Client: Direct WebSocket connection
**File:** `src/lib/gemini-live-client.ts`

- `/api/gemini-token` POST ခေါ်ပြီး ephemeral token ရယူ
- `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?access_token=<token>` ကို တိုက်ရိုက်ချိတ်
- Setup message၊ audio streaming၊ tool calls လုပ်ငန်းစဉ်အကုန် ယခုလို ဆက်လုပ်
- Token mint တုန်း error ဆို မှန်ကန်စွာ surface လုပ်

### 3. UI: Diagnostic ပိုကောင်းအောင်
**File:** `src/components/assistant-dock.tsx`

- "Connecting" အပ်ပြီး 8 seconds ထက်ကြာရင် "Connection timed out — retry" ပြ
- Token mint failure (network/quota/key) သီးခြား error message ပြ

### 4. Cleanup
- `src/routes/api/gemini-live.ts` delete
- `src/lib/dispatch-tool.functions.ts` အလုပ်ဆက်လုပ်တာ — ပြောင်းစရာမလို
- Burmese system prompt၊ voice ("Aoede")၊ tools အကုန် ယခုလို ဆက်သုံး

## Technical Details

**Ephemeral token endpoint** (Google's official Live API auth pattern):
```ts
const res = await fetch(
  `https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=${GEMINI_API_KEY}`,
  { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expireTime: new Date(Date.now() + 60_000).toISOString(),
      newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
      bidiGenerateContentSetup: { model, generationConfig, systemInstruction, tools },
      uses: 1,
    })
  });
const { name } = await res.json(); // ephemeral token
```

**Browser WS** (no proxy):
```ts
const ws = new WebSocket(
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?access_token=${encodeURIComponent(name)}`
);
```

**Security:**
- `GEMINI_API_KEY` က server မှာပဲရှိ — browser ကို ဘယ်တုန်းကမှ မရောက်
- Ephemeral token က 60 seconds အတွင်းပဲ မှန် — leak ဖြစ်ရင်လည်း တန်ဖိုးမရှိ
- Token mint တိုင်း Supabase auth စစ်တယ် — sign-in မဝင်ထားတဲ့သူ မရ

## အောင်မြင်ပြီးပါပြီလို့ ဘာနဲ့စစ်မလဲ

1. Mic button နှိပ်တယ် → "Listening" status ပေါ်လာ (3 seconds အတွင်း)
2. ဗမာစကားပြောတယ် → transcript text live ပေါ်လာ
3. AI ပြန်ပြောတယ် → audio ထွက်လာ + transcript ပေါ်လာ
4. "KPI ဘယ်လောက်လဲ" မေးတယ် → tool call run + ဖြေတယ်
5. Console မှာ WebSocket 1006 closure မရှိ၊ probe error မရှိ

## အကျိုးကျေးဇူး

- ✅ **Works on Lovable Cloud** — WebSocketPair မလိုတော့ဘူး
- ✅ **Lower latency** — middle hop ဖျက်လိုက်တာကြောင့် ~50-100ms ပိုမြန်
- ✅ **Less code** — proxy route ~110 lines ဖျက်ပြီး token route ~40 lines နဲ့ အစားထိုး
- ✅ **Google's recommended pattern** — production app တွေအတွက် official approach
- ✅ **API key က server မှာပဲဆက်ရှိ** — security အတူတူ
