import { getGeminiClient } from "@/lib/integrations/gemini";
import { enforcePriceGuard } from "@/lib/domain/price-guard";

const SAFE_FALLBACK_SUMMARY =
  "Summary unavailable — see the full transcript for details. (Automated summary was withheld by the price guard or failed to generate.)";

/**
 * Post-call summary, generated after the call ends (brief section 7, step
 * 13.2). Not time-critical the way mid-call classify is, so no hard
 * timeout — but still passes through the price guard before the summary
 * is allowed to reach Neon/Telegram/HubSpot, since a leaked price here
 * would end up in the designer note and the CRM note alike.
 */
export async function summarizeCall(transcript: string, callId?: string): Promise<string> {
  const client = getGeminiClient();
  let raw: string;
  try {
    raw = await client.summarize(transcript);
  } catch {
    return SAFE_FALLBACK_SUMMARY;
  }
  return enforcePriceGuard(raw, SAFE_FALLBACK_SUMMARY, { callId, source: "gemini_summary" });
}
