import { env } from "@/lib/env";
import {
  getCallByVaaniCallId,
  findOrCreateCallByVaaniId,
  updateCall,
  getLatestClassificationForCall,
  getAnswersForCall,
  getBookingForCall,
  getDesignerById,
  insertNotification,
  markNotificationSent,
  markNotificationFailed,
  insertHubspotSyncPending,
  enqueueJob,
  logEvent,
} from "@/lib/db/queries";
import { isAfterHours } from "@/lib/domain/after-hours";
import { summarizeCall } from "@/lib/domain/summary";
import { buildDesignerNote } from "@/lib/domain/note";
import { buildActionUrl } from "@/lib/domain/action-link";
import { attemptHubspotSync } from "@/lib/domain/hubspot-sync";
import { nextRunAt } from "@/lib/domain/retry";
import { getResendClient } from "@/lib/integrations/resend";
import { sendFollowupAlert } from "@/lib/domain/followup-alert";

export interface CallEndedInput {
  vaaniCallId: string;
  callerPhone?: string;
  startedAt?: Date;
  endedAt?: Date;
  durationSec?: number;
  transcript?: string;
  recordingUrl?: string;
  rawPayload: unknown;
  /** call.completed vs call.failed — a failed call still gets persisted, just skips the yes/maybe pipeline. */
  failed?: boolean;
}

const ANSWER_FIELD_LABELS: Record<string, string> = {
  propertyType: "home/office",
  area: "area",
  sizeSqFt: "size",
  workType: "work type",
  timeline: "timeline",
};

async function runCallEndedPipeline(input: CallEndedInput): Promise<"processed" | "already_processed"> {
  // Never overwrite an existing call's own data (notably callerPhone — the
  // webhook's copy may be masked per Vaani's docs) with the webhook's
  // best-effort fallback values; those are only used if this call was
  // somehow never touched by a mid-call tool.
  let call = await getCallByVaaniCallId(input.vaaniCallId);
  if (!call) {
    const startedAt = input.startedAt ?? input.endedAt ?? new Date();
    call = await findOrCreateCallByVaaniId({
      vaaniCallId: input.vaaniCallId,
      callerPhone: input.callerPhone ?? "unknown",
      startedAt,
      afterHours: isAfterHours(startedAt, {
        timezone: env.TIMEZONE,
        hoursStart: env.STUDIO_HOURS_START,
        hoursEnd: env.STUDIO_HOURS_END,
      }),
    });
  }

  // Dedup on vaani_call_id (brief section 7): a call already marked
  // completed/missed/dropped/not_an_enquiry has already run this whole
  // pipeline — re-running it would double-send the designer email and double-sync
  // HubSpot.
  if (call.status !== "in_progress") {
    return "already_processed";
  }

  await updateCall(call.id, {
    transcript: input.transcript,
    recordingUrl: input.recordingUrl,
    endedAt: input.endedAt ?? new Date(),
    durationSec: input.durationSec,
    status: input.failed ? "dropped" : "completed",
    rawPayload: input.rawPayload,
  });

  if (input.failed) {
    await logEvent("call_failed", { callId: call.id, vaaniCallId: input.vaaniCallId });
    await updateCall(call.id, { humanFollowup: true });
    return "processed";
  }

  const summary = await summarizeCall(input.transcript ?? "", call.id);

  const classification = await getLatestClassificationForCall(call.id);
  if (!classification) {
    // No mid-call classify ever landed — e.g. caller hung up early, or
    // (per DECISIONS.md) Vaani's mid-call tool support turns out not to
    // work. Persisted either way; flagged for a human rather than guessed.
    await logEvent("classification_missing_at_call_end", { callId: call.id });
    await updateCall(call.id, { humanFollowup: true });
    return "processed";
  }

  if (classification.verdict === "no") {
    // Neon-only per brief section 7 — no designer email, no HubSpot deal.
    return "processed";
  }

  const booking = await getBookingForCall(call.id);
  if (!booking || booking.status !== "confirmed") {
    await logEvent("yes_or_maybe_without_booking", { callId: call.id, verdict: classification.verdict });
    await updateCall(call.id, { humanFollowup: true });
    return "processed";
  }

  const answerRows = await getAnswersForCall(call.id);
  const answersMap = Object.fromEntries(answerRows.map((a) => [a.field, a.value ?? ""]));
  const missingFields = classification.missingFields ?? [];
  const budgetGiven = Boolean(answersMap.budget) && !/not given|declined/i.test(answersMap.budget ?? "");

  const designer = booking.designerId ? await getDesignerById(booking.designerId) : undefined;

  const actionLinks = (["acknowledge", "held", "no_show", "not_fit", "won"] as const).map((action) => ({
    label: { acknowledge: "Acknowledge", held: "Held", no_show: "No-show", not_fit: "Not a fit", won: "Won" }[action],
    url: buildActionUrl({ callId: call.id, bookingId: booking.id, action }),
  }));

  const note = await buildDesignerNote({
    bookingStartIso: (booking.startAt ?? new Date()).toISOString(),
    meetUrl: booking.meetUrl ?? "",
    callerName: answersMap.name || "Caller",
    callerPhone: call.callerPhone,
    callerEmail: answersMap.email,
    propertyType: answersMap.propertyType,
    area: answersMap.area,
    sizeSqFt: answersMap.sizeSqFt,
    workType: answersMap.workType,
    timeline: answersMap.timeline,
    budgetGiven,
    verdict: classification.verdict as "yes" | "maybe",
    reason: classification.reason,
    summary,
    missingFields: missingFields.map((f) => ANSWER_FIELD_LABELS[f] ?? f),
    transcriptUrl: `${env.APP_BASE_URL}/dashboard/calls/${call.id}`,
    callId: call.id,
    actionLinks,
  });

  // Email FIRST (brief section 7's "Telegram first" — now email, see
  // DECISIONS.md) — the designer must act within minutes; HubSpot can
  // retry in the background without delaying this.
  if (designer?.email) {
    const notification = await insertNotification({ callId: call.id, channel: "email" });
    try {
      await getResendClient().sendEmail({
        to: designer.email,
        subject: `New consultation booked — ${answersMap.name || "Caller"}`,
        text: note,
      });
      await markNotificationSent(notification.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markNotificationFailed(notification.id, message);
      await logEvent("designer_email_send_failed", { callId: call.id, error: message });
    }
  } else {
    await logEvent("no_designer_email", { callId: call.id, designerId: booking.designerId });
    await updateCall(call.id, { humanFollowup: true });
  }

  // HubSpot SECOND — yes/maybe only, never blocks the email path above.
  const hubspotSyncRow = await insertHubspotSyncPending(call.id);
  const syncResult = await attemptHubspotSync(
    {
      hubspotSyncId: hubspotSyncRow.id,
      name: answersMap.name || "Caller",
      phone: call.callerPhone,
      email: answersMap.email,
      verdict: classification.verdict as "yes" | "maybe",
      summary,
      bookingStartIso: booking.startAt?.toISOString(),
      designerName: designer?.name,
    },
    1
  );
  if (!syncResult.success) {
    await enqueueJob(
      "hubspot_sync",
      {
        hubspotSyncId: hubspotSyncRow.id,
        name: answersMap.name || "Caller",
        phone: call.callerPhone,
        email: answersMap.email,
        verdict: classification.verdict,
        summary,
        bookingStartIso: booking.startAt?.toISOString(),
        designerName: designer?.name,
      },
      nextRunAt(1)
    );
  }

  return "processed";
}

/**
 * The full post-call pipeline, then — once, on the first run only — a
 * callback alert if anything along the way flagged the call for a human
 * (a missed/dropped call, a failed classify, a booking with no usable
 * email…). Wrapped rather than edited into each early return above, since
 * the flag can be set mid-call by the tool endpoints as well as in here.
 */
export async function processCallEnded(input: CallEndedInput): Promise<"processed" | "already_processed"> {
  const status = await runCallEndedPipeline(input);
  if (status === "processed") {
    const call = await getCallByVaaniCallId(input.vaaniCallId);
    if (call?.humanFollowup) await sendFollowupAlert(call.id);
  }
  return status;
}
