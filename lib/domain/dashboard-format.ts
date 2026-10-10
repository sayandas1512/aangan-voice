/**
 * Pure presentation helpers for the founder dashboard — no DB, no env, so
 * they're cheap to unit-test. Anything that needs the studio's timezone
 * takes it as a parameter (defaulting to IST) rather than importing env.
 */

export const STUDIO_TZ = "Asia/Kolkata";

// ---------------------------------------------------------------------------
// Date range
// ---------------------------------------------------------------------------
export type RangeKey = "7d" | "30d" | "all";

export function parseRange(value: string | undefined): RangeKey {
  return value === "7d" || value === "30d" ? value : "all";
}

export function rangeSince(range: RangeKey, now: Date = new Date()): Date | undefined {
  if (range === "all") return undefined;
  const days = range === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export const RANGE_LABELS: Record<RangeKey, string> = {
  "7d": "7 days",
  "30d": "30 days",
  all: "All time",
};

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------
/** ₹1,23,456 — full Indian digit grouping. */
export function formatInr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** ₹28 L / ₹1.2 Cr — how an Indian founder actually reads a deal size. */
export function formatInrCompact(n: number): string {
  const abs = Math.abs(n);
  const trim = (v: number) => String(Number(v.toFixed(2)));
  if (abs >= 1e7) return `₹${trim(n / 1e7)} Cr`;
  if (abs >= 1e5) return `₹${trim(n / 1e5)} L`;
  return formatInr(n);
}

export function formatPct(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** 252 -> "4m 12s", 45 -> "45s", 0 -> "—". */
export function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/** Latency in seconds, human-sized: "18s", "2.5 min". */
export function formatLatency(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return "—";
  if (sec < 90) return `${Math.round(sec)}s`;
  return `${(sec / 60).toFixed(1)} min`;
}

// ---------------------------------------------------------------------------
// Dates — always rendered in the studio's timezone. The server runs in UTC
// (Vercel), so Date#toLocaleString() with no timeZone would show the founder
// times that are 5½ hours off.
// ---------------------------------------------------------------------------
export function formatTime(d: Date, tz: string = STUDIO_TZ): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true })
    .format(d)
    .toLowerCase();
}

export function formatDateTime(d: Date, tz: string = STUDIO_TZ): string {
  const date = new Intl.DateTimeFormat("en-IN", { timeZone: tz, day: "numeric", month: "short" }).format(d);
  return `${date}, ${formatTime(d, tz)}`;
}

export function formatDate(d: Date, tz: string = STUDIO_TZ): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);
}

/** YYYY-MM-DD in the given timezone (en-CA formats ISO-style). */
export function dayKey(d: Date, tz: string = STUDIO_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** "3 min ago", "2 h ago", "5 d ago", then a date. */
export function timeAgo(d: Date, now: Date = new Date(), tz: string = STUDIO_TZ): string {
  const sec = Math.round((now.getTime() - d.getTime()) / 1000);
  if (sec < 0) return formatDateTime(d, tz);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h ago`;
  if (sec < 86400 * 14) return `${Math.floor(sec / 86400)} d ago`;
  return formatDate(d, tz);
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------
const REASON_LABELS: Record<string, string> = {
  out_of_area: "Outside Pune / PCMC",
  advisory_only: "Wanted advice, not a project",
  unrealistic_timeline: "Timeline too short",
  budget_mismatch: "Budget below scope",
  budget_misalignment: "Budget below scope",
  below_minimum_scope: "Space too small for us",
  not_our_scope: "Not work we take on",
  incomplete_answers: "Details still missing",
  classify_timeout: "Needs a human to confirm",
  unspecified: "No reason recorded",
};

/** Turns a machine reason code (any casing, from the mock or the live model) into plain English. */
export function reasonLabel(code: string | null | undefined): string {
  if (!code) return REASON_LABELS.unspecified;
  const key = code.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (REASON_LABELS[key]) return REASON_LABELS[key];
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type PillTone = "good" | "warn" | "bad" | "info" | "neutral" | "brand";

export function verdictTone(verdict: string | null | undefined): PillTone {
  if (verdict === "yes") return "good";
  if (verdict === "maybe") return "warn";
  if (verdict === "no") return "neutral";
  return "neutral";
}

export const OUTCOME_LABELS: Record<string, string> = {
  won: "Won",
  held: "Consultation held",
  no_show: "No-show",
  not_fit: "Not a fit",
};

export function outcomeTone(outcome: string | null | undefined): PillTone {
  if (outcome === "won") return "good";
  if (outcome === "held") return "info";
  if (outcome === "no_show") return "warn";
  if (outcome === "not_fit") return "neutral";
  return "neutral";
}

/** The "furthest along" outcome wins when a booking has several (held, then won). */
const OUTCOME_RANK: Record<string, number> = { held: 1, no_show: 2, not_fit: 2, won: 3 };
export function strongestOutcome<T extends { outcome: string }>(outcomes: T[]): T | undefined {
  return [...outcomes].sort((a, b) => (OUTCOME_RANK[b.outcome] ?? 0) - (OUTCOME_RANK[a.outcome] ?? 0))[0];
}

// ---------------------------------------------------------------------------
// Project one-liner from collected answers
// ---------------------------------------------------------------------------
export function projectLine(answers: Record<string, string | undefined>): string {
  const size = answers.sizeSqFt ? `${String(answers.sizeSqFt).replace(/[^\d,.]/g, "") || answers.sizeSqFt} sq ft` : undefined;
  const parts = [answers.area, size, answers.propertyType].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(" · ") : "—";
}

// ---------------------------------------------------------------------------
// Transcript -> chat turns
// ---------------------------------------------------------------------------
export interface TranscriptTurn {
  kind: "agent" | "caller" | "note" | "caption";
  speaker: string;
  text: string;
}

const AGENT_SPEAKERS = /^(front desk|agent|ai|assistant|bot|aangan|designer)/i;
const CALLER_SPEAKERS = /^(caller|user|customer|client|human|lead|prospect)/i;

/**
 * Seeded transcripts are "Front Desk: …" / "Caller: …" plus a "# T01 · …"
 * heading; live Vaani transcripts are "Agent: …" / "User: …". Anything that
 * isn't a recognised speaker line becomes a muted caption (e.g. "Second
 * call — 4 min 30 sec") instead of being dropped or mangled.
 */
export function parseTranscript(raw: string | null | undefined): { title?: string; turns: TranscriptTurn[] } {
  if (!raw) return { turns: [] };
  const turns: TranscriptTurn[] = [];
  let title: string | undefined;

  // Live Vaani transcripts prefix every turn with "[10:39:56] " (and may put
  // several turns on one line): break before each stamp, then drop it.
  const normalised = raw.replace(/\s*(\[\d{1,2}:\d{2}:\d{2}\])\s+/g, "\n$1 ");
  for (const line of normalised.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^\[\d{1,2}:\d{2}:\d{2}\]\s+/, "");
    if (!trimmed) continue;

    if (trimmed.startsWith("#")) {
      title = trimmed.replace(/^#+\s*/, "").replace(/^T\d+\s*[·-]\s*/, "");
      continue;
    }

    const match = trimmed.match(/^([A-Za-z][A-Za-z .'-]{0,24}):\s*(.*)$/);
    if (!match) {
      turns.push({ kind: "caption", speaker: "", text: trimmed });
      continue;
    }

    const [, speaker, text] = match;
    if (/^note$/i.test(speaker)) {
      turns.push({ kind: "note", speaker: "Note", text });
    } else if (AGENT_SPEAKERS.test(speaker)) {
      turns.push({ kind: "agent", speaker, text });
    } else if (CALLER_SPEAKERS.test(speaker)) {
      turns.push({ kind: "caller", speaker, text });
    } else {
      // A named speaker ("Priya: …") is the person on the other end.
      turns.push({ kind: "caller", speaker, text });
    }
  }

  return { title, turns };
}

/** The caller's first real line — used as a preview in the attention list. */
export function firstCallerLine(raw: string | null | undefined, maxLen = 140): string | undefined {
  const first = parseTranscript(raw).turns.find((t) => t.kind === "caller" && t.text.length > 8);
  if (!first) return undefined;
  return first.text.length > maxLen ? `${first.text.slice(0, maxLen - 1).trimEnd()}…` : first.text;
}

// ---------------------------------------------------------------------------
// HubSpot deep link
// ---------------------------------------------------------------------------
/**
 * Real HubSpot deal ids are purely numeric; mock/seed ids ("mock-deal-3",
 * "seed-deal-t01") are not, and must not produce a link that opens a
 * "record not found" page.
 */
export function hubspotDealUrl(
  dealId: string | null | undefined,
  portalId: string | undefined,
  appBase: string
): string | undefined {
  if (!dealId || !portalId || !/^\d+$/.test(dealId)) return undefined;
  return `${appBase.replace(/\/$/, "")}/contacts/${portalId}/record/0-3/${dealId}`;
}

// ---------------------------------------------------------------------------
// Did the caller ask what it costs?
// ---------------------------------------------------------------------------
const PRICE_ASK = /\b(how much|cost|costs|price|prices|pricing|ballpark|per sq(?:uare)?\.? ?f(?:ee|oo)?t|rates?|charges?|quote)\b/i;

/**
 * True when a CALLER (not the assistant) asked about money. The brief wants
 * the system to "quote standard per-square-foot pricing" while `pricing.md`
 * says never to — so the dashboard shows how often it was asked and what
 * happened anyway (see computeMetrics().price). Deliberately matches only
 * caller turns, and not a bare "budget", which callers volunteer rather than ask.
 */
export function callerAskedForPrice(raw: string | null | undefined): boolean {
  return parseTranscript(raw).turns.some((t) => t.kind === "caller" && PRICE_ASK.test(t.text));
}
