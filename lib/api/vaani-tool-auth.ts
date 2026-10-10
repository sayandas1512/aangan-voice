import { timingSafeEqual } from "node:crypto";
import { env, integrationMode } from "@/lib/env";

/**
 * Shared-secret check for Vaani's mid-call tool calls (classify/slots/book/
 * pre-call) — a self-chosen secret configured as each custom tool's
 * `x-vaani-shared-secret` header in Vaani's dashboard, distinct from the
 * real, Vaani-generated HMAC signature scheme used by registered
 * *webhooks* (lib/integrations/vaani.ts). These two used to share
 * VAANI_WEBHOOK_SECRET as a placeholder before mid-call tool-calling was
 * confirmed live and a real webhook was registered — split into its own
 * var (VAANI_TOOL_SHARED_SECRET) once both were real, so registering the
 * webhook's real secret can't silently invalidate tool auth or vice versa
 * (see DECISIONS.md).
 */
export function verifyToolRequest(request: Request): boolean {
  if (integrationMode("VAANI") !== "live") {
    return true;
  }
  if (!env.VAANI_TOOL_SHARED_SECRET) {
    return false;
  }
  const provided = request.headers.get("x-vaani-shared-secret");
  if (!provided) return false;
  const expectedBuf = Buffer.from(env.VAANI_TOOL_SHARED_SECRET, "utf8");
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
