import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  calls,
  answers,
  classifications,
  bookings,
  outcomes,
  notifications,
  hubspotSync,
  designers,
  events,
  type Outcome,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { computeCallCost, costPerUnit, estimatedPipelineValue, actualWonValue } from "@/lib/domain/cost";
import {
  dayKey,
  firstCallerLine,
  formatDate,
  hubspotDealUrl,
  projectLine,
  reasonLabel,
  strongestOutcome,
  STUDIO_TZ,
  type PillTone,
} from "@/lib/domain/dashboard-format";

/**
 * Everything the founder dashboard shows is derived from ONE snapshot of the
 * tables, loaded once per page render, then run through pure functions.
 * Fetch-all-then-derive-in-JS is deliberate at this scale (a studio's call
 * log — tens to low hundreds of rows a month) and means every rule below
 * (what counts as "needs attention", what a funnel step is) lives in plain,
 * testable code instead of being scattered across SQL.
 */

type CallRow = Pick<
  typeof calls.$inferSelect,
  | "id"
  | "vaaniCallId"
  | "callerPhone"
  | "startedAt"
  | "endedAt"
  | "durationSec"
  | "afterHours"
  | "status"
  | "transcript"
  | "humanFollowup"
  | "followupResolvedAt"
>;
type AnswerRow = typeof answers.$inferSelect;
type ClassificationRow = typeof classifications.$inferSelect;
type BookingRow = typeof bookings.$inferSelect;
type OutcomeRow = typeof outcomes.$inferSelect;
type NotificationRow = typeof notifications.$inferSelect;
type HubspotRow = typeof hubspotSync.$inferSelect;
type DesignerRow = typeof designers.$inferSelect;

export interface Snapshot {
  calls: CallRow[];
  answers: AnswerRow[];
  classifications: ClassificationRow[];
  bookings: BookingRow[];
  outcomes: OutcomeRow[];
  notifications: NotificationRow[];
  hubspot: HubspotRow[];
  designers: DesignerRow[];
  priceGuardHits: number;
}

export async function loadSnapshot(): Promise<Snapshot> {
  const db = getDb();
  const [callRows, answerRows, classificationRows, bookingRows, outcomeRows, notificationRows, hubspotRows, designerRows, guardRows] =
    await Promise.all([
      db
        .select({
          id: calls.id,
          vaaniCallId: calls.vaaniCallId,
          callerPhone: calls.callerPhone,
          startedAt: calls.startedAt,
          endedAt: calls.endedAt,
          durationSec: calls.durationSec,
          afterHours: calls.afterHours,
          status: calls.status,
          transcript: calls.transcript,
          humanFollowup: calls.humanFollowup,
          followupResolvedAt: calls.followupResolvedAt,
        })
        .from(calls),
      db.select().from(answers),
      db.select().from(classifications),
      db.select().from(bookings),
      db.select().from(outcomes),
      db.select().from(notifications),
      db.select().from(hubspotSync),
      db.select().from(designers),
      db.select({ id: events.id }).from(events).where(eq(events.type, "price_guard_violation")),
    ]);

  return {
    calls: callRows,
    answers: answerRows,
    classifications: classificationRows,
    bookings: bookingRows,
    outcomes: outcomeRows,
    notifications: notificationRows,
    hubspot: hubspotRows,
    designers: designerRows,
    priceGuardHits: guardRows.length,
  };
}

// ---------------------------------------------------------------------------
// Indexes shared by every derivation
// ---------------------------------------------------------------------------
interface Indexes {
  answersByCall: Map<string, Record<string, string>>;
  classificationByCall: Map<string, ClassificationRow>;
  bookingByCall: Map<string, BookingRow>;
  outcomesByBooking: Map<string, OutcomeRow[]>;
  hubspotByCall: Map<string, HubspotRow>;
  notificationsByCall: Map<string, NotificationRow[]>;
  designerById: Map<string, DesignerRow>;
}

function buildIndexes(snap: Snapshot): Indexes {
  const answersByCall = new Map<string, Record<string, string>>();
  for (const a of snap.answers) {
    const bag = answersByCall.get(a.callId) ?? {};
    if (a.value) bag[a.field] = a.value;
    answersByCall.set(a.callId, bag);
  }

  // A call can be classified more than once (a mid-call retry); the newest wins.
  const classificationByCall = new Map<string, ClassificationRow>();
  for (const c of snap.classifications) {
    const existing = classificationByCall.get(c.callId);
    if (!existing || c.createdAt > existing.createdAt) classificationByCall.set(c.callId, c);
  }

  const bookingByCall = new Map<string, BookingRow>();
  for (const b of snap.bookings) {
    const existing = bookingByCall.get(b.callId);
    if (!existing || (b.status === "confirmed" && existing.status !== "confirmed")) bookingByCall.set(b.callId, b);
  }

  const outcomesByBooking = new Map<string, OutcomeRow[]>();
  for (const o of snap.outcomes) {
    const list = outcomesByBooking.get(o.bookingId) ?? [];
    list.push(o);
    outcomesByBooking.set(o.bookingId, list);
  }

  const hubspotByCall = new Map(snap.hubspot.map((h) => [h.callId, h] as const));

  const notificationsByCall = new Map<string, NotificationRow[]>();
  for (const n of snap.notifications) {
    const list = notificationsByCall.get(n.callId) ?? [];
    list.push(n);
    notificationsByCall.set(n.callId, list);
  }

  return {
    answersByCall,
    classificationByCall,
    bookingByCall,
    outcomesByBooking,
    hubspotByCall,
    notificationsByCall,
    designerById: new Map(snap.designers.map((d) => [d.id, d] as const)),
  };
}

// ---------------------------------------------------------------------------
// Enquiry rows — the table used on both the overview and the enquiries page
// ---------------------------------------------------------------------------
export interface EnquiryRow {
  id: string;
  name: string | null;
  phone: string;
  startedAt: Date;
  durationSec: number | null;
  status: CallRow["status"];
  afterHours: boolean;
  needsFollowup: boolean;
  verdict: "yes" | "maybe" | "no" | null;
  reasonCode: string | null;
  project: string;
  booking: { id: string; startAt: Date | null; designerName: string | null } | null;
  outcome: Outcome | null;
  wonAmountInr: number | null;
  hubspotUrl: string | undefined;
  hubspotStatus: HubspotRow["status"] | null;
}

export function buildEnquiryRows(snap: Snapshot): EnquiryRow[] {
  const idx = buildIndexes(snap);
  return [...snap.calls]
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .map((call) => {
      const answerMap = idx.answersByCall.get(call.id) ?? {};
      const classification = idx.classificationByCall.get(call.id);
      const booking = idx.bookingByCall.get(call.id);
      const bookingOutcomes = booking ? (idx.outcomesByBooking.get(booking.id) ?? []) : [];
      const best = strongestOutcome(bookingOutcomes);
      const hubspot = idx.hubspotByCall.get(call.id);
      const confirmed = booking && booking.status === "confirmed" ? booking : undefined;

      return {
        id: call.id,
        name: answerMap.name ?? null,
        phone: call.callerPhone,
        startedAt: call.startedAt,
        durationSec: call.durationSec,
        status: call.status,
        afterHours: call.afterHours,
        needsFollowup: isFollowupOpen(call, snap.calls, bookingOutcomes.length > 0),
        verdict: classification?.verdict ?? null,
        reasonCode: classification?.reasonCode ?? null,
        project: projectLine(answerMap),
        booking: confirmed
          ? {
              id: confirmed.id,
              startAt: confirmed.startAt,
              designerName: confirmed.designerId ? (idx.designerById.get(confirmed.designerId)?.name ?? null) : null,
            }
          : null,
        outcome: (best?.outcome as Outcome | undefined) ?? null,
        wonAmountInr: best?.outcome === "won" && best.amountInr ? Number(best.amountInr) : null,
        hubspotUrl: hubspotDealUrl(hubspot?.dealId, env.HUBSPOT_PORTAL_ID, env.HUBSPOT_APP_BASE),
        hubspotStatus: hubspot?.status ?? null,
      } satisfies EnquiryRow;
    });
}

// ---------------------------------------------------------------------------
// Follow-up resolution
// ---------------------------------------------------------------------------
/**
 * A call is flagged `human_followup` permanently (it's a historical fact),
 * but it only belongs on the founder's to-do list until something resolves
 * it. Resolved when ANY of:
 *  - the founder clicked "Mark handled"
 *  - its booking already has an outcome logged (the designer has dealt with them)
 *  - the same number later got through on a completed call (e.g. a dropped
 *    line followed by a successful call-back)
 */
export function isFollowupOpen(
  call: Pick<CallRow, "id" | "callerPhone" | "startedAt" | "humanFollowup" | "followupResolvedAt">,
  allCalls: Array<Pick<CallRow, "id" | "callerPhone" | "startedAt" | "status">>,
  hasOutcome: boolean
): boolean {
  if (!call.humanFollowup) return false;
  if (call.followupResolvedAt) return false;
  if (hasOutcome) return false;
  if (call.callerPhone && call.callerPhone !== "unknown") {
    const gotThroughLater = allCalls.some(
      (other) =>
        other.id !== call.id &&
        other.callerPhone === call.callerPhone &&
        other.startedAt > call.startedAt &&
        other.status === "completed"
    );
    if (gotThroughLater) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// "Needs your attention" queue
// ---------------------------------------------------------------------------
export type AttentionKind = "system" | "followup" | "outcome";

export interface AttentionItem {
  key: string;
  kind: AttentionKind;
  callId: string;
  title: string;
  detail: string;
  preview?: string;
  when: Date;
  tone: PillTone;
  actionLabel: string;
  resolvable: boolean;
}

function displayName(name: string | undefined, phone: string): string {
  if (name) return name;
  return phone && phone !== "unknown" ? phone : "Unknown caller";
}

function firstSentence(text: string, max = 150): string {
  const first = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

export function deriveAttention(snap: Snapshot, now: Date = new Date()): AttentionItem[] {
  const idx = buildIndexes(snap);
  const items: AttentionItem[] = [];

  for (const call of snap.calls) {
    const name = idx.answersByCall.get(call.id)?.name;
    const title = displayName(name, call.callerPhone);
    const booking = idx.bookingByCall.get(call.id);
    const bookingOutcomes = booking ? (idx.outcomesByBooking.get(booking.id) ?? []) : [];

    // 1. Integrations that didn't do their job.
    const hubspot = idx.hubspotByCall.get(call.id);
    if (hubspot?.status === "failed") {
      items.push({
        key: `hubspot-failed-${call.id}`,
        kind: "system",
        callId: call.id,
        title,
        detail: `HubSpot sync failed after ${hubspot.attempts} attempts${hubspot.lastError ? ` — ${firstSentence(hubspot.lastError, 90)}` : ""}`,
        when: call.startedAt,
        tone: "bad",
        actionLabel: "Open",
        resolvable: false,
      });
    }
    const failedEmail = (idx.notificationsByCall.get(call.id) ?? []).find((n) => n.status === "failed");
    if (failedEmail) {
      items.push({
        key: `email-failed-${call.id}`,
        kind: "system",
        callId: call.id,
        title,
        detail: `Designer email didn't send${failedEmail.error ? ` — ${firstSentence(failedEmail.error, 90)}` : ""}`,
        when: call.startedAt,
        tone: "bad",
        actionLabel: "Open",
        resolvable: false,
      });
    }

    // 2. Calls that need a human to pick up the phone.
    if (isFollowupOpen(call, snap.calls, bookingOutcomes.length > 0)) {
      const classification = idx.classificationByCall.get(call.id);
      let detail: string;
      if (call.status === "missed") detail = "Missed call — nobody left a message. Worth calling back.";
      else if (call.status === "dropped") detail = "Call dropped mid-conversation.";
      else if (!classification) detail = "Needs a person — the assistant couldn't qualify this call.";
      else detail = firstSentence(classification.reason);

      items.push({
        key: `followup-${call.id}`,
        kind: "followup",
        callId: call.id,
        title,
        detail,
        preview: call.status === "completed" ? firstCallerLine(call.transcript) : undefined,
        when: call.startedAt,
        tone: "warn",
        actionLabel: "Open",
        resolvable: true,
      });
    }

    // 3. Consultations that have happened but nobody has said how they went.
    if (
      booking &&
      booking.status === "confirmed" &&
      booking.startAt &&
      booking.startAt < now &&
      bookingOutcomes.length === 0
    ) {
      items.push({
        key: `outcome-${booking.id}`,
        kind: "outcome",
        callId: call.id,
        title,
        detail: `Consultation was ${formatDate(booking.startAt)} — how did it go?`,
        when: booking.startAt,
        tone: "info",
        actionLabel: "Log outcome",
        resolvable: false,
      });
    }
  }

  const order: Record<AttentionKind, number> = { system: 0, followup: 1, outcome: 2 };
  return items.sort((a, b) => {
    if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
    // Follow-ups: freshest first. Outcomes: most overdue first.
    return a.kind === "outcome" ? a.when.getTime() - b.when.getTime() : b.when.getTime() - a.when.getTime();
  });
}

// ---------------------------------------------------------------------------
// Headline metrics (range-aware)
// ---------------------------------------------------------------------------
export interface Metrics {
  calls: { total: number; afterHours: number; afterHoursShare: number | null; missedOrDropped: number };
  speed: { emailP50: number | null; emailP95: number | null; bookP50: number | null };
  funnel: {
    received: number;
    qualified: number;
    booked: number;
    held: number;
    won: number;
    verdicts: { yes: number; maybe: number; no: number };
    noReasons: Array<{ code: string; label: string; count: number }>;
  };
  cost: { totalInr: number; perBookingInr: number; perCallInr: number; voiceMinutes: number };
  value: { wonInr: number; pipelineLowInr: number; pipelineHighInr: number; openDeals: number };
  health: {
    emailSent: number;
    emailFailed: number;
    emailTotal: number;
    hubspotSynced: number;
    hubspotFailed: number;
    hubspotRetrying: number;
    hubspotTotal: number;
    priceGuardHits: number;
  };
}

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length))];
}

export function computeMetrics(snap: Snapshot, since?: Date): Metrics {
  const idx = buildIndexes(snap);
  const inRange = snap.calls.filter((c) => !since || c.startedAt >= since);
  const ids = new Set(inRange.map((c) => c.id));

  const afterHours = inRange.filter((c) => c.afterHours).length;
  const missedOrDropped = inRange.filter((c) => c.status === "missed" || c.status === "dropped").length;

  const verdicts = { yes: 0, maybe: 0, no: 0 };
  const noCounts = new Map<string, number>();
  for (const call of inRange) {
    const c = idx.classificationByCall.get(call.id);
    if (!c) continue;
    verdicts[c.verdict] += 1;
    if (c.verdict === "no") {
      const label = reasonLabel(c.reasonCode);
      noCounts.set(label, (noCounts.get(label) ?? 0) + 1);
    }
  }
  const noReasons = [...noCounts.entries()]
    .map(([label, count]) => ({ code: label, label, count }))
    .sort((a, b) => b.count - a.count);

  const confirmedBookings = snap.bookings.filter((b) => ids.has(b.callId) && b.status === "confirmed");
  let held = 0;
  let won = 0;
  let openDeals = 0;
  const wonAmounts: number[] = [];
  for (const b of confirmedBookings) {
    const list = idx.outcomesByBooking.get(b.id) ?? [];
    if (list.length === 0) openDeals += 1;
    if (list.some((o) => o.outcome === "held" || o.outcome === "won")) held += 1;
    const wonRow = list.find((o) => o.outcome === "won");
    if (wonRow) {
      won += 1;
      wonAmounts.push(Number(wonRow.amountInr ?? 0));
    }
  }
  const wonInr = actualWonValue(wonAmounts);

  // Call end -> designer email sent
  const endedAtById = new Map(inRange.map((c) => [c.id, c.endedAt] as const));
  const emailLatencies = snap.notifications
    .filter((n) => ids.has(n.callId) && n.channel === "email" && n.status === "sent" && n.sentAt)
    .map((n) => {
      const ended = endedAtById.get(n.callId);
      return ended && n.sentAt ? (n.sentAt.getTime() - ended.getTime()) / 1000 : null;
    })
    .filter((v): v is number => v !== null && v >= 0)
    .sort((a, b) => a - b);

  // Call start -> booking row created
  const startedAtById = new Map(inRange.map((c) => [c.id, c.startedAt] as const));
  const bookLatencies = confirmedBookings
    .map((b) => {
      const started = startedAtById.get(b.callId);
      return started ? (b.createdAt.getTime() - started.getTime()) / 1000 : null;
    })
    .filter((v): v is number => v !== null && v >= 0)
    .sort((a, b) => a - b);

  const voiceMinutes = inRange.reduce((sum, c) => sum + (c.durationSec ?? 0) / 60, 0);
  const voice = computeCallCost({
    voiceMinutes,
    geminiTokens: 0,
    voiceCostInrPerMin: env.VOICE_COST_INR_PER_MIN,
    geminiCostInrPer1kTokens: env.GEMINI_COST_INR_PER_1K_TOKENS,
  });
  const totalInr = voice.totalInr + (inRange.length > 0 ? env.OTHER_FIXED_COST_INR_PER_MONTH : 0);
  const pipeline = estimatedPipelineValue(openDeals, env.PROJECT_AVG_VALUE_INR_LOW, env.PROJECT_AVG_VALUE_INR_HIGH);

  const emails = snap.notifications.filter((n) => ids.has(n.callId) && n.channel === "email");
  const hubspot = snap.hubspot.filter((h) => ids.has(h.callId));

  return {
    calls: {
      total: inRange.length,
      afterHours,
      afterHoursShare: inRange.length > 0 ? afterHours / inRange.length : null,
      missedOrDropped,
    },
    speed: {
      emailP50: percentile(emailLatencies, 0.5),
      emailP95: percentile(emailLatencies, 0.95),
      bookP50: percentile(bookLatencies, 0.5),
    },
    funnel: {
      received: inRange.length,
      qualified: verdicts.yes + verdicts.maybe,
      booked: confirmedBookings.length,
      held,
      won,
      verdicts,
      noReasons,
    },
    cost: {
      totalInr,
      perBookingInr: costPerUnit(totalInr, confirmedBookings.length),
      perCallInr: costPerUnit(totalInr, inRange.length),
      voiceMinutes,
    },
    value: {
      wonInr,
      pipelineLowInr: pipeline.low,
      pipelineHighInr: pipeline.high,
      openDeals,
    },
    health: {
      emailSent: emails.filter((n) => n.status === "sent" || n.status === "acknowledged").length,
      emailFailed: emails.filter((n) => n.status === "failed").length,
      emailTotal: emails.length,
      hubspotSynced: hubspot.filter((h) => h.status === "synced").length,
      hubspotFailed: hubspot.filter((h) => h.status === "failed").length,
      hubspotRetrying: hubspot.filter((h) => h.status === "pending").length,
      hubspotTotal: hubspot.length,
      priceGuardHits: snap.priceGuardHits,
    },
  };
}

// ---------------------------------------------------------------------------
// Enquiries over time (daily, in the studio's timezone)
// ---------------------------------------------------------------------------
export interface DailyPoint {
  day: string; // YYYY-MM-DD, studio-local
  inHours: number;
  afterHours: number;
}

const MAX_DAILY_POINTS = 60;

function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function computeDailySeries(snap: Snapshot, since: Date | undefined, now: Date = new Date()): DailyPoint[] {
  const inRange = snap.calls.filter((c) => !since || c.startedAt >= since);
  const end = dayKey(now, STUDIO_TZ);
  const earliest = inRange.reduce<string | undefined>((min, c) => {
    const k = dayKey(c.startedAt, STUDIO_TZ);
    return !min || k < min ? k : min;
  }, undefined);
  const start = since ? dayKey(since, STUDIO_TZ) : (earliest ?? end);

  const counts = new Map<string, { inHours: number; afterHours: number }>();
  for (const c of inRange) {
    const k = dayKey(c.startedAt, STUDIO_TZ);
    const bucket = counts.get(k) ?? { inHours: 0, afterHours: 0 };
    if (c.afterHours) bucket.afterHours += 1;
    else bucket.inHours += 1;
    counts.set(k, bucket);
  }

  const points: DailyPoint[] = [];
  for (let k = start; k <= end && points.length < 400; k = addDays(k, 1)) {
    const bucket = counts.get(k) ?? { inHours: 0, afterHours: 0 };
    points.push({ day: k, ...bucket });
  }
  return points.slice(-MAX_DAILY_POINTS);
}

// ---------------------------------------------------------------------------
// Call detail page
// ---------------------------------------------------------------------------
export async function getCallDetail(callId: string) {
  const db = getDb();

  const [call] = await db.select().from(calls).where(eq(calls.id, callId));
  if (!call) return null;

  const [callAnswers, callClassifications, booking, callNotifications, callHubspot, samePhoneCalls] = await Promise.all([
    db.select().from(answers).where(eq(answers.callId, callId)),
    db.select().from(classifications).where(eq(classifications.callId, callId)),
    db.select().from(bookings).where(eq(bookings.callId, callId)).then((rows) => rows[0]),
    db.select().from(notifications).where(eq(notifications.callId, callId)),
    db.select().from(hubspotSync).where(eq(hubspotSync.callId, callId)).then((rows) => rows[0]),
    call.callerPhone && call.callerPhone !== "unknown"
      ? db
          .select({ id: calls.id, callerPhone: calls.callerPhone, startedAt: calls.startedAt, status: calls.status })
          .from(calls)
          .where(eq(calls.callerPhone, call.callerPhone))
      : Promise.resolve([]),
  ]);

  const callOutcomes = booking ? await db.select().from(outcomes).where(eq(outcomes.bookingId, booking.id)) : [];
  const designer = booking?.designerId
    ? await db.select().from(designers).where(eq(designers.id, booking.designerId)).then((rows) => rows[0])
    : undefined;

  const answerMap: Record<string, string> = {};
  for (const a of callAnswers) if (a.value) answerMap[a.field] = a.value;

  const classification = [...callClassifications].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  return {
    call,
    name: answerMap.name ?? null,
    answers: callAnswers,
    answerMap,
    classification,
    booking,
    designerName: designer?.name ?? null,
    notifications: callNotifications,
    hubspotSync: callHubspot,
    hubspotUrl: hubspotDealUrl(callHubspot?.dealId, env.HUBSPOT_PORTAL_ID, env.HUBSPOT_APP_BASE),
    outcomes: callOutcomes,
    followupOpen: isFollowupOpen(call, samePhoneCalls, callOutcomes.length > 0),
  };
}
