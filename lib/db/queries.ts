import { eq, desc, and, lte, gte } from "drizzle-orm";
import { getDb } from "./client";
import {
  designers,
  calls,
  answers,
  classifications,
  bookings,
  notifications,
  hubspotSync,
  outcomes,
  costEvents,
  jobs,
  events,
  type CallRoute,
  type CallStatus,
  type Verdict,
  type BookingStatus,
  type NotificationChannel,
  type NotificationStatus,
  type Outcome,
  type CostKind,
  type JobStatus,
} from "./schema";

// ---------------------------------------------------------------------------
// designers
// ---------------------------------------------------------------------------
export function listActiveDesigners() {
  return getDb().select().from(designers).where(eq(designers.active, true));
}

export function getDesignerById(id: string) {
  return getDb()
    .select()
    .from(designers)
    .where(eq(designers.id, id))
    .then((rows) => rows[0]);
}

// ---------------------------------------------------------------------------
// calls
// ---------------------------------------------------------------------------
export function getCallByVaaniCallId(vaaniCallId: string) {
  return getDb()
    .select()
    .from(calls)
    .where(eq(calls.vaaniCallId, vaaniCallId))
    .then((rows) => rows[0]);
}

/** Calls still open (no call-ended processed yet) that started at or after `since`, newest first. */
export function listOpenCallsSince(since: Date) {
  return getDb()
    .select()
    .from(calls)
    .where(and(eq(calls.status, "in_progress"), gte(calls.startedAt, since)))
    .orderBy(desc(calls.startedAt));
}

export function getCallById(id: string) {
  return getDb().select().from(calls).where(eq(calls.id, id)).then((rows) => rows[0]);
}

export function createCall(input: {
  vaaniCallId: string;
  callerPhone: string;
  startedAt: Date;
  afterHours: boolean;
  route?: CallRoute;
  status?: CallStatus;
}) {
  return getDb()
    .insert(calls)
    .values(input)
    .returning()
    .then((rows) => rows[0]);
}

/**
 * Mid-call tool endpoints (classify/slots/book) fire before the call-ended
 * webhook ever arrives, so there may be no `calls` row yet when the first
 * tool call lands — this creates a stub row on first touch (using the
 * unique vaani_call_id index to make concurrent calls safe) and returns
 * the existing row on every call after that, so classifications/bookings
 * always have a valid call_id to reference.
 */
export async function findOrCreateCallByVaaniId(input: {
  vaaniCallId: string;
  callerPhone: string;
  startedAt: Date;
  afterHours: boolean;
  route?: CallRoute;
  /**
   * The agent fills the tools' `call_id` itself and sometimes reuses a generic
   * value ("1") on every call. When set, an existing row with that id is only
   * reused while it is still open and younger than this many ms; otherwise it
   * is renamed out of the way so the new call gets its own row.
   */
  reuseWithinMs?: number;
}) {
  const { reuseWithinMs, ...values } = input;
  if (reuseWithinMs !== undefined) {
    const old = await getCallByVaaniCallId(input.vaaniCallId);
    if (old && (old.status !== "in_progress" || Date.now() - old.startedAt.getTime() > reuseWithinMs)) {
      await getDb()
        .update(calls)
        .set({ vaaniCallId: `${old.vaaniCallId}~${old.id.slice(0, 8)}` })
        .where(eq(calls.id, old.id));
    }
  }
  const inserted = await getDb()
    .insert(calls)
    .values(values)
    .onConflictDoNothing({ target: calls.vaaniCallId })
    .returning();
  if (inserted[0]) return inserted[0];
  const existing = await getCallByVaaniCallId(input.vaaniCallId);
  if (!existing) {
    throw new Error(`findOrCreateCallByVaaniId: no row after conflict for ${input.vaaniCallId}`);
  }
  return existing;
}

export function updateCall(
  callId: string,
  patch: Partial<{
    answeredAt: Date;
    endedAt: Date;
    durationSec: number;
    status: CallStatus;
    vaaniCallId: string;
    transcript: string;
    recordingUrl: string;
    humanFollowup: boolean;
    followupResolvedAt: Date;
    rawPayload: unknown;
  }>
) {
  return getDb().update(calls).set(patch).where(eq(calls.id, callId));
}

export function listRecentCalls(limit = 50) {
  return getDb().select().from(calls).orderBy(desc(calls.startedAt)).limit(limit);
}

export function getMostRecentCallByPhone(callerPhone: string) {
  return getDb()
    .select()
    .from(calls)
    .where(eq(calls.callerPhone, callerPhone))
    .orderBy(desc(calls.startedAt))
    .limit(1)
    .then((rows) => rows[0]);
}

// ---------------------------------------------------------------------------
// answers
// ---------------------------------------------------------------------------
export function insertAnswers(
  callId: string,
  rows: Array<{ field: string; value?: string; confidence?: string; unclear?: boolean }>
) {
  if (rows.length === 0) return Promise.resolve([]);
  return getDb()
    .insert(answers)
    .values(rows.map((r) => ({ callId, ...r })))
    .returning();
}

export function getAnswersForCall(callId: string) {
  return getDb().select().from(answers).where(eq(answers.callId, callId));
}

// ---------------------------------------------------------------------------
// classifications
// ---------------------------------------------------------------------------
export function insertClassification(input: {
  callId: string;
  verdict: Verdict;
  reason: string;
  reasonCode?: string;
  missingFields?: string[];
  model: string;
  latencyMs?: number;
}) {
  return getDb()
    .insert(classifications)
    .values(input)
    .returning()
    .then((rows) => rows[0]);
}

/** A call can in principle be classified more than once (e.g. a retry mid-call); the most recent row wins. */
export function getLatestClassificationForCall(callId: string) {
  return getDb()
    .select()
    .from(classifications)
    .where(eq(classifications.callId, callId))
    .orderBy(desc(classifications.createdAt))
    .limit(1)
    .then((rows) => rows[0]);
}

// ---------------------------------------------------------------------------
// bookings
// ---------------------------------------------------------------------------
export function insertBooking(input: {
  callId: string;
  calcomUid?: string;
  designerId?: string;
  startAt?: Date;
  meetUrl?: string;
  status?: BookingStatus;
}) {
  return getDb()
    .insert(bookings)
    .values(input)
    .returning()
    .then((rows) => rows[0]);
}

export function getBookingForCall(callId: string) {
  return getDb()
    .select()
    .from(bookings)
    .where(eq(bookings.callId, callId))
    .then((rows) => rows[0]);
}

export function getBookingById(id: string) {
  return getDb().select().from(bookings).where(eq(bookings.id, id)).then((rows) => rows[0]);
}

// ---------------------------------------------------------------------------
// notifications
// ---------------------------------------------------------------------------
export function insertNotification(input: {
  callId: string;
  channel: NotificationChannel;
  status?: NotificationStatus;
}) {
  return getDb()
    .insert(notifications)
    .values(input)
    .returning()
    .then((rows) => rows[0]);
}

export function markNotificationSent(id: string) {
  return getDb()
    .update(notifications)
    .set({ status: "sent", sentAt: new Date() })
    .where(eq(notifications.id, id));
}

export function markNotificationFailed(id: string, error: string) {
  return getDb()
    .update(notifications)
    .set({ status: "failed", error })
    .where(eq(notifications.id, id));
}

export function markNotificationAcknowledged(id: string) {
  return getDb()
    .update(notifications)
    .set({ status: "acknowledged", acknowledgedAt: new Date() })
    .where(eq(notifications.id, id));
}

export function getNotificationsForCall(callId: string) {
  return getDb().select().from(notifications).where(eq(notifications.callId, callId));
}

// ---------------------------------------------------------------------------
// hubspot_sync
// ---------------------------------------------------------------------------
export function insertHubspotSyncPending(callId: string) {
  return getDb()
    .insert(hubspotSync)
    .values({ callId, status: "pending" })
    .returning()
    .then((rows) => rows[0]);
}

export function getHubspotSyncForCall(callId: string) {
  return getDb()
    .select()
    .from(hubspotSync)
    .where(eq(hubspotSync.callId, callId))
    .then((rows) => rows[0]);
}

export function markHubspotSynced(id: string, contactId: string, dealId: string) {
  return getDb()
    .update(hubspotSync)
    .set({ status: "synced", contactId, dealId })
    .where(eq(hubspotSync.id, id));
}

/** Records a failed sync attempt. `status` stays "pending" while retries remain, or "failed" once exhausted. */
export function markHubspotAttemptFailed(id: string, attempts: number, lastError: string, status: "pending" | "failed") {
  return getDb().update(hubspotSync).set({ attempts, lastError, status }).where(eq(hubspotSync.id, id));
}

// ---------------------------------------------------------------------------
// outcomes
// ---------------------------------------------------------------------------
export function insertOutcome(input: { bookingId: string; outcome: Outcome; amountInr?: string }) {
  return getDb()
    .insert(outcomes)
    .values(input)
    .returning()
    .then((rows) => rows[0]);
}

export function getOutcomesForBooking(bookingId: string) {
  return getDb().select().from(outcomes).where(eq(outcomes.bookingId, bookingId));
}

// ---------------------------------------------------------------------------
// cost_events
// ---------------------------------------------------------------------------
export function insertCostEvent(input: {
  callId?: string;
  kind: CostKind;
  units: string;
  unitCostInr: string;
  amountInr: string;
}) {
  return getDb().insert(costEvents).values(input);
}

// ---------------------------------------------------------------------------
// jobs (retry queue)
// ---------------------------------------------------------------------------
export function enqueueJob(type: string, payload: unknown, runAt: Date = new Date()) {
  return getDb()
    .insert(jobs)
    .values({ type, payload: payload as object, runAt })
    .returning()
    .then((rows) => rows[0]);
}

/**
 * Jobs whose runAt has arrived and are still pending. The original version
 * of this filtered on status alone, which would have picked up jobs
 * scheduled for the future the moment they were enqueued — fixed before it
 * was ever exercised by a real cron run.
 */
export function listDueJobs(limit = 20) {
  return getDb()
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, new Date())))
    .orderBy(jobs.runAt)
    .limit(limit);
}

export function markJobSucceeded(id: string) {
  return getDb().update(jobs).set({ status: "succeeded" }).where(eq(jobs.id, id));
}

/** Reschedules a job for another attempt, or marks it permanently failed once `status` is passed as "failed". */
export function rescheduleJob(
  id: string,
  input: { runAt: Date; attempts: number; lastError: string; status: JobStatus }
) {
  return getDb().update(jobs).set(input).where(eq(jobs.id, id));
}

// ---------------------------------------------------------------------------
// events (guard violations, signature failures, etc.)
// ---------------------------------------------------------------------------
export function logEvent(type: string, payload?: unknown) {
  return getDb().insert(events).values({ type, payload: payload as object });
}

/**
 * Checks whether an event of this exact `type` has already been logged —
 * used for webhook-delivery dedup by giving each delivery's idempotency
 * key (see lib/domain/idempotency.ts) its own exact-match `type` string,
 * which reuses the existing events_type_idx index rather than needing a
 * JSONB query.
 */
export async function hasEventType(type: string): Promise<boolean> {
  const rows = await getDb().select({ id: events.id }).from(events).where(eq(events.type, type)).limit(1);
  return rows.length > 0;
}

/** Used for simple rate limiting (e.g. dashboard login attempts) — count events of a type logged since a given time. */
export async function countEventsOfTypeSince(type: string, since: Date): Promise<number> {
  const rows = await getDb()
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.type, type), gte(events.at, since)));
  return rows.length;
}
