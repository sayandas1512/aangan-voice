import { describe, expect, it } from "vitest";
import { buildDesignerNote, type DesignerNoteInput } from "@/lib/domain/note";

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

  const hasDb = Boolean(process.env.DATABASE_URL);
  it.skipIf(!hasDb)("falls back to a safe note if the reason/summary text accidentally contains price language", async () => {
    const note = await buildDesignerNote(
      baseInput({ reason: "caller said their budget is about 10 lakh and that feels affordable" })
    );
    expect(note).not.toContain("lakh");
    expect(note).toContain("price guard");
  });
});
