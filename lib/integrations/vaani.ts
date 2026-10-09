import { createHmac, timingSafeEqual } from "node:crypto";
import { integrationMode, env } from "@/lib/env";

/**
 * Vaani is the inbound party for almost everything in this system: it calls
 * our mid-call tool endpoints and posts the call-ended webhook. There is no
 * general outbound "client" the way there is for Cal.com/HubSpot/etc. — this
 * module covers webhook signature verification (shared by both modes) and
 * the one outbound action we may need in live mode: pushing the agent
 * context pack. See DECISIONS.md item 1: whether Vaani supports mid-call
 * tool calls at all is the single biggest unconfirmed risk in this build;
 * everything here assumes it does, since that's the harder path to build
 * against (the fallback design is noted in DECISIONS.md, not implemented).
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

function verifyHmacSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
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
