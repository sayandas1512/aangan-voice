import { createHmac, timingSafeEqual } from "node:crypto";
import { integrationMode, env } from "@/lib/env";

/**
 * Vaani is the inbound party for almost everything in this system: it calls
 * our mid-call tool endpoints and posts the call-ended webhook. There is no
 * general outbound "client" the way there is for Cal.com/HubSpot/etc. — this
 * module covers webhook signature verification (shared by both modes) and
 * the one outbound action we may need in live mode: pushing the agent
 * context pack.
 *
 * Signature scheme confirmed against the real docs (vaanilabs.in/docs/api/webhooks,
 * reviewed 2026-10-09 — see DECISIONS.md): each delivery carries
 * `X-VaaniVoice-Signature: sha256=<hex>`, an HMAC-SHA256 of the raw body
 * keyed with the webhook secret (`vv_whk_…`, shown once at creation).
 * Dedup on the envelope's `id` (`evt_…`) or the `X-VaaniVoice-Delivery`
 * header — both are reused across retries.
 *
 * Still unconfirmed: whether a flow can call out to our API *mid-call*
 * (brief [ASK] item 1). The public WebSocket frame protocol
 * (vaanilabs.in/docs/api/textvoice) only documents transcript/audio/end
 * frames — no tool-call frame type. That logic likely lives in the
 * dashboard's visual "Conversation flow builder," which needs an account
 * to inspect. Still building against the assumption that it supports
 * mid-call tool calls, since that's the harder path — just no longer
 * guessing blind about it.
 */

export interface VaaniCallEndedPayload {
  callId: string;
  callerPhone: string;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  transcript: string;
  recordingUrl?: string;
}

export interface VaaniClient {
  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean;
  pushAgentConfig(contextPackMarkdown: string): Promise<void>;
}

const mockClient: VaaniClient = {
  verifyWebhookSignature() {
    return true;
  },
  async pushAgentConfig(contextPackMarkdown) {
    console.log(`[mock vaani] would push ${contextPackMarkdown.length} chars of agent config`);
  },
};

/**
 * Matches the real header format exactly: "sha256=" + lowercase hex HMAC,
 * compared against "sha256=" + our own digest — not the bare hex. Getting
 * this prefix wrong means every verification silently fails (the docs call
 * this out explicitly as the most common integration mistake).
 */
function verifyHmacSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signatureHeader, "utf8");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

const liveClient: VaaniClient = {
  verifyWebhookSignature(rawBody, signatureHeader) {
    if (!env.VAANI_WEBHOOK_SECRET) {
      throw new Error("VAANI_WEBHOOK_SECRET is required in live mode.");
    }
    return verifyHmacSignature(rawBody, signatureHeader, env.VAANI_WEBHOOK_SECRET);
  },
  async pushAgentConfig() {
    // Vaani's real agent-config API shape is unconfirmed (brief section 6,
    // [ASK] item 1) — flagged in DECISIONS.md rather than guessed at here.
    throw new Error(
      "Vaani live pushAgentConfig is not implemented: the real API is unconfirmed. " +
        "Paste agent/context-pack.md into the Vaani dashboard manually until this is verified (see DECISIONS.md)."
    );
  },
};

export function getVaaniClient(): VaaniClient {
  return integrationMode("VAANI") === "live" ? liveClient : mockClient;
}
