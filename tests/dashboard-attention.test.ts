import { describe, expect, it } from "vitest";
import { followupReason } from "@/lib/domain/followup";
import {
  computeDailySeries,
  computeMetrics,
  deriveAttention,
  isFollowupOpen,
  type Snapshot,
} from "@/lib/domain/dashboard-metrics";

const NOW = new Date("2026-10-10T06:00:00Z");

function call(id: string, over: Partial<Snapshot["calls"][number]> = {}): Snapshot["calls"][number] {
  return {
    id,
    vaaniCallId: `v-${id}`,
    callerPhone: `+91-${id}`,
    startedAt: new Date("2026-09-10T05:00:00Z"),
    endedAt: new Date("2026-09-10T05:04:00Z"),
    durationSec: 240,
    afterHours: false,
    status: "completed",
    transcript: null,
    humanFollowup: false,
    followupResolvedAt: null,
    ...over,
  };
}

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    calls: [],
    answers: [],
    classifications: [],
    bookings: [],
    outcomes: [],
    notifications: [],
    hubspot: [],
    designers: [],
    priceGuardHits: 0,
    ...over,
  };
}

describe("isFollowupOpen", () => {
  const flagged = call("a", { humanFollowup: true });

  it("is closed when the call was never flagged", () => {
    expect(isFollowupOpen(call("a"), [call("a")], false)).toBe(false);
  });

  it("is open for a flagged call nothing has resolved", () => {
    expect(isFollowupOpen(flagged, [flagged], false)).toBe(true);
  });

  it("closes once the founder marks it handled", () => {
    const handled = call("a", { humanFollowup: true, followupResolvedAt: new Date() });
    expect(isFollowupOpen(handled, [handled], false)).toBe(false);
  });

  it("closes once the booking has an outcome logged", () => {
    expect(isFollowupOpen(flagged, [flagged], true)).toBe(false);
  });

  it("closes a dropped call when the same number later got through", () => {
    const dropped = call("d", { humanFollowup: true, status: "dropped", callerPhone: "+91-777" });
    const retry = call("r", { callerPhone: "+91-777", startedAt: new Date("2026-09-10T05:02:00Z"), status: "completed" });
    expect(isFollowupOpen(dropped, [dropped, retry], false)).toBe(false);
  });

  it("does not close on an earlier call, or one that also didn't get through", () => {
    const missed = call("m", { humanFollowup: true, status: "missed", callerPhone: "+91-888" });
    const earlier = call("e", { callerPhone: "+91-888", startedAt: new Date("2026-09-09T05:00:00Z"), status: "completed" });
    const alsoDropped = call("x", { callerPhone: "+91-888", startedAt: new Date("2026-09-11T05:00:00Z"), status: "dropped" });
    expect(isFollowupOpen(missed, [missed, earlier, alsoDropped], false)).toBe(true);
  });

  it("never pairs calls by the placeholder 'unknown' number", () => {
    const a = call("a", { humanFollowup: true, callerPhone: "unknown" });
    const b = call("b", { callerPhone: "unknown", startedAt: new Date("2026-09-11T05:00:00Z"), status: "completed" });
    expect(isFollowupOpen(a, [a, b], false)).toBe(true);
  });
});

describe("deriveAttention", () => {
  it("surfaces open follow-ups with a readable reason and the caller's own words", () => {
    const c = call("c1", {
      humanFollowup: true,
      status: "completed",
      transcript: "Front Desk: Good morning.\nCaller: I need to speak to someone right now about my project.",
    });
    const items = deriveAttention(snapshot({ calls: [c] }), NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "followup", resolvable: true });
    expect(items[0].detail).toContain("couldn't qualify");
    expect(items[0].preview).toContain("speak to someone right now");
  });

  it("describes missed and dropped calls specifically", () => {
    const missed = call("m", { humanFollowup: true, status: "missed", callerPhone: "+91-1" });
    const dropped = call("d", { humanFollowup: true, status: "dropped", callerPhone: "+91-2" });
    const details = deriveAttention(snapshot({ calls: [missed, dropped] }), NOW).map((i) => i.detail);
    expect(details.some((d) => d.startsWith("Missed call"))).toBe(true);
    expect(details.some((d) => d.startsWith("Call dropped"))).toBe(true);
  });

  it("asks for an outcome only on past, confirmed, outcome-less bookings", () => {
    const c = call("c2");
    const past = {
      id: "b-past",
      callId: "c2",
      status: "confirmed" as const,
      startAt: new Date("2026-09-15T05:00:00Z"),
      createdAt: new Date(),
      calcomUid: null,
      designerId: null,
      meetUrl: null,
    };
    const future = { ...past, id: "b-future", callId: "c3", startAt: new Date("2026-10-20T05:00:00Z") };
    const logged = { ...past, id: "b-logged", callId: "c4" };

    const snap = snapshot({
      calls: [c, call("c3"), call("c4")],
      bookings: [past, future, logged],
      outcomes: [{ id: "o1", bookingId: "b-logged", outcome: "held", amountInr: null, recordedAt: new Date() }],
    });
    const items = deriveAttention(snap, NOW).filter((i) => i.kind === "outcome");
    expect(items.map((i) => i.callId)).toEqual(["c2"]);
  });

  it("frames a missing outcome as the designer not having reported, by name", () => {
    const c = call("c9", { callerPhone: "+91-9999" });
    const snap = snapshot({
      calls: [c],
      designers: [{ id: "d1", name: "Rohan", calcomHostId: null, email: null, active: true, createdAt: new Date() }],
      bookings: [
        {
          id: "b9",
          callId: "c9",
          status: "confirmed",
          startAt: new Date("2026-09-15T05:00:00Z"),
          createdAt: new Date(),
          calcomUid: null,
          designerId: "d1",
          meetUrl: null,
        },
      ],
    });
    const [item] = deriveAttention(snap, NOW);
    expect(item.detail).toContain("Rohan hasn't reported");
    expect(item.actionLabel).toBe("Open");
  });

  it("puts broken integrations first, then follow-ups, then outcomes", () => {
    const followup = call("f", { humanFollowup: true, status: "missed", callerPhone: "+91-9" });
    const hub = call("h", { callerPhone: "+91-8" });
    const snap = snapshot({
      calls: [followup, hub],
      hubspot: [
        {
          id: "hs",
          callId: "h",
          contactId: null,
          dealId: null,
          status: "failed",
          attempts: 5,
          lastError: "401 unauthorized",
          createdAt: new Date(),
        },
      ],
    });
    expect(deriveAttention(snap, NOW).map((i) => i.kind)).toEqual(["system", "followup"]);
  });

  it("is empty when everything is in order", () => {
    expect(deriveAttention(snapshot({ calls: [call("ok")] }), NOW)).toEqual([]);
  });
});

describe("computeMetrics", () => {
  const calls = [
    call("old", { startedAt: new Date("2026-08-01T05:00:00Z"), afterHours: true }),
    call("new", { startedAt: new Date("2026-10-08T05:00:00Z") }),
  ];

  it("respects the selected range", () => {
    const snap = snapshot({ calls });
    expect(computeMetrics(snap).calls.total).toBe(2);
    expect(computeMetrics(snap, new Date("2026-10-03T00:00:00Z")).calls.total).toBe(1);
    expect(computeMetrics(snap).calls.afterHoursShare).toBe(0.5);
  });

  it("counts a booking once for 'held' even when held and won are both logged", () => {
    const booking = {
      id: "b1",
      callId: "new",
      status: "confirmed" as const,
      startAt: new Date("2026-10-09T05:00:00Z"),
      createdAt: new Date("2026-10-08T05:01:00Z"),
      calcomUid: null,
      designerId: null,
      meetUrl: null,
    };
    const snap = snapshot({
      calls,
      bookings: [booking],
      outcomes: [
        { id: "o1", bookingId: "b1", outcome: "held", amountInr: null, recordedAt: new Date() },
        { id: "o2", bookingId: "b1", outcome: "won", amountInr: "2800000.00", recordedAt: new Date() },
      ],
    });
    const m = computeMetrics(snap);
    expect(m.funnel).toMatchObject({ booked: 1, held: 1, won: 1 });
    expect(m.value.wonInr).toBe(2800000);
    expect(m.value.openDeals).toBe(0);
  });

  it("labels 'no' reasons in plain English and ranks them", () => {
    const snap = snapshot({
      calls: [call("a"), call("b"), call("c")],
      classifications: [
        { id: "1", callId: "a", verdict: "no", reason: "r", reasonCode: "out_of_area", missingFields: [], model: "m", latencyMs: 1, createdAt: new Date() },
        { id: "2", callId: "b", verdict: "no", reason: "r", reasonCode: "OUT_OF_AREA", missingFields: [], model: "m", latencyMs: 1, createdAt: new Date() },
        { id: "3", callId: "c", verdict: "no", reason: "r", reasonCode: "advisory_only", missingFields: [], model: "m", latencyMs: 1, createdAt: new Date() },
      ],
    });
    expect(computeMetrics(snap).funnel.noReasons).toEqual([
      { code: "Outside Pune / PCMC", label: "Outside Pune / PCMC", count: 2 },
      { code: "Wanted advice, not a project", label: "Wanted advice, not a project", count: 1 },
    ]);
  });
});

describe("computeDailySeries", () => {
  it("fills quiet days with zeros and splits after-hours", () => {
    const snap = snapshot({
      calls: [
        call("a", { startedAt: new Date("2026-10-08T05:00:00Z") }),
        call("b", { startedAt: new Date("2026-10-08T17:00:00Z"), afterHours: true }),
        call("c", { startedAt: new Date("2026-10-10T05:00:00Z") }),
      ],
    });
    const series = computeDailySeries(snap, undefined, NOW);
    expect(series.map((p) => p.day)).toEqual(["2026-10-08", "2026-10-09", "2026-10-10"]);
    expect(series[0]).toMatchObject({ inHours: 1, afterHours: 1 });
    expect(series[1]).toMatchObject({ inHours: 0, afterHours: 0 });
  });

  it("returns a single zero day when there are no calls", () => {
    expect(computeDailySeries(snapshot(), undefined, NOW)).toEqual([
      { day: "2026-10-10", inHours: 0, afterHours: 0 },
    ]);
  });
});

describe("followupReason", () => {
  it("describes each way a call ends up needing a person", () => {
    expect(followupReason({ status: "missed" })).toMatch(/^Missed call/);
    expect(followupReason({ status: "dropped" })).toMatch(/^Call dropped/);
    expect(followupReason({ status: "completed" })).toMatch(/couldn't qualify/);
    expect(followupReason({ status: "completed", classificationReason: "Timeline is too short. Caller will ring back." })).toBe(
      "Timeline is too short."
    );
  });
});

describe("owners", () => {
  it("assigns callbacks to the front desk, missing outcomes to the designer, failures to the system", () => {
    const missed = call("m", { humanFollowup: true, status: "missed", callerPhone: "+91-1" });
    const hub = call("h", { callerPhone: "+91-2" });
    const snap = snapshot({
      calls: [missed, hub],
      hubspot: [
        { id: "hs", callId: "h", contactId: null, dealId: null, status: "failed", attempts: 5, lastError: "x", createdAt: new Date() },
      ],
    });
    const owners = Object.fromEntries(deriveAttention(snap, NOW).map((i) => [i.kind, i.owner]));
    expect(owners).toEqual({ system: "system", followup: "front_desk" });
  });
});

describe("computeMetrics — what the brief asks the dashboard to prove", () => {
  const booking = (callId: string) => ({
    id: `b-${callId}`,
    callId,
    status: "confirmed" as const,
    startAt: new Date("2026-10-09T05:00:00Z"),
    createdAt: new Date("2026-10-08T05:01:00Z"),
    calcomUid: null,
    designerId: null,
    meetUrl: null,
  });
  const notification = (callId: string, endedAt: Date, secondsLater: number) => ({
    id: `n-${callId}`,
    callId,
    channel: "email" as const,
    status: "sent" as const,
    attempts: 1,
    sentAt: new Date(endedAt.getTime() + secondsLater * 1000),
    acknowledgedAt: null,
    error: null,
    createdAt: endedAt,
  });

  it("counts after-hours calls that still became a booking", () => {
    const snap = snapshot({
      calls: [call("night", { afterHours: true }), call("night2", { afterHours: true }), call("day")],
      bookings: [booking("night"), booking("day")],
    });
    expect(computeMetrics(snap).calls).toMatchObject({ afterHours: 2, afterHoursBooked: 1 });
  });

  it("measures the designer email against the five-minute target", () => {
    const ended = new Date("2026-09-10T05:04:00Z");
    const snap = snapshot({
      calls: [call("a", { endedAt: ended }), call("b", { endedAt: ended }), call("c", { endedAt: ended })],
      notifications: [notification("a", ended, 20), notification("b", ended, 299), notification("c", ended, 420)],
    });
    expect(computeMetrics(snap).speed).toMatchObject({ emailWithin5Min: 2, emailCount: 3 });
  });

  it("projects the monthly running cost from the per-call cost at the expected volume", () => {
    const m = computeMetrics(snapshot({ calls: [call("a", { durationSec: 120 }), call("b", { durationSec: 240 })] }));
    expect(m.cost.projectedMonthlyInr).not.toBeNull();
    // Voice-only here (no fixed cost configured): per-call cost scaled to the expected volume.
    expect(m.cost.projectedMonthlyInr!).toBeCloseTo(m.cost.perCallInr * 200, 1);
    expect(computeMetrics(snapshot()).cost.projectedMonthlyInr).toBeNull();
  });

  it("separates 'callers asked for a price' from 'the assistant used price language'", () => {
    const asked = call("asked", {
      transcript: "Caller: roughly how much would that cost?\nFront Desk: It depends on the site. The consultation will cover that.",
    });
    const slipped = call("slipped", { transcript: "Agent: that would be around 10 lakh for the full scope." });
    const quiet = call("quiet", { transcript: "Agent: Hello.\nUser: Hi." });
    const snap = snapshot({ calls: [asked, slipped, quiet], bookings: [booking("asked")] });
    expect(computeMetrics(snap).price).toEqual({ asked: 1, bookedAnyway: 1, assistantPriceLanguage: 1 });
  });
});
