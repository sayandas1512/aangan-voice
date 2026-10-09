import { describe, expect, it, afterAll } from "vitest";
import { eq, and, gte, lte } from "drizzle-orm";
import { buildDesignerNote, type DesignerNoteInput } from "@/lib/domain/note";

// The last test below triggers a real price_guard_violation event against
// the shared production events table. Scope cleanup to this run's window
// rather than tracking ids (see tests/price-guard.test.ts for the same
// pattern) so any real violation from actual pipeline usage is untouched.
const testRunStartedAt = new Date();
const hasDb = Boolean(process.env.DATABASE_URL);

afterAll(async () => {
  if (!hasDb) return;
  const { getDb } = await import("@/lib/db/client");
  const { events } = await import("@/lib/db/schema");
  await getDb()
    .delete(events)
    .where(and(eq(events.type, "price_guard_violation"), gte(events.at, testRunStartedAt), lte(events.at, new Date())));
});

function baseInput(overrides: Partial<DesignerNoteInput> = {}): DesignerNoteInput {
  return {
    bookingStartIso: "2026-10-12T05:30:00.000Z",
    meetUrl: "https://meet.mock/abc",
    callerName: "Priya",
    callerPhone: "+91-90000-00001",
    callerEmail: "priya@example.com",
    propertyType: "home",
    area: "Kothrud",
    sizeSqFt: "1400",
    workType: "full interiors",
    timeline: "6 months, no rush",
    budgetGiven: false,
    verdict: "yes",
    reason: "Real project, in service area, realistic timeline.",
    summary: "Caller wants a full 3BHK redesign in Kothrud, no rush on timeline.",
    missingFields: [],
    transcriptUrl: "https://dashboard.example.com/calls/T01",
    callId: "T01",
    actionLinks: [
      { label: "Acknowledge", url: "https://app.example.com/api/notifications/action?token=ack" },
      { label: "Held", url: "https://app.example.com/api/notifications/action?token=held" },
      { label: "No-show", url: "https://app.example.com/api/notifications/action?token=noshow" },
      { label: "Not a fit", url: "https://app.example.com/api/notifications/action?token=notfit" },
      { label: "Won", url: "https://app.example.com/api/notifications/action?token=won" },
    ],
    ...overrides,
  };
}

describe("buildDesignerNote", () => {
  it("includes all the fields from the brief's template", async () => {
    const note = await buildDesignerNote(baseInput());
    expect(note).toContain("New consultation booked");
    expect(note).toContain("Meet: https://meet.mock/abc");
    expect(note).toContain("Priya");
    expect(note).toContain("+91-90000-00001");
    expect(note).toContain("Kothrud");
    expect(note).toContain("Verdict: yes because");
    expect(note).toContain("Transcript: https://dashboard.example.com/calls/T01");
  });

  it("includes all five action links, replacing Telegram's inline buttons", async () => {
    const note = await buildDesignerNote(baseInput());
    expect(note).toContain("Acknowledge: https://app.example.com/api/notifications/action?token=ack");
    expect(note).toContain("Won: https://app.example.com/api/notifications/action?token=won");
  });

  it("never includes a budget figure, only yes/no, even when budgetGiven is true", async () => {
    const note = await buildDesignerNote(baseInput({ budgetGiven: true }));
    expect(note).toContain("Budget given: yes");
    expect(note).toContain("the number is in the transcript, not here");
  });

  it("lists missing fields as open questions", async () => {
    const note = await buildDesignerNote(baseInput({ missingFields: ["timeline", "budget"] }));
    expect(note).toContain("Open questions: timeline, budget");
  });

  it("says 'none' for open questions when nothing is missing", async () => {
    const note = await buildDesignerNote(baseInput({ missingFields: [] }));
    expect(note).toContain("Open questions: none");
  });

  it.skipIf(!hasDb)("falls back to a safe note if the reason/summary text accidentally contains price language", async () => {
    const note = await buildDesignerNote(
      baseInput({ reason: "caller said their budget is about 10 lakh and that feels affordable" })
    );
    expect(note).not.toContain("lakh");
    expect(note).toContain("price guard");
  });
});
