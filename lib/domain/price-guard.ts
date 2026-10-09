import { logEvent } from "@/lib/db/queries";

export interface PriceGuardResult {
  violated: boolean;
  matches: string[];
}

// Deliberately broad: a false positive (blocking safe text) is far cheaper
// than a false negative (a price leaking to a caller or designer). English
// and Hindi-transliterated terms both included per brief section 7.
const PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "rupee_symbol", regex: /[₹]/ },
  { name: "rs_amount", regex: /\bRs\.?\s?\d/i },
  { name: "inr_amount", regex: /\bINR\s?\d/i },
  { name: "lakh", regex: /\blakhs?\b/i },
  { name: "crore", regex: /\bcrores?\b/i },
  { name: "per_sq", regex: /\bper\s?(sq|square)\b/i },
  { name: "rate_word", regex: /\brate\b/i },
  { name: "numeric_range_near_currency", regex: /\d+\s*(?:-|to)\s*\d+\s*(?:lakh|crore|rs|inr|₹)/i },
  { name: "expensive_cheap_en", regex: /\b(expensive|cheap|costly|affordable|pricey)\b/i },
  // Hindi-transliterated: sasta (cheap), mehenga/mehnga (expensive), keemat (price/cost), daam (price)
  { name: "expensive_cheap_hi", regex: /\b(sasta|sasti|mehenga|mehnga|mehengi|keemat|daam)\b/i },
];

export function checkPriceGuard(text: string): PriceGuardResult {
  const matches = PATTERNS.filter((p) => p.regex.test(text)).map((p) => p.name);
  return { violated: matches.length > 0, matches };
}

/**
 * Scans any system-generated text headed for a caller or designer (agent
 * strings, Gemini summaries, Telegram notes). On a hit: logs a
 * price_guard_violation event and returns the fallback instead of the
 * original text — it never returns flagged text, even partially.
 *
 * Designer-entered "won" amounts are NOT generated text and must not be
 * passed through this guard — see brief section 7.
 */
export async function enforcePriceGuard(
  text: string,
  fallback: string,
  context?: { callId?: string; source?: string }
): Promise<string> {
  const result = checkPriceGuard(text);
  if (!result.violated) {
    return text;
  }
  await logEvent("price_guard_violation", {
    source: context?.source ?? "unknown",
    callId: context?.callId,
    matches: result.matches,
    textLength: text.length,
  });
  return fallback;
}
