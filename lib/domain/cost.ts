export interface CallCostInput {
  voiceMinutes: number;
  geminiTokens: number;
  voiceCostInrPerMin: number;
  geminiCostInrPer1kTokens: number;
}

export interface CallCostBreakdown {
  voiceCostInr: number;
  geminiCostInr: number;
  totalInr: number;
}

/** Per-call cost line items (brief section 10's "Cost" panel). */
export function computeCallCost(input: CallCostInput): CallCostBreakdown {
  const voiceCostInr = round2(input.voiceMinutes * input.voiceCostInrPerMin);
  const geminiCostInr = round2((input.geminiTokens / 1000) * input.geminiCostInrPer1kTokens);
  return { voiceCostInr, geminiCostInr, totalInr: round2(voiceCostInr + geminiCostInr) };
}

/** Spreads a monthly fixed cost (env OTHER_FIXED_COST_INR_PER_MONTH) evenly across the month's calls. */
export function monthlyFixedCostPerCall(otherFixedCostInrPerMonth: number, callsInMonth: number): number {
  if (callsInMonth <= 0) return 0;
  return round2(otherFixedCostInrPerMonth / callsInMonth);
}

export function costPerUnit(totalCostInr: number, unitCount: number): number {
  if (unitCount <= 0) return 0;
  return round2(totalCostInr / unitCount);
}

export interface PipelineEstimate {
  low: number;
  high: number;
}

/**
 * Estimated pipeline value from open (not-yet-won) qualified deals, using
 * the configurable average project value range. Always labelled an
 * ESTIMATE by the caller — brief section 10 is explicit that this must
 * never be mixed into the same number as actual won value.
 */
export function estimatedPipelineValue(openDealsCount: number, avgLowInr: number, avgHighInr: number): PipelineEstimate {
  return {
    low: round2(openDealsCount * avgLowInr),
    high: round2(openDealsCount * avgHighInr),
  };
}

/** Actual realized value from designer-reported "won" outcomes. */
export function actualWonValue(wonAmountsInr: number[]): number {
  return round2(wonAmountsInr.reduce((sum, v) => sum + v, 0));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
