import { env } from "@/lib/env";
import {
  getAnswersForCall,
  getCallById,
  getLatestClassificationForCall,
  logEvent,
} from "@/lib/db/queries";
import { formatDateTime } from "@/lib/domain/dashboard-format";
import { followupReason } from "@/lib/domain/followup";
import { getResendClient } from "@/lib/integrations/resend";

/**
 * Emails FOLLOWUP_ALERT_EMAIL when a call ended flagged for a human. Without
 * this, a missed or dropped call, or one the assistant couldn't qualify,
 * only ever showed up on the dashboard — and nobody is watching a dashboard
 * at 7pm. Called once per call (processCallEnded is idempotent), never
 * throws, and records what happened in `events` rather than adding a
 * notification row, so it can't be mistaken for the designer handoff email
 * in the dashboard's delivery stats.
 *
 * Deliberately carries no transcript excerpt: callers sometimes volunteer a
 * budget, and the designer handoff note withholds the figure for the same
 * reason — the detail page behind the link has the full conversation.
 */
export async function sendFollowupAlert(callId: string): Promise<"sent" | "skipped" | "failed"> {
  const to = env.FOLLOWUP_ALERT_EMAIL;
  if (!to) return "skipped";

  try {
    const call = await getCallById(callId);
    if (!call || !call.humanFollowup) return "skipped";

    const [answers, classification] = await Promise.all([getAnswersForCall(callId), getLatestClassificationForCall(callId)]);
    const name = answers.find((a) => a.field === "name")?.value;
    const phone = call.callerPhone && call.callerPhone !== "unknown" ? call.callerPhone : undefined;
    const who = name ?? phone ?? "Unknown caller";

    const text = [
      "A call to Aangan Studio needs a person to follow up.",
      "",
      `Who:  ${name ? `${name}${phone ? `  ${phone}` : ""}` : (phone ?? "Unknown caller")}`,
      `When: ${formatDateTime(call.startedAt)} IST`,
      `Why:  ${followupReason({ status: call.status, classificationReason: classification?.reason })}`,
      "",
      `Details and conversation: ${env.APP_BASE_URL}/dashboard/calls/${call.id}`,
    ].join("\n");

    await getResendClient().sendEmail({ to, subject: `Call needs a callback — ${who}`, text });
    await logEvent("followup_alert_sent", { callId });
    return "sent";
  } catch (err) {
    await logEvent("followup_alert_failed", {
      callId,
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => undefined);
    return "failed";
  }
}
