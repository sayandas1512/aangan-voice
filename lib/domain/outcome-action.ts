import type { Outcome } from "@/lib/db/schema";
import {
  getNotificationsForCall,
  markNotificationAcknowledged,
  getOutcomesForBooking,
  insertOutcome,
  getBookingById,
  getHubspotSyncForCall,
  enqueueJob,
} from "@/lib/db/queries";
import { attemptHubspotOutcomeUpdate } from "@/lib/domain/hubspot-sync";
import { nextRunAt } from "@/lib/domain/retry";

export interface RecordOutcomeResult {
  message: string;
}

/** Marks the designer's email notification acknowledged — idempotent, clicking twice is harmless. */
export async function recordAcknowledge(callId: string): Promise<RecordOutcomeResult> {
  const callNotifications = await getNotificationsForCall(callId);
  const emailNotification = callNotifications.find((n) => n.channel === "email");
  if (emailNotification && !emailNotification.acknowledgedAt) {
    await markNotificationAcknowledged(emailNotification.id);
  }
  return { message: "Thanks — marked as acknowledged." };
}

const SIMPLE_OUTCOME_LABELS: Record<string, string> = {
  held: "held",
  no_show: "a no-show",
  not_fit: "not a fit",
};

/** Held / no-show / not-a-fit — idempotent per outcome type, so a reloaded confirmation page doesn't double-record. */
export async function recordSimpleOutcome(
  bookingId: string,
  outcome: Extract<Outcome, "held" | "no_show" | "not_fit">
): Promise<RecordOutcomeResult> {
  const existing = await getOutcomesForBooking(bookingId);
  if (!existing.some((o) => o.outcome === outcome)) {
    await insertOutcome({ bookingId, outcome });
  }
  await syncOutcomeToHubspot(bookingId, outcome);
  return { message: `Marked as ${SIMPLE_OUTCOME_LABELS[outcome]}.` };
}

/** Won, with the amount the designer entered in the follow-up form. */
export async function recordWonOutcome(bookingId: string, amountInr: number): Promise<RecordOutcomeResult> {
  const existing = await getOutcomesForBooking(bookingId);
  if (!existing.some((o) => o.outcome === "won")) {
    await insertOutcome({ bookingId, outcome: "won", amountInr: amountInr.toFixed(2) });
  }
  await syncOutcomeToHubspot(bookingId, "won", amountInr);
  return { message: `Marked as won (₹${amountInr.toLocaleString("en-IN")}).` };
}

async function syncOutcomeToHubspot(bookingId: string, outcome: Outcome, amountInr?: number): Promise<void> {
  const booking = await getBookingById(bookingId);
  if (!booking) return;
  const hubspotSyncRow = await getHubspotSyncForCall(booking.callId);
  if (!hubspotSyncRow?.dealId) return; // never synced — nothing to update

  const result = await attemptHubspotOutcomeUpdate({ dealId: hubspotSyncRow.dealId, outcome, amountInr });
  if (!result.success) {
    await enqueueJob(
      "hubspot_outcome_update",
      { dealId: hubspotSyncRow.dealId, outcome, amountInr },
      nextRunAt(1)
    );
  }
}
