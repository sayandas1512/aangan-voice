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
    ...textActionLines(input.actionLinks),
  ];

  const text = lines.join("\n");
  return enforcePriceGuard(text, SAFE_FALLBACK_NOTE, { callId: input.callId, source: "designer_note" });
}

const BEFORE_MEETING = ["Acknowledge"];

function textActionLines(links: { label: string; url: string }[]): string[] {
  const now = links.filter((l) => BEFORE_MEETING.includes(l.label));
  const after = links.filter((l) => !BEFORE_MEETING.includes(l.label));
  return [
    ...now.map((l) => `${l.label}: ${l.url}`),
    ...(after.length > 0 ? ["", "After the meeting, tell us how it went:", ...after.map((l) => `${l.label}: ${l.url}`)] : []),
  ];
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Rich version of the same note: a details table and buttons instead of
 * long raw links. "Acknowledge" is the only action for now; Held / No-show /
 * Not a fit / Won come after the consultation, so they sit in their own
 * "after the meeting" block. Same content as the text note, so it goes
 * through the same price guard.
 */
export async function buildDesignerNoteHtml(input: DesignerNoteInput): Promise<string> {
  const project = [input.propertyType, input.area, input.sizeSqFt ? `${input.sizeSqFt} sq ft` : undefined, input.workType]
    .filter(Boolean)
    .join(", ");
  const openQuestions = input.missingFields.length > 0 ? input.missingFields.join(", ") : "none";
  const row = (k: string, v: string) =>
    `<tr><td style="padding:6px 14px 6px 0;color:#6b655c;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0">${v}</td></tr>`;
  const button = (l: { label: string; url: string }, primary: boolean) =>
    `<a href="${esc(l.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border-radius:8px;font-weight:600;text-decoration:none;${
      primary ? "background:#9c4a2f;color:#ffffff" : "background:#f3eee6;color:#5c2b1a;border:1px solid #e0d6c7"
    }">${esc(l.label)}</a>`;
  const now = input.actionLinks.filter((l) => BEFORE_MEETING.includes(l.label));
  const after = input.actionLinks.filter((l) => !BEFORE_MEETING.includes(l.label));

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1d1b18;max-width:600px;line-height:1.5">
<h2 style="margin:0 0 4px">New consultation booked</h2>
<p style="margin:0 0 16px;color:#6b655c">${esc(formatIstTime(input.bookingStartIso))}</p>
<table style="border-collapse:collapse;font-size:15px">
${row("Caller", esc([input.callerName, input.callerPhone !== "unknown" ? input.callerPhone : "", input.callerEmail ?? ""].filter(Boolean).join("  ·  ")))}
${row("Project", esc(project || "not fully captured"))}
${row("Timeline", esc(input.timeline ?? "not given"))}
${row("Budget given", input.budgetGiven ? "yes (the number is in the transcript)" : "no")}
${row("Assessment", esc(`${input.verdict} — ${input.reason}`))}
${row("Summary", esc(input.summary))}
${row("Open questions", esc(openQuestions))}
</table>
<p style="margin:18px 0 8px">
${input.meetUrl ? `<a href="${esc(input.meetUrl)}" style="color:#9c4a2f;font-weight:600">Join the meeting</a> &nbsp;·&nbsp; ` : ""}<a href="${esc(input.transcriptUrl)}" style="color:#9c4a2f;font-weight:600">Open the full conversation</a></p>
${now.length ? `<p style="margin:20px 0 8px;font-weight:600">Confirm you've seen this</p><div>${now.map((l) => button(l, true)).join("")}</div>` : ""}
${after.length ? `<p style="margin:20px 0 4px;font-weight:600">After the meeting — how did it go?</p><p style="margin:0 0 8px;color:#6b655c;font-size:14px">Click once the consultation is done. Won will ask for the project amount.</p><div>${after.map((l) => button(l, false)).join("")}</div>` : ""}
</div>`;
  return enforcePriceGuard(html, `<p>${esc(SAFE_FALLBACK_NOTE)}</p>`, { callId: input.callId, source: "designer_note_html" });
}
