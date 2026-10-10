import { describe, expect, it } from "vitest";
import {
  dayKey,
  firstCallerLine,
  formatDateTime,
  formatDuration,
  formatInr,
  formatInrCompact,
  formatLatency,
  hubspotDealUrl,
  parseRange,
  parseTranscript,
  projectLine,
  rangeSince,
  reasonLabel,
  strongestOutcome,
  timeAgo,
} from "@/lib/domain/dashboard-format";

describe("range", () => {
  it("defaults to all time for missing/unknown values", () => {
    expect(parseRange(undefined)).toBe("all");
    expect(parseRange("bogus")).toBe("all");
    expect(parseRange("7d")).toBe("7d");
  });

  it("computes the window start", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    expect(rangeSince("all", now)).toBeUndefined();
    expect(rangeSince("7d", now)?.toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(rangeSince("30d", now)?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });
});

describe("number formatting", () => {
  it("groups rupees the Indian way", () => {
    expect(formatInr(2800000)).toBe("₹28,00,000");
    expect(formatInr(950)).toBe("₹950");
  });

  it("compacts to lakh / crore", () => {
    expect(formatInrCompact(2800000)).toBe("₹28 L");
    expect(formatInrCompact(6500000)).toBe("₹65 L");
    expect(formatInrCompact(12500000)).toBe("₹1.25 Cr");
    expect(formatInrCompact(48000)).toBe("₹48,000");
  });

  it("formats durations and latencies", () => {
    expect(formatDuration(252)).toBe("4m 12s");
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(null)).toBe("—");
    expect(formatLatency(18)).toBe("18s");
    expect(formatLatency(150)).toBe("2.5 min");
    expect(formatLatency(null)).toBe("—");
  });
});

describe("dates are shown in IST, not the server's UTC", () => {
  // 04:53 UTC is 10:23 am in India (UTC+5:30).
  const d = new Date("2026-09-02T04:53:00Z");

  it("renders studio-local time", () => {
    expect(formatDateTime(d)).toBe("2 Sept, 10:23 am");
  });

  it("buckets days by studio-local calendar day", () => {
    // 22:00 UTC on the 2nd is already 3:30 am on the 3rd in India.
    expect(dayKey(new Date("2026-09-02T22:00:00Z"))).toBe("2026-09-03");
    expect(dayKey(new Date("2026-09-02T04:53:00Z"))).toBe("2026-09-02");
  });

  it("describes recency", () => {
    const now = new Date("2026-09-02T05:00:00Z");
    expect(timeAgo(new Date("2026-09-02T04:59:40Z"), now)).toBe("just now");
    expect(timeAgo(new Date("2026-09-02T04:30:00Z"), now)).toBe("30 min ago");
    expect(timeAgo(new Date("2026-09-02T01:00:00Z"), now)).toBe("4 h ago");
    expect(timeAgo(new Date("2026-08-30T05:00:00Z"), now)).toBe("3 d ago");
  });
});

describe("reasonLabel", () => {
  it("translates the codes the mock classifier emits", () => {
    expect(reasonLabel("out_of_area")).toBe("Outside Pune / PCMC");
    expect(reasonLabel("advisory_only")).toBe("Wanted advice, not a project");
    expect(reasonLabel("budget_mismatch")).toBe("Budget below scope");
  });

  it("handles the live model's shouted variants", () => {
    expect(reasonLabel("BUDGET_MISALIGNMENT")).toBe("Budget below scope");
    expect(reasonLabel("OUT_OF_AREA")).toBe("Outside Pune / PCMC");
  });

  it("humanises unknown codes instead of showing them raw", () => {
    expect(reasonLabel("TIMELINE_TOO_TIGHT")).toBe("Timeline too tight");
    expect(reasonLabel(null)).toBe("No reason recorded");
  });
});

describe("outcomes", () => {
  it("picks the furthest-along outcome for a booking", () => {
    expect(strongestOutcome([{ outcome: "held" }, { outcome: "won" }])?.outcome).toBe("won");
    expect(strongestOutcome([{ outcome: "held" }, { outcome: "no_show" }])?.outcome).toBe("no_show");
    expect(strongestOutcome([])).toBeUndefined();
  });
});

describe("projectLine", () => {
  it("joins what was captured, skipping what wasn't", () => {
    expect(projectLine({ area: "Baner", sizeSqFt: "1000", propertyType: "Home" })).toBe("Baner · 1000 sq ft · Home");
    expect(projectLine({ area: "Aundh" })).toBe("Aundh");
    expect(projectLine({})).toBe("—");
  });
});

describe("parseTranscript", () => {
  it("splits seeded front-desk transcripts into agent/caller turns, with the heading as title", () => {
    const { title, turns } = parseTranscript(
      "# T01 · Phone · 2 September\n\nFront Desk: Good morning.\nCaller: Hi, I'm Priya.\n\nNote: Existing client."
    );
    expect(title).toBe("Phone · 2 September");
    expect(turns.map((t) => t.kind)).toEqual(["agent", "caller", "note"]);
    expect(turns[1].text).toBe("Hi, I'm Priya.");
  });

  it("understands live Agent/User transcripts", () => {
    const { turns } = parseTranscript("Agent: Hello\nUser: Hi");
    expect(turns).toEqual([
      { kind: "agent", speaker: "Agent", text: "Hello" },
      { kind: "caller", speaker: "User", text: "Hi" },
    ]);
  });

  it("keeps non-speaker lines as captions instead of dropping them", () => {
    const { turns } = parseTranscript("First call — disconnected at 1 min 12 sec\nFront Desk: Hello.");
    expect(turns[0]).toEqual({ kind: "caption", speaker: "", text: "First call — disconnected at 1 min 12 sec" });
  });

  it("returns nothing for an empty transcript", () => {
    expect(parseTranscript(null).turns).toEqual([]);
    expect(parseTranscript("").turns).toEqual([]);
  });

  it("previews the caller's first substantive line", () => {
    const raw = "Front Desk: Good morning.\nCaller: Hi.\nCaller: I need to speak to someone right now. This is not acceptable.";
    expect(firstCallerLine(raw)).toBe("I need to speak to someone right now. This is not acceptable.");
    expect(firstCallerLine(null)).toBeUndefined();
  });
});

describe("hubspotDealUrl", () => {
  it("links only real, numeric deal ids", () => {
    expect(hubspotDealUrl("353588754108", "247647285", "https://app-na2.hubspot.com/")).toBe(
      "https://app-na2.hubspot.com/contacts/247647285/record/0-3/353588754108"
    );
  });

  it("refuses mock/seed ids and missing config", () => {
    expect(hubspotDealUrl("seed-deal-t01", "247647285", "https://app.hubspot.com")).toBeUndefined();
    expect(hubspotDealUrl("mock-deal-3", "247647285", "https://app.hubspot.com")).toBeUndefined();
    expect(hubspotDealUrl("353588754108", undefined, "https://app.hubspot.com")).toBeUndefined();
    expect(hubspotDealUrl(null, "247647285", "https://app.hubspot.com")).toBeUndefined();
  });
});
