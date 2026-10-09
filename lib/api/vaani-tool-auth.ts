import { timingSafeEqual } from "node:crypto";
import { env, integrationMode } from "@/lib/env";

/**
 * Shared-secret check for Vaani's mid-call tool calls (classify/slots/book/
 * pre-call) — distinct from the real, confirmed HMAC signature scheme used
 * by Vaani's registered *webhooks* (lib/integrations/vaani.ts,
 * DECISIONS.md). How the flow builder actually authenticates its own
 * outbound tool-call requests is unconfirmed (same open risk as whether
 * mid-call tools exist at all — DECISIONS.md [ASK] item 1), so this is a
 * conservative placeholder: a constant-time comparison against
 * VAANI_WEBHOOK_SECRET via a custom header, skipped entirely in mock mode
 * so local dev and tests don't need a secret configured. Revisit once
 * Vaani account access clarifies the real mechanism.
 */
export function verifyToolRequest(request: Request): boolean {
  if (integrationMode("VAANI") !== "live") {
    return true;
  }
  if (!env.VAANI_WEBHOOK_SECRET) {
    return false;
  }
  const provided = request.headers.get("x-vaani-shared-secret");
  if (!provided) return false;
  const expectedBuf = Buffer.from(env.VAANI_WEBHOOK_SECRET, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export function badRequest(message: string, details?: unknown): Response {
  return Response.json({ error: message, details }, { status: 400 });
}
