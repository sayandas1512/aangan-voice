import { describe, expect, it } from "vitest";
import {
  computeCallCost,
  monthlyFixedCostPerCall,
  costPerUnit,
  estimatedPipelineValue,
  actualWonValue,
} from "@/lib/domain/cost";

describe("computeCallCost", () => {
  it("multiplies voice minutes and gemini tokens by their configured rates", () => {
    const result = computeCallCost({
      voiceMinutes: 4,
      geminiTokens: 2000,
      voiceCostInrPerMin: 2.5,
      geminiCostInrPer1kTokens: 0.5,
    });
    expect(result.voiceCostInr).toBe(10);
    expect(result.geminiCostInr).toBe(1);
    expect(result.totalInr).toBe(11);
  });

  it("returns zero cost when rates are unset (brief default: unknown rates)", () => {
    const result = computeCallCost({
      voiceMinutes: 4,
      geminiTokens: 2000,
      voiceCostInrPerMin: 0,
      geminiCostInrPer1kTokens: 0,
    });
    expect(result.totalInr).toBe(0);
  });
});

describe("monthlyFixedCostPerCall", () => {
  it("spreads a fixed monthly cost evenly across the month's calls", () => {
    expect(monthlyFixedCostPerCall(10000, 200)).toBe(50);
  });

  it("returns 0 when there were no calls, instead of dividing by zero", () => {
    expect(monthlyFixedCostPerCall(10000, 0)).toBe(0);
  });
});

describe("costPerUnit", () => {
  it("divides total cost by a unit count (per-call, per-lead, per-booking)", () => {
    expect(costPerUnit(1000, 40)).toBe(25);
  });

  it("returns 0 for a zero unit count", () => {
    expect(costPerUnit(1000, 0)).toBe(0);
  });
});

describe("estimatedPipelineValue and actualWonValue stay separate", () => {
  it("estimates pipeline value from open deal count and the configured average range", () => {
    const estimate = estimatedPipelineValue(5, 800000, 1400000);
    expect(estimate.low).toBe(4000000);
    expect(estimate.high).toBe(7000000);
  });

  it("sums actual won amounts independently of the estimate", () => {
    expect(actualWonValue([900000, 1100000])).toBe(2000000);
  });
});
