import { describe, expect, it } from "vitest";
import { isAfterHours } from "@/lib/domain/after-hours";

const config = { timezone: "Asia/Kolkata", hoursStart: "10:00", hoursEnd: "19:00" };

describe("isAfterHours", () => {
  it("is false for a call inside business hours (2pm IST)", () => {
    // 2026-10-09T08:30:00Z = 2026-10-09 14:00 IST
    expect(isAfterHours(new Date("2026-10-09T08:30:00.000Z"), config)).toBe(false);
  });

  it("is true for a call before opening (9am IST)", () => {
    // 2026-10-09T03:30:00Z = 2026-10-09 09:00 IST
    expect(isAfterHours(new Date("2026-10-09T03:30:00.000Z"), config)).toBe(true);
  });

  it("is true for a call at exactly closing time (7:00pm IST, half-open boundary)", () => {
    // 2026-10-09T13:30:00Z = 2026-10-09 19:00 IST
    expect(isAfterHours(new Date("2026-10-09T13:30:00.000Z"), config)).toBe(true);
  });

  it("is false one minute before closing (6:59pm IST)", () => {
    expect(isAfterHours(new Date("2026-10-09T13:29:00.000Z"), config)).toBe(false);
  });

  it("is true late at night (11pm IST)", () => {
    expect(isAfterHours(new Date("2026-10-09T17:30:00.000Z"), config)).toBe(true);
  });

  it("is false at exactly opening time (10:00am IST, inclusive start)", () => {
    expect(isAfterHours(new Date("2026-10-09T04:30:00.000Z"), config)).toBe(false);
  });
});
