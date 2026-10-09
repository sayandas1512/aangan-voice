import { eq, desc } from "drizzle-orm";
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
} from "./schema";

// ---------------------------------------------------------------------------
// designers
// ---------------------------------------------------------------------------
export function listActiveDesigners() {
  return getDb().select().from(designers).where(eq(designers.active, true));
}

export function getDesignerByTelegramChatId(chatId: string) {
  return getDb()
    .select()
    .from(designers)
    .where(eq(designers.telegramChatId, chatId))
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

export function updateCall(
  callId: string,
  patch: Partial<{
    answeredAt: Date;
    endedAt: Date;
    durationSec: number;
    status: CallStatus;
    transcript: string;
    recordingUrl: string;
    humanFollowup: boolean;
    rawPayload: unknown;
  }>
) {
  return getDb().update(calls).set(patch).where(eq(calls.id, callId));
}

export function listRecentCalls(limit = 50) {
  return getDb().select().from(calls).orderBy(desc(calls.startedAt)).limit(limit);
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
  model: string;
  latencyMs?: number;
}) {
  return getDb()
    .insert(classifications)
    .values(input)
    .returning()
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

export function markHubspotSynced(id: string, contactId: string, dealId: string) {
  return getDb()
    .update(hubspotSync)
    .set({ status: "synced", contactId, dealId })
    .where(eq(hubspotSync.id, id));
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

export function listDueJobs(limit = 20) {
  return getDb()
    .select()
    .from(jobs)
    .where(eq(jobs.status, "pending"))
    .orderBy(jobs.runAt)
    .limit(limit);
}

// ---------------------------------------------------------------------------
// events (guard violations, signature failures, etc.)
// ---------------------------------------------------------------------------
export function logEvent(type: string, payload?: unknown) {
  return getDb().insert(events).values({ type, payload: payload as object });
}
