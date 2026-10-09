import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { calls, answers, classifications, bookings, notifications, hubspotSync, outcomes, designers } from "@/lib/db/schema";

/**
 * Seeds the 20 real September 2026 phone enquiries (knowledge/transcripts/T01-T20.md,
 * sourced from the assignment's "Aangan_Sep 2026_Enquiries.pdf") as historical `calls`
 * rows, replaying the same side effects the live call-ended pipeline
 * (lib/domain/call-ended.ts) would have produced: answers, classification, booking,
 * designer email notification, and HubSpot sync — each with backdated timestamps so
 * the dashboard's time-based stats read naturally.
 *
 * Only the phone-call section is seeded. The PDF's WhatsApp and web-form sections
 * (W01-10, F01-10) describe enquiries on channels this system doesn't model — the
 * schema is call-centric (lib/db/schema.ts) because the product is a voice AI that
 * handles phone calls, not a generic enquiry inbox. Forcing those into `calls` rows
 * would misrepresent them as calls that never happened.
 */

const TRANSCRIPT_DIR = join(process.cwd(), "knowledge", "transcripts");

function transcript(file: string): string {
  return readFileSync(join(TRANSCRIPT_DIR, file), "utf8").trim();
}

function ist(iso: string): Date {
  return new Date(`${iso}+05:30`);
}

function plusSec(d: Date, sec: number): Date {
  return new Date(d.getTime() + sec * 1000);
}

function plusDays(d: Date, days: number, hour: number, minute = 0): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  const istHourUtc = hour - 5;
  const istMinuteUtc = minute - 30;
  out.setUTCHours(istHourUtc, istMinuteUtc < 0 ? istMinuteUtc + 60 : istMinuteUtc, 0, 0);
  if (istMinuteUtc < 0) out.setUTCHours(out.getUTCHours() - 1);
  return out;
}

const STUDIO_HOURS_START = 10 * 60;
const STUDIO_HOURS_END = 19 * 60;

function isAfterHoursIst(d: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const minutes = hour * 60 + minute;
  return minutes < STUDIO_HOURS_START || minutes >= STUDIO_HOURS_END;
}

interface Answer {
  field: string;
  value: string;
}

interface CallSeed {
  key: string;
  file: string;
  startedAt: Date;
  durationSec: number;
  status: "completed" | "missed" | "dropped" | "not_an_enquiry";
  phone: string;
  humanFollowup: boolean;
  answers: Answer[];
  classification?: {
    verdict: "yes" | "maybe" | "no";
    reason: string;
    reasonCode?: string;
    missingFields: string[];
  };
  booked: boolean;
  designer?: "Asha" | "Rohan";
  consultationDaysOut?: number;
  consultationHour?: number;
}

const CALLS: CallSeed[] = [
  {
    key: "t01",
    file: "T01.md",
    startedAt: ist("2026-09-02T10:23:00"),
    durationSec: 252,
    status: "completed",
    phone: "+91-90000-20101",
    humanFollowup: false,
    answers: [
      { field: "name", value: "Priya" },
      { field: "propertyType", value: "Home" },
      { field: "area", value: "Kothrud (Dahanukar Colony)" },
      { field: "sizeSqFt", value: "1400" },
      { field: "workType", value: "Full redesign — kitchen, living room, both bedrooms" },
      { field: "timeline", value: "By March — no rush" },
      { field: "decisionMaker", value: "Owner (caller) and husband, both agreed" },
    ],
    classification: {
      verdict: "yes",
      reason: "Real project, in Pune service area, realistic ~6 month timeline, no budget red flag, both owners on board.",
      missingFields: [],
    },
    booked: true,
    designer: "Asha",
    consultationDaysOut: 4,
    consultationHour: 11,
  },
  {
    key: "t02",
    file: "T02.md",
    startedAt: ist("2026-09-03T14:41:00"),
    durationSec: 308,
    status: "completed",
    phone: "+91-90000-20102",
    humanFollowup: false,
    answers: [
      { field: "propertyType", value: "Home" },
      { field: "area", value: "Wakad" },
      { field: "sizeSqFt", value: "950" },
      { field: "workType", value: "Full redesign — modular kitchen, wardrobes, living room, both bedrooms" },
      { field: "budget", value: "Asked for a ballpark; declined to quote, caller accepted" },
      { field: "timeline", value: "Design from October, move in November" },
      { field: "decisionMaker", value: "Caller, no flag raised" },
    ],
    classification: {
      verdict: "yes",
      reason: "Real project, in service area, realistic timeline, price-guard deflection held on the call.",
      missingFields: [],
    },
    booked: true,
    designer: "Rohan",
    consultationDaysOut: 5,
    consultationHour: 15,
  },
  {
    key: "t03",
    file: "T03.md",
    startedAt: ist("2026-09-03T16:15:00"),
    durationSec: 160,
    status: "completed",
    phone: "+91-90000-20103",
    humanFollowup: false,
    answers: [
      { field: "name", value: "Suresh Patil" },
      { field: "propertyType", value: "Home" },
      { field: "area", value: "Nashik" },
      { field: "workType", value: "Home office and study redesign" },
    ],
    classification: {
      verdict: "no",
      reason: 'Area "Nashik" is outside the Pune/PCMC service area.',
      reasonCode: "out_of_area",
      missingFields: [],
    },
    booked: false,
  },
  {
    key: "t04",
    file: "T04.md",
    startedAt: ist("2026-09-04T11:07:00"),
    durationSec: 202,
    status: "completed",
    phone: "+91-90000-20104",
    humanFollowup: false,
    answers: [{ field: "workType", value: "Styling/colour advice only, no execution — caller declined full project" }],
    classification: {
      verdict: "no",
      reason: "Caller wants advisory/styling only, not design with execution.",
      reasonCode: "advisory_only",
      missingFields: [],
    },
    booked: false,
  },
  {
    key: "t05",
    file: "T05.md",
    startedAt: ist("2026-09-05T10:52:00"),
    durationSec: 404,
    status: "completed",
    phone: "+91-90000-20105",
    humanFollowup: false,
    answers: [
      { field: "name", value: "Aarti Mehta" },
      { field: "propertyType", value: "Home" },
      { field: "area", value: "Koregaon Park" },
      { field: "sizeSqFt", value: "2400" },
      { field: "workType", value: "Complete redesign — new flooring, kitchen, all four bedrooms" },
      { field: "timeline", value: "Move back in by February — about 4 months" },
      { field: "decisionMaker", value: "Referral via Vikram Agarwal; caller arranging site visit" },
    ],
    classification: {
      verdict: "yes",
      reason: "Large real project, in service area, realistic 4-month timeline, referral lead.",
      missingFields: [],
    },
    booked: true,
    designer: "Asha",
    consultationDaysOut: 6,
    consultationHour: 11,
  },
  {
    key: "t06",
    file: "T06.md",
    startedAt: ist("2026-09-05T15:28:00"),
    durationSec: 301,
    status: "completed",
    phone: "+91-90000-20106",
    humanFollowup: false,
    answers: [
      { field: "propertyType", value: "Commercial — office" },
      { field: "area", value: "Baner" },
      { field: "sizeSqFt", value: "800" },
      { field: "workType", value: "Full fitout from bare shell — 20 workstations, cabin, meeting room, break area" },
      { field: "timeline", value: "Operational by December" },
      { field: "decisionMaker", value: "Caller is the founder" },
    ],
    classification: {
      verdict: "yes",
      reason: "Commercial fitout within our 3,000 sq ft scope, in service area, realistic timeline, decision-maker confirmed.",
      missingFields: [],
    },
    booked: true,
    designer: "Rohan",
    consultationDaysOut: 3,
    consultationHour: 12,
  },
  {
    key: "t07",
    file: "T07.md",
    startedAt: ist("2026-09-08T09:44:00"),
    durationSec: 195,
    status: "completed",
    phone: "+91-90000-20107",
    humanFollowup: true,
    answers: [
      { field: "propertyType", value: "Home" },
      { field: "workType", value: "Living room and kitchen redesign" },
      { field: "timeline", value: "Wanted done before Diwali (~3 weeks) — under 6-week minimum lead time" },
    ],
    classification: {
      verdict: "no",
      reason:
        "Requested timeline (~3 weeks) is under the 6-week minimum lead time. A November start was offered but the caller did not commit — said they'd think it over and call back.",
      reasonCode: "unrealistic_timeline",
      missingFields: [],
    },
    booked: false,
  },
  {
    key: "t08",
    file: "T08.md",
    startedAt: ist("2026-09-09T22:47:00"),
    durationSec: 0,
    status: "missed",
    phone: "+91-90000-20108",
    humanFollowup: true,
    answers: [],
    booked: false,
  },
  {
    key: "t09",
    file: "T09.md",
    startedAt: ist("2026-09-10T11:32:00"),
    durationSec: 352,
    status: "completed",
    phone: "+91-90000-20109",
    humanFollowup: true,
    answers: [{ field: "name", value: "Sheetal Deshpande" }],
    booked: false,
  },
  {
    key: "t10",
    file: "T10.md",
    startedAt: ist("2026-09-11T14:04:00"),
    durationSec: 220,
    status: "completed",
    phone: "+91-90000-20110",
    humanFollowup: false,
    answers: [
      { field: "propertyType", value: "Home" },
      { field: "area", value: "Kharadi" },
      { field: "sizeSqFt", value: "550" },
      { field: "workType", value: "Kitchen and one bedroom" },
      { field: "budget", value: "1 to 1.5 lakh maximum" },
    ],
    classification: {
      verdict: "no",
      reason: "Caller volunteered a budget (₹1-1.5 lakh) clearly below what a kitchen + bedroom full execution would cost.",
      reasonCode: "budget_mismatch",
      missingFields: [],
    },
    booked: false,
  },
  {
    key: "t11",
    file: "T11.md",
    startedAt: ist("2026-09-12T10:18:00"),
    durationSec: 382,
    status: "completed",
    phone: "+91-90000-20111",
    humanFollowup: false,
    answers: [
      { field: "propertyType", value: "Home (rented, 3-year lease, landlord approved)" },
      { field: "area", value: "Baner" },
      { field: "workType", value: "Living room, bedroom, kitchen — design and fittings only, no structural changes" },
    ],
    classification: {
      verdict: "maybe",
      reason: "Qualified — rented apartment is fine with no structural changes — but timeline wasn't captured on the call.",
      reasonCode: "incomplete_answers",
      missingFields: ["timeline"],
    },
    booked: true,
    designer: "Asha",
    consultationDaysOut: 5,
    consultationHour: 16,
  },
  {
    key: "t12",
    file: "T12.md",
    startedAt: ist("2026-09-15T10:05:00"),
    durationSec: 450,
    status: "completed",
    phone: "+91-90000-20112",
    humanFollowup: false,
    answers: [
      { field: "name", value: "Anand Sharma" },
      { field: "propertyType", value: "Villa (new construction, empty, possession last month)" },
      { field: "area", value: "Kalyani Nagar" },
      { field: "sizeSqFt", value: "5500 (ground + two floors)" },
      { field: "workType", value: "Full end-to-end design" },
      { field: "timeline", value: "Move in by March next year — no rush" },
    ],
    classification: {
      verdict: "yes",
      reason: "Large new-construction project, in service area, realistic timeline, requested a principal-designer site visit.",
      missingFields: [],
    },
    booked: true,
    designer: "Rohan",
    consultationDaysOut: 5,
    consultationHour: 11,
  },
  {
    key: "t13",
    file: "T13.md",
    startedAt: ist("2026-09-16T12:19:00"),
    durationSec: 368,
    status: "completed",
    phone: "+91-90000-20113",
    humanFollowup: false,
    answers: [
      { field: "propertyType", value: "Home" },
      { field: "area", value: "Aundh" },
      { field: "sizeSqFt", value: "1100" },
      { field: "workType", value: "Kitchen, wardrobes in both bedrooms, living room" },
      { field: "budget", value: "Pushed repeatedly for a ballpark; price guard held" },
    ],
    classification: {
      verdict: "maybe",
      reason: "Qualified — in area, real project — but timeline wasn't captured; caller pushed hard on pricing, worth flagging for the designer.",
      reasonCode: "incomplete_answers",
      missingFields: ["timeline"],
    },
    booked: true,
    designer: "Asha",
    consultationDaysOut: 4,
    consultationHour: 14,
  },
  {
    key: "t14",
    file: "T14.md",
    startedAt: ist("2026-09-17T11:41:00"),
    durationSec: 295,
    status: "completed",
    phone: "+91-90000-20114",
    humanFollowup: false,
    answers: [
      { field: "propertyType", value: "Home (new possession)" },
      { field: "area", value: "Hadapsar" },
      { field: "workType", value: "Proper full design for parents' 3BHK" },
      { field: "decisionMaker", value: "Caller is son; parents will attend consultation and decide" },
    ],
    classification: {
      verdict: "maybe",
      reason: "Decision-maker represented per rubric (parents will attend and decide) — qualified, but timeline wasn't captured.",
      reasonCode: "incomplete_answers",
      missingFields: ["timeline"],
    },
    booked: true,
    designer: "Rohan",
    consultationDaysOut: 6,
    consultationHour: 11,
  },
  {
    key: "t15",
    file: "T15.md",
    startedAt: ist("2026-09-18T15:12:00"),
    durationSec: 344,
    status: "completed",
    phone: "+91-90000-20115",
    humanFollowup: false,
    answers: [
      { field: "name", value: "Smita" },
      { field: "propertyType", value: "Home" },
      { field: "area", value: "Undri" },
      { field: "sizeSqFt", value: "875" },
      { field: "workType", value: "Full home — kitchen, wardrobes, living room" },
      { field: "timeline", value: "Possession in ~6 weeks — meets the minimum lead time" },
      { field: "decisionMaker", value: "Owner (caller) and husband, both agreed" },
    ],
    classification: {
      verdict: "yes",
      reason: "Real project, in service area, timeline right at the minimum lead time, both owners aligned.",
      missingFields: [],
    },
    booked: true,
    designer: "Asha",
    consultationDaysOut: 3,
    consultationHour: 11,
  },
  {
    key: "t16",
    file: "T16.md",
    startedAt: ist("2026-09-19T10:38:00"),
    durationSec: 318,
    status: "completed",
    phone: "+91-90000-20116",
    humanFollowup: true,
    answers: [
      { field: "name", value: "Girish Nair" },
      { field: "area", value: "Viman Nagar" },
      { field: "propertyType", value: "3BHK" },
    ],
    classification: {
      verdict: "maybe",
      reason:
        "Service-recovery case: original enquiry (Monday) was never logged, caller followed up frustrated. Re-logged and booked directly; scope and timeline still need confirming at consultation.",
      reasonCode: "incomplete_answers",
      missingFields: ["workType", "timeline"],
    },
    booked: true,
    designer: "Rohan",
    consultationDaysOut: 2,
    consultationHour: 11,
  },
  {
    key: "t17a",
    file: "T17.md",
    startedAt: ist("2026-09-22T14:14:00"),
    durationSec: 72,
    status: "dropped",
    phone: "+91-90000-20117",
    humanFollowup: true,
    answers: [],
    booked: false,
  },
  {
    key: "t17b",
    file: "T17.md",
    startedAt: ist("2026-09-22T14:16:00"),
    durationSec: 270,
    status: "completed",
    phone: "+91-90000-20117",
    humanFollowup: false,
    answers: [
      { field: "name", value: "Ritu Kapoor" },
      { field: "propertyType", value: "Home" },
      { field: "area", value: "Pimple Saudagar" },
      { field: "sizeSqFt", value: "1050" },
      { field: "workType", value: "Kitchen, wardrobes, living room — builder furniture, never done interiors" },
      { field: "timeline", value: "By March — plenty of time" },
    ],
    classification: {
      verdict: "yes",
      reason: "Real project, in service area (PCMC), realistic timeline. Caller called back immediately after a dropped line.",
      missingFields: [],
    },
    booked: true,
    designer: "Asha",
    consultationDaysOut: 5,
    consultationHour: 11,
  },
  {
    key: "t18",
    file: "T18.md",
    startedAt: ist("2026-09-23T11:55:00"),
    durationSec: 182,
    status: "completed",
    phone: "+91-90000-20118",
    humanFollowup: false,
    answers: [
      { field: "propertyType", value: "Commercial — coworking pod" },
      { field: "sizeSqFt", value: "180" },
      { field: "workType", value: "Lighting, desk, storage for a single pod" },
    ],
    classification: {
      verdict: "no",
      reason: "180 sq ft is below our commercial minimum scope (500 sq ft) — not a fit for our fitout team's scale.",
      reasonCode: "below_minimum_scope",
      missingFields: [],
    },
    booked: false,
  },
  {
    key: "t19",
    file: "T19.md",
    startedAt: ist("2026-09-24T16:02:00"),
    durationSec: 170,
    status: "completed",
    phone: "+91-90000-20119",
    humanFollowup: false,
    answers: [
      { field: "propertyType", value: "Commercial — restaurant" },
      { field: "area", value: "Koregaon Park" },
      { field: "workType", value: "Full restaurant interior design" },
    ],
    classification: {
      verdict: "no",
      reason: "Restaurant/hospitality interiors are outside our scope — different material and compliance requirements than our residential/office focus.",
      reasonCode: "not_our_scope",
      missingFields: [],
    },
    booked: false,
  },
  {
    key: "t20",
    file: "T20.md",
    startedAt: ist("2026-09-25T09:15:00"),
    durationSec: 284,
    status: "completed",
    phone: "+91-90000-20120",
    humanFollowup: false,
    answers: [
      { field: "name", value: "Pooja" },
      { field: "propertyType", value: "Home" },
      { field: "area", value: "Magarpatta (Cybercity)" },
      { field: "sizeSqFt", value: "900" },
      { field: "workType", value: "Kitchen, both bedrooms, living room" },
      { field: "timeline", value: "Flexible — January start for execution" },
      { field: "decisionMaker", value: "Owner (caller) and husband, both attending consultation" },
    ],
    classification: {
      verdict: "yes",
      reason: "Real project, in service area, flexible and realistic timeline, both owners aligned.",
      missingFields: [],
    },
    booked: true,
    designer: "Rohan",
    consultationDaysOut: 4,
    consultationHour: 10,
  },
];

// Outcomes for bookings whose consultation (per consultationDaysOut) has already
// passed relative to "today" (2026-10-09, per the assignment's reference date).
// Two bookings (t12, t17b) are deliberately left without an outcome to populate
// the dashboard's "open pipeline" estimate rather than making everything terminal.
const OUTCOMES: Record<string, { outcome: "held" | "no_show" | "not_fit" | "won"; amountInr?: string; daysAfterConsultation: number }> = {
  t01: { outcome: "won", amountInr: "2800000.00", daysAfterConsultation: 6 },
  t02: { outcome: "held", daysAfterConsultation: 3 },
  t05: { outcome: "won", amountInr: "6500000.00", daysAfterConsultation: 8 },
  t06: { outcome: "won", amountInr: "1400000.00", daysAfterConsultation: 5 },
  t11: { outcome: "not_fit", daysAfterConsultation: 4 },
  t13: { outcome: "no_show", daysAfterConsultation: 1 },
  t14: { outcome: "held", daysAfterConsultation: 2 },
  t15: { outcome: "won", amountInr: "1900000.00", daysAfterConsultation: 5 },
  t16: { outcome: "won", amountInr: "2400000.00", daysAfterConsultation: 7 },
  t20: { outcome: "won", amountInr: "2100000.00", daysAfterConsultation: 4 },
};

async function main() {
  const db = getDb();

  const designerRows = await db.select().from(designers).where(inArray(designers.name, ["Asha", "Rohan"]));
  const designerIdByName = new Map(designerRows.map((d) => [d.name, d.id]));
  if (designerIdByName.size !== 2) {
    throw new Error("Expected designers Asha and Rohan to already be seeded (run `npm run seed` first).");
  }

  const bookingByKey = new Map<string, { id: string; startAt: Date }>();

  for (const c of CALLS) {
    const vaaniCallId = `sept-${c.key}`;
    const afterHours = isAfterHoursIst(c.startedAt);
    const endedAt = plusSec(c.startedAt, c.durationSec);

    const [call] = await db
      .insert(calls)
      .values({
        vaaniCallId,
        callerPhone: c.phone,
        startedAt: c.startedAt,
        answeredAt: c.status === "missed" ? null : c.startedAt,
        endedAt,
        durationSec: c.durationSec,
        afterHours,
        route: afterHours ? "after_hours" : "forwarded",
        status: c.status,
        transcript: transcript(c.file),
        humanFollowup: c.humanFollowup,
        createdAt: c.startedAt,
      })
      .returning();
    console.log(`Seeded call ${c.key} (${call.id}) — ${c.status}`);

    if (c.answers.length > 0) {
      await db.insert(answers).values(c.answers.map((a) => ({ callId: call.id, field: a.field, value: a.value, createdAt: endedAt })));
    }

    if (c.classification) {
      await db.insert(classifications).values({
        callId: call.id,
        verdict: c.classification.verdict,
        reason: c.classification.reason,
        reasonCode: c.classification.reasonCode,
        missingFields: c.classification.missingFields,
        model: "mock-gemini",
        latencyMs: 1,
        createdAt: endedAt,
      });
    }

    if (c.booked && c.designer && c.consultationDaysOut !== undefined && c.consultationHour !== undefined) {
      const bookingCreatedAt = plusSec(endedAt, 20);
      const startAt = plusDays(c.startedAt, c.consultationDaysOut, c.consultationHour);
      const [booking] = await db
        .insert(bookings)
        .values({
          callId: call.id,
          calcomUid: `seed-${c.key}`,
          designerId: designerIdByName.get(c.designer),
          startAt,
          meetUrl: `https://meet.google.com/seed-${c.key}`,
          status: "confirmed",
          createdAt: bookingCreatedAt,
        })
        .returning();
      bookingByKey.set(c.key, { id: booking.id, startAt });

      const notifiedAt = plusSec(bookingCreatedAt, 15);
      await db.insert(notifications).values({
        callId: call.id,
        channel: "email",
        status: "sent",
        attempts: 1,
        sentAt: notifiedAt,
        createdAt: bookingCreatedAt,
      });

      const syncedAt = plusSec(notifiedAt, 10);
      await db.insert(hubspotSync).values({
        callId: call.id,
        contactId: `seed-contact-${c.key}`,
        dealId: `seed-deal-${c.key}`,
        status: "synced",
        attempts: 1,
        createdAt: syncedAt,
      });
    }
  }

  for (const [key, o] of Object.entries(OUTCOMES)) {
    const booking = bookingByKey.get(key);
    if (!booking) continue;
    await db.insert(outcomes).values({
      bookingId: booking.id,
      outcome: o.outcome,
      amountInr: o.amountInr,
      recordedAt: plusDays(booking.startAt, o.daysAfterConsultation, 17),
    });
    console.log(`Recorded outcome for ${key}: ${o.outcome}`);
  }

  console.log("Seed complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
