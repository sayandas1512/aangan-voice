import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Replaces Telegram's inline buttons: each designer email carries plain
 * GET links (Acknowledge/Held/No-show/Not a fit/Won) that need no login,
 * so they must be unguessable and tamper-evident on their own — this signs
 * {callId, bookingId, action} with HMAC-SHA256 and an expiry, verified
 * with a constant-time comparison. Stateless by design (no DB row to look
 * up), unlike the pending_prompts table an earlier draft of this phase
 * added for a Telegram "what was the amount?" follow-up and then removed.
 */

export type ActionLinkAction = "acknowledge" | "held" | "no_show" | "not_fit" | "won";

export interface ActionLinkPayload {
  callId: string;
  bookingId: string;
  action: ActionLinkAction;
  exp: number; // unix seconds
}

const DEFAULT_TTL_DAYS = 30;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signActionToken(
  payload: Omit<ActionLinkPayload, "exp">,
  ttlDays = DEFAULT_TTL_DAYS
): string {
  const full: ActionLinkPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlDays * 86400 };
  const body = base64url(JSON.stringify(full));
  const signature = createHmac("sha256", env.ACTION_LINK_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyActionToken(token: string): ActionLinkPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;

  const expected = createHmac("sha256", env.ACTION_LINK_SECRET).update(body).digest("base64url");
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return null;
  }

  let payload: ActionLinkPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  if (!payload.callId || !payload.bookingId || !payload.action) {
    return null;
  }

  return payload;
}

export function buildActionUrl(payload: Omit<ActionLinkPayload, "exp">): string {
  const token = signActionToken(payload);
  return `${env.APP_BASE_URL}/api/notifications/action?token=${encodeURIComponent(token)}`;
}
