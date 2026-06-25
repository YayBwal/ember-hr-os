// Server-only helpers for Telegram Bot API via Lovable connector gateway.
const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

export async function tgCall(method: string, body: Record<string, unknown>) {
  const lov = process.env.LOVABLE_API_KEY;
  const tg = process.env.TELEGRAM_API_KEY;
  if (!lov) throw new Error("LOVABLE_API_KEY not configured");
  if (!tg) throw new Error("TELEGRAM_API_KEY not configured (link Telegram connector)");
  const res = await fetch(`${GATEWAY_URL}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lov}`,
      "X-Connection-Api-Key": tg,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Telegram ${method} failed [${res.status}]: ${JSON.stringify(json)}`);
  return json;
}

export async function tgSendMessage(chatId: number | string, text: string, extra: Record<string, unknown> = {}) {
  return tgCall("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}

export function ratingKeyboard() {
  return {
    reply_markup: {
      keyboard: [[{ text: "1" }, { text: "2" }, { text: "3" }, { text: "4" }, { text: "5" }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  };
}

export function mainMenuKeyboard() {
  return {
    reply_markup: {
      keyboard: [[{ text: "📋 Take Survey" }, { text: "⚠️ Report Incident" }], [{ text: "❌ Cancel" }]],
      resize_keyboard: true,
    },
  };
}

export function removeKeyboard() {
  return { reply_markup: { remove_keyboard: true } };
}
