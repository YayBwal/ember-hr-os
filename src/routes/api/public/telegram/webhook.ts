import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createHash, timingSafeEqual, randomUUID } from "crypto";
import { tgCall, tgSendMessage, ratingKeyboard, mainMenuKeyboard, removeKeyboard } from "@/lib/telegram.server";
import { ROLE_PRESETS } from "@/lib/roles";

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
    | "report_description"
    | "apply_pick_role"
    | "apply_await_cv";
  employee_id?: string;
  department?: string;
  survey_id?: string;
  question_ids?: string[];
  q_index?: number;
  report?: { subject?: string; category?: string };
  apply_role?: string;
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

async function startMenu(chatId: number) {
  await tgSendMessage(
    chatId,
    "What would you like to do?\n\n📋 Take Survey — answer active surveys\n⚠️ Report Incident — anonymously report bullying or misconduct",
    mainMenuKeyboard(),
  );
}

function rolesKeyboard() {
  const rows: { text: string }[][] = [];
  for (let i = 0; i < ROLE_PRESETS.length; i += 2) {
    rows.push(ROLE_PRESETS.slice(i, i + 2).map((r) => ({ text: r })));
  }
  rows.push([{ text: "❌ Cancel" }]);
  return { reply_markup: { keyboard: rows, resize_keyboard: true, one_time_keyboard: true } };
}

async function startApply(chatId: number) {
  const state: SessionState = { step: "apply_pick_role" };
  await setSession(chatId, state);
  await tgSendMessage(
    chatId,
    "📄 <b>Apply for a position</b>\n\nPick the position you'd like to apply for:",
    rolesKeyboard(),
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// Download a Telegram document via the connector gateway and return bytes + filename.
async function downloadTelegramFile(fileId: string): Promise<{ bytes: Buffer; filename: string; mime: string }> {
  const fileResp = await tgCall("getFile", { file_id: fileId });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filePath = (fileResp as any)?.result?.file_path as string | undefined;
  if (!filePath) throw new Error("Telegram getFile returned no file_path");

  const lov = process.env.LOVABLE_API_KEY!;
  const tg = process.env.TELEGRAM_API_KEY!;
  const dl = await fetch(`https://connector-gateway.lovable.dev/telegram/file/${filePath}`, {
    headers: { Authorization: `Bearer ${lov}`, "X-Connection-Api-Key": tg },
  });
  if (!dl.ok) throw new Error(`Telegram file download failed [${dl.status}]`);
  const ab = await dl.arrayBuffer();
  const filename = filePath.split("/").pop() ?? "cv.pdf";
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const mime = ext === "pdf" ? "application/pdf" : `application/octet-stream`;
  return { bytes: Buffer.from(ab), filename, mime };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCvUpload(chatId: number, state: SessionState, doc: any) {
  const role = state.apply_role;
  if (!role) {
    await tgSendMessage(chatId, "Please start with /apply and pick a position first.", removeKeyboard());
    return;
  }
  const fileName = String(doc?.file_name ?? "cv.pdf");
  const mime = String(doc?.mime_type ?? "");
  const size = Number(doc?.file_size ?? 0);
  const isPdf = mime === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    await tgSendMessage(
      chatId,
      "❌ Please send your CV as a <b>PDF</b> file. (If you have a Word doc, export it as PDF first.)",
    );
    return;
  }
  if (size > 15 * 1024 * 1024) {
    await tgSendMessage(chatId, "❌ File is too large. Please send a CV under 15 MB.");
    return;
  }

  await tgSendMessage(chatId, "⏳ Got it — reading your CV and scoring it…", removeKeyboard());

  try {
    const { bytes } = await downloadTelegramFile(doc.file_id as string);
    const storagePath = `${chatId}/${randomUUID()}.pdf`;

    // Upload to private candidate-cvs bucket
    const { error: upErr } = await sb().storage.from("candidate-cvs").upload(storagePath, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (upErr) throw new Error(upErr.message);

    // Pick an org to attach to (single-org system uses Mandai; first one wins).
    const { data: org } = await sb().from("organizations").select("id").limit(1).maybeSingle();
    const orgId = (org?.id as string | undefined) ?? null;
    if (!orgId) throw new Error("No organization configured");

    // Insert candidate row in screening
    const { data: created, error: insErr } = await sb()
      .from("candidates")
      .insert({
        org_id: orgId,
        full_name: "(parsing…)",
        email: null,
        role_applied: role,
        status: "screening",
        ai_match_score: 0,
        skills: [],
        next_action: "AI scoring…",
        notes: null,
        source: "telegram",
        telegram_chat_id: chatId,
        cv_storage_path: storagePath,
      })
      .select("id")
      .single();
    if (insErr || !created) throw new Error(insErr?.message ?? "Insert failed");

    // AI scoring (best-effort; row already exists if this fails)
    try {
      const { scoreTelegramCv } = await import("@/lib/cv-intake.server");
      const parsed = await scoreTelegramCv({
        candidate_id: created.id as string,
        storage_path: storagePath,
        role,
      });

      // Duplicate-email guard: prevent spamming applications from the same Gmail
      if (parsed.email) {
        const normalizedEmail = parsed.email.trim().toLowerCase();
        const { data: dupes } = await sb()
          .from("candidates")
          .select("id, role_applied, created_at, status")
          .ilike("email", normalizedEmail)
          .neq("id", created.id as string)
          .order("created_at", { ascending: false });
        const others = dupes ?? [];
        if (others.length > 0) {
          // Remove the new duplicate row and uploaded CV
          await sb().from("candidates").delete().eq("id", created.id as string);
          await sb().storage.from("candidate-cvs").remove([storagePath]).catch(() => {});

          const sameRole = others.find((o: { role_applied: string | null }) => (o.role_applied ?? "") === role);
          const tooMany = others.length >= 3;
          const msg = tooMany
            ? `⚠️ <b>Too many applications</b>\n\nWe've received <b>${others.length}</b> applications from <code>${escapeHtml(parsed.email)}</code> already. Please wait for our team to review them before applying again.`
            : sameRole
              ? `ℹ️ You've already applied for <b>${escapeHtml(role)}</b> with <code>${escapeHtml(parsed.email)}</code>. Your previous application is still on file — no need to re-apply.`
              : `ℹ️ We already have an application from <code>${escapeHtml(parsed.email)}</code> on file. To avoid duplicates we kept your earlier one. Reach out to HR if you'd like to switch positions.`;
          await tgSendMessage(chatId, msg, mainMenuKeyboard());
          await setSession(chatId, { step: "menu", apply_role: undefined });
          return;
        }
      }

      await tgSendMessage(
        chatId,
        `✅ <b>CV received for ${escapeHtml(role)}</b>\n\nMatch score: <b>${parsed.ai_match_score}%</b>\nWe'll be in touch — thanks for applying!`,
        mainMenuKeyboard(),
      );
    } catch (e) {
      console.error("cv scoring failed", e);
      await tgSendMessage(
        chatId,
        `✅ <b>CV received for ${escapeHtml(role)}</b>\n\nOur team will review it shortly. Thanks for applying!`,
        mainMenuKeyboard(),
      );
    }


    await setSession(chatId, { step: "menu", apply_role: undefined });
  } catch (e) {
    console.error("telegram CV upload failed", e);
    await tgSendMessage(
      chatId,
      "❌ Sorry — we couldn't process that file. Please try again with a PDF under 15 MB.",
    );
  }
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleMessage(update: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msg = (update.message ?? update.edited_message) as any;
  if (!msg?.chat?.id) return;
  const chatId = msg.chat.id as number;
  const text = (msg.text ?? "").toString().trim();
  let state = await getSession(chatId);

  // Document upload (CV)
  if (msg.document && state.step === "apply_await_cv") {
    return handleCvUpload(chatId, state, msg.document);
  }
  if (msg.document && state.step !== "apply_await_cv") {
    await tgSendMessage(
      chatId,
      "📄 To submit a CV, send /apply first and pick a position.",
    );
    return;
  }

  // Resolve linked employee
  const { data: emp } = await sb()
    .from("employees")
    .select("id, full_name, department, org_id")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();

  // /apply — open to everyone, no employee link required
  if (text === "/apply") {
    return startApply(chatId);
  }

  // /help
  if (text === "/help") {
    await tgSendMessage(
      chatId,
      [
        "ℹ️ <b>HR Bot — Help</b>",
        "",
        "<b>Applying for a job</b>",
        "1. Send /apply",
        "2. Pick the position",
        "3. Upload your CV as a <b>PDF</b> (max 15 MB)",
        "",
        "<b>Employees: link your account</b>",
        "1. Send /start",
        "2. Reply with your Employee ID (e.g. <code>EMP-1234</code>)",
        "3. You can then take surveys or report incidents anonymously",
        "",
        "<b>Commands</b>",
        "/apply — apply for a job",
        "/start — begin or restart linking",
        "/help — show this message",
        "/cancel — cancel the current action",
      ].join("\n"),
      removeKeyboard(),
    );
    return;
  }

  // Apply: pick a role
  if (state.step === "apply_pick_role") {
    if (text === "❌ Cancel" || text === "/cancel") {
      await setSession(chatId, { step: undefined });
      await tgSendMessage(chatId, "Cancelled.", removeKeyboard());
      return;
    }
    const picked = ROLE_PRESETS.find((r) => r === text);
    if (!picked) {
      await tgSendMessage(chatId, "Please tap one of the position buttons.", rolesKeyboard());
      return;
    }
    state = { step: "apply_await_cv", apply_role: picked };
    await setSession(chatId, state);
    await tgSendMessage(
      chatId,
      `📎 Great. Now upload your CV (<b>PDF</b>, max 15 MB) for <b>${escapeHtml(picked)}</b>.`,
      removeKeyboard(),
    );
    return;
  }

  if (state.step === "apply_await_cv") {
    if (text === "❌ Cancel" || text === "/cancel") {
      await setSession(chatId, { step: undefined, apply_role: undefined });
      await tgSendMessage(chatId, "Application cancelled.", removeKeyboard());
      return;
    }
    await tgSendMessage(
      chatId,
      "Please upload your CV as a <b>PDF document</b>. Use the 📎 attach button in Telegram.",
    );
    return;
  }

  // /start always greets; unlinked users go through code lookup below
  if (text === "/start") {
    if (emp) {
      state = { step: "menu", employee_id: emp.id as string, department: emp.department as string };
      await setSession(chatId, state, emp.org_id as string);
      await tgSendMessage(chatId, `Hi <b>${emp.full_name}</b> 👋`, removeKeyboard());
      return startMenu(chatId);
    }
    state = { step: "await_code" };
    await setSession(chatId, state);
    await tgSendMessage(
      chatId,
      "👋 Welcome.\n\n• Send /apply to apply for an open position.\n• If you're an employee, send your <b>Employee ID</b> to link your account (e.g. EMP-1234).",
      removeKeyboard(),
    );
    return;
  }

  // Unlinked: try to treat any incoming text as an Employee ID
  if (!emp) {
    const code = text;
    const { data: match } = await sb()
      .from("employees")
      .select("id, full_name, department, org_id")
      .eq("employee_code", code)
      .maybeSingle();
    if (!match) {
      await tgSendMessage(
        chatId,
        "Not recognised. Send /apply to apply for a job, or send your <b>Employee ID</b> (e.g. EMP-1234) to link as an employee.",
        removeKeyboard(),
      );
      return;
    }
    await sb().from("employees").update({ telegram_chat_id: chatId }).eq("id", match.id as string);
    state = { step: "menu", employee_id: match.id as string, department: match.department as string };
    await setSession(chatId, state, match.org_id as string);
    await tgSendMessage(chatId, `✅ Linked! Hi <b>${match.full_name}</b>.`);
    return startMenu(chatId);
  }

  // Cancel
  if (text === "❌ Cancel" || text === "/cancel") {
    state = { step: "menu", employee_id: emp.id as string, department: emp.department as string };
    await setSession(chatId, state, emp.org_id as string);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const picked = surveys?.find((s: any) => (s.title as string) === text);
    if (!picked) return tgSendMessage(chatId, "Please tap one of the survey buttons.");
    const { data: qs } = await sb()
      .from("survey_questions")
      .select("id")
      .eq("survey_id", picked.id as string)
      .order("sort_order");
    state.step = "survey_answer";
    state.survey_id = picked.id as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
