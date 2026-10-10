import { z } from "zod";
import { getVaaniClient } from "@/lib/integrations/vaani";
import { vaaniDeliveryIdempotencyKey } from "@/lib/domain/idempotency";
import { processCallEnded } from "@/lib/domain/call-ended";
import { getCallByVaaniCallId, hasEventType, listOpenCallsSince, logEvent, updateCall } from "@/lib/db/queries";

/**
 * Receives Vaani's real registered webhook deliveries — confirmed live via
 * "Test Connectivity" (see DECISIONS.md), not from docs, and the real shape
 * is nothing like the brief's assumed `{id, type, created, data}`:
 *
 *   { "event": "webhook_test", "timestamp": "...", "events": [
 *       { "event": "call_postprocessing", "call_id": "...", "timestamp": "...",
 *         "data": { room_name, call_id, call_duration, end_reason, summary,
 *                    entities, dispositions, recording_url, transcript } },
 *       { "event": "call_failed", "timestamp": "...",
 *         "data": { room_name, call_id, phone_number, reason } }
 *   ] }
 *
 * — a single POST is a BATCH of one or more individual events, not one
 * event. The real event type strings are snake_case ("call_postprocessing",
 * "call_failed"), not the dotted "call.completed"/"call.failed" assumed
 * originally. There is no per-delivery id anywhere in the payload (unlike
 * the brief's assumed `evt_…`), so the delivery-dedup key is synthesized
 * from each item's own (event, call_id, timestamp) instead.
 *
 * The signature header is `X-Webhook-Signature`, not `X-VaaniVoice-Signature`
 * — also only discovered by logging real header names, since the wrong
 * name produced a 401 with no other symptom.
 *
 * Only "call_postprocessing" ("fired when the call ends and the
 * transcript/analysis is ready" — confirmed in the dashboard's own tooltip)
 * is treated as a completion; "call_ended" (if ever subscribed) fires
 * before the transcript exists and isn't handled here on purpose.
 */

const EventItemSchema = z.object({
  event: z.string().min(1),
  call_id: z.string().optional(),
  timestamp: z.string().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});

const EnvelopeSchema = z.object({
  event: z.string().min(1),
  timestamp: z.string().optional(),
  events: z.array(EventItemSchema).default([]),
});

function classifyEventType(type: string): "completed" | "failed" | "ignored" {
  const t = type.toLowerCase();
  if (/fail/.test(t)) return "failed";
  if (/post.?process/.test(t)) return "completed";
  return "ignored";
}

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

// calls.duration_sec is an integer column; Vaani reports fractional seconds (226.49).
function roundedDuration(sec: number | undefined): number | undefined {
  return sec === undefined ? undefined : Math.round(sec);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-webhook-signature");

  if (!getVaaniClient().verifyWebhookSignature(rawBody, signature)) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  const json = JSON.parse(rawBody);
  const parsed = EnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }
  const envelope = parsed.data;

  // The wrapper's own top-level "event" covers the connectivity-test case
  // ("webhook_test") seen live; a real delivery's wrapper event name isn't
  // confirmed yet, so this only special-cases the known test value rather
  // than requiring an exact match — any other wrapper is processed for its
  // nested `events` normally.
  if (envelope.event === "webhook_test") {
    return Response.json({ ok: true, status: "test_received" });
  }

  // Shape-only log (long strings truncated) so an unexpected payload can be diagnosed without leaking a transcript.
  console.log(
    "[webhook] envelope",
    JSON.stringify(json, (_k, v) => (typeof v === "string" && v.length > 60 ? `${v.slice(0, 60)}…(${v.length})` : v)).slice(0, 2500)
  );
  // A real call's delivery arrives with NO nested `events` array: the wrapper
  // itself is the event ({"event":"call_postprocessing", ...fields}). Only
  // the connectivity test used the batch shape. Treat such a wrapper as a
  // single item, reading fields from its `data` object or from the top level.
  let items = envelope.events;
  if (items.length === 0 && classifyEventType(envelope.event) !== "ignored") {
    const top = json as Record<string, unknown>;
    const nested = top.data && typeof top.data === "object" ? (top.data as Record<string, unknown>) : top;
    items = [
      {
        event: envelope.event,
        call_id: typeof top.call_id === "string" ? top.call_id : undefined,
        timestamp: envelope.timestamp,
        data: nested,
      },
    ];
  }

  const results: Array<{ callId?: string; event: string; outcome: string }> = [];

  for (const item of items) {
    const kind = classifyEventType(item.event);
    if (kind === "ignored") {
      console.log("[webhook] ignored event", item.event, item.call_id);
      results.push({ event: item.event, outcome: "ignored" });
      continue;
    }

    const vaaniCallId = item.call_id ?? stringField(item.data, "call_id", "vaani_call_id", "room_name");
    if (!vaaniCallId) {
      results.push({ event: item.event, outcome: "missing_call_id" });
      continue;
    }

    // The mid-call tools fill `call_id` from the conversation, so it can differ
    // from the id Vaani reports here (a live call used a timestamp it made up,
    // while Vaani's own id was "webrtc-<epoch>-<hex>"). If nothing matches,
    // look for the open call whose row was created DURING this call (the row
    // appears at the first tool call, i.e. between call start and end). Only
    // an unambiguous single candidate is used; with two or more we leave it
    // unmatched rather than attach a transcript to the wrong enquiry.
    if (!(await getCallByVaaniCallId(vaaniCallId))) {
      const endedAt = item.timestamp ? new Date(item.timestamp) : new Date();
      const duration = numberField(item.data, "call_duration", "duration_sec", "durationSec", "duration");
      const startedAfter = new Date(endedAt.getTime() - (duration ?? 30 * 60) * 1000 - 60 * 1000);
      const endedBefore = endedAt.getTime() + 60 * 1000;
      const during = (await listOpenCallsSince(startedAfter)).filter((c) => c.startedAt.getTime() <= endedBefore);
      if (during.length === 1) {
        await logEvent("webhook_call_id_remapped", { from: vaaniCallId, to: during[0].vaaniCallId, callId: during[0].id });
        // Rename the row to Vaani's real id so a generic tool-side id ("1")
        // is freed for the next call and later retries match directly.
        await updateCall(during[0].id, { vaaniCallId });
      }
    }

    // No per-delivery id exists in the real payload (see module docstring)
    // — synthesized from fields that are stable across a genuine retry of
    // the same delivery, but change for a logically different event.
    const deliveryKey = vaaniDeliveryIdempotencyKey(`${item.event}:${vaaniCallId}:${item.timestamp ?? ""}`);
    if (await hasEventType(deliveryKey)) {
      results.push({ callId: vaaniCallId, event: item.event, outcome: "duplicate_delivery" });
      continue;
    }

    const endedAtRaw = item.timestamp ?? stringField(item.data, "ended_at", "endedAt");

    const status = await processCallEnded({
      vaaniCallId,
      callerPhone: stringField(item.data, "phone_number", "caller_phone", "callerPhone", "from"),
      startedAt: undefined, // not present in the real payload; processCallEnded falls back sensibly
      endedAt: endedAtRaw ? new Date(endedAtRaw) : new Date(),
      durationSec: roundedDuration(numberField(item.data, "call_duration", "duration_sec", "durationSec", "duration")),
      transcript: stringField(item.data, "transcript"),
      recordingUrl: stringField(item.data, "recording_url", "recordingUrl"),
      rawPayload: item,
      failed: kind === "failed",
    });
    // Recorded only after processing succeeds: if it throws, Vaani's retry
    // must be allowed through instead of being dropped as a duplicate.
    await logEvent(deliveryKey, { receivedAt: new Date().toISOString() });
    results.push({ callId: vaaniCallId, event: item.event, outcome: status });
  }

  return Response.json({ ok: true, results });
}
