import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createHash, timingSafeEqual } from "crypto";
import { tgSendMessage, ratingKeyboard, mainMenuKeyboard, removeKeyboard } from "@/lib/telegram.server";

function deriveSecret(apiKey: string) {
  return createHash("sha256").update(`telegram-webhook:${apiKey}`).digest("base64url");
}
function safeEq(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

type SessionState = {
  step?:
    | "await_code"
    | "menu"
    | "survey_pick"
    | "survey_answer"
    | "report_subject"
    | "report_category"
    | "report_description";
  employee_id?: string;
  department?: string;
  survey_id?: string;
  question_ids?: string[];
  q_index?: number;
  report?: { subject?: string; category?: string };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: any = null;
function sb() {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

async function getSession(chatId: number): Promise<SessionState> {
  const { data } = await sb().from("telegram_sessions").select("state").eq("chat_id", chatId).maybeSingle();
  return ((data?.state as SessionState) ?? {}) as SessionState;
}
async function setSession(chatId: number, state: SessionState, org_id?: string | null) {
  await sb()
    .from("telegram_sessions")
    .upsert({ chat_id: chatId, state: state as never, org_id: org_id ?? null, updated_at: new Date().toISOString() });
}
async function clearSession(chatId: number) {
  await sb().from("telegram_sessions").delete().eq("chat_id", chatId);
}

async function startMenu(chatId: number) {
  await tgSendMessage(
    chatId,
    "What would you like to do?\n\n📋 Take Survey — answer active surveys\n⚠️ Report Incident — anonymously report bullying or misconduct",
    mainMenuKeyboard(),
  );
}

async function startSurvey(chatId: number, state: SessionState) {
  const { data: surveys } = await sb()
    .from("surveys")
    .select("id, title")
    .eq("status", "active")
    .order("created_at", { ascending: false });
  if (!surveys || surveys.length === 0) {
    await tgSendMessage(chatId, "No active surveys right now. Check back later.", mainMenuKeyboard());
    state.step = "menu";
    await setSession(chatId, state);
    return;
  }
  const keyboard = surveys.map((s: any) => [{ text: s.title as string }]);
  keyboard.push([{ text: "❌ Cancel" }]);
  state.step = "survey_pick";
  await setSession(chatId, state);
  await tgSendMessage(chatId, "Pick a survey:", { reply_markup: { keyboard, resize_keyboard: true, one_time_keyboard: true } });
}

async function askNextQuestion(chatId: number, state: SessionState) {
  const idx = state.q_index ?? 0;
  const qid = state.question_ids?.[idx];
  if (!qid) {
    await tgSendMessage(chatId, "✅ Thanks! Your responses were submitted anonymously.", mainMenuKeyboard());
    state.step = "menu";
    state.survey_id = undefined;
    state.question_ids = undefined;
    state.q_index = undefined;
    await setSession(chatId, state);
    return;
  }
  const { data: q } = await sb()
    .from("survey_questions")
    .select("question_text, question_type")
    .eq("id", qid)
    .maybeSingle();
  if (!q) {
    state.q_index = idx + 1;
    await setSession(chatId, state);
    return askNextQuestion(chatId, state);
  }
  const extra = q.question_type === "rating" ? ratingKeyboard() : removeKeyboard();
  await tgSendMessage(chatId, `Q${idx + 1}. ${q.question_text}`, extra);
}

async function handleMessage(update: { update_id: number; message?: { chat: { id: number }; from?: { id?: number }; text?: string } }) {
  const msg = update.message;
  if (!msg?.chat?.id) return;
  const chatId = msg.chat.id;
  const text = (msg.text ?? "").trim();
  let state = await getSession(chatId);

  // Resolve linked employee
  const { data: emp } = await sb()
    .from("employees")
    .select("id, full_name, department, org_id")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();

  // /start or unlinked
  if (text === "/start" || !emp) {
    if (!emp) {
      state = { step: "await_code" };
      await setSession(chatId, state);
      await tgSendMessage(
        chatId,
        "👋 Welcome to the HR Feedback Bot.\n\nPlease send your <b>Employee ID</b> to link your account.",
        removeKeyboard(),
      );
      return;
    }
    state = { step: "menu", employee_id: emp.id as string, department: emp.department as string };
    await setSession(chatId, state, emp.org_id as string);
    await tgSendMessage(chatId, `Hi <b>${emp.full_name}</b> 👋`, removeKeyboard());
    return startMenu(chatId);
  }

  // Cancel
  if (text === "❌ Cancel" || text === "/cancel") {
    state = { step: "menu", employee_id: emp.id as string, department: emp.department as string };
    await setSession(chatId, state, emp.org_id as string);
    return startMenu(chatId);
  }

  // Await code (shouldn't reach here since emp exists, but for safety)
  if (state.step === "await_code") {
    const { data: match } = await sb()
      .from("employees")
      .select("id, full_name, department, org_id")
      .eq("employee_code", text)
      .maybeSingle();
    if (!match) {
      return tgSendMessage(chatId, "❌ Employee ID not found. Please check with HR and try again.");
    }
    await sb().from("employees").update({ telegram_chat_id: chatId }).eq("id", match.id as string);
    state = { step: "menu", employee_id: match.id as string, department: match.department as string };
    await setSession(chatId, state, match.org_id as string);
    await tgSendMessage(chatId, `✅ Linked! Hi <b>${match.full_name}</b>.`);
    return startMenu(chatId);
  }

  // Menu choices
  if (text === "📋 Take Survey") return startSurvey(chatId, state);
  if (text === "⚠️ Report Incident") {
    state.step = "report_subject";
    state.report = {};
    await setSession(chatId, state);
    return tgSendMessage(
      chatId,
      "Anonymous incident report.\n\nWho is the report about? Send their <b>name or Employee ID</b>.\n(Type 'skip' to omit.)",
      removeKeyboard(),
    );
  }

  // Survey pick
  if (state.step === "survey_pick") {
    const { data: surveys } = await sb().from("surveys").select("id, title").eq("status", "active");
    const picked = surveys?.find((s: any) => (s.title as string) === text);
    if (!picked) return tgSendMessage(chatId, "Please tap one of the survey buttons.");
    const { data: qs } = await sb()
      .from("survey_questions")
      .select("id")
      .eq("survey_id", picked.id as string)
      .order("sort_order");
    state.step = "survey_answer";
    state.survey_id = picked.id as string;
    state.question_ids = (qs ?? []).map((q: any) => q.id as string);
    state.q_index = 0;
    await setSession(chatId, state);
    return askNextQuestion(chatId, state);
  }

  // Survey answer
  if (state.step === "survey_answer" && state.survey_id && state.question_ids) {
    const idx = state.q_index ?? 0;
    const qid = state.question_ids[idx];
    const { data: q } = await sb().from("survey_questions").select("question_type").eq("id", qid).maybeSingle();
    const qType = (q?.question_type as string) ?? "text";
    let rating: number | null = null;
    let comment: string | null = null;
    if (qType === "rating") {
      const n = parseInt(text, 10);
      if (!Number.isFinite(n) || n < 1 || n > 5) return tgSendMessage(chatId, "Please rate 1–5.", ratingKeyboard());
      rating = n;
    } else {
      comment = text;
    }
    await sb().from("feedback_responses").insert({
      survey_id: state.survey_id,
      question_id: qid,
      department: state.department ?? null,
      rating_value: rating,
      text_comment: comment,
    });
    state.q_index = idx + 1;
    await setSession(chatId, state);
    return askNextQuestion(chatId, state);
  }

  // Incident report flow
  if (state.step === "report_subject") {
    state.report = state.report ?? {};
    if (text.toLowerCase() !== "skip") state.report.subject = text;
    state.step = "report_category";
    await setSession(chatId, state);
    return tgSendMessage(chatId, "Category? (e.g. Bullying, Harassment, Misconduct, Other)", {
      reply_markup: {
        keyboard: [[{ text: "Bullying" }, { text: "Harassment" }], [{ text: "Misconduct" }, { text: "Other" }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  }
  if (state.step === "report_category") {
    state.report = state.report ?? {};
    state.report.category = text;
    state.step = "report_description";
    await setSession(chatId, state);
    return tgSendMessage(chatId, "Please describe what happened. Your name will <b>not</b> be stored.", removeKeyboard());
  }
  if (state.step === "report_description") {
    const subj = state.report?.subject ?? null;
    // Try resolve to employee by code or name
    let subject_employee_code: string | null = null;
    let subject_name: string | null = subj;
    if (subj) {
      const { data: byCode } = await sb()
        .from("employees")
        .select("employee_code, full_name")
        .eq("employee_code", subj)
        .maybeSingle();
      if (byCode) {
        subject_employee_code = byCode.employee_code as string;
        subject_name = byCode.full_name as string;
      }
    }
    await sb().from("employee_incident_reports").insert({
      org_id: emp.org_id as string,
      reporter_department: state.department ?? null,
      subject_employee_code,
      subject_name,
      category: state.report?.category ?? null,
      description: text,
    });
    state = { step: "menu", employee_id: emp.id as string, department: emp.department as string };
    await setSession(chatId, state, emp.org_id as string);
    await tgSendMessage(chatId, "✅ Report submitted anonymously. HR will review it. Thank you for speaking up.");
    return startMenu(chatId);
  }

  // Default → show menu
  return startMenu(chatId);
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.TELEGRAM_API_KEY;
        if (!apiKey) return new Response("Not configured", { status: 503 });
        const expected = deriveSecret(apiKey);
        const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEq(got, expected)) return new Response("Unauthorized", { status: 401 });
        const update = await request.json().catch(() => null);
        if (!update) return new Response("Bad request", { status: 400 });
        try {
          await handleMessage(update);
        } catch (e) {
          console.error("telegram webhook error", e);
        }
        return Response.json({ ok: true });
      },
      GET: async () => Response.json({ ok: true, info: "telegram webhook" }),
    },
  },
});
