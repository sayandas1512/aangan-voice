import { describe, expect, it } from "vitest";
import { primaryIdempotencyKey, fallbackIdempotencyKey } from "@/lib/domain/idempotency";

describe("primaryIdempotencyKey", () => {
  it("is stable for the same vaani call id", () => {
    expect(primaryIdempotencyKey("call_123")).toBe(primaryIdempotencyKey("call_123"));
  });

  it("differs for different call ids", () => {
    expect(primaryIdempotencyKey("call_123")).not.toBe(primaryIdempotencyKey("call_456"));
  });
});

describe("fallbackIdempotencyKey", () => {
  it("is the same for two deliveries of the same call seconds apart", () => {
    const a = fallbackIdempotencyKey("+91 90000 00001", new Date("2026-10-09T08:30:00.000Z"));
    const b = fallbackIdempotencyKey("+91-90000-00001", new Date("2026-10-09T08:30:45.000Z"));
    expect(a).toBe(b);
  });

  it("normalizes phone number formatting differences", () => {
    const a = fallbackIdempotencyKey("+91 90000 00001", new Date("2026-10-09T08:30:00.000Z"));
    const b = fallbackIdempotencyKey("+919000000001", new Date("2026-10-09T08:30:00.000Z"));
    expect(a).toBe(b);
  });

  it("differs once the window boundary is crossed", () => {
    const a = fallbackIdempotencyKey("+91-90000-00001", new Date("2026-10-09T08:30:00.000Z"), 5);
    const b = fallbackIdempotencyKey("+91-90000-00001", new Date("2026-10-09T08:40:00.000Z"), 5);
    expect(a).not.toBe(b);
  });

  it("differs for different callers in the same window", () => {
    const a = fallbackIdempotencyKey("+91-90000-00001", new Date("2026-10-09T08:30:00.000Z"));
    const b = fallbackIdempotencyKey("+91-90000-00002", new Date("2026-10-09T08:30:00.000Z"));
    expect(a).not.toBe(b);
  });
});
