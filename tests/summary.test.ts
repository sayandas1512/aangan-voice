import { describe, expect, it } from "vitest";
import { summarizeCall } from "@/lib/domain/summary";

describe("summarizeCall", () => {
  it("returns a mock summary for a clean transcript (price guard passes without touching the DB)", async () => {
    const summary = await summarizeCall("Front Desk: Hello.\nCaller: Hi, I'd like a consultation.");
    expect(summary).toContain("[mock summary]");
  });

  const hasDb = Boolean(process.env.DATABASE_URL);
  it.skipIf(!hasDb)("falls back and logs a guard violation if the transcript itself leads the mock summary to echo a price", async () => {
    // The mock summarizer just echoes the first lines of the transcript, so
    // feeding it transcript text containing price language is the simplest
    // way to exercise the guard's fallback path end to end.
    const summary = await summarizeCall("Front Desk: that would be about 10 lakh for the full scope.");
    expect(summary).not.toContain("lakh");
    expect(summary).toContain("Summary unavailable");
  });
});
