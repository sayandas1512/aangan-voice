import { getHubspotClient, type HubspotClient } from "@/lib/integrations/hubspot";
import { markHubspotSynced, markHubspotAttemptFailed } from "@/lib/db/queries";
import { isExhausted } from "@/lib/domain/retry";
import type { Verdict } from "@/lib/db/schema";

export interface HubspotSyncInput {
  hubspotSyncId: string;
  name: string;
  phone: string;
  email?: string;
  verdict: Verdict; // caller's responsibility: only "yes" | "maybe" ever reach here
  summary: string;
  bookingStartIso?: string;
  designerName?: string;
}

/**
 * One sync attempt, shared by the call-ended webhook's fast path (attempt
 * 1) and the cron retry worker (attempt = job.attempts + 1). Never throws
 * — failure is recorded on the hubspot_sync row and returned, so a caller
 * in the webhook's hot path can't have a HubSpot outage delay or block the
 * Telegram send that must happen first (brief section 7).
 */
export async function attemptHubspotSync(
  input: HubspotSyncInput,
  attempt: number,
  client: HubspotClient = getHubspotClient()
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await client.upsertContactAndDeal({
      name: input.name,
      phone: input.phone,
      email: input.email,
      verdict: input.verdict,
      summary: input.summary,
      bookingStartIso: input.bookingStartIso,
      designerName: input.designerName,
    });
    await markHubspotSynced(input.hubspotSyncId, result.contactId, result.dealId);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markHubspotAttemptFailed(input.hubspotSyncId, attempt, message, isExhausted(attempt) ? "failed" : "pending");
    return { success: false, error: message };
  }
}
