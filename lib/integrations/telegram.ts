import { integrationMode, env } from "@/lib/env";

export type OutcomeButton = "acknowledge" | "held" | "no_show" | "not_fit" | "won";

export interface SendNoteInput {
  chatId: string;
  text: string;
  callId: string; // encoded into callback_data so the webhook can route outcomes
}

export interface SendNoteResult {
  messageId: string;
}

export interface TelegramClient {
  sendDesignerNote(input: SendNoteInput): Promise<SendNoteResult>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
}

const OUTCOME_BUTTONS: Array<{ label: string; action: OutcomeButton }> = [
  { label: "Acknowledge", action: "acknowledge" },
  { label: "Held", action: "held" },
  { label: "No-show", action: "no_show" },
  { label: "Not a fit", action: "not_fit" },
  { label: "Won", action: "won" },
];

function buildInlineKeyboard(callId: string) {
  return {
    inline_keyboard: [
      OUTCOME_BUTTONS.map((b) => ({
        text: b.label,
        callback_data: `${b.action}:${callId}`,
      })),
    ],
  };
}

// ---------------------------------------------------------------------------
// mock
// ---------------------------------------------------------------------------
let mockMessageCounter = 0;

const mockClient: TelegramClient = {
  async sendDesignerNote(input) {
    mockMessageCounter += 1;
    console.log(
      `[mock telegram] -> chat ${input.chatId} (call ${input.callId}):\n${input.text}\nbuttons: ${OUTCOME_BUTTONS.map((b) => b.label).join(" | ")}`
    );
    return { messageId: `mock-msg-${mockMessageCounter}` };
  },
  async answerCallbackQuery() {
    // no-op in mock mode
  },
};

// ---------------------------------------------------------------------------
// live — Telegram Bot API (https://core.telegram.org/bots/api)
// ---------------------------------------------------------------------------
function telegramApiUrl(method: string) {
  return `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
}

const liveClient: TelegramClient = {
  async sendDesignerNote(input) {
    if (!env.TELEGRAM_BOT_TOKEN) {
      throw new Error("TELEGRAM_BOT_TOKEN is required in live mode.");
    }
    const res = await fetch(telegramApiUrl("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: input.text,
        reply_markup: buildInlineKeyboard(input.callId),
      }),
    });
    if (!res.ok) {
      throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    return { messageId: String(data.result.message_id) };
  },
  async answerCallbackQuery(callbackQueryId, text) {
    if (!env.TELEGRAM_BOT_TOKEN) {
      throw new Error("TELEGRAM_BOT_TOKEN is required in live mode.");
    }
    await fetch(telegramApiUrl("answerCallbackQuery"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
  },
};

export function getTelegramClient(): TelegramClient {
  return integrationMode("TELEGRAM") === "live" ? liveClient : mockClient;
}
