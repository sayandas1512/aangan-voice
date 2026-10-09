import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { calls, classifications, bookings, outcomes, notifications, hubspotSync, answers } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { computeCallCost, costPerUnit, estimatedPipelineValue, actualWonValue } from "@/lib/domain/cost";

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return sortedAsc[idx];
}

export interface DashboardMetrics {
  speed: {
    totalCalls: number;
    afterHoursCalls: number;
    afterHoursShare: number | null;
    notificationLatencySecP50: number | null;
    notificationLatencySecP95: number | null;
    callToBookingSecP50: number | null;
    callToBookingSecP95: number | null;
  };
  funnel: {
    verdictCounts: Record<"yes" | "maybe" | "no", number>;
    bookedCount: number;
    outcomeCounts: Record<"held" | "no_show" | "not_fit" | "won", number>;
    noReasonCounts: Record<string, number>;
  };
  cost: {
    totalVoiceCostInr: number;
    totalOtherFixedCostInr: number;
    totalCostInr: number;
    costPerCallInr: number;
    costPerQualifiedLeadInr: number;
    costPerBookingInr: number;
    geminiCostTracked: false; // see DECISIONS.md — token usage isn't recorded yet
  };
  value: {
    actualWonInr: number;
    pipelineEstimate: { low: number; high: number; openDealsCount: number };
  };
  operational: {
    hubspotFailedCount: number;
    hubspotRetryingCount: number;
    notificationFailedCount: number;
    priceGuardViolationCount: number;
    humanFollowupCount: number;
    unclearAnswerCallsCount: number;
  };
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const db = getDb();

  const allCalls = await db
    .select({
      id: calls.id,
      startedAt: calls.startedAt,
      endedAt: calls.endedAt,
      afterHours: calls.afterHours,
      durationSec: calls.durationSec,
      humanFollowup: calls.humanFollowup,
    })
    .from(calls);

  const totalCalls = allCalls.length;
  const afterHoursCalls = allCalls.filter((c) => c.afterHours).length;

  // Latest classification per call (simplest correct approach at this
  // scale: fetch all, keep the newest per call_id in JS).
  const allClassifications = await db
    .select({
      callId: classifications.callId,
      verdict: classifications.verdict,
      reasonCode: classifications.reasonCode,
      createdAt: classifications.createdAt,
    })
    .from(classifications);
  const latestClassificationByCall = new Map<string, (typeof allClassifications)[number]>();
  for (const c of allClassifications) {
    const existing = latestClassificationByCall.get(c.callId);
    if (!existing || c.createdAt > existing.createdAt) {
      latestClassificationByCall.set(c.callId, c);
    }
  }
  const latestClassifications = [...latestClassificationByCall.values()];

  const verdictCounts = { yes: 0, maybe: 0, no: 0 };
  const noReasonCounts: Record<string, number> = {};
  for (const c of latestClassifications) {
    verdictCounts[c.verdict] += 1;
    if (c.verdict === "no") {
      const code = c.reasonCode ?? "unspecified";
      noReasonCounts[code] = (noReasonCounts[code] ?? 0) + 1;
    }
  }
  const qualifiedCount = verdictCounts.yes + verdictCounts.maybe;

  const allBookings = await db
    .select({ id: bookings.id, callId: bookings.callId, status: bookings.status, createdAt: bookings.createdAt })
    .from(bookings)
    .where(eq(bookings.status, "confirmed"));
  const bookedCount = allBookings.length;

  const allOutcomes = await db
    .select({ bookingId: outcomes.bookingId, outcome: outcomes.outcome, amountInr: outcomes.amountInr })
    .from(outcomes);
  const outcomeCounts = { held: 0, no_show: 0, not_fit: 0, won: 0 };
  for (const o of allOutcomes) outcomeCounts[o.outcome] += 1;

  // Pipeline estimate: confirmed bookings with no terminal outcome yet.
  const bookingIdsWithOutcome = new Set(allOutcomes.map((o) => o.bookingId));
  const openDealsCount = allBookings.filter((b) => !bookingIdsWithOutcome.has(b.id)).length;

  // Notification latency: call end -> email sent.
  const sentEmailNotifications = await db
    .select({ callId: notifications.callId, sentAt: notifications.sentAt })
    .from(notifications)
    .where(and(eq(notifications.channel, "email"), eq(notifications.status, "sent")));
  const callEndedAtById = new Map(allCalls.map((c) => [c.id, c.endedAt] as const));
  const notificationLatenciesSec = sentEmailNotifications
    .map((n) => {
      const endedAt = callEndedAtById.get(n.callId);
      if (!endedAt || !n.sentAt) return null;
      return (n.sentAt.getTime() - endedAt.getTime()) / 1000;
    })
    .filter((v): v is number => v !== null && v >= 0)
    .sort((a, b) => a - b);

  // Call-to-booking time: call start -> booking row created.
  const callStartedAtById = new Map(allCalls.map((c) => [c.id, c.startedAt] as const));
  const callToBookingSec = allBookings
    .map((b) => {
      const startedAt = callStartedAtById.get(b.callId);
      if (!startedAt) return null;
      return (b.createdAt.getTime() - startedAt.getTime()) / 1000;
    })
    .filter((v): v is number => v !== null && v >= 0)
    .sort((a, b) => a - b);

  // Cost: voice minutes from real call duration; Gemini token usage isn't
  // tracked anywhere in the pipeline yet (classifications stores latency,
  // not tokens), so that line item is honestly 0, not estimated — see
  // DECISIONS.md.
  const totalVoiceMinutes = allCalls.reduce((sum, c) => sum + (c.durationSec ?? 0) / 60, 0);
  const voiceCost = computeCallCost({
    voiceMinutes: totalVoiceMinutes,
    geminiTokens: 0,
    voiceCostInrPerMin: env.VOICE_COST_INR_PER_MIN,
    geminiCostInrPer1kTokens: env.GEMINI_COST_INR_PER_1K_TOKENS,
  });
  const totalOtherFixedCostInr = env.OTHER_FIXED_COST_INR_PER_MONTH;
  const totalCostInr = voiceCost.totalInr + totalOtherFixedCostInr;

  const hubspotRows = await db.select({ status: hubspotSync.status }).from(hubspotSync);
  const hubspotFailedCount = hubspotRows.filter((r) => r.status === "failed").length;
  const hubspotRetryingCount = hubspotRows.filter((r) => r.status === "pending").length;

  const notificationRows = await db.select({ status: notifications.status }).from(notifications);
  const notificationFailedCount = notificationRows.filter((r) => r.status === "failed").length;

  const priceGuardViolationCount = await countEventType("price_guard_violation");
  const humanFollowupCount = allCalls.filter((c) => c.humanFollowup).length;

  const unclearAnswers = await db
    .select({ callId: answers.callId })
    .from(answers)
    .where(eq(answers.unclear, true));
  const unclearAnswerCallsCount = new Set(unclearAnswers.map((a) => a.callId)).size;

  return {
    speed: {
      totalCalls,
      afterHoursCalls,
      afterHoursShare: totalCalls > 0 ? afterHoursCalls / totalCalls : null,
      notificationLatencySecP50: percentile(notificationLatenciesSec, 0.5),
      notificationLatencySecP95: percentile(notificationLatenciesSec, 0.95),
      callToBookingSecP50: percentile(callToBookingSec, 0.5),
      callToBookingSecP95: percentile(callToBookingSec, 0.95),
    },
    funnel: {
      verdictCounts,
      bookedCount,
      outcomeCounts,
      noReasonCounts,
    },
    cost: {
      totalVoiceCostInr: voiceCost.totalInr,
      totalOtherFixedCostInr,
      totalCostInr,
      costPerCallInr: costPerUnit(totalCostInr, totalCalls),
      costPerQualifiedLeadInr: costPerUnit(totalCostInr, qualifiedCount),
      costPerBookingInr: costPerUnit(totalCostInr, bookedCount),
      geminiCostTracked: false,
    },
    value: {
      actualWonInr: actualWonValue(allOutcomes.filter((o) => o.outcome === "won").map((o) => Number(o.amountInr ?? 0))),
      pipelineEstimate: {
        ...estimatedPipelineValue(openDealsCount, env.PROJECT_AVG_VALUE_INR_LOW, env.PROJECT_AVG_VALUE_INR_HIGH),
        openDealsCount,
      },
    },
    operational: {
      hubspotFailedCount,
      hubspotRetryingCount,
      notificationFailedCount,
      priceGuardViolationCount,
      humanFollowupCount,
      unclearAnswerCallsCount,
    },
  };
}

async function countEventType(type: string): Promise<number> {
  const { events } = await import("@/lib/db/schema");
  const rows = await getDb().select({ id: events.id }).from(events).where(eq(events.type, type));
  return rows.length;
}

export async function getRecentNoCalls(limit = 10) {
  const db = getDb();
  const noClassifications = await db
    .select({ callId: classifications.callId, reason: classifications.reason, reasonCode: classifications.reasonCode })
    .from(classifications)
    .where(eq(classifications.verdict, "no"));
  if (noClassifications.length === 0) return [];

  const callIds = [...new Set(noClassifications.map((c) => c.callId))];
  const matchingCalls = await db
    .select({ id: calls.id, callerPhone: calls.callerPhone, startedAt: calls.startedAt, transcript: calls.transcript })
    .from(calls)
    .where(inArray(calls.id, callIds));

  const reasonByCallId = new Map(noClassifications.map((c) => [c.callId, c]));
  return matchingCalls
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, limit)
    .map((c) => ({ ...c, ...reasonByCallId.get(c.id) }));
}

export async function listCallsForDashboard(limit = 50) {
  const db = getDb();
  const rows = await db
    .select({
      id: calls.id,
      callerPhone: calls.callerPhone,
      startedAt: calls.startedAt,
      status: calls.status,
      afterHours: calls.afterHours,
      humanFollowup: calls.humanFollowup,
    })
    .from(calls)
    .orderBy(calls.startedAt);
  return rows.reverse().slice(0, limit);
}

/** Everything the per-call detail page needs, in one place. */
export async function getCallDetail(callId: string) {
  const db = getDb();

  const [call] = await db.select().from(calls).where(eq(calls.id, callId));
  if (!call) return null;

  const [callAnswers, callClassifications, booking, callNotifications, callHubspotSync] = await Promise.all([
    db.select().from(answers).where(eq(answers.callId, callId)),
    db.select().from(classifications).where(eq(classifications.callId, callId)),
    db.select().from(bookings).where(eq(bookings.callId, callId)).then((rows) => rows[0]),
    db.select().from(notifications).where(eq(notifications.callId, callId)),
    db.select().from(hubspotSync).where(eq(hubspotSync.callId, callId)).then((rows) => rows[0]),
  ]);

  const callOutcomes = booking ? await db.select().from(outcomes).where(eq(outcomes.bookingId, booking.id)) : [];

  return {
    call,
    answers: callAnswers,
    classification: callClassifications.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0],
    booking,
    notifications: callNotifications,
    hubspotSync: callHubspotSync,
    outcomes: callOutcomes,
  };
}
