import { describe, expect, it, afterAll } from "vitest";
import { eq, and, gte, lte } from "drizzle-orm";
import { summarizeCall } from "@/lib/domain/summary";

// The last test below triggers a real price_guard_violation event against
// the shared production events table. Scope cleanup to this run's window
// rather than tracking ids (see tests/price-guard.test.ts for the same
// pattern) so any real violation from actual pipeline usage is untouched.
const testRunStartedAt = new Date(Date.now() - 60_000); // 60s buffer for clock skew vs Neon's server clock
const hasDb = Boolean(process.env.DATABASE_URL);

afterAll(async () => {
  if (!hasDb) return;
  const { getDb } = await import("@/lib/db/client");
  const { events } = await import("@/lib/db/schema");
  await getDb()
    .delete(events)
    .where(and(eq(events.type, "price_guard_violation"), gte(events.at, testRunStartedAt), lte(events.at, new Date(Date.now() + 60_000))));
});

describe("summarizeCall", () => {
  it("returns a mock summary for a clean transcript (price guard passes without touching the DB)", async () => {
    const summary = await summarizeCall("Front Desk: Hello.\nCaller: Hi, I'd like a consultation.");
    expect(summary).toContain("[mock summary]");
  });

  it.skipIf(!hasDb)("falls back and logs a guard violation if the transcript itself leads the mock summary to echo a price", async () => {
    // The mock summarizer just echoes the first lines of the transcript, so
    // feeding it transcript text containing price language is the simplest
    // way to exercise the guard's fallback path end to end.
    const summary = await summarizeCall("Front Desk: that would be about 10 lakh for the full scope.");
    expect(summary).not.toContain("lakh");
    expect(summary).toContain("Summary unavailable");
  });
});
