import { z } from "zod";
import { getVaaniClient } from "@/lib/integrations/vaani";
import { vaaniDeliveryIdempotencyKey } from "@/lib/domain/idempotency";
import { processCallEnded } from "@/lib/domain/call-ended";
import { hasEventType, logEvent } from "@/lib/db/queries";

/**
 * Receives Vaani's real registered webhook events (confirmed against
 * vaanilabs.in/docs/api/webhooks — see DECISIONS.md): `call.completed` and
 * `call.failed`. Envelope shape is {id, type, created, data}; `data`'s own
 * sub-fields are explicitly "not guaranteed" by Vaani's docs, so this
 * parses them defensively and falls back to best-effort values rather than
 * rejecting the whole delivery over one missing field.
 */

const EnvelopeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["call.completed", "call.failed", "webhook.ping"]),
  created: z.number().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});

function stringField(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function numberField(data: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "number") return value;
  }
  return undefined;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-vaanivoice-signature");

  if (!getVaaniClient().verifyWebhookSignature(rawBody, signature)) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  const json = JSON.parse(rawBody);
  const parsed = EnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }
  const envelope = parsed.data;

  if (envelope.type === "webhook.ping") {
    return Response.json({ ok: true });
  }

  // Dedup on the delivery id first (Vaani retries reuse the same evt_… id
  // up to 8 times) — before touching the call at all.
  const deliveryKey = vaaniDeliveryIdempotencyKey(envelope.id);
  if (await hasEventType(deliveryKey)) {
    return Response.json({ ok: true, status: "duplicate_delivery" });
  }
  await logEvent(deliveryKey, { receivedAt: new Date().toISOString() });

  const vaaniCallId = stringField(envelope.data, "call_id", "vaani_call_id", "callId");
  if (!vaaniCallId) {
    return Response.json({ error: "payload missing a call id" }, { status: 400 });
  }

  const startedAtRaw = stringField(envelope.data, "started_at", "startedAt");
  const endedAtRaw = stringField(envelope.data, "ended_at", "endedAt");

  const status = await processCallEnded({
    vaaniCallId,
    callerPhone: stringField(envelope.data, "caller_phone", "callerPhone", "from"),
    startedAt: startedAtRaw ? new Date(startedAtRaw) : undefined,
    endedAt: endedAtRaw ? new Date(endedAtRaw) : new Date(envelope.created ? envelope.created * 1000 : Date.now()),
    durationSec: numberField(envelope.data, "duration_sec", "durationSec", "duration"),
    transcript: stringField(envelope.data, "transcript"),
    recordingUrl: stringField(envelope.data, "recording_url", "recordingUrl"),
    rawPayload: envelope,
    failed: envelope.type === "call.failed",
  });

  return Response.json({ ok: true, status });
}
