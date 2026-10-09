import { describe, expect, it } from "vitest";
import { backoffMinutes, nextRunAt, isExhausted, MAX_RETRY_ATTEMPTS } from "@/lib/domain/retry";

describe("backoffMinutes", () => {
  it("doubles each attempt: 1, 2, 4, 8, 16, 32", () => {
    expect(backoffMinutes(1)).toBe(1);
    expect(backoffMinutes(2)).toBe(2);
    expect(backoffMinutes(3)).toBe(4);
    expect(backoffMinutes(4)).toBe(8);
    expect(backoffMinutes(5)).toBe(16);
    expect(backoffMinutes(6)).toBe(32);
  });

  it("caps at capMinutes instead of growing unbounded", () => {
    expect(backoffMinutes(10, 60)).toBe(60);
  });
});

describe("nextRunAt", () => {
  it("schedules backoffMinutes(attempt) minutes after the given now", () => {
    const now = new Date("2026-10-09T10:00:00.000Z");
    const result = nextRunAt(3, now); // backoff 4 min
    expect(result.toISOString()).toBe("2026-10-09T10:04:00.000Z");
  });
});

describe("isExhausted", () => {
  it("is false before MAX_RETRY_ATTEMPTS", () => {
    expect(isExhausted(MAX_RETRY_ATTEMPTS - 1)).toBe(false);
  });

  it("is true at and beyond MAX_RETRY_ATTEMPTS", () => {
    expect(isExhausted(MAX_RETRY_ATTEMPTS)).toBe(true);
    expect(isExhausted(MAX_RETRY_ATTEMPTS + 1)).toBe(true);
  });
});
