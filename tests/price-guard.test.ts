import { describe, expect, it } from "vitest";
import { checkPriceGuard, enforcePriceGuard } from "@/lib/domain/price-guard";

describe("checkPriceGuard", () => {
  it("passes clean text with no price language", () => {
    const result = checkPriceGuard(
      "Thanks for calling. The designer will go through the scope at the consultation and confirm everything with you."
    );
    expect(result.violated).toBe(false);
    expect(result.matches).toEqual([]);
  });

  it.each([
    ["₹8,00,000", "rupee_symbol"],
    ["Rs 50000 for the kitchen", "rs_amount"],
    ["INR 900000 total", "inr_amount"],
    ["around 8 to 14 lakh for a full home", "lakh"],
    ["budget of 1.2 crore", "crore"],
    ["our rate is per sq ft", "per_sq"],
    ["ask about the rate card", "rate_word"],
    ["somewhere between 8-14 lakh", "numeric_range_near_currency"],
    ["that would be quite expensive for this scope", "expensive_cheap_en"],
    ["kaafi sasta hoga", "expensive_cheap_hi"],
    ["bahut mehenga padega", "expensive_cheap_hi"],
  ])("flags %j", (text, expectedMatch) => {
    const result = checkPriceGuard(text);
    expect(result.violated).toBe(true);
    expect(result.matches).toContain(expectedMatch);
  });

  it("blocks even unrelated, non-price uses of 'rate' (false positives are cheaper than leaks)", () => {
    // Documents a deliberate trade-off in price-guard.ts: "rate" and
    // "per sq" are broad enough to catch some non-price sentences too.
    const result = checkPriceGuard("We'll rate your satisfaction after the project.");
    expect(result.violated).toBe(true);
  });
});

describe("enforcePriceGuard", () => {
  it("returns the original text unchanged when clean", async () => {
    const text = "The designer will confirm the scope at the consultation.";
    const result = await enforcePriceGuard(text, "fallback");
    expect(result).toBe(text);
  });

  const hasDb = Boolean(process.env.DATABASE_URL);
  it.skipIf(!hasDb)("returns the fallback and logs an event when text is flagged", async () => {
    const result = await enforcePriceGuard("that'll be around 10 lakh", "Let's discuss specifics at the consultation.", {
      source: "test",
    });
    expect(result).toBe("Let's discuss specifics at the consultation.");
  });
});
