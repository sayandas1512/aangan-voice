import { describe, expect, it } from "vitest";
import { signActionToken, verifyActionToken, buildActionUrl } from "@/lib/domain/action-link";

describe("signActionToken / verifyActionToken", () => {
  const payload = { callId: "call-1", bookingId: "booking-1", action: "held" as const };

  it("round-trips a signed token", () => {
    const token = signActionToken(payload);
    const verified = verifyActionToken(token);
    expect(verified?.callId).toBe(payload.callId);
    expect(verified?.bookingId).toBe(payload.bookingId);
    expect(verified?.action).toBe(payload.action);
  });

  it("rejects a tampered payload (action swapped after signing)", () => {
    const token = signActionToken(payload);
    const [body, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const tamperedBody = Buffer.from(JSON.stringify({ ...decoded, action: "won" })).toString("base64url");
    expect(verifyActionToken(`${tamperedBody}.${signature}`)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifyActionToken("not-a-real-token")).toBeNull();
    expect(verifyActionToken("")).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = signActionToken(payload, -1); // ttl in the past
    expect(verifyActionToken(token)).toBeNull();
  });
});

describe("buildActionUrl", () => {
  it("produces an absolute URL with the token as a query param", () => {
    const url = buildActionUrl({ callId: "call-1", bookingId: "booking-1", action: "won" });
    expect(url).toMatch(/^https?:\/\/.+\/api\/notifications\/action\?token=/);
    const token = new URL(url).searchParams.get("token")!;
    expect(verifyActionToken(token)?.action).toBe("won");
  });
});
