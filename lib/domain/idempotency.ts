/** Primary dedup key: Vaani's own call id. Preferred whenever present. */
export function primaryIdempotencyKey(vaaniCallId: string): string {
  return `vaani:${vaaniCallId}`;
}

/**
 * Dedup key for the webhook *delivery* itself (not the call) — confirmed
 * against the real webhook docs (vaanilabs.in/docs/api/webhooks): the
 * envelope's `id` (`evt_…`) is reused across retries of the same delivery,
 * so two POSTs with the same envelope id are the same attempt, not two
 * different events. Check this before `primaryIdempotencyKey` — it catches
 * literal retries; the call-id key catches Vaani re-sending logically the
 * same call under a new delivery.
 */
export function vaaniDeliveryIdempotencyKey(eventId: string): string {
  return `vaani-delivery:${eventId}`;
}

/**
 * Fallback dedup key for when vaani_call_id is missing or two webhook
 * deliveries disagree on it (brief section 7: "deduplicated on
 * (vaani_call_id) and then (caller_phone, started_at window)"). Buckets
 * startedAt to a fixed window so near-simultaneous retries of the same
 * call land on the same key regardless of small clock jitter between
 * deliveries.
 */
export function fallbackIdempotencyKey(callerPhone: string, startedAt: Date, windowMinutes = 5): string {
  const windowMs = windowMinutes * 60 * 1000;
  const bucket = Math.floor(startedAt.getTime() / windowMs);
  return `phone:${normalizePhone(callerPhone)}:${bucket}`;
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}
