/** Max retry attempts before a job is marked permanently failed (brief: HubSpot sync retries, never blocks Telegram). */
export const MAX_RETRY_ATTEMPTS = 6;

/**
 * Exponential backoff in minutes: 1, 2, 4, 8, 16, 32 — attempt 6 is the
 * last retry; attempt 7 means the caller should give up (see
 * MAX_RETRY_ATTEMPTS). Capped so a stuck job doesn't silently stretch out
 * for days between attempts.
 */
export function backoffMinutes(attempt: number, capMinutes = 60): number {
  const minutes = Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(minutes, capMinutes);
}

export function nextRunAt(attempt: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + backoffMinutes(attempt) * 60 * 1000);
}

export function isExhausted(attempt: number): boolean {
  return attempt >= MAX_RETRY_ATTEMPTS;
}
