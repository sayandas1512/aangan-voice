import { env } from "@/lib/env";
import { enforcePriceGuard } from "@/lib/domain/price-guard";

export interface DesignerNoteInput {
  bookingStartIso: string;
  meetUrl: string;
  callerName: string;
  callerPhone: string;
  callerEmail?: string;
  propertyType?: string; // home | office
  area?: string;
  sizeSqFt?: string;
  workType?: string;
  timeline?: string;
  budgetGiven: boolean; // the caller-stated number itself never appears here
  verdict: "yes" | "maybe";
  reason: string;
  summary: string;
  missingFields: string[];
  transcriptUrl: string;
  callId?: string;
  /** Acknowledge/Held/No-show/Not a fit/Won — signed GET links (lib/domain/action-link.ts), replacing Telegram's inline buttons. */
  actionLinks: { label: string; url: string }[];
}

const SAFE_FALLBACK_NOTE =
  "New consultation booked. Details withheld by the price guard — check the call's transcript page for the full note.";

function formatIstTime(startIso: string): string {
  const date = new Date(startIso);
  const formatted = new Intl.DateTimeFormat("en-IN", {
    timeZone: env.TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${formatted} IST`;
}

/**
 * Builds the designer-handoff email body (brief section 8's note
 * structure, originally designed for Telegram — now sent via Resend, see
 * DECISIONS.md). Note: a caller-volunteered budget is a caller-provided
 * fact and is allowed to reach the designer, but per the template this
 * note only ever says "Budget given: yes/no" — the actual figure lives in
 * the transcript, never in generated text. Still passed through the price
 * guard like every other generated string, as a defense-in-depth measure.
 */
export async function buildDesignerNote(input: DesignerNoteInput): Promise<string> {
  const project = [input.propertyType, input.area, input.sizeSqFt ? `${input.sizeSqFt} sq ft` : undefined, input.workType]
    .filter(Boolean)
    .join(", ");

  const openQuestions = input.missingFields.length > 0 ? input.missingFields.join(", ") : "none";

  const lines = [
    "New consultation booked",
    `When: ${formatIstTime(input.bookingStartIso)}   |   Meet: ${input.meetUrl}`,
    `Caller: ${input.callerName}  ${input.callerPhone}  ${input.callerEmail ?? ""}`.trimEnd(),
    `Project: ${project || "not fully captured"}`,
    `Timeline: ${input.timeline ?? "not given"}   Budget given: ${input.budgetGiven ? "yes" : "no"} (the number is in the transcript, not here)`,
    `Verdict: ${input.verdict} because ${input.reason}`,
    `Summary: ${input.summary}`,
    `Open questions: ${openQuestions}`,
    `Transcript: ${input.transcriptUrl}`,
    "",
    ...input.actionLinks.map((link) => `${link.label}: ${link.url}`),
  ];

  const text = lines.join("\n");
  return enforcePriceGuard(text, SAFE_FALLBACK_NOTE, { callId: input.callId, source: "designer_note" });
}
