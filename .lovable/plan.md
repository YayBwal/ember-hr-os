## Audit ရလဒ် — ဘာတွေ glitch ဖြစ်နေပြီး ဘာတွေ မလိုပဲ နေနေသလဲ

အောက်က list က codebase တစ်ခုလုံး scan လုပ်ပြီး တွေ့ထားသမျှပါ။ severity ၃ မျိုးခွဲထားတယ်: **broken** (bug အစစ်)၊ **dead** (UI/handler မရှိတဲ့ code)၊ **redundant/low-value** (ထပ်နေတာ ဒါမှမဟုတ် အသုံးမဝင်တာ)။

### A. Broken — အရင်ဆုံး ပြင်ရမယ်

1. `**["kpis"]` queryKey တိုက်နေတယ်** (`dashboard.tsx:24` ↔ `operations.tsx:89`)
  - Dashboard က `employees` table ကနေ summary object ဆွဲ၊ Operations က `employee_kpis` table ကနေ array ဆွဲ — key တူနေတော့ cache တစ်ခုက တစ်ခုကို overwrite လုပ်တယ်။ Tab ပြောင်းတိုင်း data shape မှားနိုင်တယ်။
  - Fix: key ကို `["dashboard-kpis"]`၊ `["employee-kpis"]` လို့ ခွဲပစ်မယ်။
2. **Promote dialog က "mid" level ကို ဖျက်ထားလို့ demotion ဖြစ်နိုင်** (`financial.tsx:50`)
  - `LEVELS` array ထဲ `"mid"` မပါ → mid level ဝန်ထမ်းတွေ promote လုပ်ရင် default က `trainee` ဖြစ်သွားတယ်။
  - Fix: `nextLevel` တွက်တာနဲ့ level picker render တာ နှစ်နေရာစလုံးမှာ `mid → junior` ကို normalize လုပ်မယ်။
3. `**useMemo` ကို `useEffect` အသုံးပြုနေတယ်** (`financial.tsx:422–429`)
  - Promote form reset က React Strict Mode မှာ ၂ ခါ run နိုင်၊ မ run တာလည်း ဖြစ်နိုင်တယ်။ Form state မမှန်ဘဲ ဖြစ်တတ်တယ်။
  - Fix: `useEffect` ပြောင်းမယ်။

### B. Dead — UI မရှိတဲ့ code/feature များ

4. **Operations → Meetings tab က placeholder ပဲ** (`operations.tsx:540–553`)
  - "coming next round" ဆိုပြီး စာတမ်းတစ်ကြောင်းပဲ ပေါ်တယ်။
  - Fix: tab ကို ဖျက်ပစ်မယ် (နောက်လုပ်ချင်ရင်မှ ပြန်ထည့်)။
5. **Voice assistant ရဲ့ `highlight_candidates` action က no-op** (`voice-assistant.tsx:81–84`)
  - ID list လက်ခံပေမယ့် ဘာမှ မလုပ်ပါ။
  - Fix: action type ကို ဖျက်ပစ်ပြီး voice prompt ထဲကလည်း ထုတ်ပစ်မယ်။
6. **Promote dialog က `toPosition` ကို လက်ရှိ position နဲ့ပဲ ပို့နေတယ်** (`financial.tsx:462–470`)
  - Server fn က position လက်ခံပေမယ့် UI မှာ position input မရှိ။
  - Fix: dialog ထဲ position text field ထည့်မယ် (current value prefill)။
7. **Dead server functions သုံးခု** (`operations.functions.ts:80–120`)
  - `renameTeam`, `assignMember`, `removeMember` ဘယ်နေရာကမှ ခေါ်တာ မရှိ။
  - Fix: `renameTeam` ကို team detail sheet ထဲ rename button နဲ့ wire လုပ်မယ်။ `assignMember`/`removeMember` က `teams.functions.ts` က version နဲ့ ထပ်နေတာဖြစ်လို့ ဖျက်ပစ်မယ်။
8. `**addComment` + `task_comments` table က UI မရှိ** (`delivery.functions.ts:83`)
  - Fix: ယခု scope မဟုတ်လို့ server fn ကို ဖျက်မယ် (migration မထိ၊ table ကို လောလောဆယ် ထားမယ်)။

### C. Redundant / Low-value

9. **Task management UI က နှစ်နေရာ ထပ်နေတယ်**
  - Team Leader Hub ထဲ TasksSection (`team-leader.tsx:200`)
  - Operations → Teams → card click → TeamTasksTab (`team-detail-sheet.tsx:175`)
  - HR က Team detail မှာ task စီမံစရာ မလို။ Fix: `TeamTasksTab` ကို read-only summary (task count + နောက်ဆုံး status) ပဲ ပြမယ်။ Edit/create အလုပ်ကို Team Leader Hub တစ်ခုထဲ ထား။
10. **Productivity/Quality input နှစ်နေရာ မရှင်းသေး**
  - HR (EmployeeProfileSheet) က တိုက်ရိုက် `employee_kpis` ထဲ ရေး၊ TL (MemberRatingRow) က `member_ratings` ထဲ ရေး။
    - Fix: HR ဘက်က slider တွေကို label ပြောင်း — "HR Override (auto-recompute)" လို့ ထား၊ TL ဘက်က "Team Leader Rating" လို့ ထား။ Tooltip နဲ့ ဘယ်ဟာက ဘယ်လို တွက်တယ်ဆိုတာ ပြ။
11. `**overtime_mmk` ဆွဲထားပေမယ့် မပြ** (`financial.tsx:117`)
  - Fix: payroll table မှာ "Overtime" column ထည့်ပေးမယ် (data ရှိနေပြီးသား)။
12. `**salary_grade`, salary bands, peer reviews ကို တွေ့ဖို့ ခက်တယ်**
  - Peer review က ၄ ချက် နှိပ်မှ တွေ့ — Operations → Teams → card → tab။
    - Fix: Team detail sheet ဖွင့်ပြီး peer review tab ကို badge နဲ့ ထင်ထင်ရှားရှား ပြ။ Operations leaderboard မှာ "Pending reviews" အရေအတွက် badge ထည့်ပေး။
    - Salary bands UI က ယခု scope ထဲ မထည့်ပါ (separate effort)။

### Out of scope (ဒီ round မှာ မလုပ်ပါ)

- Database schema/migration ပြောင်းခြင်း
- `task_comments`, salary bands write UI အသစ်တည်ဆောက်ခြင်း
- Meetings AI feature တကယ်ဆောက်ခြင်း
- Voice assistant အသစ်ထပ်တိုးခြင်း

### ပြောင်းမယ့် ဖိုင်များ

- `src/routes/_authenticated/dashboard.tsx` — queryKey rename
- `src/routes/_authenticated/operations.tsx` — queryKey rename, Meetings tab ဖျက်
- `src/routes/_authenticated/financial.tsx` — `mid` normalize, `useEffect` ပြောင်း, position field ထည့်, overtime column ပြ
- `src/components/team-detail-sheet.tsx` — rename team button + tasks tab ကို read-only
- `src/components/voice-assistant.tsx` — `highlight_candidates` ဖျက်
- `src/lib/voice.functions.ts` — action type clean up
- `src/lib/operations.functions.ts` — `assignMember`/`removeMember` ဖျက်၊ `renameTeam` ထား
- `src/lib/delivery.functions.ts` — `addComment` ဖျက်
- `src/routes/_authenticated/team-leader.tsx` — UI labels (HR vs TL ratings ကို တကွဲချင်း ရှင်းအောင်)  
AI ကလွဲပြီး တစ်ခြား ပြင်ရမယ့် ၁၁ ခုလုံးပြင်ပါမယ် ပြင်ပြီးရင် ပြင်ပြီးကြောင်း summary ပြပေးပါ နောက်ပိုင်းမှာ AI assisant ကို upgrade လုပ်မာပါ

### စစ်ဆေးနည်း

ပြောင်းပြီးရင် Dashboard → Operations heat ပြောင်းကြည့်ပြီး KPI data shape မမှားသွားတာ၊ Promote dialog က Mid-level employee အတွက် Senior ကို default ပြတာ၊ Meetings tab ပျောက်နေတာ၊ Operations tasks tab က read-only ဖြစ်နေတာ၊ payroll မှာ overtime column ပေါ်နေတာ ၅ ချက် verify လုပ်မယ်။